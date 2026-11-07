/**
 * Reading what the owner types: amounts, the shop name, a customer name and an item.
 *
 * Every refusal comes back with a plain notice for the screen to show. Nothing here saves anything.
 */

import {
  customerDisplayName,
  parseAmount,
  requiresConfirmation,
  validateAmount,
  validateShopName,
  type Currency
} from '../../core/index.js';
import { NOTICE } from './text.js';

export const MAX_SHOP_NAME = 24;
export const MAX_CUSTOMER_NAME = 20;
export const MAX_ITEM = 20;

export type AmountReading = { ok: true; cents: number; big: boolean } | { ok: false; notice: string };
export type TextReading = { ok: true; value: string } | { ok: false; notice: string };

/** At 14 digits of whole money the cents no longer fit a safe integer. */
const TOO_MANY_DIGITS = 14;

/**
 * Reads an amount in the shop's currency.
 *
 * `2 200` could be two things for 200 or R2,200; the menu has no quantity, so it takes the larger, the
 * thousands reading. `big` is true above 1,000,000.00, when the owner must confirm twice.
 */
export function readAmount(raw: string, currency: Currency): AmountReading {
  const text = raw.trim();
  const parsed = parseAmount(text, currency);

  let cents: number;
  if (parsed.type === 'success') {
    cents = parsed.amount.cents;
  } else if (parsed.type === 'ambiguous') {
    cents = Math.max(...parsed.possibleAmounts.map((a) => a.cents));
  } else {
    return { ok: false, notice: noticeForUnreadable(text) };
  }

  const check = validateAmount(cents);
  if (!check.valid) {
    return { ok: false, notice: Number.isSafeInteger(cents) ? NOTICE.amountZero : NOTICE.amountBig };
  }
  return { ok: true, cents, big: requiresConfirmation(cents) };
}

function noticeForUnreadable(text: string): string {
  if (text.startsWith('-')) return NOTICE.amountZero;
  if (!/\d/.test(text)) return NOTICE.amountWords;
  // Only digits, spaces, commas, points and a leading symbol, with 14 or more digits: the core refuses it only
  // because the cents no longer fit a safe whole number.
  const withoutSymbol = text.replace(/^[A-Za-z$]+/, '');
  if (/^[\d\s,.]+$/.test(withoutSymbol) && withoutSymbol.replace(/\D/g, '').length >= TOO_MANY_DIGITS) {
    return NOTICE.amountBig;
  }
  return NOTICE.amountWords;
}

function hasOnlyPrintableAscii(text: string): boolean {
  return /^[\x20-\x7e]*$/.test(text);
}

/** The shop name: trimmed, inner spaces collapsed, 1 to 24 printable ASCII characters. */
export function readShopName(raw: string): TextReading {
  const value = customerDisplayName(raw);
  if (value === '') return { ok: false, notice: NOTICE.shopNameEmpty };
  if (!hasOnlyPrintableAscii(value)) return { ok: false, notice: NOTICE.asciiOnly };
  if (value.length > MAX_SHOP_NAME || !validateShopName(value)) return { ok: false, notice: NOTICE.shopNameLong };
  return { ok: true, value };
}

/** A customer name: 1 to 20 printable ASCII characters with at least one letter. */
export function readCustomerName(raw: string): TextReading {
  const value = customerDisplayName(raw);
  if (value === '') return { ok: false, notice: NOTICE.customerBad };
  if (!hasOnlyPrintableAscii(value)) return { ok: false, notice: NOTICE.asciiOnly };
  if (value.length > MAX_CUSTOMER_NAME) return { ok: false, notice: NOTICE.customerLong };
  if (!/[A-Za-z]/.test(value)) return { ok: false, notice: NOTICE.customerBad };
  return { ok: true, value };
}

/** An item: 1 to 20 printable ASCII characters. (`1` means "skip" and is read before this.) */
export function readItem(raw: string): TextReading {
  const value = customerDisplayName(raw);
  if (value === '') return { ok: false, notice: NOTICE.itemEmpty };
  if (!hasOnlyPrintableAscii(value)) return { ok: false, notice: NOTICE.asciiOnly };
  if (value.length > MAX_ITEM) return { ok: false, notice: NOTICE.itemLong };
  return { ok: true, value };
}
