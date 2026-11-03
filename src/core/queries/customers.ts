// Customer balance queries for the ledger

import type { LedgerStore } from '../../store/interface.js';
import type { Shop } from '../shops/types.js';
import { customerKey } from '../records/types.js';

export interface CustomerBalance {
  displayName: string; // Original display name
  balance: number; // cents (positive = owes, negative = credit)
}

/**
 * Gets list of customers who owe money, sorted by amount (largest first)
 * Only returns customers with positive balances (greater than zero)
 * Excludes customers with zero or credit balances (negative)
 */
export async function getWhoOwes(
  store: LedgerStore,
  shop: Shop
): Promise<CustomerBalance[]> {
  const allRecords = await store.listRecords(shop.id);

  // Map from customer key to { displayName, balance }
  const customers = new Map<string, { displayName: string; balance: number }>();

  for (const record of allRecords) {
    // Check if this record is reversed
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
        if (!reversedRecord || (reversedRecord.kind !== 'debt' && reversedRecord.kind !== 'payment')) {
          continue;
        }

        const key = (reversedRecord as any).customerKey;
        const displayName = (reversedRecord as any).customerDisplayName;
        const current = customers.get(key) || { displayName, balance: 0 };

        if (reversedRecord.kind === 'debt') {
          current.balance += reversedRecord.amount;
        } else if (reversedRecord.kind === 'payment') {
          current.balance -= reversedRecord.amount;
        }

        customers.set(key, current);
      }
      // If the reversal is not itself reversed, it cancels the original record, so skip
      continue;
    }

    // Only track debt and payment records
    if (record.kind === 'debt' || record.kind === 'payment') {
      const key = (record as any).customerKey;
      const displayName = (record as any).customerDisplayName;
      const current = customers.get(key) || { displayName, balance: 0 };

      if (record.kind === 'debt') {
        current.balance += record.amount;
      } else if (record.kind === 'payment') {
        current.balance -= record.amount;
      }

      customers.set(key, current);
    }
  }

  // Filter to only customers with positive balances and sort by balance descending
  const result: CustomerBalance[] = [];
  for (const { displayName, balance } of customers.values()) {
    if (balance > 0) {
      result.push({ displayName, balance });
    }
  }

  result.sort((a, b) => b.balance - a.balance);
  return result;
}

/**
 * Gets a specific customer's balance
 * Handles case-insensitive name matching using keys
 * Returns sum of debt records minus payment records
 */
export async function getCustomerBalance(
  store: LedgerStore,
  shop: Shop,
  customerName: string
): Promise<number> {
  const key = customerKey(customerName);
  const allRecords = await store.listRecords(shop.id);

  let balance = 0;

  for (const record of allRecords) {
    // Check if this record is reversed
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
        if (!reversedRecord) {
          continue;
        }

        if (reversedRecord.kind === 'debt') {
          const recordKey = (reversedRecord as any).customerKey;
          if (recordKey === key) {
            balance += reversedRecord.amount;
          }
        } else if (reversedRecord.kind === 'payment') {
          const recordKey = (reversedRecord as any).customerKey;
          if (recordKey === key) {
            balance -= reversedRecord.amount;
          }
        }
      }
      // If the reversal is not itself reversed, it cancels the original record, so skip
      continue;
    }

    // Only track debt and payment records for this customer
    if (record.kind === 'debt') {
      const recordKey = (record as any).customerKey;
      if (recordKey === key) {
        balance += record.amount;
      }
    } else if (record.kind === 'payment') {
      const recordKey = (record as any).customerKey;
      if (recordKey === key) {
        balance -= record.amount;
      }
    }
  }

  return balance;
}
