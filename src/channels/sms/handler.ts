/**
 * SMS handler - one text message in, one reply out.
 *
 * The order of things for each message:
 *
 * 1. A phone with no shop is a new owner. The first message gets the welcome; the next one is the shop name.
 * 2. If a question is waiting (which amount? yes to a very big amount?), the message is the answer. Any
 *    message clears the question first, so a question is answered once at most. A message that is not an
 *    answer is then read as a normal message.
 * 3. The fixed rules read the message (readIntent). Only if they cannot, and a model reader was passed, the
 *    model proposes, and src/ai/check.ts checks the proposal against the owner's own words.
 * 4. The intent is carried out with the core operations and queries, using the shop's own time zone, and the
 *    reply is built by replies.ts or prompts.ts.
 *
 * Nothing here keeps state of its own: the ledger is the LedgerStore and the questions are the PendingStore,
 * both passed in.
 */

import {
  createShop,
  customerDisplayName,
  customerKey,
  formatCents,
  getCustomerBalance,
  getDayCloseSummary,
  getTodaySummary,
  getWhoOwes,
  recordDebt,
  recordExpense,
  recordPayment,
  recordSale,
  requiresConfirmation,
  undoLastRecord,
  validateAmount,
  validateShopName,
  type LedgerStore,
  type ParsedAmount,
  type RecordKind,
  type RecordResult,
  type Shop
} from '../../core/index.js';
import type { ModelReader } from '../../ai/reader.js';
import { checkProposal } from '../../ai/check.js';
import { normalizePhone } from '../phone.js';
import { PENDING_TTL_MS, type PendingQuestion, type PendingStore } from './pending.js';
import {
  AMOUNT_MUST_BE_MORE_THAN_ZERO,
  AMOUNT_TOO_BIG,
  ASK_SHOP_NAME_AGAIN,
  NOT_SAVED,
  TRY_AGAIN,
  WELCOME,
  askConfirmLargeAmount,
  askWhichAmount,
  cleanShopName,
  shopReady
} from './prompts.js';
import { buildReply } from './replies.js';
import {
  readIntent,
  type DebtIntent,
  type ExpenseIntent,
  type Intent,
  type PaymentIntent,
  type SaleIntent
} from './reader.js';

// ============================================================================
// Public types
// ============================================================================

export interface HandleTextParams {
  /** The owner's phone number, as the SMS gateway gives it. */
  phone: string;
  /** The message exactly as the owner typed it. */
  text: string;
  /** The time of the message. "Today" is the shop's local day at this time. */
  now: Date;
  store: LedgerStore;
  pending: PendingStore;
  /** Optional. Asked only when the fixed rules cannot read the message. */
  reader?: ModelReader;
}

export interface HandleTextResult {
  /** The reply to send: plain ASCII, at most 160 characters. */
  reply: string;
}

/** A message longer than this is not read. A real record is a few words; this keeps odd input out. */
export const MAX_TEXT_LENGTH = 500;

const DEFAULT_CURRENCY = 'ZAR';
const DEFAULT_TIME_ZONE = 'Africa/Johannesburg';

type Recordable = SaleIntent | ExpenseIntent | DebtIntent | PaymentIntent;

interface Context {
  shop: Shop;
  store: LedgerStore;
  pending: PendingStore;
  phone: string;
  now: Date;
}

// ============================================================================
// Entry point
// ============================================================================

export async function handleText(params: HandleTextParams): Promise<HandleTextResult> {
  // The dialled menu finds the shop by the normalised number ("+27 00 000 1234" and "+27000001234" are one phone),
  // so a text does too. A number that cannot be normalised is used as it was written.
  const written = params.phone.trim();
  const phone = normalizePhone(written) ?? written;
  const text = typeof params.text === 'string' ? params.text : '';
  const { store, pending, now, reader } = params;

  // A shop stored under the number as written (before numbers were normalised) is still found.
  const shop = (await store.findShopByPhone(phone)) ?? (phone !== written ? await store.findShopByPhone(written) : null);
  if (!shop) {
    return { reply: await signUp({ store, pending, phone, now }, text) };
  }
  const ctx: Context = { shop, store, pending, phone, now };

  // A waiting question: any message clears it first, so it can only be answered once.
  const question = await livePending(pending, phone, now);
  if (question) {
    await pending.clear(phone);
    const answered = await answerQuestion(ctx, question, text);
    if (answered !== null) {
      return { reply: answered };
    }
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return { reply: unknownReply(shop) };
  }

  let intent = readIntent(text, shop.currency);
  if (intent.kind === 'unknown' && reader) {
    const proposal = await askModel(reader, text);
    if (proposal !== null) {
      intent = checkProposal(proposal, text, shop.currency);
    }
  }
  return { reply: await carryOut(ctx, intent, text) };
}

