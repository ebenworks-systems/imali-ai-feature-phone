// Tests for today's summary query

import { describe, it, expect, beforeEach } from 'vitest';
import type { LedgerStore } from '../../../src/store/interface.js';
import { MemoryStore } from '../../../src/store/memory/store.js';
import { createShop } from '../../../src/core/shops/types.js';
import { getTodaySummary } from '../../../src/core/queries/today.js';
import {
  recordSale,
  recordExpense,
  recordDebt,
  recordPayment,
  undoLastRecord
} from '../../../src/core/ledger/operations.js';
import type { ParsedAmount } from '../../../src/core/money/parse.js';

describe('getTodaySummary', () => {
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

  it('returns zero totals for new shop', async () => {
    const summary = await getTodaySummary(store, shop, now);

    expect(summary).toEqual({
      sales: {
        total: 0,
        count: 0
      },
      expenses: {
        total: 0
      },
      moneyInHand: 0,
      newDebts: 0,
      paymentsReceived: 0,
      totalOwed: 0
    });
  });

  it('calculates sales total and count for today', async () => {
    const amount1: ParsedAmount = { cents: 4500, requiresConfirmation: false };
    const amount2: ParsedAmount = { cents: 3000, requiresConfirmation: false };

    await recordSale(store, shop, {
      amount: amount1,
      item: 'bread',
      channel: 'sms',
      originalWords: 'sold 45 bread',
      now
    });

    await recordSale(store, shop, {
      amount: amount2,
      item: 'eggs',
      channel: 'sms',
      originalWords: 'sold 30 eggs',
      now
    });

    const summary = await getTodaySummary(store, shop, now);

    expect(summary.sales).toEqual({
      total: 7500,
      count: 2
    });
  });

  it('calculates expenses total for today', async () => {
    const amount1: ParsedAmount = { cents: 2000, requiresConfirmation: false };
    const amount2: ParsedAmount = { cents: 1500, requiresConfirmation: false };

    await recordExpense(store, shop, {
      amount: amount1,
      item: 'taxi',
      channel: 'sms',
      originalWords: 'spent 20 taxi',
      now
    });

    await recordExpense(store, shop, {
      amount: amount2,
      item: 'transport',
      channel: 'sms',
      originalWords: 'spent 15 transport',
      now
    });

    const summary = await getTodaySummary(store, shop, now);

    expect(summary.expenses.total).toBe(3500);
  });

  it('calculates money in hand (sales + payments - expenses)', async () => {
    await recordSale(store, shop, {
      amount: { cents: 5000, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 50',
      now
    });

    await recordPayment(store, shop, {
      amount: { cents: 2000, requiresConfirmation: false },
      customer: 'John',
      channel: 'sms',
      originalWords: 'John paid 20',
      now
    });

    await recordExpense(store, shop, {
      amount: { cents: 1500, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'spent 15',
      now
    });

    const summary = await getTodaySummary(store, shop, now);

    expect(summary.moneyInHand).toBe(5000 + 2000 - 1500);
  });

  it('tracks new debts for today', async () => {
    const amount1: ParsedAmount = { cents: 3000, requiresConfirmation: false };
    const amount2: ParsedAmount = { cents: 2500, requiresConfirmation: false };

    await recordDebt(store, shop, {
      amount: amount1,
      customer: 'Tendai',
      channel: 'sms',
      originalWords: 'Tendai owes 30',
      now
    });

    await recordDebt(store, shop, {
      amount: amount2,
      customer: 'Mary',
      channel: 'sms',
      originalWords: 'Mary owes 25',
      now
    });

    const summary = await getTodaySummary(store, shop, now);

    expect(summary.newDebts).toBe(5500);
  });

  it('tracks payments received today', async () => {
    const amount1: ParsedAmount = { cents: 1500, requiresConfirmation: false };
    const amount2: ParsedAmount = { cents: 2000, requiresConfirmation: false };

    await recordPayment(store, shop, {
      amount: amount1,
      customer: 'John',
      channel: 'sms',
      originalWords: 'John paid 15',
      now
    });

    await recordPayment(store, shop, {
      amount: amount2,
      customer: 'Jane',
      channel: 'sms',
      originalWords: 'Jane paid 20',
      now
    });

    const summary = await getTodaySummary(store, shop, now);

    expect(summary.paymentsReceived).toBe(3500);
  });

  it('calculates total owed (positive balances only)', async () => {
    // Create debts and payments across multiple customers
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
      amount: { cents: 3000, requiresConfirmation: false },
      customer: 'Mary',
      channel: 'sms',
      originalWords: 'Mary owes 30',
      now
    });

    // Mary pays more than she owes (gives her credit)
    await recordPayment(store, shop, {
      amount: { cents: 5000, requiresConfirmation: false },
      customer: 'Mary',
      channel: 'sms',
      originalWords: 'Mary paid 50',
      now
    });

    const summary = await getTodaySummary(store, shop, now);

    // Tendai owes 3000, Mary has credit -2000, so total owed is 3000
    expect(summary.totalOwed).toBe(3000);
  });

  it('excludes reversed records from today summary', async () => {
    await recordSale(store, shop, {
      amount: { cents: 4500, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 45',
      now
    });

    await recordSale(store, shop, {
      amount: { cents: 3000, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 30',
      now
    });

    // Undo the second sale
    await undoLastRecord(store, shop, {
      channel: 'sms',
      originalWords: 'undo',
      now
    });

    const summary = await getTodaySummary(store, shop, now);

    // Only first sale should count
    expect(summary.sales.total).toBe(4500);
    expect(summary.sales.count).toBe(1);
  });

  it('only counts records from today', async () => {
    const yesterday = new Date('2025-11-02T10:30:00Z');

    // Record sale yesterday
    await recordSale(store, shop, {
      amount: { cents: 5000, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 50',
      now: yesterday
    });

    // Record sale today
    await recordSale(store, shop, {
      amount: { cents: 3000, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 30',
      now
    });

    const summary = await getTodaySummary(store, shop, now);

    // Only today's sale should count
    expect(summary.sales.total).toBe(3000);
    expect(summary.sales.count).toBe(1);
  });

  it('includes all historical customer balances in total owed', async () => {
    const yesterday = new Date('2025-11-02T10:30:00Z');

    // Yesterday: Tendai owes 10000
    await recordDebt(store, shop, {
      amount: { cents: 10000, requiresConfirmation: false },
      customer: 'Tendai',
      channel: 'sms',
      originalWords: 'Tendai owes 100',
      now: yesterday
    });

    // Today: Tendai pays 3000
    await recordPayment(store, shop, {
      amount: { cents: 3000, requiresConfirmation: false },
      customer: 'Tendai',
      channel: 'sms',
      originalWords: 'Tendai paid 30',
      now
    });

    const summary = await getTodaySummary(store, shop, now);

    // Total owed should be 10000 - 3000 = 7000
    expect(summary.totalOwed).toBe(7000);
    // But new debts today should be 0
    expect(summary.newDebts).toBe(0);
    // And payments received today should be 3000
    expect(summary.paymentsReceived).toBe(3000);
  });
});
