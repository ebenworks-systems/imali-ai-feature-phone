/**
 * SMS replies - builds the text sent back to the owner.
 *
 * Pure functions: a context object goes in, a string comes out. No ledger calls, no I/O.
 *
 * Every reply is plain ASCII and at most 160 characters (one GSM-7 SMS). When a reply is too long the least
 * useful part is dropped first, in this order: the hint ("Reply undo to cancel."), then the item (with its
 * quantity). Words and numbers are never cut in half.
 *
 * Money is written only with formatCents. Money in the context is whole cents.
 *
 * Differences from the sketch in design.md (the design left these open):
 * - `currency` is required, because the reply has to write money in the shop's currency.
 * - Customer figures (`customerTotal`, `balance`, `owed`, `customerBalance`) are sizes, never negative.
 *   `isCredit: true` says the customer paid too much and the figure is what the shop owes them.
 * - `whoOwes` takes the whole list of customers. Which names fit on a page depends on how long the names
 *   are, so the page breaks are worked out here, not by the caller. `hasMore` is not needed.
 * - Replies with no figures have flags: `nothingToUndo`, `help`, `unknown`.
 */

import {
  formatCents,
  type Currency,
  type DayCloseSummary,
  type RecordKind
} from '../../core/index.js';

/** One text message. A longer reply is split and costs the owner twice. */
export const SMS_MAX_LENGTH = 160;

/** Wording that is the same every time. */
const HINT_UNDO = 'Reply undo to cancel.';
const NOTHING_TO_UNDO = 'Nothing to undo.';
const NOBODY_OWES = 'Nobody owes you money.';
const NO_MORE_NAMES = 'No more names. Reply owes for the first page.';
const SORRY =
  'Sorry, I did not get that. Try: sold 45 bread, spent 20 taxi, Tendai owes 30, today, who owes.';
/** The words requirement 40 uses for goods given on credit today. */
const CLOSE_NEW_DEBTS = 'credit given';
const CLOSE_PAYMENTS = 'paid back';
const FALLBACK_CUSTOMER = 'Customer';

// ============================================================================
// Context
// ============================================================================

export interface ReplyContext {
  /** The shop's currency. */
  currency: Currency;

  sale?: { amount: number; item?: string; qty?: number; todayTotal: number; todayCount: number };
  expense?: { amount: number; item?: string; todayTotal: number };
  debt?: {
    customer: string;
    amount: number;
    item?: string;
    /** What the customer owes now, in total (or the credit they have, when isCredit). */
    customerTotal: number;
    isCredit?: boolean;
  };
  payment?: {
    customer: string;
    amount: number;
    /** True when the customer paid more than they owed. */
    isCredit: boolean;
    /** What the customer owes now (or the credit they have, when isCredit). */
    balance: number;
  };
  undo?: {
    kind: Exclude<RecordKind, 'reversal'>;
    amount: number;
    item?: string;
    /** For a sale: sales today after the undo. For an expense: spent today after the undo. */
    todayTotal?: number;
    todayCount?: number;
    /** For a debt or payment: who it was for and where they stand after the undo. */
    customer?: string;
    customerBalance?: number;
    isCredit?: boolean;
  };
  /** There is no record to undo. */
  nothingToUndo?: boolean;
  today?: { sales: number; salesCount: number; spent: number; inHand: number };
  /** All customers who owe money (any order) and the page the owner asked for (1 is the first). */
  whoOwes?: { debtors: Array<{ name: string; owed: number }>; page: number };
  balance?: { customer: string; owed: number; isCredit: boolean };
  close?: DayCloseSummary;
  help?: boolean;
  unknown?: boolean;
}

const CONTEXT_KEYS = [
  'sale',
  'expense',
  'debt',
  'payment',
  'undo',
  'nothingToUndo',
  'today',
  'whoOwes',
  'balance',
  'close',
  'help',
  'unknown'
] as const;

// ============================================================================
// Public API
// ============================================================================

/** True when the text is plain ASCII: printable characters only, no emoji, curly quotes or em dashes. */
export function isPlainAscii(text: string): boolean {
  return /^[\x20-\x7e]*$/.test(text);
}