// ============================================================================
// New owners
// ============================================================================

async function signUp(
  c: { store: LedgerStore; pending: PendingStore; phone: string; now: Date },
  text: string
): Promise<string> {
  const question = await livePending(c.pending, c.phone, c.now);

  if (question?.kind !== 'signup') {
    // First message from this phone (or the welcome was sent too long ago): say welcome and wait for a name.
    await c.pending.set(c.phone, { kind: 'signup', createdAt: c.now });
    return WELCOME;
  }

  const name = text.length > MAX_TEXT_LENGTH ? null : cleanShopName(text);
  if (name === null || !validateShopName(name)) {
    await c.pending.set(c.phone, { kind: 'signup', createdAt: c.now });
    return ASK_SHOP_NAME_AGAIN;
  }

  const shop: Shop = {
    ...createShop({ name, phone: c.phone, currency: DEFAULT_CURRENCY, timeZone: DEFAULT_TIME_ZONE }),
    createdAt: c.now.toISOString()
  };
  await c.store.createShop(shop);
  await c.pending.clear(c.phone);
  return shopReady(shop.name);
}

// ============================================================================
// Waiting questions
// ============================================================================

/** The open question, or null. A question older than 10 minutes is cleared even if the store kept it. */
async function livePending(
  pending: PendingStore,
  phone: string,
  now: Date
): Promise<PendingQuestion | null> {
  const question = await pending.get(phone);
  if (!question) return null;
  const asked = new Date(question.createdAt).getTime();
  if (Number.isFinite(asked) && now.getTime() - asked > PENDING_TTL_MS) {
    await pending.clear(phone);
    return null;
  }
  return question;
}

/**
 * Use the message as the answer to the question. Returns the reply, or null when the message is not an
 * answer and should be read as a normal message. "no" cancels with a friendly reply.
 */
async function answerQuestion(
  c: Context,
  question: PendingQuestion,
  text: string
): Promise<string | null> {
  const words = question.originalWords ?? text;

  if (question.kind === 'ambiguous' && question.intent?.kind === 'ambiguous') {
    const pick = /^\s*([12])\s*$/.exec(text);
    if (pick) {
      const option = question.intent.options[Number(pick[1]) - 1];
      if (option) {
        const base = question.intent.base.kind;
        const intent: Recordable =
          base === 'sale'
            ? { kind: 'sale', cents: option.cents, ...(option.quantity !== undefined ? { quantity: option.quantity } : {}) }
            : { kind: 'expense', cents: option.cents };
        return saveOrAsk(c, intent, words, false);
      }
    }
  }

  if (question.kind === 'largeAmount' && isYes(text)) {
    const intent = question.intent;
    if (
      intent?.kind === 'sale' ||
      intent?.kind === 'expense' ||
      intent?.kind === 'debt' ||
      intent?.kind === 'payment'
    ) {
      return saveOrAsk(c, intent, words, true);
    }
  }

  if (question.kind !== 'signup' && isNo(text)) {
    return NOT_SAVED;
  }
  return null;
}

function isYes(text: string): boolean {
  return /^\s*yes\s*$/i.test(text);
}

function isNo(text: string): boolean {
  return /^\s*no\s*$/i.test(text);
}

// ============================================================================
// The model reader
// ============================================================================

/** The reader should never throw, but a reader that does must not stop the owner getting a reply. */
async function askModel(reader: ModelReader, text: string) {
  try {
    return await reader.read(text);
  } catch {
    return null;
  }
}

// ============================================================================
// Carrying out an intent
// ============================================================================

