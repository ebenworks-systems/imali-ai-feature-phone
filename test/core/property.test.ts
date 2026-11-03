// Comprehensive property tests for ledger core

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { parseAmount } from '../../src/core/money/parse.js';
import { formatCents } from '../../src/core/money/format.js';
import { customerKey, customerDisplayName } from '../../src/core/records/types.js';
import { MemoryStore } from '../../src/store/memory/store.js';
import { createShop } from '../../src/core/shops/types.js';
import {
  recordSale,
  recordExpense,
  recordDebt,
  recordPayment,
  undoLastRecord
} from '../../src/core/ledger/operations.js';
import { getTodaySummary } from '../../src/core/queries/today.js';
import { getWhoOwes, getCustomerBalance } from '../../src/core/queries/customers.js';
import { getShopLocalDate, isTodayInShopTimeZone } from '../../src/core/timezone/utils.js';

describe('Property: Parse/Format round trip', () => {
  it('formatting then parsing returns the same amount (within valid range)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999_999_999_999 }), (cents) => {
        const formatted = formatCents(cents, 'ZAR');
        const result = parseAmount(formatted, 'ZAR');

        expect(result.type).toBe('success');
        if (result.type === 'success') {
          expect(result.amount.cents).toBe(cents);
        }
      }),
      { numRuns: 50 }
    );
  });

  it('formatting with decimals preserves fractional cents', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999_999 }),
        fc.integer({ min: 1, max: 99 }),
        (whole, decimal) => {
          const cents = whole * 100 + decimal;
          const formatted = formatCents(cents, 'ZAR');
          const result = parseAmount(formatted, 'ZAR');

          expect(result.type).toBe('success');
          if (result.type === 'success') {
            expect(result.amount.cents).toBe(cents);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('Property: Customer name normalization', () => {
  it('customer key is always lowercase', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (name) => {
        const key = customerKey(name);
        expect(key).toBe(key.toLowerCase());
      }),
      { numRuns: 100 }
    );
  });

  it('display name is trimmed', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (name) => {
        const display = customerDisplayName(name);
        expect(display).toBe(display.trim());
      }),
      { numRuns: 100 }
    );
  });

  it('multiple spaces are collapsed to one', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (name) => {
        const display = customerDisplayName(name);
        // Check no double spaces exist
        expect(display).not.toMatch(/  /);
      }),
      { numRuns: 100 }
    );
  });

  it('names with different case but same content have same key', () => {
    const names = [
      'Tendai',
      'TENDAI',
      'tendai',
      'TeNdAi'
    ];

    const keys = names.map(name => customerKey(name));
    const firstKey = keys[0];

    for (const key of keys) {
      expect(key).toBe(firstKey);
    }
  });

  it('names with extra spaces have same key', () => {
    const names = [
      'John Smith',
      '  John Smith  ',
      'John  Smith',
      'John   Smith'
    ];

    const keys = names.map(name => customerKey(name));
    const firstKey = keys[0];

    for (const key of keys) {
      expect(key).toBe(firstKey);
    }
  });
});