/**
 * Build the reply for exactly one thing that happened (one field of the context is set).
 *
 * The result is plain ASCII. It is at most `maxLength` characters whenever the least-detailed form of the
 * reply fits; if even that is longer (absurdly long names), whole trailing sentences are dropped, and the
 * first sentence is kept whole rather than cut.
 *
 * @throws TypeError when not exactly one field of the context is set.
 * @throws RangeError when a money figure is not a safe whole number of cents (or is negative where it
 *   cannot be).
 */
export function buildReply(context: ReplyContext, maxLength: number = SMS_MAX_LENGTH): string {
  const set = CONTEXT_KEYS.filter((key) => context[key] !== undefined && context[key] !== false);
  if (set.length !== 1) {
    throw new TypeError(`buildReply needs exactly one thing to reply about, got ${set.length}`);
  }
  const { currency } = context;

  switch (set[0]) {
    case 'sale':
      return fit(saleCandidates(context.sale!, currency), maxLength);
    case 'expense':
      return fit(expenseCandidates(context.expense!, currency), maxLength);
    case 'debt':
      return fit(debtCandidates(context.debt!, currency), maxLength);
    case 'payment':
      return fit(paymentCandidates(context.payment!, currency), maxLength);
    case 'undo':
      return fit(undoCandidates(context.undo!, currency), maxLength);
    case 'nothingToUndo':
      return fit([[NOTHING_TO_UNDO]], maxLength);
    case 'today':
      return fit(todayCandidates(context.today!, currency), maxLength);
    case 'whoOwes':
      return whoOwesReply(context.whoOwes!, currency, maxLength);
    case 'balance':
      return fit(balanceCandidates(context.balance!, currency), maxLength);
    case 'close':
      return fit(closeCandidates(context.close!, currency), maxLength);
    case 'help':
    case 'unknown':
      return fit([[SORRY]], maxLength);
    default:
      // Unreachable: `set` only holds keys from CONTEXT_KEYS.
      throw new TypeError('buildReply: unknown reply kind');
  }
}

// ============================================================================
// Fitting a reply into the limit
// ============================================================================

/**
 * `candidates` go from the most complete reply to the least. Each is a list of sentences. The first one that
 * fits wins. If none fit, the last (shortest) one loses trailing sentences until it fits.
 */
function fit(candidates: string[][], maxLength: number): string {
  for (const sentences of candidates) {
    const reply = sentences.join(' ');
    if (reply.length <= maxLength) {
      return reply;
    }
  }
  const sentences = [...candidates[candidates.length - 1]];
  while (sentences.length > 1 && sentences.join(' ').length > maxLength) {
    sentences.pop();
  }
  return sentences.join(' ');
}

// ============================================================================
// Text and money helpers
// ============================================================================

const PUNCTUATION_MAP: Array<[RegExp, string]> = [
  [/[\u2018\u2019\u201a\u2032\u02bc]/g, "'"],
  [/[\u201c\u201d\u201e\u2033]/g, '"'],
  [/[\u2010-\u2015\u2212]/g, '-'],
  [/\u2026/g, '...']
];

/**
 * Make text the owner typed (a name or an item) safe to send: plain ASCII, one line, single spaces.
 * Curly quotes and long dashes become straight ones, accents are dropped (e -> e), anything else becomes "?".
 */
export function ascii(input: string): string {
  let out = input;
  for (const [pattern, replacement] of PUNCTUATION_MAP) {
    out = out.replace(pattern, replacement);
  }
  out = out
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7e]+/gu, '?')
    .trim();
  return out;
}

function customerName(name: string): string {
  return ascii(name) || FALLBACK_CUSTOMER;
}

/** Item text, or undefined when there is nothing to show. */
function itemText(item: string | undefined): string | undefined {
  if (item === undefined) return undefined;
  return ascii(item) || undefined;
}

/** Money, written only with formatCents. A figure that is not whole cents is a bug in the caller. */
function money(cents: number, currency: Currency, allowNegative = false): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`Money must be a whole number of cents, got ${String(cents)}`);
  }
  if (cents < 0 && !allowNegative) {
    throw new RangeError(`Money cannot be negative here, got ${cents}`);
  }
  return formatCents(cents, currency);
}

function count(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`A count must be a whole number, got ${String(value)}`);
  }
  return String(value);
}

