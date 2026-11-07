// Ledger logic: money and time formatting, checking the ledger answer, who-owes order, record rows, demo numbers.
// No DOM, no fetch, no timers. The time is always passed in.

export const DEFAULT_TIME_ZONE = 'Africa/Johannesburg';

/** Plain ASCII symbols, the same table as src/core/money/currency.ts. */
export const CURRENCY_SYMBOLS = Object.freeze({
  ZAR: 'R',
  USD: '$',
  KES: 'KSh',
  NGN: 'N',
  GHS: 'GHS',
  ZMW: 'K',
  BWP: 'P',
});

export const RECORD_KINDS = Object.freeze(['sale', 'expense', 'debt', 'payment', 'reversal']);
export const CHANNELS = Object.freeze(['ussd', 'sms', 'web']);

const KIND_WORDS = Object.freeze({ sale: 'Sale', expense: 'Spent', debt: 'Owes', payment: 'Paid', reversal: 'Undo' });
const CHANNEL_WORDS = Object.freeze({ ussd: 'Menu', sms: 'Text', web: 'Web' });
const MONTHS = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);

// ---------------------------------------------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------------------------------------------

/**
 * Whole cents to short text: R45, R45.50, R1,240. Integer maths only, the same rules as formatCents on the server.
 * @param {number} cents a safe integer
 * @param {string} currency one of the seven codes
 */
export function formatMoney(cents, currency) {
  if (!Number.isSafeInteger(cents)) throw new RangeError('Money must be a whole number of cents');
  const symbol = Object.hasOwn(CURRENCY_SYMBOLS, currency) ? CURRENCY_SYMBOLS[currency] : String(currency);
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const rest = absolute % 100;
  const sign = cents < 0 ? '-' : '';
  const wholeText = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return rest === 0 ? `${symbol}${sign}${wholeText}` : `${symbol}${sign}${wholeText}.${String(rest).padStart(2, '0')}`;
}