async function carryOut(c: Context, intent: Intent, text: string): Promise<string> {
  const { shop, store, now } = c;

  switch (intent.kind) {
    case 'sale':
    case 'expense':
    case 'debt':
    case 'payment':
      return saveOrAsk(c, intent, text, false);

    case 'ambiguous':
      return askWhich(c, intent, text);

    case 'undo':
      return undo(c, text);

    case 'today': {
      const today = await getTodaySummary(store, shop, now);
      return buildReply({
        currency: shop.currency,
        today: {
          sales: today.sales.total,
          salesCount: today.sales.count,
          spent: today.expenses.total,
          inHand: today.moneyInHand
        }
      });
    }

    case 'whoOwes': {
      const debtors = await getWhoOwes(store, shop);
      return buildReply({
        currency: shop.currency,
        whoOwes: {
          debtors: debtors.map((d) => ({ name: d.displayName, owed: d.balance })),
          page: intent.page
        }
      });
    }

    case 'balance': {
      if (customerDisplayName(intent.customer) === '') return unknownReply(shop);
      const name = await knownName(c, intent.customer);
      const balance = await getCustomerBalance(store, shop, name);
      return buildReply({
        currency: shop.currency,
        balance: { customer: name, owed: Math.abs(balance), isCredit: balance < 0 }
      });
    }

    case 'close': {
      const close = await getDayCloseSummary(store, shop, { now });
      return buildReply({ currency: shop.currency, close });
    }

    case 'help':
    case 'unknown':
      return unknownReply(shop);
  }
}

function unknownReply(shop: Shop): string {
  return buildReply({ currency: shop.currency, unknown: true });
}

/** "sold 2 200": ask which one the owner meant, and wait for 1 or 2. */
async function askWhich(c: Context, intent: Extract<Intent, { kind: 'ambiguous' }>, text: string): Promise<string> {
  const { options } = intent;
  if (options.length !== 2 || options.some((o) => !Number.isSafeInteger(o.cents) || o.cents <= 0)) {
    return options.some((o) => !Number.isSafeInteger(o.cents)) ? AMOUNT_TOO_BIG : unknownReply(c.shop);
  }
  const [first, second] = options;
  const choice = (o: { cents: number; quantity?: number }) => ({
    cents: o.cents,
    ...(o.quantity !== undefined && Number.isSafeInteger(o.quantity) && o.quantity > 0 ? { quantity: o.quantity } : {})
  });
  const choices: [ReturnType<typeof choice>, ReturnType<typeof choice>] = [choice(first), choice(second)];

  await c.pending.set(c.phone, {
    kind: 'ambiguous',
    intent,
    possibleAmounts: choices.map((o) => ({ cents: o.cents, formatted: formatCents(o.cents, c.shop.currency) })),
    originalWords: text,
    createdAt: c.now
  });
  return askWhichAmount(choices, c.shop.currency);
}

/**
 * Check the amount, then save the record. A very big amount is not saved until the owner replies yes
 * (unless they already did: `confirmed`).
 */
async function saveOrAsk(c: Context, intent: Recordable, originalWords: string, confirmed: boolean): Promise<string> {
  if (!Number.isSafeInteger(intent.cents)) {
    return AMOUNT_TOO_BIG;
  }
  if (!validateAmount(intent.cents).valid) {
    return AMOUNT_MUST_BE_MORE_THAN_ZERO;
  }
  if (!(await hasRoom(c, intent))) {
    return AMOUNT_TOO_BIG;
  }
  if (!confirmed && requiresConfirmation(intent.cents)) {
    await c.pending.set(c.phone, {
      kind: 'largeAmount',
      intent,
      largeAmount: intent.cents,
      originalWords,
      createdAt: c.now
    });
    return askConfirmLargeAmount(
      intent.kind === 'debt' || intent.kind === 'payment'
        ? { kind: intent.kind, cents: intent.cents, customer: intent.customer }
        : { kind: intent.kind, cents: intent.cents },
      c.shop.currency
    );
  }
  return save(c, intent, originalWords);
}

/**
 * True when saving this amount leaves every figure the replies show a safe whole number of cents. An amount
 * that would push a total past that is refused before anything is saved, so a record is never saved and then
 * left without a reply.
 */
async function hasRoom(c: Context, intent: Recordable): Promise<boolean> {
  const { store, shop, now } = c;
  const safe = Number.isSafeInteger;
  const today = await getTodaySummary(store, shop, now);

  switch (intent.kind) {
    case 'sale':
      return safe(today.sales.total + intent.cents) && safe(today.moneyInHand + intent.cents);
    case 'expense':
      return safe(today.expenses.total + intent.cents);
    case 'debt': {
      const balance = await getCustomerBalance(store, shop, intent.customer);
      return (
        safe(balance + intent.cents) &&
        safe(today.newDebts + intent.cents) &&
        safe(today.totalOwed + intent.cents)
      );
    }
    case 'payment': {
      const balance = await getCustomerBalance(store, shop, intent.customer);
      return (
        safe(balance - intent.cents) &&
        safe(today.paymentsReceived + intent.cents) &&
        safe(today.moneyInHand + intent.cents)
      );
    }
  }
}

