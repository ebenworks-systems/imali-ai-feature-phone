import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../../../src/store/memory/store';
import { RecordAlreadyReversedError } from '../../../src/store/interface';
import { createShop } from '../../../src/core/shops/types';
import {
  createSaleRecord,
  createReversal
} from '../../../src/core/records/types';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  describe('shop operations', () => {
    it('creates and finds a shop by ID', async () => {
      const shop = createShop({
        name: 'Test Shop',
        phone: '+27001234567',
        currency: 'ZAR',
        timeZone: 'Africa/Johannesburg'
      });

      await store.createShop(shop);
      const found = await store.findShopById(shop.id);

      expect(found).toEqual(shop);
    });

    it('returns null when shop not found by ID', async () => {
      const found = await store.findShopById('nonexistent');
      expect(found).toBeNull();
    });

    it('finds a shop by phone number', async () => {
      const shop = createShop({
        name: 'Test Shop',
        phone: '+27001234567',
        currency: 'ZAR',
        timeZone: 'Africa/Johannesburg'
      });

      await store.createShop(shop);
      const found = await store.findShopByPhone('+27001234567');

      expect(found).toEqual(shop);
    });

    it('returns null when shop not found by phone', async () => {
      const found = await store.findShopByPhone('+27001234567');
      expect(found).toBeNull();
    });
  });

  describe('record operations', () => {
    let shopId: string;
    const now = new Date('2024-01-15T10:30:00Z');

    beforeEach(async () => {
      const shop = createShop({
        name: 'Test Shop',
        phone: '+27001234567',
        currency: 'ZAR',
        timeZone: 'Africa/Johannesburg'
      });
      shopId = shop.id;
      await store.createShop(shop);
    });

    it('appends and finds a record by ID', async () => {
      const record = createSaleRecord(shopId, {
        amount: 5000,
        channel: 'sms',
        originalWords: 'sold 50',
        now
      });

      await store.appendRecord(record);
      const found = await store.findRecordById(record.id);

      expect(found).toEqual(record);
    });

    it('returns null when record not found', async () => {
      const found = await store.findRecordById('nonexistent');
      expect(found).toBeNull();
    });

    it('lists records for a shop', async () => {
      const record1 = createSaleRecord(shopId, {
        amount: 5000,
        channel: 'sms',
        originalWords: 'sold 50',
        now
      });

      const record2 = createSaleRecord(shopId, {
        amount: 3000,
        channel: 'sms',
        originalWords: 'sold 30',
        now: new Date('2024-01-15T11:00:00Z')
      });

      await store.appendRecord(record1);
      await store.appendRecord(record2);

      const records = await store.listRecords(shopId);

      expect(records).toHaveLength(2);
      expect(records).toContainEqual(record1);
      expect(records).toContainEqual(record2);
    });

    it('filters records by since timestamp', async () => {
      const early = createSaleRecord(shopId, {
        amount: 5000,
        channel: 'sms',
        originalWords: 'sold 50',
        now: new Date('2024-01-15T10:00:00Z')
      });

      const late = createSaleRecord(shopId, {
        amount: 3000,
        channel: 'sms',
        originalWords: 'sold 30',
        now: new Date('2024-01-15T11:00:00Z')
      });

      await store.appendRecord(early);
      await store.appendRecord(late);

      const records = await store.listRecords(shopId, {
        since: '2024-01-15T10:30:00Z'
      });

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual(late);
    });

    it('returns empty list when no records for shop', async () => {
      const records = await store.listRecords(shopId);
      expect(records).toEqual([]);
    });
  });

  describe('reversal handling', () => {
    let shopId: string;
    const now = new Date('2024-01-15T10:30:00Z');

    beforeEach(async () => {
      const shop = createShop({
        name: 'Test Shop',
        phone: '+27001234567',
        currency: 'ZAR',
        timeZone: 'Africa/Johannesburg'
      });
      shopId = shop.id;
      await store.createShop(shop);
    });

    it('stores and finds a reversal record', async () => {
      const record = createSaleRecord(shopId, {
        amount: 5000,
        channel: 'sms',
        originalWords: 'sold 50',
        now
      });

      const reversal = createReversal(record, 'sms', 'undo', now);

      await store.appendRecord(record);
      await store.appendRecord(reversal);

      const found = await store.findReversalOf(record.id);

      expect(found).toEqual(reversal);
    });

    it('returns null when no reversal found', async () => {
      const record = createSaleRecord(shopId, {
        amount: 5000,
        channel: 'sms',
        originalWords: 'sold 50',
        now
      });

      await store.appendRecord(record);
      const found = await store.findReversalOf(record.id);

      expect(found).toBeNull();
    });

    it('throws RecordAlreadyReversedError when reversing twice', async () => {
      const record = createSaleRecord(shopId, {
        amount: 5000,
        channel: 'sms',
        originalWords: 'sold 50',
        now
      });

      const reversal1 = createReversal(record, 'sms', 'undo', now);
      const reversal2 = createReversal(record, 'sms', 'undo', now);

      await store.appendRecord(record);
      await store.appendRecord(reversal1);

      await expect(store.appendRecord(reversal2)).rejects.toThrow(
        RecordAlreadyReversedError
      );
    });

    it('stores the reversal record even if second reversal fails', async () => {
      const record = createSaleRecord(shopId, {
        amount: 5000,
        channel: 'sms',
        originalWords: 'sold 50',
        now
      });

      const reversal1 = createReversal(record, 'sms', 'undo', now);
      const reversal2 = createReversal(record, 'sms', 'undo', now);

      await store.appendRecord(record);
      await store.appendRecord(reversal1);

      // Second reversal should fail but first should be stored
      await expect(store.appendRecord(reversal2)).rejects.toThrow();

      const found = await store.findReversalOf(record.id);
      expect(found).toEqual(reversal1);
    });
  });
});