/** "(3 bread)", "(bread)", or undefined when there is no item. A quantity alone is not shown. */
function itemLabel(item: string | undefined, qty?: number): string | undefined {
  const text = itemText(item);
  if (text === undefined) return undefined;
  if (qty !== undefined && Number.isSafeInteger(qty) && qty > 0) {
    return `(${qty} ${text})`;
  }
  return `(${text})`;
}

function withLabel(lead: string, label: string | undefined): string {
  return label ? `${lead} ${label}.` : `${lead}.`;
}

/** Where a customer stands, in the words for each reply. */
function standing(
  name: string,
  size: number,
  isCredit: boolean,
  currency: Currency,
  ending: 'total' | 'now' | 'plain'
): string {
  const amount = money(size, currency);
  const tail = ending === 'total' ? ' in total' : ending === 'now' ? ' now' : '';
  if (size === 0) {
    return `${name} owes nothing${ending === 'now' ? ' now' : ''}.`;
  }
  if (isCredit) {
    return `${name} has ${amount} credit${ending === 'now' ? ' now' : ''}.`;
  }
  return `${name} owes ${amount}${tail}.`;
}

// ============================================================================
// Reply kinds
// ============================================================================

function saleCandidates(sale: NonNullable<ReplyContext['sale']>, currency: Currency): string[][] {
  const amount = money(sale.amount, currency);
  const sales = `Sales today ${money(sale.todayTotal, currency)}.`;
  count(sale.todayCount);
  const withItem = withLabel(`Saved: sale ${amount}`, itemLabel(sale.item, sale.qty));
  const withoutItem = `Saved: sale ${amount}.`;
  return [
    [withItem, sales, HINT_UNDO],
    [withItem, sales],
    [withoutItem, sales]
  ];
}

function expenseCandidates(
  expense: NonNullable<ReplyContext['expense']>,
  currency: Currency
): string[][] {
  const amount = money(expense.amount, currency);
  const spent = `Spent today ${money(expense.todayTotal, currency)}.`;
  return [
    [withLabel(`Saved: spent ${amount}`, itemLabel(expense.item)), spent],
    [`Saved: spent ${amount}.`, spent]
  ];
}

function debtCandidates(debt: NonNullable<ReplyContext['debt']>, currency: Currency): string[][] {
  const name = customerName(debt.customer);
  const amount = money(debt.amount, currency);
  const total = standing(name, debt.customerTotal, debt.isCredit ?? false, currency, 'total');
  return [
    [withLabel(`Saved: ${name} owes ${amount}`, itemLabel(debt.item)), total],
    [`Saved: ${name} owes ${amount}.`, total]
  ];
}

function paymentCandidates(
  payment: NonNullable<ReplyContext['payment']>,
  currency: Currency
): string[][] {
  const name = customerName(payment.customer);
  const amount = money(payment.amount, currency);
  const now = standing(name, payment.balance, payment.isCredit, currency, 'now');
  return [[`Saved: ${name} paid ${amount}.`, now]];
}

function undoCandidates(undo: NonNullable<ReplyContext['undo']>, currency: Currency): string[][] {
  const amount = money(undo.amount, currency);
  const label = itemLabel(undo.item);

  let lead: (label: string | undefined) => string;
  let figure: string | undefined;

  if (undo.kind === 'sale' || undo.kind === 'expense') {
    const verb = undo.kind === 'sale' ? 'sale' : 'spent';
    lead = (l) => withLabel(`Undone: ${verb} ${amount}`, l);
    if (undo.todayTotal !== undefined) {
      const words = undo.kind === 'sale' ? 'Sales today' : 'Spent today';
      figure = `${words} ${money(undo.todayTotal, currency)}.`;
    }
  } else {
    if (undo.customer === undefined) {
      throw new TypeError(`Undoing a ${undo.kind} needs the customer's name`);
    }
    const name = customerName(undo.customer);
    const verb = undo.kind === 'debt' ? 'owes' : 'paid';
    lead = (l) => withLabel(`Undone: ${name} ${verb} ${amount}`, l);
    if (undo.customerBalance !== undefined) {
      figure = standing(name, undo.customerBalance, undo.isCredit ?? false, currency, 'now');
    }
  }

  const rest = figure === undefined ? [] : [figure];
  return [[lead(label), ...rest], [lead(undefined), ...rest]];
}

