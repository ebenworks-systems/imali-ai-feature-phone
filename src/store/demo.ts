/**
 * What makes a shop a demo shop, in one place, for the stores.
 *
 * A demo number is `+2700000` and four digits (`+27 00 000 xxxx` without spaces). Every demo number is invented. The
 * housekeeping that clears away old demo shops (`LedgerStore.deleteExpiredDemoShops`) uses this and nothing else to
 * decide what it may delete, so a shop on any other number can never be touched by it.
 */

export const DEMO_PHONE_PREFIX = '+2700000';

/** The whole number: the prefix and exactly four digits. */
export const DEMO_PHONE_PATTERN = /^\+2700000\d{4}$/;

/** The same pattern for Postgres (`~`). Kept beside the JavaScript one so the two stay the same. */
export const DEMO_PHONE_SQL_PATTERN = '^\\+2700000[0-9]{4}$';

export function isDemoNumber(phone: string): boolean {
  return DEMO_PHONE_PATTERN.test(phone);
}

/** The most demo shops one call to `deleteExpiredDemoShops` may remove, whatever the caller asks for. */
export const MAX_DEMO_SHOPS_PER_SWEEP = 1000;

/** How old a demo shop is before the housekeeping may remove it: 7 days. */
export const DEMO_SHOP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
