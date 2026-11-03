// Integration tests for complete ledger flows

import { describe, it, expect, beforeEach } from 'vitest';
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
import { getDayCloseSummary } from '../../src/core/queries/dayClose.js';
import { generateExport } from '../../src/core/export/generator.js';
import { getShopLocalDate, getShopDayBounds } from '../../src/core/timezone/utils.js';

describe('Integration: Complete workflow - record to query to undo', () => {
  let store: ReturnType<typeof MemoryStore>;
  let shop: ReturnType<typeof createShop>;

  beforeEach(() => {
    store = new MemoryStore();
    shop = createShop({
      name: 'Test Shop',
      phone: '+27 00 000 1234',
      currency: 'ZAR',
      timeZone: 'Africa/Johannesburg'
    });
  });

  it('records sale, queries summary, then undoes and verifies balance returns to zero', async () => {
    const now = new Date('2025-11-03T10:00:00Z');

    // Record a sale
    const saleResult = await recordSale(store, shop, {
      amount: { cents: 5000, requiresConfirmation: false },
      item: 'bread',
      channel: 'sms',
      originalWords: 'sold 50 bread',
      now
    });

    expect(saleResult.success).toBe(true);
    if (!saleResult.success) return;

    // Verify summary shows the sale
    let summary = await getTodaySummary(store, shop, now);
    expect(summary.sales.total).toBe(5000);
    expect(summary.sales.count).toBe(1);
    expect(summary.moneyInHand).toBe(5000);

    // Undo the sale
    const undoResult = await undoLastRecord(store, shop, {
      channel: 'sms',
      originalWords: 'undo',
      now: new Date('2025-11-03T10:01:00Z')
    });

    expect(undoResult.success).toBe(true);
    if (!undoResult.success) return;

    // Verify summary shows no sales
    summary = await getTodaySummary(store, shop, new Date('2025-11-03T10:01:00Z'));
    expect(summary.sales.total).toBe(0);
    expect(summary.sales.count).toBe(0);
    expect(summary.moneyInHand).toBe(0);
  });

  it('records multiple transactions and verifies they all appear in summary', async () => {
    const now = new Date('2025-11-03T10:00:00Z');
    let time = now;

    // Record sales
    await recordSale(store, shop, {
      amount: { cents: 5000, requiresConfirmation: false },
      item: 'bread',
      channel: 'sms',
      originalWords: 'sold 50 bread',
      now: time
    });

    time = new Date(time.getTime() + 60_000); // +1 minute

    await recordSale(store, shop, {
      amount: { cents: 3000, requiresConfirmation: false },
      item: 'milk',
      channel: 'sms',
      originalWords: 'sold 30 milk',
      now: time
    });

    time = new Date(time.getTime() + 60_000);

    // Record expense
    await recordExpense(store, shop, {
      amount: { cents: 2000, requiresConfirmation: false },
      item: 'transport',
      channel: 'sms',
      originalWords: 'spent 20 transport',
      now: time
    });

    time = new Date(time.getTime() + 60_000);

    // Record debt
    await recordDebt(store, shop, {
      amount: { cents: 4000, requiresConfirmation: false },
      customer: 'Tendai',
      item: 'sugar',
      channel: 'sms',
      originalWords: 'Tendai owes 40 sugar',
      now: time
    });

    // Get summary
    const summary = await getTodaySummary(store, shop, time);

    // Verify all transactions
    expect(summary.sales.total).toBe(8000); // 50 + 30
    expect(summary.sales.count).toBe(2);
    expect(summary.expenses.total).toBe(2000);
    expect(summary.moneyInHand).toBe(6000); // 8000 - 2000
    expect(summary.newDebts).toBe(4000);
  });

  it('handles customer debt and payment matching with different name capitalizations', async () => {
    const now = new Date('2025-11-03T10:00:00Z');

    // Record debt with one capitalization
    await recordDebt(store, shop, {
      amount: { cents: 5000, requiresConfirmation: false },
      customer: 'Tendai',
      item: 'sugar',
      channel: 'sms',
      originalWords: 'Tendai owes 50 sugar',
      now
    });

    // Record payment with different capitalization
    await recordPayment(store, shop, {
      amount: { cents: 2000, requiresConfirmation: false },
      customer: 'TENDAI',
      channel: 'sms',
      originalWords: 'TENDAI paid 20',
      now: new Date(now.getTime() + 60_000)
    });

    // Record another payment with yet another capitalization
    await recordPayment(store, shop, {
      amount: { cents: 1000, requiresConfirmation: false },
      customer: 'tendai',
      channel: 'sms',
      originalWords: 'tendai paid 10',
      now: new Date(now.getTime() + 120_000)
    });

    // Get who owes - should show Tendai with 2000 remaining (5000 - 2000 - 1000)
    const whoOwes = await getWhoOwes(store, shop);

    expect(whoOwes).toHaveLength(1);
    expect(whoOwes[0].displayName).toBe('Tendai'); // From first transaction
    expect(whoOwes[0].balance).toBe(2000);

    // Also verify with direct balance query
    const balance = await getCustomerBalance(store, shop, 'TendAi');
    expect(balance).toBe(2000);
  });
});

