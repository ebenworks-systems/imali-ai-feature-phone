// Tests for customer balance queries

import { describe, it, expect, beforeEach } from 'vitest';
import type { LedgerStore } from '../../../src/store/interface.js';
import { MemoryStore } from '../../../src/store/memory/store.js';
import { createShop } from '../../../src/core/shops/types.js';
import { getWhoOwes, getCustomerBalance } from '../../../src/core/queries/customers.js';
import { recordDebt, recordPayment, undoLastRecord } from '../../../src/core/ledger/operations.js';
import type { ParsedAmount } from '../../../src/core/money/parse.js';

describe('customer balance queries', () => {
  let store: LedgerStore;
  let shop: ReturnType<typeof createShop>;
  const now = new Date('2025-11-03T10:30:00Z');

  beforeEach(() => {
    store = new MemoryStore();
    shop = createShop({
      name: 'Test Shop',
      phone: '+27 00 000 1234',
      currency: 'ZAR',
      timeZone: 'Africa/Johannesburg'
    });
  });

  describe('getWhoOwes', () => {
    it('returns empty list for shop with no debts', async () => {
      const result = await getWhoOwes(store, shop);
      expect(result).toEqual([]);
    });

    it('lists customers with positive balances', async () => {
      await recordDebt(store, shop, {
        amount: { cents: 5000, requiresConfirmation: false },
        customer: 'Tendai',
        channel: 'sms',
        originalWords: 'Tendai owes 50',
        now
      });

      await recordDebt(store, shop, {
        amount: { cents: 3000, requiresConfirmation: false },
        customer: 'Mary',
        channel: 'sms',
        originalWords: 'Mary owes 30',
        now
      });

      const result = await getWhoOwes(store, shop);

      expect(result).toEqual([
        { displayName: 'Tendai', balance: 5000 },
        { displayName: 'Mary', balance: 3000 }
      ]);
    });

    it('sorts by balance largest first', async () => {
      await recordDebt(store, shop, {
        amount: { cents: 3000, requiresConfirmation: false },
        customer: 'John',
        channel: 'sms',
        originalWords: 'John owes 30',
        now
      });

      await recordDebt(store, shop, {
        amount: { cents: 10000, requiresConfirmation: false },
        customer: 'Jane',
        channel: 'sms',
        originalWords: 'Jane owes 100',
        now
      });

      await recordDebt(store, shop, {
        amount: { cents: 5000, requiresConfirmation: false },
        customer: 'Bob',
        channel: 'sms',
        originalWords: 'Bob owes 50',
        now
      });

      const result = await getWhoOwes(store, shop);

      expect(result).toEqual([
        { displayName: 'Jane', balance: 10000 },
        { displayName: 'Bob', balance: 5000 },
        { displayName: 'John', balance: 3000 }
      ]);
    });

    it('excludes customers with zero balance', async () => {
      await recordDebt(store, shop, {
        amount: { cents: 5000, requiresConfirmation: false },
        customer: 'Tendai',
        channel: 'sms',
        originalWords: 'Tendai owes 50',
        now
      });

      await recordPayment(store, shop, {
        amount: { cents: 5000, requiresConfirmation: false },
        customer: 'Tendai',
        channel: 'sms',
        originalWords: 'Tendai paid 50',
        now
      });

      const result = await getWhoOwes(store, shop);

      expect(result).toEqual([]);
    });

    it('excludes customers with credit (negative balance)', async () => {
      await recordDebt(store, shop, {
        amount: { cents: 5000, requiresConfirmation: false },
        customer: 'Mary',
        channel: 'sms',
        originalWords: 'Mary owes 50',
        now
      });

      await recordPayment(store, shop, {
        amount: { cents: 7000, requiresConfirmation: false },
        customer: 'Mary',
        channel: 'sms',
        originalWords: 'Mary paid 70',
        now
      });

      const result = await getWhoOwes(store, shop);

      // Mary has credit, should not appear
      expect(result).toEqual([]);
    });

    it('handles multiple transactions per customer', async () => {
      // Tendai owes 50, pays 20, owes 10 = 40 total
      await recordDebt(store, shop, {
        amount: { cents: 5000, requiresConfirmation: false },
        customer: 'Tendai',
        channel: 'sms',
        originalWords: 'Tendai owes 50',
        now
      });

      await recordPayment(store, shop, {
        amount: { cents: 2000, requiresConfirmation: false },
        customer: 'Tendai',
        channel: 'sms',
        originalWords: 'Tendai paid 20',
        now
      });

      await recordDebt(store, shop, {
        amount: { cents: 1000, requiresConfirmation: false },
        customer: 'Tendai',
        channel: 'sms',
        originalWords: 'Tendai owes 10',
        now
      });

      const result = await getWhoOwes(store, shop);

      expect(result).toEqual([{ displayName: 'Tendai', balance: 4000 }]);
    });

    it('normalizes customer names for grouping', async () => {
      await recordDebt(store, shop, {
        amount: { cents: 5000, requiresConfirmation: false },
        customer: 'tendai',
        channel: 'sms',
        originalWords: 'tendai owes 50',
        now
      });

      await recordPayment(store, shop, {
        amount: { cents: 2000, requiresConfirmation: false },
        customer: 'TENDAI',
        channel: 'sms',
        originalWords: 'TENDAI paid 20',
        now
      });

      const result = await getWhoOwes(store, shop);

      // Should group under the first display name encountered
      expect(result).toEqual([{ displayName: 'tendai', balance: 3000 }]);
    });

    it('excludes reversed records', async () => {
      await recordDebt(store, shop, {
        amount: { cents: 5000, requiresConfirmation: false },
        customer: 'Tendai',
        channel: 'sms',
        originalWords: 'Tendai owes 50',
        now
      });

      // Undo the debt
      await undoLastRecord(store, shop, {
        channel: 'sms',
        originalWords: 'undo',
        now
      });

      const result = await getWhoOwes(store, shop);

      expect(result).toEqual([]);
    });
  });

  describe('getCustomerBalance', () => {
    it('returns 0 for customer with no transactions', async () => {
      const balance = await getCustomerBalance(store, shop, 'Unknown');
      expect(balance).toBe(0);
    });

    it('calculates balance for customer with debts', async () => {
      await recordDebt(store, shop, {
        amount: { cents: 5000, requiresConfirmation: false },
        customer: 'Tendai',
        channel: 'sms',
        originalWords: 'Tendai owes 50',
        now
      });

      await recordDebt(store, shop, {
        amount: { cents: 3000, requiresConfirmation: false },
        customer: 'Tendai',
        channel: 'sms',
        originalWords: 'Tendai owes 30',
        now
      });

      const balance = await getCustomerBalance(store, shop, 'Tendai');

      expect(balance).toBe(8000);
    });

    it('subtracts payments from debts', async () => {
      await recordDebt(store, shop, {
        amount: { cents: 5000, requiresConfirmation: false },
        customer: 'Tendai',
        channel: 'sms',
        originalWords: 'Tendai owes 50',
        now
      });

      await recordPayment(store, shop, {
        amount: { cents: 2000, requiresConfirmation: false },
        customer: 'Tendai',
        channel: 'sms',
        originalWords: 'Tendai paid 20',
        now
      });

      const balance = await getCustomerBalance(store, shop, 'Tendai');

      expect(balance).toBe(3000);
    });

    it('handles case-insensitive name matching', async () => {
      await recordDebt(store, shop, {
        amount: { cents: 5000, requiresConfirmation: false },
        customer: 'Tendai',
        channel: 'sms',
        originalWords: 'Tendai owes 50',
        now
      });

      const balance1 = await getCustomerBalance(store, shop, 'tendai');
      const balance2 = await getCustomerBalance(store, shop, 'TENDAI');
      const balance3 = await getCustomerBalance(store, shop, 'TenDai');

      expect(balance1).toBe(5000);
      expect(balance2).toBe(5000);
      expect(balance3).toBe(5000);
    });

    it('returns negative balance for customer with credit', async () => {
      await recordDebt(store, shop, {
        amount: { cents: 5000, requiresConfirmation: false },
        customer: 'Mary',
        channel: 'sms',
        originalWords: 'Mary owes 50',
        now
      });

      await recordPayment(store, shop, {
        amount: { cents: 7000, requiresConfirmation: false },
        customer: 'Mary',
        channel: 'sms',
        originalWords: 'Mary paid 70',
        now
      });

      const balance = await getCustomerBalance(store, shop, 'Mary');

      expect(balance).toBe(-2000);
    });

    it('excludes reversed transactions', async () => {
      await recordDebt(store, shop, {
        amount: { cents: 5000, requiresConfirmation: false },
        customer: 'Tendai',
        channel: 'sms',
        originalWords: 'Tendai owes 50',
        now
      });

      await recordPayment(store, shop, {
        amount: { cents: 2000, requiresConfirmation: false },
        customer: 'Tendai',
        channel: 'sms',
        originalWords: 'Tendai paid 20',
        now
      });

      // Undo the payment
      await undoLastRecord(store, shop, {
        channel: 'sms',
        originalWords: 'undo',
        now
      });

      const balance = await getCustomerBalance(store, shop, 'Tendai');

      // Should only have the debt, not the payment
      expect(balance).toBe(5000);
    });

    it('normalizes name with extra spaces', async () => {
      await recordDebt(store, shop, {
        amount: { cents: 5000, requiresConfirmation: false },
        customer: '  Tendai  ',
        channel: 'sms',
        originalWords: '  Tendai   owes 50',
        now
      });

      const balance = await getCustomerBalance(store, shop, 'Tendai');

      expect(balance).toBe(5000);
    });
  });
});
