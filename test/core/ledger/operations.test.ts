// Tests for ledger operations

import { describe, it, expect, beforeEach } from 'vitest';
import type { LedgerStore } from '../../../src/store/interface.js';
import { DuplicateRecordError, RecordAlreadyReversedError } from '../../../src/store/interface.js';
import { MemoryStore } from '../../../src/store/memory/store.js';
import { createShop } from '../../../src/core/shops/types.js';
import {
  recordSale,
  recordExpense,
  recordDebt,
  recordPayment,
  undoLastRecord
} from '../../../src/core/ledger/operations.js';
import type { ParsedAmount } from '../../../src/core/money/parse.js';

describe('ledger operations', () => {
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

  describe('recordSale', () => {
    it('saves a sale record successfully', async () => {
      const amount: ParsedAmount = { cents: 4500, requiresConfirmation: false };
      const result = await recordSale(store, shop, {
        amount,
        item: 'bread',
        channel: 'sms',
        originalWords: 'sold 45 bread',
        now
      });

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          kind: 'sale',
          amount: 4500,
          item: 'bread',
          channel: 'sms',
          originalWords: 'sold 45 bread'
        }),
        figure: {
          kind: 'salesToday',
          cents: 4500
        }
      });
    });

    it('returns needsConfirmation for large amounts', async () => {
      const amount: ParsedAmount = { cents: 100_000_001, requiresConfirmation: true };
      const result = await recordSale(store, shop, {
        amount,
        channel: 'ussd',
        originalWords: '1000000',
        now
      });

      expect(result).toEqual({
        needsConfirmation: true,
        amount,
        reason: expect.any(String)
      });
    });

    it('persists record in store', async () => {
      const amount: ParsedAmount = { cents: 4500, requiresConfirmation: false };
      const result = await recordSale(store, shop, {
        amount,
        item: 'bread',
        channel: 'sms',
        originalWords: 'sold 45 bread',
        now
      });

      expect(result.success === true).toBe(true);
      if (result.success === true) {
        const found = await store.findRecordById(result.data.id);
        expect(found).toEqual(result.data);
      }
    });
  });

  describe('recordExpense', () => {
    it('saves an expense record successfully', async () => {
      const amount: ParsedAmount = { cents: 2000, requiresConfirmation: false };
      const result = await recordExpense(store, shop, {
        amount,
        item: 'taxi',
        channel: 'sms',
        originalWords: 'spent 20 taxi',
        now
      });

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          kind: 'expense',
          amount: 2000,
          item: 'taxi'
        }),
        figure: {
          kind: 'expensesToday',
          cents: 2000
        }
      });
    });

    it('returns needsConfirmation for large amounts', async () => {
      const amount: ParsedAmount = { cents: 100_000_001, requiresConfirmation: true };
      const result = await recordExpense(store, shop, {
        amount,
        channel: 'ussd',
        originalWords: '1000000',
        now
      });

      expect('needsConfirmation' in result && result.needsConfirmation).toBe(true);
    });
  });

  describe('recordDebt', () => {
    it('saves a debt record with customer name normalization', async () => {
      const amount: ParsedAmount = { cents: 3000, requiresConfirmation: false };
      const result = await recordDebt(store, shop, {
        amount,
        customer: '  Tendai  ',
        item: 'sugar',
        channel: 'sms',
        originalWords: 'Tendai owes 30 sugar',
        now
      });

      expect(result.success === true).toBe(true);
      if (result.success === true) {
        expect(result.data).toEqual(expect.objectContaining({
          kind: 'debt',
          amount: 3000,
          customerDisplayName: 'Tendai',
          customerKey: 'tendai',
          item: 'sugar'
        }));
        expect(result.figure).toEqual({
          kind: 'customerBalance',
          cents: 3000,
          customer: 'Tendai'
        });
      }
    });

    it('normalizes customer names with multiple spaces', async () => {
      const amount: ParsedAmount = { cents: 1000, requiresConfirmation: false };
      const result = await recordDebt(store, shop, {
        amount,
        customer: 'Mary   Jane   Smith',
        channel: 'sms',
        originalWords: 'Mary   Jane   Smith owes 10',
        now
      });

      expect(result.success === true).toBe(true);
      if (result.success === true) {
        expect(result.data.customerDisplayName).toBe('Mary Jane Smith');
        expect(result.data.customerKey).toBe('mary jane smith');
      }
    });
  });

  describe('recordPayment', () => {
    it('saves a payment record successfully', async () => {
      const amount: ParsedAmount = { cents: 1500, requiresConfirmation: false };
      const result = await recordPayment(store, shop, {
        amount,
        customer: 'Tendai',
        channel: 'sms',
        originalWords: 'Tendai paid 15',
        now
      });

      expect(result.success === true).toBe(true);
      if (result.success === true) {
        expect(result.data).toEqual(expect.objectContaining({
          kind: 'payment',
          amount: 1500,
          customerDisplayName: 'Tendai',
          customerKey: 'tendai'
        }));
        expect(result.figure).toEqual({
          kind: 'customerBalance',
          cents: 1500,
          customer: 'Tendai'
        });
      }
    });
  });

  describe('undoLastRecord', () => {
    it('reverses the most recent record', async () => {
      // Record a sale
      const sale = await recordSale(store, shop, {
        amount: { cents: 4500, requiresConfirmation: false },
        item: 'bread',
        channel: 'sms',
        originalWords: 'sold 45 bread',
        now
      });

      expect(sale.success).toBe(true);

      // Undo it
      const undoResult = await undoLastRecord(store, shop, {
        channel: 'sms',
        originalWords: 'undo',
        now: new Date('2025-11-03T10:31:00Z')
      });

      expect(undoResult.success).toBe(true);
      if (undoResult.success) {
        expect(undoResult.data.reversedRecord).toEqual({
          kind: 'sale',
          amount: 4500,
          item: 'bread'
        });
      }
    });

    it('returns error when nothing to undo', async () => {
      const result = await undoLastRecord(store, shop, {
        channel: 'sms',
        originalWords: 'undo',
        now
      });

      expect(result).toEqual({
        success: false,
        error: 'Nothing to undo'
      });
    });

    it('skips already-reversed records when finding record to undo', async () => {
      // Record a sale
      const sale = await recordSale(store, shop, {
        amount: { cents: 4500, requiresConfirmation: false },
        channel: 'sms',
        originalWords: 'sold 45',
        now
      });

      expect(sale.success).toBe(true);

      // Undo it
      const undo1 = await undoLastRecord(store, shop, {
        channel: 'sms',
        originalWords: 'undo',
        now: new Date('2025-11-03T10:31:00Z')
      });

      expect(undo1.success).toBe(true);

      // Record an expense (so we have something else to undo)
      const expense = await recordExpense(store, shop, {
        amount: { cents: 2000, requiresConfirmation: false },
        channel: 'sms',
        originalWords: 'spent 20',
        now: new Date('2025-11-03T10:32:00Z')
      });

      expect(expense.success).toBe(true);

      // Undo the expense (not the already-reversed sale)
      const undo2 = await undoLastRecord(store, shop, {
        channel: 'sms',
        originalWords: 'undo',
        now: new Date('2025-11-03T10:33:00Z')
      });

      expect(undo2.success).toBe(true);
      if (undo2.success) {
        expect(undo2.data.reversedRecord.kind).toBe('expense');
      }
    });

    it('returns error when nothing to undo (all records already reversed or are reversals)', async () => {
      // Record a sale
      const sale = await recordSale(store, shop, {
        amount: { cents: 4500, requiresConfirmation: false },
        channel: 'sms',
        originalWords: 'sold 45',
        now
      });

      expect(sale.success).toBe(true);

      // Undo it
      const undo1 = await undoLastRecord(store, shop, {
        channel: 'sms',
        originalWords: 'undo',
        now: new Date('2025-11-03T10:31:00Z')
      });

      expect(undo1.success).toBe(true);

      // Try to undo again - no more reversible records (sale is already reversed, undo result is a reversal)
      const undo2 = await undoLastRecord(store, shop, {
        channel: 'sms',
        originalWords: 'undo',
        now: new Date('2025-11-03T10:32:00Z')
      });

      expect(undo2).toEqual({
        success: false,
        error: 'Nothing to undo'
      });
    });

    it('creates reversal for debt records with customer info', async () => {
      // Record a debt
      const debt = await recordDebt(store, shop, {
        amount: { cents: 3000, requiresConfirmation: false },
        customer: 'Tendai',
        channel: 'sms',
        originalWords: 'Tendai owes 30',
        now
      });

      expect(debt.success).toBe(true);

      // Undo it
      const undoResult = await undoLastRecord(store, shop, {
        channel: 'sms',
        originalWords: 'undo',
        now: new Date('2025-11-03T10:31:00Z')
      });

      expect(undoResult.success).toBe(true);
      if (undoResult.success) {
        expect(undoResult.data.reversedRecord).toEqual({
          kind: 'debt',
          amount: 3000,
          customer: 'Tendai'
        });
      }
    });
  });

  describe('a given record id', () => {
    const amount: ParsedAmount = { cents: 4500, requiresConfirmation: false };
    const common = { amount, channel: 'ussd' as const, originalWords: '1*45*1*1', now };

    it('is used by recordSale, recordExpense, recordDebt and recordPayment', async () => {
      const sale = await recordSale(store, shop, { ...common, id: 'rec_ussd_A_4' });
      const expense = await recordExpense(store, shop, { ...common, id: 'rec_ussd_B_4' });
      const debt = await recordDebt(store, shop, { ...common, customer: 'Tendai', id: 'rec_ussd_C_4' });
      const payment = await recordPayment(store, shop, { ...common, customer: 'Tendai', id: 'rec_ussd_D_4' });

      for (const [result, id] of [
        [sale, 'rec_ussd_A_4'],
        [expense, 'rec_ussd_B_4'],
        [debt, 'rec_ussd_C_4'],
        [payment, 'rec_ussd_D_4']
      ] as const) {
        expect('success' in result && result.success).toBe(true);
        if ('success' in result && result.success) expect(result.data.id).toBe(id);
        expect(await store.findRecordById(id)).not.toBeNull();
      }
    });

    it('is used by undoLastRecord for the reversal', async () => {
      await recordSale(store, shop, { ...common, id: 'rec_ussd_A_4' });
      const result = await undoLastRecord(store, shop, {
        channel: 'ussd',
        originalWords: '7*1',
        now,
        id: 'rec_ussd_A_2'
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.reversal.id).toBe('rec_ussd_A_2');
        expect(result.data.reversal.reversesRecordId).toBe('rec_ussd_A_4');
      }
      expect((await store.findRecordById('rec_ussd_A_2'))?.kind).toBe('reversal');
    });

    it('makes a random id starting rec_ when none is given', async () => {
      const sale = await recordSale(store, shop, common);
      expect('success' in sale && sale.success && sale.data.id).toMatch(/^rec_/);
      const undo = await undoLastRecord(store, shop, { channel: 'sms', originalWords: 'undo', now });
      expect(undo.success && undo.data.reversal.id).toMatch(/^rec_/);
    });

    it('refuses the same id twice with DuplicateRecordError and keeps one copy', async () => {
      await recordSale(store, shop, { ...common, id: 'rec_ussd_A_4' });
      await expect(recordSale(store, shop, { ...common, id: 'rec_ussd_A_4' })).rejects.toThrow(DuplicateRecordError);
      expect(await store.listRecords(shop.id)).toHaveLength(1);
    });
  });
});
