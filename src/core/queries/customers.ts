// Customer balance queries for the ledger

import type { LedgerStore } from '../../store/interface.js';
import type { Shop } from '../shops/types.js';
import type { Record } from '../records/types.js';
import { customerKey } from '../records/types.js';
import { activeRecords } from '../records/active.js';

export interface CustomerBalance {
  displayName: string; // Original display name
  balance: number; // cents (positive = owes, negative = credit)
}

/**
 * Computes all customer balances from a list of active records
 * Returns a map from customer key to { displayName, balance }
 * Used internally by both getWhoOwes and getCustomerBalance
 */
function computeCustomerBalances(
  activeList: Record[]
): Map<string, { displayName: string; balance: number }> {
  const customers = new Map<string, { displayName: string; balance: number }>();

  for (const record of activeList) {
    // Only track debt and payment records
    if (record.kind === 'debt' || record.kind === 'payment') {
      const key = record.customerKey;
      const displayName = record.customerDisplayName;
      const current = customers.get(key) || { displayName, balance: 0 };

      if (record.kind === 'debt') {
        current.balance += record.amount;
      } else if (record.kind === 'payment') {
        current.balance -= record.amount;
      }

      customers.set(key, current);
    }
  }

  return customers;
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

  // Filter to only active (non-reversed) records
  const { active: activeList } = activeRecords(allRecords);

  // Compute customer balances from active records
  const customers = computeCustomerBalances(activeList);

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

  // Filter to only active (non-reversed) records
  const { active: activeList } = activeRecords(allRecords);

  // Compute customer balances from active records
  const customers = computeCustomerBalances(activeList);

  // Return balance for this customer, or 0 if not found
  const customer = customers.get(key);
  return customer?.balance ?? 0;
}