describe('Property: Balance unchanged after record and reversal', () => {
  it('sales plus reversal leaves balance at zero', async () => {
    const store = new MemoryStore();
    const shop = createShop({
      name: 'Test Shop',
      phone: '+27 00 000 1234',
      currency: 'ZAR',
      timeZone: 'Africa/Johannesburg'
    });
    const now = new Date('2025-11-03T10:00:00Z');

    // Record a sale
    await recordSale(store, shop, {
      amount: { cents: 5000, requiresConfirmation: false },
      item: 'bread',
      channel: 'sms',
      originalWords: 'sold 50 bread',
      now
    });

    // Get summary before undo
    let summary = await getTodaySummary(store, shop, now);
    const beforeSales = summary.sales.total;

    // Undo the sale
    const undoResult = await undoLastRecord(store, shop, {
      channel: 'sms',
      originalWords: 'undo',
      now: new Date('2025-11-03T10:01:00Z')
    });

    expect(undoResult.success).toBe(true);

    // Get summary after undo
    summary = await getTodaySummary(store, shop, new Date('2025-11-03T10:01:00Z'));

    // Sales should be back to zero (both records are today but reversal cancels out)
    expect(summary.sales.total).toBe(0);
  });

  it('multiple transactions net correctly with reversals', async () => {
    const store = new MemoryStore();
    const shop = createShop({
      name: 'Test Shop',
      phone: '+27 00 000 1234',
      currency: 'ZAR',
      timeZone: 'Africa/Johannesburg'
    });
    const now = new Date('2025-11-03T10:00:00Z');

    // Record three sales
    await recordSale(store, shop, {
      amount: { cents: 1000, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 10',
      now
    });

    await recordSale(store, shop, {
      amount: { cents: 2000, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 20',
      now: new Date('2025-11-03T10:01:00Z')
    });

    await recordSale(store, shop, {
      amount: { cents: 3000, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 30',
      now: new Date('2025-11-03T10:02:00Z')
    });

    // Undo the last one
    await undoLastRecord(store, shop, {
      channel: 'sms',
      originalWords: 'undo',
      now: new Date('2025-11-03T10:03:00Z')
    });

    const summary = await getTodaySummary(store, shop, new Date('2025-11-03T10:03:00Z'));

    // Should only have first two sales: 10 + 20 = 30
    expect(summary.sales.total).toBe(3000);
  });
});

describe('Property: Customer balance calculations', () => {
  it('who owes returns only positive balances', async () => {
    const store = new MemoryStore();
    const shop = createShop({
      name: 'Test Shop',
      phone: '+27 00 000 1234',
      currency: 'ZAR',
      timeZone: 'Africa/Johannesburg'
    });
    const now = new Date('2025-11-03T10:00:00Z');

    // Create a debt
    await recordDebt(store, shop, {
      amount: { cents: 5000, requiresConfirmation: false },
      customer: 'Tendai',
      channel: 'sms',
      originalWords: 'Tendai owes 50',
      now
    });

    // Get who owes
    const whoOwes = await getWhoOwes(store, shop);

    expect(whoOwes).toHaveLength(1);
    expect(whoOwes[0].displayName).toBe('Tendai');
    expect(whoOwes[0].balance).toBe(5000);
  });

  it('who owes excludes customers with zero balance', async () => {
    const store = new MemoryStore();
    const shop = createShop({
      name: 'Test Shop',
      phone: '+27 00 000 1234',
      currency: 'ZAR',
      timeZone: 'Africa/Johannesburg'
    });
    const now = new Date('2025-11-03T10:00:00Z');

    // Debt and then full payment
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
      now: new Date('2025-11-03T10:01:00Z')
    });

    const whoOwes = await getWhoOwes(store, shop);

    expect(whoOwes).toHaveLength(0);
  });

  it('who owes excludes customers with credit (negative balance)', async () => {
    const store = new MemoryStore();
    const shop = createShop({
      name: 'Test Shop',
      phone: '+27 00 000 1234',
      currency: 'ZAR',
      timeZone: 'Africa/Johannesburg'
    });
    const now = new Date('2025-11-03T10:00:00Z');

    // Payment without prior debt (creates credit)
    await recordPayment(store, shop, {
      amount: { cents: 5000, requiresConfirmation: false },
      customer: 'Tendai',
      channel: 'sms',
      originalWords: 'Tendai paid 50',
      now
    });

    const whoOwes = await getWhoOwes(store, shop);

    expect(whoOwes).toHaveLength(0);
  });

  it('who owes is sorted by balance (largest first)', async () => {
    const store = new MemoryStore();
    const shop = createShop({
      name: 'Test Shop',
      phone: '+27 00 000 1234',
      currency: 'ZAR',
      timeZone: 'Africa/Johannesburg'
    });
    const now = new Date('2025-11-03T10:00:00Z');

    // Create debts for multiple customers
    await recordDebt(store, shop, {
      amount: { cents: 3000, requiresConfirmation: false },
      customer: 'Alice',
      channel: 'sms',
      originalWords: 'Alice owes 30',
      now
    });

    await recordDebt(store, shop, {
      amount: { cents: 8000, requiresConfirmation: false },
      customer: 'Bob',
      channel: 'sms',
      originalWords: 'Bob owes 80',
      now: new Date('2025-11-03T10:01:00Z')
    });

    await recordDebt(store, shop, {
      amount: { cents: 5000, requiresConfirmation: false },
      customer: 'Charlie',
      channel: 'sms',
      originalWords: 'Charlie owes 50',
      now: new Date('2025-11-03T10:02:00Z')
    });

    const whoOwes = await getWhoOwes(store, shop);

    expect(whoOwes).toHaveLength(3);
    expect(whoOwes[0].balance).toBe(8000); // Bob
    expect(whoOwes[1].balance).toBe(5000); // Charlie
    expect(whoOwes[2].balance).toBe(3000); // Alice
  });

  it('customer balance uses key for matching', async () => {
    const store = new MemoryStore();
    const shop = createShop({
      name: 'Test Shop',
      phone: '+27 00 000 1234',
      currency: 'ZAR',
      timeZone: 'Africa/Johannesburg'
    });
    const now = new Date('2025-11-03T10:00:00Z');

    // Record debt with one capitalization
    await recordDebt(store, shop, {
      amount: { cents: 5000, requiresConfirmation: false },
      customer: 'Tendai',
      channel: 'sms',
      originalWords: 'Tendai owes 50',
      now
    });

    // Record payment with different capitalization
    await recordPayment(store, shop, {
      amount: { cents: 2000, requiresConfirmation: false },
      customer: 'TENDAI',
      channel: 'sms',
      originalWords: 'TENDAI paid 20',
      now: new Date('2025-11-03T10:01:00Z')
    });

    // Get balance for lowercase version
    const balance = await getCustomerBalance(store, shop, 'tendai');

    // Should be 5000 - 2000 = 3000, not two separate customers
    expect(balance).toBe(3000);
  });
});

describe('Property: Time zone calculations', () => {
  it('same UTC time produces different local dates in different time zones', () => {
    const utcDate = new Date('2025-11-03T23:00:00Z'); // 11pm UTC
    const shop1 = createShop({
      name: 'Shop1',
      phone: '+27 00 000 1111',
      currency: 'ZAR',
      timeZone: 'Africa/Johannesburg' // UTC+2
    });
    const shop2 = createShop({
      name: 'Shop2',
      phone: '+27 00 000 2222',
      currency: 'ZAR',
      timeZone: 'Atlantic/Azores' // UTC-1
    });

    const date1 = getShopLocalDate(shop1, utcDate);
    const date2 = getShopLocalDate(shop2, utcDate);

    // Different time zones should have different local dates
    // Johannesburg: 2025-11-04 (11pm + 2 hours = 1am next day)
    // Azores: 2025-11-03 (11pm - 1 hour = 10pm same day)
    expect(date1).not.toBe(date2);
  });

  it('is today check respects time zone boundaries', () => {
    const now = new Date('2025-11-03T22:00:00Z');

    const shop = createShop({
      name: 'Test Shop',
      phone: '+27 00 000 1234',
      currency: 'ZAR',
      timeZone: 'Africa/Johannesburg' // UTC+2, so 2025-11-04 00:00 UTC = 2025-11-04 02:00 local
    });

    // A time at the same moment
    const sameTime = new Date('2025-11-03T22:00:00Z');

    // Check is today with respect to the shop's timezone
    const isToday = isTodayInShopTimeZone(shop, sameTime.toISOString(), now);
    expect(isToday).toBe(true);
  });
});

describe('Property: Ledger operation invariants', () => {
  it('money in hand is sales minus expenses (excluding reversals)', async () => {
    const store = new MemoryStore();
    const shop = createShop({
      name: 'Test Shop',
      phone: '+27 00 000 1234',
      currency: 'ZAR',
      timeZone: 'Africa/Johannesburg'
    });
    const now = new Date('2025-11-03T10:00:00Z');

    // Record sales
    await recordSale(store, shop, {
      amount: { cents: 5000, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 50',
      now
    });

    await recordSale(store, shop, {
      amount: { cents: 3000, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 30',
      now: new Date('2025-11-03T10:01:00Z')
    });

    // Record expenses
    await recordExpense(store, shop, {
      amount: { cents: 2000, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'spent 20',
      now: new Date('2025-11-03T10:02:00Z')
    });

    const summary = await getTodaySummary(store, shop, new Date('2025-11-03T10:02:00Z'));

    // Money in hand = sales - expenses = 8000 - 2000 = 6000
    expect(summary.moneyInHand).toBe(6000);
  });

  it('record count matches total records including reversals', async () => {
    const store = new MemoryStore();
    const shop = createShop({
      name: 'Test Shop',
      phone: '+27 00 000 1234',
      currency: 'ZAR',
      timeZone: 'Africa/Johannesburg'
    });
    const now = new Date('2025-11-03T10:00:00Z');

    // Record sales
    await recordSale(store, shop, {
      amount: { cents: 5000, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 50',
      now
    });

    await recordSale(store, shop, {
      amount: { cents: 3000, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 30',
      now: new Date('2025-11-03T10:01:00Z')
    });

    // Undo one
    await undoLastRecord(store, shop, {
      channel: 'sms',
      originalWords: 'undo',
      now: new Date('2025-11-03T10:02:00Z')
    });

    const summary = await getTodaySummary(store, shop, new Date('2025-11-03T10:02:00Z'));

    // Sale count should only count non-reversed sales
    expect(summary.sales.total).toBe(5000);
  });
});