function todayCandidates(today: NonNullable<ReplyContext['today']>, currency: Currency): string[][] {
  const sales = money(today.sales, currency);
  const spent = money(today.spent, currency);
  // Money in hand can be below zero when more was spent than taken.
  const inHand = money(today.inHand, currency, true);
  const tail = `spent ${spent}, in hand ${inHand}.`;
  return [
    [`Today: sales ${sales} (${count(today.salesCount)}), ${tail}`],
    [`Today: sales ${sales}, ${tail}`]
  ];
}

function balanceCandidates(
  balance: NonNullable<ReplyContext['balance']>,
  currency: Currency
): string[][] {
  const name = customerName(balance.customer);
  return [[standing(name, balance.owed, balance.isCredit, currency, 'plain')]];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Mon 3 Nov" from the shop's local date "2025-11-03". The date is already the shop's local day, so the
 * day of the week comes from the calendar date alone and no time zone is needed.
 */
function dayLabel(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new RangeError(`Expected a date like 2025-11-03, got ${date}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new RangeError(`Not a real date: ${date}`);
  }
  return `${WEEKDAYS[utc.getUTCDay()]} ${day} ${MONTHS[month - 1]}`;
}

function closeCandidates(close: DayCloseSummary, currency: Currency): string[][] {
  const label = `Close ${dayLabel(close.date)}:`;
  const sales = money(close.sales.total, currency);
  const spent = money(close.expenses.total, currency);
  const inHand = money(close.moneyInHand, currency, true);
  const newDebts = money(close.newDebts, currency);
  const paid = money(close.paymentsReceived, currency);
  const owed = money(close.totalOwed, currency);
  const salesCount = count(close.sales.count);

  const middle = `spent ${spent}, in hand ${inHand}`;
  const movements = `${CLOSE_NEW_DEBTS} ${newDebts}, ${CLOSE_PAYMENTS} ${paid}`;
  return [
    [`${label} sales ${sales} (${salesCount}), ${middle}, ${movements}, total owed ${owed}.`],
    // Too long (a currency with a long sign, or huge figures): drop the count, then the day's movements.
    [`${label} sales ${sales}, ${middle}, ${movements}, total owed ${owed}.`],
    [`${label} sales ${sales}, ${middle}, total owed ${owed}.`]
  ];
}

// ============================================================================
// Who owes (pages)
// ============================================================================

/**
 * Names go largest debt first. As many as fit in one message go on a page. When more are left the reply ends
 * "+N more. Reply owes 2" with the next page number. A name is never cut off.
 */
function whoOwesReply(
  whoOwes: NonNullable<ReplyContext['whoOwes']>,
  currency: Currency,
  maxLength: number
): string {
  const debtors = whoOwes.debtors
    .map((d) => ({ name: customerName(d.name), owed: d.owed }))
    .filter((d) => {
      money(d.owed, currency); // checks it is whole cents and not negative
      return d.owed > 0;
    })
    .sort((a, b) => b.owed - a.owed || compareNames(a.name, b.name));

  if (debtors.length === 0) {
    return NOBODY_OWES;
  }

  const items = debtors.map((d) => `${d.name} ${money(d.owed, currency)}`);
  const wanted = Number.isFinite(whoOwes.page) ? Math.max(1, Math.floor(whoOwes.page)) : 1;

  const render = (start: number, size: number, page: number): string => {
    const shown = items.slice(start, start + size).join(', ');
    const remaining = items.length - (start + size);
    return remaining > 0
      ? `Owes: ${shown}, +${remaining} more. Reply owes ${page + 1}`
      : `Owes: ${shown}.`;
  };

  let start = 0;
  for (let page = 1; ; page++) {
    const left = items.length - start;
    let size = 1;
    if (render(start, left, page).length <= maxLength) {
      size = left; // everything that is left fits on this page
    } else {
      // Grow the page while it still fits with its "+N more" ending. Always show at least one name.
      while (size < left - 1 && render(start, size + 1, page).length <= maxLength) {
        size++;
      }
    }
    if (page === wanted) {
      return render(start, size, page);
    }
    start += size;
    if (start >= items.length) {
      return NO_MORE_NAMES;
    }
  }
}

function compareNames(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}