/** 'Currency ZAR (R)' */
export function currencyLabel(currency) {
  const symbol = Object.hasOwn(CURRENCY_SYMBOLS, currency) ? CURRENCY_SYMBOLS[currency] : '';
  return symbol ? `Currency ${currency} (${symbol})` : `Currency ${currency}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------------------------------------------

const formatters = new Map();

function formatterFor(timeZone) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Returns the numbers on the wall clock of `timeZone`, or null when `ms` is not a time. */
function wallClock(ms, timeZone) {
  if (!Number.isFinite(ms)) return null;
  let formatter;
  try {
    formatter = formatterFor(timeZone || DEFAULT_TIME_ZONE);
  } catch {
    formatter = formatterFor(DEFAULT_TIME_ZONE);
  }
  const out = {};
  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') out[part.type] = Number.parseInt(part.value, 10);
  }
  return out;
}

const two = (n) => String(n).padStart(2, '0');

/** '14:05' on a 24 hour clock in the shop's time zone. */
export function formatClock(nowMs, timeZone = DEFAULT_TIME_ZONE) {
  const t = wallClock(nowMs, timeZone);
  return t ? `${two(t.hour)}:${two(t.minute)}` : '';
}

/**
 * '14:05' for a record made on the shop's today, '3 Nov 14:05' for an earlier day.
 * @param {string} createdAt UTC ISO 8601
 */
export function formatRecordTime(createdAt, timeZone = DEFAULT_TIME_ZONE, nowMs = 0) {
  const t = wallClock(Date.parse(createdAt), timeZone);
  if (!t) return '';
  const now = wallClock(nowMs, timeZone);
  const time = `${two(t.hour)}:${two(t.minute)}`;
  if (now && now.year === t.year && now.month === t.month && now.day === t.day) return time;
  return `${t.day} ${MONTHS[t.month - 1]} ${time}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Checking the ledger answer (requirement 77)
// ---------------------------------------------------------------------------------------------------------------

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCents = (value) => typeof value === 'number' && Number.isSafeInteger(value);
const isText = (value) => typeof value === 'string';
const isOptionalText = (value) => value === undefined || value === null || typeof value === 'string';
const isId = (value) => (isText(value) && value !== '') || (isCents(value) && value >= 0);

function validTimeZone(value) {
  try {
    formatterFor(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks and normalises the answer of GET /api/ledger.
 * @returns {{ ok: true, ledger: object } | { ok: false }}
 */
export function readLedger(json) {
  const bad = { ok: false };
  if (!isObject(json)) return bad;
  const { shop, today, whoOwes, records } = json;

  if (!isObject(shop) || !isText(shop.name) || !Object.hasOwn(CURRENCY_SYMBOLS, shop.currency)) return bad;
  if (shop.timeZone !== undefined && shop.timeZone !== null && !isText(shop.timeZone)) return bad;

  if (!isObject(today)) return bad;
  if (![today.sales, today.salesCount, today.spent, today.inHand].every(isCents)) return bad;
  if (today.salesCount < 0) return bad;

  if (!Array.isArray(whoOwes) || !Array.isArray(records)) return bad;

  const owes = [];
  for (const entry of whoOwes) {
    if (!isObject(entry) || !isText(entry.name) || !isCents(entry.owed)) return bad;
    owes.push({ name: entry.name, owed: entry.owed });
  }

  const rows = [];
  for (const record of records) {
    if (!isObject(record)) return bad;
    if (!isId(record.id)) return bad;
    if (!RECORD_KINDS.includes(record.kind) || !CHANNELS.includes(record.channel)) return bad;
    if (!isCents(record.amount) || record.amount < 0) return bad;
    if (!isText(record.createdAt) || !Number.isFinite(Date.parse(record.createdAt))) return bad;
    if (!isOptionalText(record.item) || !isOptionalText(record.customerDisplayName)) return bad;
    if (record.reversesRecordId !== undefined && record.reversesRecordId !== null && !isId(record.reversesRecordId)) {
      return bad;
    }
    rows.push({
      id: String(record.id),
      kind: record.kind,
      amount: record.amount,
      createdAt: record.createdAt,
      channel: record.channel,
      item: record.item ?? '',
      customerDisplayName: record.customerDisplayName ?? '',
      reversesRecordId:
        record.reversesRecordId === undefined || record.reversesRecordId === null ? '' : String(record.reversesRecordId),
    });
  }

  const timeZone = isText(shop.timeZone) && validTimeZone(shop.timeZone) ? shop.timeZone : DEFAULT_TIME_ZONE;
  return {
    ok: true,
    ledger: {
      shop: { name: shop.name, currency: shop.currency, timeZone },
      today: { sales: today.sales, salesCount: today.salesCount, spent: today.spent, inHand: today.inHand },
      whoOwes: owes,
      records: rows,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Who owes and record rows
// ---------------------------------------------------------------------------------------------------------------

/** Largest amount first; ties by name without regard to case. Returns a new array. */
export function sortOwes(list) {
  return list
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      if (a.entry.owed !== b.entry.owed) return b.entry.owed - a.entry.owed;
      const nameA = a.entry.name.toLowerCase();
      const nameB = b.entry.name.toLowerCase();
      if (nameA !== nameB) return nameA < nameB ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

/** The first `shown` people and the rest. Does not sort. */
export function splitOwes(list, shown = 6) {
  return { shown: list.slice(0, shown), hidden: list.slice(shown) };
}

function detailOf(record) {
  const parts = [record.customerDisplayName, record.item].filter((part) => typeof part === 'string' && part !== '');
  return parts.join(' - ');
}

/**
 * Rows for the "Last records" list, newest first.
 * @returns {Array<{ id: string, kindWord: string, amountText: string, detail: string, channelWord: string,
 *   timeText: string, undone: boolean, isReversal: boolean, cancelsText: string }>}
 */
export function recordRows(records, currency, timeZone = DEFAULT_TIME_ZONE, nowMs = 0) {
  const byId = new Map(records.map((record) => [String(record.id), record]));
  const reversed = new Set();
  for (const record of records) {
    if (record.kind === 'reversal' && record.reversesRecordId) reversed.add(String(record.reversesRecordId));
  }

  const describe = (record) => {
    const detail = detailOf(record);
    return `${KIND_WORDS[record.kind]} ${formatMoney(record.amount, currency)}${detail ? ` ${detail}` : ''}`;
  };

  return records
    .map((record, index) => ({ record, index, ms: Date.parse(record.createdAt) }))
    .sort((a, b) => {
      if (a.ms !== b.ms) return b.ms - a.ms;
      const reversalA = a.record.kind === 'reversal';
      const reversalB = b.record.kind === 'reversal';
      if (reversalA !== reversalB) return reversalA ? -1 : 1; // an Undo is newer than the record it cancels
      return a.index - b.index;
    })
    .map(({ record }) => {
      const isReversal = record.kind === 'reversal';
      let cancelsText = '';
      if (isReversal) {
        const target = byId.get(String(record.reversesRecordId));
        cancelsText = target ? `cancels ${describe(target)}` : 'cancels an earlier record';
      }
      return {
        id: String(record.id),
        kindWord: KIND_WORDS[record.kind],
        amountText: isReversal ? '' : formatMoney(record.amount, currency),
        detail: detailOf(record),
        channelWord: CHANNEL_WORDS[record.channel],
        timeText: formatRecordTime(record.createdAt, timeZone, nowMs),
        undone: !isReversal && reversed.has(String(record.id)),
        isReversal,
        cancelsText,
      };
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Demo numbers and the export file name
// ---------------------------------------------------------------------------------------------------------------

/** 0..9999 to a demo number in the fiction range: '+2700000' and four digits (displayed +27 00 000 xxxx). */
export function demoPhone(n) {
  if (!Number.isInteger(n) || n < 0 || n > 9999) throw new RangeError('A demo number needs a whole number from 0 to 9999');
  return `+2700000${String(n).padStart(4, '0')}`;
}

export function isDemoPhone(text) {
  return typeof text === 'string' && /^\+2700000\d{4}$/.test(text);
}

/** '+27 00 000 1234'. Anything that is not a demo number comes back unchanged. */
export function displayPhone(phone) {
  if (!isDemoPhone(phone)) return String(phone ?? '');
  return `+27 00 000 ${phone.slice(8)}`;
}

/** 'imali-ai-export-YYYY-MM-DD.json', the UTC date. */
export function exportFileName(nowMs) {
  if (!Number.isFinite(nowMs)) throw new RangeError('A file name needs a real time');
  return `imali-ai-export-${new Date(nowMs).toISOString().slice(0, 10)}.json`;
}
