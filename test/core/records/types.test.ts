import { describe, it, expect } from 'vitest';
import {
  createSaleRecord,
  createExpenseRecord,
  createDebtRecord,
  createPaymentRecord,
  createReversal,
  isReversible,
  customerDisplayName,
  customerKey,
  type Record
} from '../../../src/core/records/types';

describe('records', () => {
  const shopId = 'shop_test123';
  const now = new Date('2024-01-15T10:30:00Z');

  describe('customerDisplayName', () => {
    it('trims whitespace', () => {
      expect(customerDisplayName('  Tendai  ')).toBe('Tendai');
    });

    it('collapses multiple inner spaces to one', () => {
      expect(customerDisplayName('John   Doe')).toBe('John Doe');
      expect(customerDisplayName('John  Doe  Smith')).toBe('John Doe Smith');
    });

    it('preserves single spaces', () => {
      expect(customerDisplayName('John Doe')).toBe('John Doe');
    });

    it('handles only spaces', () => {
      expect(customerDisplayName('   ')).toBe('');
    });
  });

  describe('customerKey', () => {
    it('returns lowercased displayName', () => {
      expect(customerKey('Tendai')).toBe('tendai');
      expect(customerKey('JOHN DOE')).toBe('john doe');
    });

    it('matches customers regardless of case', () => {
      expect(customerKey('Tendai')).toBe(customerKey('tendai'));
      expect(customerKey('Tendai')).toBe(customerKey('TENDAI'));
    });

    it('matches customers regardless of spacing', () => {
      expect(customerKey('John  Doe')).toBe(customerKey('john doe'));
    });
  });

  describe('createSaleRecord', () => {
    it('creates a sale record with all required fields', () => {
      const record = createSaleRecord(shopId, {
        amount: 5000,
        item: 'bread',
        channel: 'sms',
        originalWords: 'sold 50 bread',
        now
      });

      expect(record.id).toMatch(/^rec_/);
      expect(record.shopId).toBe(shopId);
      expect(record.kind).toBe('sale');
      expect(record.amount).toBe(5000);
      expect(record.item).toBe('bread');
      expect(record.channel).toBe('sms');
      expect(record.originalWords).toBe('sold 50 bread');
      expect(record.createdAt).toBe(now.toISOString());
    });

    it('creates a sale record without item', () => {
      const record = createSaleRecord(shopId, {
        amount: 5000,
        channel: 'ussd',
        originalWords: '50',
        now
      });

      expect(record.item).toBeUndefined();
    });
  });

  describe('createExpenseRecord', () => {
    it('creates an expense record with all required fields', () => {
      const record = createExpenseRecord(shopId, {
        amount: 2000,
        item: 'taxi',
        channel: 'sms',
        originalWords: 'spent 20 taxi',
        now
      });

      expect(record.kind).toBe('expense');
      expect(record.amount).toBe(2000);
      expect(record.item).toBe('taxi');
    });
  });

  describe('createDebtRecord', () => {
    it('creates a debt record with customer name processing', () => {
      const record = createDebtRecord(shopId, {
        amount: 3000,
        customer: '  Tendai  ',
        item: 'sugar',
        channel: 'sms',
        originalWords: 'Tendai owes 30 sugar',
        now
      });

      expect(record.kind).toBe('debt');
      expect(record.amount).toBe(3000);
      expect(record.customerDisplayName).toBe('Tendai');
      expect(record.customerKey).toBe('tendai');
      expect(record.item).toBe('sugar');
    });

    it('normalizes customer display name and key', () => {
      const record = createDebtRecord(shopId, {
        amount: 3000,
        customer: 'john   doe',
        channel: 'sms',
        originalWords: 'john doe owes 30',
        now
      });

      expect(record.customerDisplayName).toBe('john doe');
      expect(record.customerKey).toBe('john doe');
    });
  });

  describe('createPaymentRecord', () => {
    it('creates a payment record with customer name processing', () => {
      const record = createPaymentRecord(shopId, {
        amount: 1500,
        customer: 'Tendai',
        item: 'sugar',
        channel: 'sms',
        originalWords: 'Tendai paid 15',
        now
      });

      expect(record.kind).toBe('payment');
      expect(record.amount).toBe(1500);
      expect(record.customerDisplayName).toBe('Tendai');
      expect(record.customerKey).toBe('tendai');
    });
  });

  describe('isReversible', () => {
    it('returns true for sale records', () => {
      const record = createSaleRecord(shopId, {
        amount: 5000,
        channel: 'sms',
        originalWords: 'sold 50',
        now
      });
      expect(isReversible(record)).toBe(true);
    });

    it('returns true for expense records', () => {
      const record = createExpenseRecord(shopId, {
        amount: 2000,
        channel: 'sms',
        originalWords: 'spent 20',
        now
      });
      expect(isReversible(record)).toBe(true);
    });

    it('returns true for debt records', () => {
      const record = createDebtRecord(shopId, {
        amount: 3000,
        customer: 'Tendai',
        channel: 'sms',
        originalWords: 'Tendai owes 30',
        now
      });
      expect(isReversible(record)).toBe(true);
    });

    it('returns true for payment records', () => {
      const record = createPaymentRecord(shopId, {
        amount: 1500,
        customer: 'Tendai',
        channel: 'sms',
        originalWords: 'Tendai paid 15',
        now
      });
      expect(isReversible(record)).toBe(true);
    });

    it('returns false for reversal records', () => {
      const saleRecord = createSaleRecord(shopId, {
        amount: 5000,
        channel: 'sms',
        originalWords: 'sold 50',
        now
      });
      const reversalRecord = createReversal(saleRecord, 'sms', 'undo', now);
      expect(isReversible(reversalRecord)).toBe(false);
    });
  });

  describe('createReversal', () => {
    it('creates a reversal record pointing to the original', () => {
      const saleRecord = createSaleRecord(shopId, {
        amount: 5000,
        channel: 'sms',
        originalWords: 'sold 50',
        now
      });

      const reversalRecord = createReversal(saleRecord, 'sms', 'undo', now);

      expect(reversalRecord.id).toMatch(/^rec_/);
      expect(reversalRecord.shopId).toBe(shopId);
      expect(reversalRecord.kind).toBe('reversal');
      expect(reversalRecord.amount).toBe(0);
      expect(reversalRecord.reversesRecordId).toBe(saleRecord.id);
      expect(reversalRecord.createdAt).toBe(now.toISOString());
      expect(reversalRecord.channel).toBe('sms');
      expect(reversalRecord.originalWords).toBe('undo');
    });
  });
});
