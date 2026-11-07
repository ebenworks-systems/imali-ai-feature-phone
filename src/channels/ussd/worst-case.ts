/**
 * The longest realistic data, and the sessions that walk every menu screen with it.
 *
 * Shared by the tests and by `npm run check:screens`, so the screen limits are checked against the same worst
 * case in both places. Everything here is invented: the shop, the customers and the phone number (in the fiction
 * range `+27 00 000 xxxx`).
 *
 * - A 24-character shop name, 20-character customer names and items, amounts of 999,999.99.
 * - Three sales, an expense, ten debts and two payments today, so every total on the aggregate screens (today,
 *   close, who owes) reaches 15 characters in `GHS`, the widest symbol, and no more.
 * - Each session is run on a fresh store, once for each of the seven currencies, by pressing the inputs one by one.
 * - A session with `channel: 'text'` is a text-message conversation instead: each input is one message sent through
 *   `handleText`, and each reply is checked against the 160-character limit.
 *
 * The time is passed in; the clock is never read.
 */

import {
  createShop,
  recordDebt,
  recordExpense,
  recordPayment,
  recordSale,
  type Currency,
  type LedgerStore,
  type Shop
} from '../../core/index.js';
import { MemoryStore } from '../../store/memory/store.js';
import { InMemoryPendingStore } from '../sms/pending.js';
import { handleText } from '../sms/handler.js';
import { runMenu } from './handler.js';
import { recordIdFor } from './ids.js';
import { COUNTRIES } from './ports.js';
import type { ScreenId } from './screen.js';

export const WORST_PHONE = '+27000001234';
/** A phone number with no shop, for the sign-up sessions. */
export const WORST_NEW_PHONE = '+27000005555';
export const WORST_SHOP_NAME = "Nomsa's Corner Tuck Shop"; // 24 characters
export const WORST_ITEM = 'Maize meal 12.5kg x2'; // 20 characters
export const WORST_CUSTOMERS = Array.from(
  { length: 10 },
  (_, i) => `Longname Customer ${String(i + 1).padStart(2, '0')}` // 20 characters
);
export const WORST_TIME_ZONE = 'Africa/Johannesburg';
/** 999,999.99 in cents. */
export const WORST_AMOUNT = 99_999_999;

export const ALL_CURRENCIES: readonly Currency[] = ['ZAR', 'USD', 'KES', 'NGN', 'GHS', 'ZMW', 'BWP'];

const ENTRY = { channel: 'sms' as const, originalWords: 'worst case' };
const confirmed = (cents: number) => ({ cents, requiresConfirmation: false });

/** Makes the shop only. */
export async function seedShopOnly(store: LedgerStore, currency: Currency, now: Date, phone = WORST_PHONE): Promise<Shop> {
  const shop: Shop = {
    ...createShop({ name: WORST_SHOP_NAME, phone, currency, timeZone: WORST_TIME_ZONE }),
    createdAt: now.toISOString()
  };
  await store.createShop(shop);
  return shop;
}

/** Makes the shop and its worst-case records, all dated `now`. */
export async function seedWorstCase(store: LedgerStore, currency: Currency, now: Date): Promise<Shop> {
  const shop = await seedShopOnly(store, currency, now);
  const common = { ...ENTRY, now };

  for (let i = 0; i < 3; i += 1) {
    await recordSale(store, shop, { ...common, amount: confirmed(WORST_AMOUNT), item: WORST_ITEM });
  }
  await recordExpense(store, shop, { ...common, amount: confirmed(WORST_AMOUNT), item: WORST_ITEM });
  for (const [i, customer] of WORST_CUSTOMERS.entries()) {
    await recordDebt(store, shop, {
      ...common,
      amount: confirmed(WORST_AMOUNT - (i + 1)),
      customer,
      item: WORST_ITEM
    });
  }
  // Customers 01 and 02 pay nearly all of it back, so "paid back" is also a long figure.
  await recordPayment(store, shop, { ...common, amount: confirmed(WORST_AMOUNT - 2), customer: WORST_CUSTOMERS[0]! });
  await recordPayment(store, shop, { ...common, amount: confirmed(WORST_AMOUNT - 3), customer: WORST_CUSTOMERS[1]! });
  return shop;
}

/**
 * Figures too big for the closing summary to fit even without the date and the counts, all still safe whole
 * numbers of cents.
 */