describe('Integration: Day boundary scenarios with time injection', () => {
  let store: ReturnType<typeof MemoryStore>;
  let shop: ReturnType<typeof createShop>;

  beforeEach(() => {
    store = new MemoryStore();
    shop = createShop({
      name: 'Test Shop',
      phone: '+27 00 000 1234',
      currency: 'ZAR',
      timeZone: 'Africa/Johannesburg'
    });
  });

  it('correctly separates transactions by day boundary in shop timezone', async () => {
    // Johannesburg is UTC+2, so day boundary is at 22:00 UTC (00:00 Johannesburg)

    // Record a sale on "day 1" (11-02)
    const day1Evening = new Date('2025-11-02T21:00:00Z'); // 23:00 Johannesburg
    await recordSale(store, shop, {
      amount: { cents: 3000, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 30',
      now: day1Evening
    });

    // Record a sale on "day 2" (11-03) after the boundary
    const day2Morning = new Date('2025-11-02T22:30:00Z'); // 00:30 Johannesburg next day
    await recordSale(store, shop, {
      amount: { cents: 5000, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 50',
      now: day2Morning
    });

    // Query for day 1 (actually 11-03 in UTC which maps to 11-03 in Johannesburg time)
    // The reference point is day1Evening, so "today" is 2025-11-03 in Johannesburg
    const summaryDay2 = await getTodaySummary(store, shop, day2Morning);

    // Only the second transaction should be counted (after the boundary)
    expect(summaryDay2.sales.total).toBe(5000);
    expect(summaryDay2.sales.count).toBe(1);
  });

  it('handles midnight rollover scenarios correctly', async () => {
    // Test the exact boundary moment
    // In Johannesburg (UTC+2), the day starts at 22:00 UTC of the previous day

    const justBeforeMidnight = new Date('2025-11-02T21:59:59Z');
    const justAfterMidnight = new Date('2025-11-02T22:00:01Z');

    // Record before midnight (still "day 1")
    await recordSale(store, shop, {
      amount: { cents: 1000, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 10',
      now: justBeforeMidnight
    });

    // Query at the moment just before midnight
    let summary = await getTodaySummary(store, shop, justBeforeMidnight);
    expect(summary.sales.total).toBe(1000);

    // Record after midnight (now "day 2")
    await recordSale(store, shop, {
      amount: { cents: 2000, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 20',
      now: justAfterMidnight
    });

    // Query at the moment just after midnight - should only see the new sale
    summary = await getTodaySummary(store, shop, justAfterMidnight);
    expect(summary.sales.total).toBe(2000);
    expect(summary.sales.count).toBe(1);
  });
});

describe('Integration: Export generation with complete workflow', () => {
  let store: ReturnType<typeof MemoryStore>;
  let shop: ReturnType<typeof createShop>;

  beforeEach(() => {
    store = new MemoryStore();
    shop = createShop({
      name: 'Demo Shop',
      phone: '+27 00 000 1234',
      currency: 'ZAR',
      timeZone: 'Africa/Johannesburg'
    });
  });

  it('exports all record types in chronological order including reversals', async () => {
    const now = new Date('2025-11-03T10:00:00Z');
    let time = now;

    // Create various records
    await recordSale(store, shop, {
      amount: { cents: 5000, requiresConfirmation: false },
      item: 'bread',
      channel: 'sms',
      originalWords: 'sold 50 bread',
      now: time
    });

    time = new Date(time.getTime() + 60_000);

    await recordExpense(store, shop, {
      amount: { cents: 2000, requiresConfirmation: false },
      item: 'stock',
      channel: 'sms',
      originalWords: 'spent 20 stock',
      now: time
    });

    time = new Date(time.getTime() + 60_000);

    await recordDebt(store, shop, {
      amount: { cents: 3000, requiresConfirmation: false },
      customer: 'Tendai',
      channel: 'sms',
      originalWords: 'Tendai owes 30',
      now: time
    });

    time = new Date(time.getTime() + 60_000);

    await recordPayment(store, shop, {
      amount: { cents: 1000, requiresConfirmation: false },
      customer: 'Tendai',
      channel: 'sms',
      originalWords: 'Tendai paid 10',
      now: time
    });

    time = new Date(time.getTime() + 60_000);

    // Undo the payment
    await undoLastRecord(store, shop, {
      channel: 'sms',
      originalWords: 'undo',
      now: time
    });

    // Generate export
    const exportData = await generateExport(store, shop);

    // Verify format
    expect(exportData.format).toBe('imali-ai-ledger-export');
    expect(exportData.version).toBe(1);

    // Verify all 5 records are present (4 + 1 reversal)
    expect(exportData.records).toHaveLength(5);

    // Verify chronological order
    for (let i = 0; i < exportData.records.length - 1; i++) {
      const current = new Date(exportData.records[i].createdAt).getTime();
      const next = new Date(exportData.records[i + 1].createdAt).getTime();
      expect(current).toBeLessThanOrEqual(next);
    }

    // Verify record types
    const kinds = exportData.records.map(r => r.kind);
    expect(kinds).toContain('sale');
    expect(kinds).toContain('expense');
    expect(kinds).toContain('debt');
    expect(kinds).toContain('payment');
    expect(kinds).toContain('reversal');

    // Verify reversal points to payment
    const reversal = exportData.records.find(r => r.kind === 'reversal');
    const payment = exportData.records.find(r => r.kind === 'payment');
    expect(reversal).toBeDefined();
    expect(payment).toBeDefined();
    if (reversal && payment) {
      expect((reversal as any).reversesRecordId).toBe(payment.id);
    }
  });

  it('export maintains data integrity for re-import', async () => {
    const now = new Date('2025-11-03T10:00:00Z');

    // Create a realistic scenario
    await recordSale(store, shop, {
      amount: { cents: 10000, requiresConfirmation: false },
      item: 'groceries',
      channel: 'sms',
      originalWords: 'sold 100 groceries',
      now
    });

    await recordDebt(store, shop, {
      amount: { cents: 5500, requiresConfirmation: false },
      customer: 'John Smith',
      item: 'rice',
      channel: 'sms',
      originalWords: 'John Smith owes 55 rice',
      now: new Date(now.getTime() + 60_000)
    });

    await recordPayment(store, shop, {
      amount: { cents: 2000, requiresConfirmation: false },
      customer: '  john smith  ', // Different spacing/case
      channel: 'sms',
      originalWords: 'john smith paid 20',
      now: new Date(now.getTime() + 120_000)
    });

    // Get current state before export
    const beforeWhoOwes = await getWhoOwes(store, shop);
    const beforeBalance = await getCustomerBalance(store, shop, 'JOHN SMITH');

    // Export
    const exportData = await generateExport(store, shop);

    // Verify shop data is complete
    expect(exportData.shop.id).toBe(shop.id);
    expect(exportData.shop.name).toBe(shop.name);
    expect(exportData.shop.currency).toBe('ZAR');

    // Verify records are complete
    expect(exportData.records.length).toBe(3);

    // Verify customer display names are preserved
    const debtRecord = exportData.records.find(r => r.kind === 'debt');
    expect((debtRecord as any).customerDisplayName).toBe('John Smith');

    const paymentRecord = exportData.records.find(r => r.kind === 'payment');
    expect((paymentRecord as any).customerDisplayName).toBe('john smith');

    // Both should have the same key for matching
    expect((debtRecord as any).customerKey).toBe((paymentRecord as any).customerKey);
  });
});

describe('Integration: Undo returns correct reversal info', () => {
  let store: ReturnType<typeof MemoryStore>;
  let shop: ReturnType<typeof createShop>;

  beforeEach(() => {
    store = new MemoryStore();
    shop = createShop({
      name: 'Test Shop',
      phone: '+27 00 000 1234',
      currency: 'ZAR',
      timeZone: 'Africa/Johannesburg'
    });
  });

  it('undo returns info about which record was reversed', async () => {
    const now = new Date('2025-11-03T10:00:00Z');

    // Record a sale
    await recordSale(store, shop, {
      amount: { cents: 5000, requiresConfirmation: false },
      item: 'bread',
      channel: 'sms',
      originalWords: 'sold 50 bread',
      now
    });

    // Undo it
    const undoResult = await undoLastRecord(store, shop, {
      channel: 'sms',
      originalWords: 'undo',
      now: new Date(now.getTime() + 60_000)
    });

    expect(undoResult.success).toBe(true);
    if (!undoResult.success) return;

    // Verify reversal info
    expect(undoResult.data.reversedRecord).toBeDefined();
    expect(undoResult.data.reversedRecord.kind).toBe('sale');
    expect(undoResult.data.reversedRecord.amount).toBe(5000);
    expect(undoResult.data.reversedRecord.item).toBe('bread');
  });

  it('undo returns customer info for reversed debt', async () => {
    const now = new Date('2025-11-03T10:00:00Z');

    // Record a debt
    await recordDebt(store, shop, {
      amount: { cents: 3000, requiresConfirmation: false },
      customer: 'Tendai',
      item: 'sugar',
      channel: 'sms',
      originalWords: 'Tendai owes 30 sugar',
      now
    });

    // Undo it
    const undoResult = await undoLastRecord(store, shop, {
      channel: 'sms',
      originalWords: 'undo',
      now: new Date(now.getTime() + 60_000)
    });

    expect(undoResult.success).toBe(true);
    if (!undoResult.success) return;

    // Verify reversal info includes customer
    expect(undoResult.data.reversedRecord.kind).toBe('debt');
    expect(undoResult.data.reversedRecord.customer).toBe('Tendai');
  });
});

describe('Integration: Day close summary', () => {
  let store: ReturnType<typeof MemoryStore>;
  let shop: ReturnType<typeof createShop>;

  beforeEach(() => {
    store = new MemoryStore();
    shop = createShop({
      name: 'Test Shop',
      phone: '+27 00 000 1234',
      currency: 'ZAR',
      timeZone: 'Africa/Johannesburg'
    });
  });

  it('day close summary defaults to today not yesterday', async () => {
    const now = new Date('2025-11-03T10:00:00Z');

    // Record transactions
    await recordSale(store, shop, {
      amount: { cents: 5000, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 50',
      now
    });

    await recordExpense(store, shop, {
      amount: { cents: 1000, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'spent 10',
      now
    });

    // Get day close with no date parameter (should default to today)
    const closeToday = await getDayCloseSummary(store, shop, { now });

    // Get day close with yesterday's date
    const yesterday = new Date('2025-11-02T10:00:00Z');
    const closeYesterday = await getDayCloseSummary(store, shop, { now: yesterday });

    // Today's close should have the sales
    expect(closeToday.sales.total).toBe(5000);

    // Yesterday's close should not
    expect(closeYesterday.sales.total).toBe(0);

    // Verify date field shows the correct local date
    const todayLocalDate = getShopLocalDate(shop, now);
    expect(closeToday.date).toBe(todayLocalDate);
  });
});
