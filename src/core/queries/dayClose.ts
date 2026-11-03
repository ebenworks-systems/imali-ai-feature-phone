// Day close summary query for the ledger

import type { LedgerStore } from '../../store/interface.js';
import type { Shop } from '../shops/types.js';
import { getTodaySummary, type TodaySummary } from './today.js';
import { getShopLocalDate } from '../timezone/utils.js';

export interface DayCloseSummary extends TodaySummary {
  date: string; // YYYY-MM-DD in shop's time zone
  shopId: string;
}

/**
 * Gets day close summary for a shop
 * Extends today's summary with date field in shop's local time zone
 * Defaults to TODAY in shop's time zone, not yesterday
 */
export async function getDayCloseSummary(
  store: LedgerStore,
  shop: Shop,
  params: {
    date?: string; // YYYY-MM-DD, defaults to TODAY in shop's time zone
    now: Date; // Time injected
  }
): Promise<DayCloseSummary> {
  // Get the date in shop's local time zone
  const dateLocal = params.date ?? getShopLocalDate(shop, params.now);

  // Get today's summary for that date
  const todaySummary = await getTodaySummary(store, shop, params.now);

  return {
    ...todaySummary,
    date: dateLocal,
    shopId: shop.id
  };
}
