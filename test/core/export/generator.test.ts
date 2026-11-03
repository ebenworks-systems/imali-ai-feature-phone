// Tests for export generation

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LedgerStore } from '../../../src/store/interface.js';
import { MemoryStore } from '../../../src/store/memory/store.js';
import { createShop } from '../../../src/core/shops/types.js';
import { generateExport } from '../../../src/core/export/generator.js';
import {
  recordSale,
  recordExpense,
  recordDebt,
  recordPayment,
  undoLastRecord
} from '../../../src/core/ledger/operations.js';

describe('generateExport', () => {
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

  it('exports shop data with correct format and version', async () => {
    const exportData = await generateExport(store, shop);

    expect(exportData.format).toBe('imali-ai-ledger-export');
    expect(exportData.version).toBe(1);
    expect(exportData.shop).toEqual(shop);
    expect(exportData.records).toEqual([]);
  });

  it('includes exportedAt timestamp', async () => {
    const beforeTime = new Date();
    const exportData = await generateExport(store, shop);
    const afterTime = new Date();

    const exportedTime = new Date(exportData.exportedAt);
    expect(exportedTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
    expect(exportedTime.getTime()).toBeLessThanOrEqual(afterTime.getTime() + 1000);
  });

  it('exports all records in chronological order', async () => {
    const time1 = new Date('2025-11-03T08:00:00Z');
    const time2 = new Date('2025-11-03T09:00:00Z');
    const time3 = new Date('2025-11-03T10:00:00Z');

    // Record in non-chronological order
    await recordSale(store, shop, {
      amount: { cents: 3000, requiresConfirmation: false },
      item: 'item3',
      channel: 'sms',
      originalWords: 'sold 30',
      now: time3
    });

    await recordSale(store, shop, {
      amount: { cents: 1000, requiresConfirmation: false },
      item: 'item1',
      channel: 'sms',
      originalWords: 'sold 10',
      now: time1
    });

    await recordSale(store, shop, {
      amount: { cents: 2000, requiresConfirmation: false },
      item: 'item2',
      channel: 'sms',
      originalWords: 'sold 20',
      now: time2
    });

    const exportData = await generateExport(store, shop);

    expect(exportData.records.length).toBe(3);
    expect(exportData.records[0].item).toBe('item1');
    expect(exportData.records[1].item).toBe('item2');
    expect(exportData.records[2].item).toBe('item3');
  });

  it('includes reversal records in export', async () => {
    await recordSale(store, shop, {
      amount: { cents: 4500, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 45',
      now
    });

    const undoResult = await undoLastRecord(store, shop, {
      channel: 'sms',
      originalWords: 'undo',
      now: new Date('2025-11-03T10:31:00Z')
    });

    expect(undoResult.success).toBe(true);

    const exportData = await generateExport(store, shop);

    expect(exportData.records.length).toBe(2);
    expect(exportData.records[0].kind).toBe('sale');
    expect(exportData.records[1].kind).toBe('reversal');
  });

  it('exports records with all types (sale, expense, debt, payment, reversal)', async () => {
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

    await recordDebt(store, shop, {
      amount: { cents: 3000, requiresConfirmation: false },
      customer: 'Tendai',
      channel: 'sms',
      originalWords: 'Tendai owes 30',
      now
    });

    await recordPayment(store, shop, {
      amount: { cents: 1000, requiresConfirmation: false },
      customer: 'Tendai',
      channel: 'sms',
      originalWords: 'Tendai paid 10',
      now
    });

    const undoResult = await undoLastRecord(store, shop, {
      channel: 'sms',
      originalWords: 'undo',
      now
    });

    expect(undoResult.success).toBe(true);

    const exportData = await generateExport(store, shop);

    expect(exportData.records.length).toBe(5);
    const kinds = exportData.records.map(r => r.kind);
    expect(kinds).toContain('sale');
    expect(kinds).toContain('expense');
    expect(kinds).toContain('debt');
    expect(kinds).toContain('payment');
    expect(kinds).toContain('reversal');
  });

  it('uses UTC ISO 8601 timestamps for all records', async () => {
    await recordSale(store, shop, {
      amount: { cents: 4500, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 45',
      now
    });

    const exportData = await generateExport(store, shop);

    expect(exportData.records.length).toBeGreaterThan(0);
    for (const record of exportData.records) {
      // Should be a valid ISO 8601 string that can be parsed
      const timestamp = new Date(record.createdAt);
      expect(timestamp.toISOString()).toBe(record.createdAt);
    }
  });

  it('exports empty records array for new shop', async () => {
    const exportData = await generateExport(store, shop);

    expect(exportData.records).toEqual([]);
  });

  it('includes customer data in debt and payment records', async () => {
    await recordDebt(store, shop, {
      amount: { cents: 3000, requiresConfirmation: false },
      customer: '  Tendai  ',
      item: 'sugar',
      channel: 'sms',
      originalWords: 'Tendai owes 30 sugar',
      now
    });

    const exportData = await generateExport(store, shop);

    expect(exportData.records.length).toBe(1);
    const debtRecord = exportData.records[0];
    expect(debtRecord.kind).toBe('debt');
    expect((debtRecord as any).customerDisplayName).toBe('Tendai');
    expect((debtRecord as any).customerKey).toBe('tendai');
    expect(debtRecord.item).toBe('sugar');
  });

  it('exports all required shop fields', async () => {
    const exportData = await generateExport(store, shop);

    expect(exportData.shop).toEqual({
      id: shop.id,
      name: shop.name,
      phone: shop.phone,
      currency: shop.currency,
      timeZone: shop.timeZone,
      createdAt: shop.createdAt
    });

    // Verify createdAt is a UTC ISO 8601 string
    const createdTime = new Date(exportData.shop.createdAt);
    expect(createdTime.toISOString()).toBe(exportData.shop.createdAt);
  });
});