export async function seedHugeFigures(store: LedgerStore, shop: Shop, now: Date): Promise<void> {
  const common = { ...ENTRY, now };
  await recordSale(store, shop, { ...common, amount: confirmed(4_400_000_000_000_091) });
  await recordExpense(store, shop, { ...common, amount: confirmed(4_000_000_000_000_091) });
  await recordDebt(store, shop, { ...common, amount: confirmed(9_000_000_000_000_091), customer: WORST_CUSTOMERS[0]! });
  await recordPayment(store, shop, { ...common, amount: confirmed(4_400_000_000_000_091), customer: WORST_CUSTOMERS[1]! });
}

// ============================================================================
// The sessions
// ============================================================================

export interface WorstSession {
  name: string;
  /** `menu` (the default): the dialled menu. `text`: a text-message conversation, one message per input. */
  channel?: 'menu' | 'text';
  /** What the owner presses (or sends), one entry at a time. A function when it depends on the currency (sign-up). */
  inputs: string[] | ((currency: Currency) => string[]);
  /** Default `ATUid_worst`. An empty string makes a bad request. */
  sessionId?: string;
  /** The phone number. Default is the worst-case shop's. */
  phone?: string;
  /** Make no shop: the sign-up sessions. */
  noShop?: boolean;
  /** Make the shop but none of its records (nothing to undo, nobody owes). */
  bare?: boolean;
  /** Add the huge figures instead of the worst-case records. */
  hugeFigures?: boolean;
  /** Add records after the worst-case ones. */
  prepare?: (store: LedgerStore, shop: Shop, now: Date) => Promise<void>;
}

const NAME20 = WORST_CUSTOMERS[0]!;
const AMOUNT = '999999.99';
const CLASH_SESSION = 'ATUid_clash';

const lastRecord =
  (kind: 'sale' | 'expense' | 'debt' | 'payment') =>
  async (store: LedgerStore, shop: Shop, now: Date): Promise<void> => {
    const common = { ...ENTRY, now, amount: confirmed(WORST_AMOUNT) };
    if (kind === 'sale') await recordSale(store, shop, { ...common, item: WORST_ITEM });
    if (kind === 'expense') await recordExpense(store, shop, { ...common, item: WORST_ITEM });
    if (kind === 'debt') await recordDebt(store, shop, { ...common, customer: WORST_CUSTOMERS[9]!, item: WORST_ITEM });
    if (kind === 'payment') await recordPayment(store, shop, { ...common, customer: WORST_CUSTOMERS[9]! });
  };

