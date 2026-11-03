// Tests for day close summary query

import { describe, it, expect, beforeEach } from 'vitest';
import type { LedgerStore } from '../../../src/store/interface.js';
import { MemoryStore } from '../../../src/store/memory/store.js';
import { createShop } from '../../../src/core/shops/types.js';
import { getDayCloseSummary } from '../../../src/core/queries/dayClose.js';
import { recordSale, recordExpense } from '../../../src/core/ledger/operations.js';

describe('getDayCloseSummary', () => {
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

  it('returns day close summary with today as default date', async () => {
    await recordSale(store, shop, {
      amount: { cents: 4500, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 45',
      now
    });

    await recordExpense(store, shop, {
      amount: { cents: 1500, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'spent 15',
      now
    });

    const summary = await getDayCloseSummary(store, shop, { now });

    // Date should be today in shop's time zone (Africa/Johannesburg)
    // 2025-11-03T10:30:00Z is 2025-11-03T12:30:00+02:00 in Johannesburg
    expect(summary.date).toBe('2025-11-03');
    expect(summary.shopId).toBe(shop.id);
    expect(summary.sales.total).toBe(4500);
    expect(summary.expenses.total).toBe(1500);
    expect(summary.moneyInHand).toBe(3000);
  });

  it('uses provided date instead of today', async () => {
    const yesterday = new Date('2025-11-02T10:30:00Z');

    await recordSale(store, shop, {
      amount: { cents: 4500, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 45',
      now: yesterday
    });

    const summary = await getDayCloseSummary(store, shop, {
      date: '2025-11-02',
      now: new Date('2025-11-03T10:30:00Z')
    });

    expect(summary.date).toBe('2025-11-02');
  });

  it('includes all summary fields', async () => {
    const summary = await getDayCloseSummary(store, shop, { now });

    expect(summary).toHaveProperty('date');
    expect(summary).toHaveProperty('shopId');
    expect(summary).toHaveProperty('sales');
    expect(summary).toHaveProperty('expenses');
    expect(summary).toHaveProperty('moneyInHand');
    expect(summary).toHaveProperty('newDebts');
    expect(summary).toHaveProperty('paymentsReceived');
    expect(summary).toHaveProperty('totalOwed');
  });

  it('includes today summary data', async () => {
    await recordSale(store, shop, {
      amount: { cents: 5000, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 50',
      now
    });

    await recordExpense(store, shop, {
      amount: { cents: 2000, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'spent 20',
      now
    });

    const summary = await getDayCloseSummary(store, shop, { now });

    expect(summary.sales).toEqual({
      total: 5000,
      count: 1
    });
    expect(summary.expenses.total).toBe(2000);
    expect(summary.moneyInHand).toBe(3000);
  });
});
