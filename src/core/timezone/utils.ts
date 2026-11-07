// Time zone utilities for the ledger

import type { Shop } from '../shops/types.js';

/**
 * Gets the shop's local date in YYYY-MM-DD format
 * Uses Intl.DateTimeFormat to convert UTC to shop's time zone
 */
export function getShopLocalDate(shop: Shop, date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: shop.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date);
}

/**
 * Gets the UTC start and end times for a day in the shop's time zone
 * @param shop - The shop with time zone info
 * @param date - YYYY-MM-DD date string in shop's time zone
 * @returns Object with start and end as UTC Date objects
 */
export function getShopDayBounds(
  shop: Shop,
  date: string
): { start: Date; end: Date } {
  const [year, month, day] = date.split('-').map(Number);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);

  // The day runs from its first millisecond up to, but not including, the first
  // millisecond of the next local day.
  const start = firstMomentOfLocalDay(shop, date, year, month, day);
  const end = firstMomentOfLocalDay(shop, nextDay, year, month, day + 1);

  return { start, end };
}

/**
 * The first millisecond at which the shop's local date is `date`.
 * Binary search on whole milliseconds, so the answer is exact.
 */
function firstMomentOfLocalDay(
  shop: Shop,
  date: string,
  year: number,
  month: number,
  day: number
): Date {
  // Every time zone is within +/-14 hours of UTC, so two UTC days either side is enough.
  // Invariant: the local date at `low` is before `date`; the local date at `high` is `date` or later.
  let low = Date.UTC(year, month - 1, day - 2, 0, 0, 0, 0);
  let high = Date.UTC(year, month - 1, day + 2, 0, 0, 0, 0);

  while (high - low > 1) {
    const mid = low + Math.floor((high - low) / 2);
    if (getShopLocalDate(shop, new Date(mid)) < date) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return new Date(high);
}

/**
 * Checks if a timestamp is from today in the shop's local time zone
 * @param shop - The shop with time zone info
 * @param timestamp - UTC ISO 8601 timestamp string
 * @param now - Current time for "today" determination
 * @returns true if the timestamp is from today in the shop's time zone
 */
export function isTodayInShopTimeZone(
  shop: Shop,
  timestamp: string,
  now: Date
): boolean {
  const recordDate = getShopLocalDate(shop, new Date(timestamp));
  const today = getShopLocalDate(shop, now);
  return recordDate === today;
}
