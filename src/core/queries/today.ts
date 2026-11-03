// Today's summary query for the ledger

import type { LedgerStore } from '../../store/interface.js';
import type { Shop } from '../shops/types.js';
import { getShopLocalDate, getShopDayBounds } from '../timezone/utils.js';

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

  // Determine today's date in shop's local time zone
  const todayLocal = getShopLocalDate(shop, now);
  const dayBounds = getShopDayBounds(shop, todayLocal);

  // Initialize accumulators
  let salesToday = 0;
  let saleCount = 0;
  let expensesToday = 0;
  let newDebtsToday = 0;
  let paymentsReceivedToday = 0;

  // Track customer balances (all time, but we filter for total owed)
  const customerBalances = new Map<string, number>();

  for (const record of allRecords) {
    // Check if this record is reversed (if so, skip it)
    const reversal = await store.findReversalOf(record.id);
    if (reversal) {
      continue;
    }

    // Check if this is a reversal record
    if (record.kind === 'reversal') {
      // Check if this reversal is itself reversed
      const reversalOfReversal = await store.findReversalOf(record.id);
      if (reversalOfReversal) {
        // This reversal is itself reversed, so treat the original record as active again
        const reversedRecord = await store.findRecordById(record.reversesRecordId);
        if (!reversedRecord) continue;

        // For today's summary, only process if the original record happened today
        const isToday =
          reversedRecord.createdAt >= dayBounds.start.toISOString() &&
          reversedRecord.createdAt < dayBounds.end.toISOString();

        if (!isToday) {
          // Track customer balances for total owed even if not today
          if (reversedRecord.kind === 'debt') {
            const customer = (reversedRecord as any).customerKey;
            const current = customerBalances.get(customer) || 0;
            customerBalances.set(customer, current + reversedRecord.amount);
          } else if (reversedRecord.kind === 'payment') {
            const customer = (reversedRecord as any).customerKey;
            const current = customerBalances.get(customer) || 0;
            customerBalances.set(customer, current - reversedRecord.amount);
          }
          continue;
        }

        // Record the effect of the original record
        if (reversedRecord.kind === 'sale') {
          salesToday += reversedRecord.amount;
          saleCount += 1;
        } else if (reversedRecord.kind === 'expense') {
          expensesToday += reversedRecord.amount;
        } else if (reversedRecord.kind === 'debt') {
          newDebtsToday += reversedRecord.amount;
          const customer = (reversedRecord as any).customerKey;
          const current = customerBalances.get(customer) || 0;
          customerBalances.set(customer, current + reversedRecord.amount);
        } else if (reversedRecord.kind === 'payment') {
          paymentsReceivedToday += reversedRecord.amount;
          const customer = (reversedRecord as any).customerKey;
          const current = customerBalances.get(customer) || 0;
          customerBalances.set(customer, current - reversedRecord.amount);
        }
      }
      // If the reversal is not itself reversed, it cancels the original record, so skip
      continue;
    }

    // Check if this record is from today
    const isToday =
      record.createdAt >= dayBounds.start.toISOString() &&
      record.createdAt < dayBounds.end.toISOString();

    if (!isToday) {
      // Even if not today, track customer balances for total owed
      if (record.kind === 'debt') {
        const customer = (record as any).customerKey;
        const current = customerBalances.get(customer) || 0;
        customerBalances.set(customer, current + record.amount);
      } else if (record.kind === 'payment') {
        const customer = (record as any).customerKey;
        const current = customerBalances.get(customer) || 0;
        customerBalances.set(customer, current - record.amount);
      }
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
      const customer = (record as any).customerKey;
      const current = customerBalances.get(customer) || 0;
      customerBalances.set(customer, current + record.amount);
    } else if (record.kind === 'payment') {
      paymentsReceivedToday += record.amount;
      const customer = (record as any).customerKey;
      const current = customerBalances.get(customer) || 0;
      customerBalances.set(customer, current - record.amount);
    }
  }

  // Calculate money in hand
  const moneyInHand = salesToday + paymentsReceivedToday - expensesToday;

  // Calculate total owed (sum of positive balances only)
  let totalOwed = 0;
  for (const balance of customerBalances.values()) {
    if (balance > 0) {
      totalOwed += balance;
    }
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
