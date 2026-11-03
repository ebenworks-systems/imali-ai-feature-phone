// Today's summary query for the ledger

import type { LedgerStore } from '../../store/interface.js';
import type { Shop } from '../shops/types.js';
import { getShopLocalDate, getShopDayBounds } from '../timezone/utils.js';
import { activeRecords } from '../records/active.js';
import { getWhoOwes } from './customers.js';

export interface TodaySummary {
  sales: {
    total: number; // cents
    count: number;
  };
  expenses: {
    total: number; // cents
  };
  moneyInHand: number; // cents (sales + payments - expenses)
  newDebts: number; // cents given today
  paymentsReceived: number; // cents received today
  totalOwed: number; // cents all customers still owe (positive balances only)
}

/**
 * Gets today's summary for a shop
 * Computes from all records, not via store query methods
 * Uses the shop's local time zone to determine "today"
 */
export async function getTodaySummary(
  store: LedgerStore,
  shop: Shop,
  now: Date
): Promise<TodaySummary> {
  // Get all records for this shop
  const allRecords = await store.listRecords(shop.id);

  // Filter to only active (non-reversed) records
  const { active: activeRecordsList } = activeRecords(allRecords);

  // Determine today's date in shop's local time zone
  const todayLocal = getShopLocalDate(shop, now);
  const dayBounds = getShopDayBounds(shop, todayLocal);

  // Initialize accumulators
  let salesToday = 0;
  let saleCount = 0;
  let expensesToday = 0;
  let newDebtsToday = 0;
  let paymentsReceivedToday = 0;

  for (const record of activeRecordsList) {
    // Check if this record is from today
    const isToday =
      record.createdAt >= dayBounds.start.toISOString() &&
      record.createdAt < dayBounds.end.toISOString();

    if (!isToday) {
      continue;
    }

    // Record is from today
    if (record.kind === 'sale') {
      salesToday += record.amount;
      saleCount += 1;
    } else if (record.kind === 'expense') {
      expensesToday += record.amount;
    } else if (record.kind === 'debt') {
      newDebtsToday += record.amount;
    } else if (record.kind === 'payment') {
      paymentsReceivedToday += record.amount;
    }
  }

  // Calculate money in hand
  const moneyInHand = salesToday + paymentsReceivedToday - expensesToday;

  // Get total owed from customers query (reuses that computation)
  const customers = await getWhoOwes(store, shop);
  let totalOwed = 0;
  for (const customer of customers) {
    totalOwed += customer.balance;
  }

  return {
    sales: {
      total: salesToday,
      count: saleCount
    },
    expenses: {
      total: expensesToday
    },
    moneyInHand,
    newDebts: newDebtsToday,
    paymentsReceived: paymentsReceivedToday,
    totalOwed
  };
}