function isSaved(result: RecordResult): boolean {
  return 'success' in result && result.success === true;
}

async function save(c: Context, intent: Recordable, originalWords: string): Promise<string> {
  const { shop, store, now } = c;
  const currency = shop.currency;
  // The owner has been asked about a big amount already, so the core does not ask again.
  const amount: ParsedAmount = { cents: intent.cents, requiresConfirmation: false };
  const common = { amount, channel: 'sms' as const, originalWords, now };

  switch (intent.kind) {
    case 'sale': {
      const result = await recordSale(store, shop, { ...common, item: intent.item });
      if (!isSaved(result)) return TRY_AGAIN;
      const today = await getTodaySummary(store, shop, now);
      return buildReply({
        currency,
        sale: {
          amount: intent.cents,
          item: intent.item,
          qty: intent.quantity,
          todayTotal: today.sales.total,
          todayCount: today.sales.count
        }
      });
    }

    case 'expense': {
      const result = await recordExpense(store, shop, { ...common, item: intent.item });
      if (!isSaved(result)) return TRY_AGAIN;
      const today = await getTodaySummary(store, shop, now);
      return buildReply({
        currency,
        expense: { amount: intent.cents, item: intent.item, todayTotal: today.expenses.total }
      });
    }

    case 'debt': {
      const customer = await knownName(c, intent.customer);
      const result = await recordDebt(store, shop, { ...common, customer, item: intent.item });
      if (!isSaved(result)) return TRY_AGAIN;
      const balance = await getCustomerBalance(store, shop, customer);
      return buildReply({
        currency,
        debt: {
          customer,
          amount: intent.cents,
          item: intent.item,
          customerTotal: Math.abs(balance),
          isCredit: balance < 0
        }
      });
    }

    case 'payment': {
      const customer = await knownName(c, intent.customer);
      const result = await recordPayment(store, shop, { ...common, customer });
      if (!isSaved(result)) return TRY_AGAIN;
      const balance = await getCustomerBalance(store, shop, customer);
      return buildReply({
        currency,
        payment: { customer, amount: intent.cents, isCredit: balance < 0, balance: Math.abs(balance) }
      });
    }
  }
}

/**
 * The name to show for a customer: the way the shop first wrote it ("Tendai"), even when the owner types
 * "tendai" this time. A customer the shop has not seen before keeps the name as typed.
 */
async function knownName(c: Context, typed: string): Promise<string> {
  const name = customerDisplayName(typed);
  const key = customerKey(name);
  for (const record of await c.store.listRecords(c.shop.id)) {
    if ((record.kind === 'debt' || record.kind === 'payment') && record.customerKey === key) {
      return record.customerDisplayName;
    }
  }
  return name;
}

/** Undo adds a reversing record for the latest record that is not already undone. Nothing is deleted. */
async function undo(c: Context, originalWords: string): Promise<string> {
  const { shop, store, now } = c;
  const currency = shop.currency;

  const result = await undoLastRecord(store, shop, { channel: 'sms', originalWords, now });
  if (!result.success) {
    return result.error === 'Nothing to undo' ? buildReply({ currency, nothingToUndo: true }) : TRY_AGAIN;
  }

  const undone = result.data.reversedRecord;
  const kind = undone.kind as Exclude<RecordKind, 'reversal'>;

  if (kind === 'sale' || kind === 'expense') {
    const today = await getTodaySummary(store, shop, now);
    return buildReply({
      currency,
      undo: {
        kind,
        amount: undone.amount,
        item: undone.item,
        todayTotal: kind === 'sale' ? today.sales.total : today.expenses.total,
        todayCount: kind === 'sale' ? today.sales.count : undefined
      }
    });
  }

  const customer = undone.customer ?? '';
  const balance = await getCustomerBalance(store, shop, customer);
  return buildReply({
    currency,
    undo: {
      kind,
      amount: undone.amount,
      item: undone.item,
      customer,
      customerBalance: Math.abs(balance),
      isCredit: balance < 0
    }
  });
}
