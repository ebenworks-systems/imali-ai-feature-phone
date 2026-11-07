/**
 * Small text helpers for the menu screens: plain ASCII, clipping, money, the day label, the hint and the notices.
 */

import { formatCents, type Currency } from '../../core/index.js';

/** The last line of a typed-answer, list or confirm screen, when it fits (requirement 52). */
export const HINT = '0 Back 00 Menu';

/** Anything outside printable ASCII (32 to 126) becomes `?`, one `?` for each character the owner would see. */
export function plain(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    out += code >= 32 && code <= 126 ? char : '?';
  }
  return out;
}

/** `plain(text)` cut at `max` characters. */
export function clip(text: string, max: number): string {
  return plain(text).slice(0, max);
}

/** Money as the core writes it: `R45`, `R45.50`, `R1,240`, and `-R60` below zero. */
export function money(cents: number, currency: Currency): string {
  return formatCents(cents, currency);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2025-11-03` becomes `Mon 3 Nov`. Reads the calendar date only, never the clock. */
export function dayLabel(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return plain(date);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${DAYS[weekday]} ${day} ${MONTHS[month - 1] ?? ''}`.trimEnd();
}

/** Fixed lines of the paid-back and who-owes lists. The screens and the page budgets are built from the same text. */
export const LABEL = {
  whoPaidBack: 'Who paid back?',
  otherName: '8 Other name',
  more: '9 More'
} as const;

/** Every notice (the first line of a screen that tells the owner what went wrong). */
export const NOTICE = {
  choose: 'Choose a number from the list.',
  amountWords: 'Type the amount in numbers, like 45.',
  amountZero: 'The amount must be more than zero.',
  amountBig: 'That amount is too big.',
  shopNameEmpty: 'Type your shop name.',
  shopNameLong: 'That name is too long. Use 24 letters or less.',
  customerBad: "Type the customer's name, like Tendai.",
  customerLong: 'That name is too long. Use 20 letters or less.',
  itemEmpty: 'Type a short word, or 1 to skip.',
  itemLong: 'That is too long. Use 20 letters or less.',
  asciiOnly: 'Use letters and numbers only.',
  notSaved: 'Not saved.',
  notUndone: 'Not undone.'
} as const;

export type NoticeKey = keyof typeof NOTICE;