export const WORST_SESSIONS: readonly WorstSession[] = [
  // The first call, and a request that cannot be read.
  { name: 'first call', inputs: [] },
  { name: 'bad request', inputs: [], sessionId: '' },

  // Sign-up: refusals, then each currency.
  {
    name: 'sign-up',
    noShop: true,
    phone: WORST_NEW_PHONE,
    inputs: (currency) => [WORST_SHOP_NAME, String(COUNTRIES.findIndex((c) => c.currency === currency) + 1), '1']
  },
  {
    name: 'sign-up refused',
    noShop: true,
    phone: WORST_NEW_PHONE,
    inputs: ['a'.repeat(25), '  ', 'Caf\u00e9', WORST_SHOP_NAME, '9', '0', '00']
  },

  // Wrong numbers on every choice screen.
  { name: 'wrong number at the main menu', inputs: ['x'] },
  { name: 'wrong number at confirm', inputs: ['1', AMOUNT, WORST_ITEM, '7'] },
  { name: 'wrong number at the big-amount confirm', inputs: ['1', '1500000', WORST_ITEM, '1', '7'] },
  { name: 'wrong number at the paid-back list', inputs: ['4', 'x'] },
  { name: 'wrong number at the who-owes list', inputs: ['6', 'x'] },
  { name: 'wrong number at undo', inputs: ['7', 'x'] },

  // Sale, expense and owes with the longest data.
  { name: 'sale', inputs: ['1', AMOUNT, WORST_ITEM, '1'] },
  { name: 'sale with no item', inputs: ['1', AMOUNT, '1', '1'] },
  { name: 'sale refused amounts', inputs: ['1', 'abc', '0.00', '-5', '99999999999999', AMOUNT, WORST_ITEM, '2'] },
  { name: 'sale refused item', inputs: ['1', AMOUNT, '', 'x'.repeat(21), 'Caf\u00e9', WORST_ITEM, '1'] },
  { name: 'expense', inputs: ['2', AMOUNT, WORST_ITEM, '1'] },
  { name: 'owes', inputs: ['3', NAME20, AMOUNT, WORST_ITEM, '1'] },
  { name: 'owes refused names', inputs: ['3', '45', 'x'.repeat(21), 'Ren\u00e9', '', NAME20, '0x', AMOUNT, WORST_ITEM, '2'] },
  { name: 'back and menu', inputs: ['3', NAME20, AMOUNT, WORST_ITEM, '0', '0', '0', '00', '5'] },

  // Paid back: the list, its pages and Other name.
  { name: 'paid back from the list', inputs: ['4', '3', AMOUNT, '1'] },
  { name: 'paid back from page 2', inputs: ['4', '9', '1', AMOUNT, '1'] },
  { name: 'paid back from the last page', inputs: ['4', '9', '9', '9', '1', AMOUNT, '1'] },
  { name: 'paid back, other name', inputs: ['4', '8', NAME20, AMOUNT, '1'] },
  { name: 'paid back, refused', inputs: ['4', '9', '9', '9', '9', '5', '0', '0', '0', '0'] },

  // Big amounts.
  { name: 'big amount', inputs: ['1', '1500000', WORST_ITEM, '1', '1'] },
  { name: 'big amount, no', inputs: ['2', '1500000', WORST_ITEM, '1', '2'] },
  { name: 'largest amount', inputs: ['3', NAME20, '90071992547409.91', WORST_ITEM, '1'] },

  // Who owes, page by page.
  { name: 'who owes, all pages', inputs: ['6', '9', '9', '9'] },
  { name: 'who owes, back', inputs: ['6', '9', '0', '0'] },

  // Today and close.
  { name: 'today', inputs: ['5'] },
  { name: 'close', inputs: ['8'] },

  // Undo of each kind.
  { name: 'undo a sale', inputs: ['7', '1'], prepare: lastRecord('sale') },
  { name: 'undo an expense', inputs: ['7', '1'], prepare: lastRecord('expense') },
  { name: 'undo an owes entry', inputs: ['7', '1'], prepare: lastRecord('debt') },
  { name: 'undo a payment', inputs: ['7', '1'], prepare: lastRecord('payment') },
  { name: 'undo, no', inputs: ['7', '2'], prepare: lastRecord('debt') },

  // A shop with no records.
  { name: 'nobody owes', inputs: ['6'], bare: true },
  { name: 'nothing to undo', inputs: ['7'], bare: true },
  { name: 'empty day', inputs: ['5', '8'], bare: true },
  { name: 'paid back, nobody owes', inputs: ['4', NAME20, AMOUNT, '1'], bare: true },

  // The failures.
  {
    name: 'save failed',
    inputs: ['1', '45', '1', '1'],
    sessionId: CLASH_SESSION,
    prepare: async (store, shop, now) => {
      await recordSale(store, shop, {
        ...ENTRY,
        now,
        id: recordIdFor(CLASH_SESSION, 4),
        amount: confirmed(9900)
      });
    }
  },
  { name: 'too big', inputs: ['8'], hugeFigures: true },

  // Text-message conversations, with the same worst-case data.
  { name: 'text: sold', channel: 'text', inputs: ['sold 3 Maize meal 999999.99', 'sold 999999.99'] },
  { name: 'text: spent', channel: 'text', inputs: ['spent 999999.99 Maize meal', 'spent 999999.99'] },
  {
    name: 'text: owes',
    channel: 'text',
    inputs: [`${NAME20} owes 999999.99 Maize meal`, `${WORST_CUSTOMERS[2]!} owes 999999.99`]
  },
  {
    name: 'text: paid',
    channel: 'text',
    inputs: [`${WORST_CUSTOMERS[2]!} paid 999999.99`, `${WORST_CUSTOMERS[0]!} paid 999999.99`, `${NAME20} paid 0.01`]
  },
  { name: 'text: undo a sale', channel: 'text', inputs: ['sold 3 Maize meal 999999.99', 'undo'] },
  { name: 'text: undo an expense', channel: 'text', inputs: ['spent 999999.99 Maize meal', 'undo'] },
  { name: 'text: undo an owes entry', channel: 'text', inputs: [`${NAME20} owes 999999.99 Maize meal`, 'undo'] },
  { name: 'text: undo a payment', channel: 'text', inputs: [`${WORST_CUSTOMERS[2]!} paid 999999.99`, 'undo'] },
  { name: 'text: undo, nothing left', channel: 'text', bare: true, inputs: ['undo'] },
  { name: 'text: today', channel: 'text', inputs: ['today'] },
  { name: 'text: who owes with pages', channel: 'text', inputs: ['who owes', 'owes 2', 'owes 3', 'owes 4', 'owes 9'] },
  { name: 'text: nobody owes', channel: 'text', bare: true, inputs: ['who owes'] },
  { name: 'text: close', channel: 'text', inputs: ['close'] },
  { name: 'text: close, huge figures', channel: 'text', hugeFigures: true, inputs: ['close', 'today'] },
  { name: 'text: help', channel: 'text', inputs: ['help', '?'] },
  { name: 'text: unknown', channel: 'text', inputs: ['xyzzy', `${'blah '.repeat(60)}`] },
  { name: 'text: two amounts, first', channel: 'text', inputs: ['sold 2 200', '1'] },
  { name: 'text: two amounts, second', channel: 'text', inputs: ['sold 2 200', '2'] },
  { name: 'text: over 1,000,000, yes', channel: 'text', inputs: ['sold 1500000', 'yes'] },
  { name: 'text: over 1,000,000, no', channel: 'text', inputs: [`${NAME20} owes 1500000`, 'no'] },
  { name: 'text: too big', channel: 'text', inputs: ['sold 90071992547409.91', 'sold 99999999999999'] },
  {
    name: 'text: sign-up',
    channel: 'text',
    noShop: true,
    phone: WORST_NEW_PHONE,
    inputs: ['hi', 'a'.repeat(25), WORST_SHOP_NAME, 'sold 45 bread', 'today']
  }
];

/** The dialled-menu sessions. */
export const MENU_SESSIONS: readonly WorstSession[] = WORST_SESSIONS.filter((s) => s.channel !== 'text');
/** The text-message conversations. */
export const TEXT_SESSIONS: readonly WorstSession[] = WORST_SESSIONS.filter((s) => s.channel === 'text');

// ============================================================================
// Running them
// ============================================================================

export interface ShownScreen {
  /** The path sent. */
  text: string;
  response: string;
  screen: ScreenId;
}

/** The store for a session: the shop and its records as the session asks. */
async function storeFor(session: WorstSession, currency: Currency, now: Date): Promise<MemoryStore> {
  const store = new MemoryStore();
  const phone = session.phone ?? WORST_PHONE;
  if (!session.noShop) {
    const shop = session.hugeFigures
      ? await seedShopOnly(store, currency, now, phone)
      : session.bare
        ? await seedShopOnly(store, currency, now, phone)
        : await seedWorstCase(store, currency, now);
    if (session.hugeFigures) await seedHugeFigures(store, shop, now);
    await session.prepare?.(store, shop, now);
  }
  return store;
}

function inputsOf(session: WorstSession, currency: Currency): string[] {
  return typeof session.inputs === 'function' ? session.inputs(currency) : session.inputs;
}

/** Runs one menu session for one currency on a fresh store, pressing the inputs one by one after the first call. */
export async function runWorstSession(
  session: WorstSession,
  currency: Currency,
  now: Date
): Promise<ShownScreen[]> {
  const store = await storeFor(session, currency, now);
  const phone = session.phone ?? WORST_PHONE;
  const inputs = inputsOf(session, currency);
  const sessionId = session.sessionId ?? 'ATUid_worst';
  const shown: ShownScreen[] = [];
  for (let n = 0; n <= inputs.length; n += 1) {
    const text = inputs.slice(0, n).join('*');
    const { response, screen } = await runMenu({
      sessionId,
      serviceCode: '*384*1234#',
      phoneNumber: phone,
      text,
      now,
      store
    });
    shown.push({ text, response, screen });
  }
  return shown;
}

export interface ShownReply {
  /** The message sent. */
  message: string;
  reply: string;
}

/** Runs one text-message conversation for one currency on a fresh store, one message at a time. */
export async function runWorstTextSession(
  session: WorstSession,
  currency: Currency,
  now: Date
): Promise<ShownReply[]> {
  const store = await storeFor(session, currency, now);
  const pending = new InMemoryPendingStore({ now: () => now });
  const phone = session.phone ?? WORST_PHONE;
  const shown: ShownReply[] = [];
  for (const message of inputsOf(session, currency)) {
    const { reply } = await handleText({ phone, text: message, now, store, pending });
    shown.push({ message, reply });
  }
  return shown;
}
