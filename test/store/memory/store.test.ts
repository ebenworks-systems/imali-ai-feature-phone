import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../../../src/store/memory/store';
import {
  DuplicateRecordError,
  RecordAlreadyReversedError,
  ShopAlreadyExistsError
} from '../../../src/store/interface';
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

  describe('duplicate record ids', () => {
    const now = new Date('2024-01-15T10:30:00Z');
    let shopId: string;

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

    const sale = (id: string) =>
      createSaleRecord(shopId, { id, amount: 5000, channel: 'ussd', originalWords: '1*50*1*1', now });

    it('throws DuplicateRecordError for a second append of the same id and keeps one copy', async () => {
      await store.appendRecord(sale('rec_ussd_S1_4'));
      await expect(store.appendRecord(sale('rec_ussd_S1_4'))).rejects.toThrow(DuplicateRecordError);
      await expect(store.appendRecord(sale('rec_ussd_S1_4'))).rejects.toMatchObject({
        name: 'DuplicateRecordError'
      });
      expect(await store.listRecords(shopId)).toHaveLength(1);
    });

    it('still throws RecordAlreadyReversedError for a second reversal with a new id', async () => {
      const record = sale('rec_ussd_S1_4');
      await store.appendRecord(record);
      await store.appendRecord(createReversal(record, 'ussd', '7*1', now, 'rec_ussd_S1_2'));
      await expect(
        store.appendRecord(createReversal(record, 'ussd', '7*1', now, 'rec_ussd_S2_2'))
      ).rejects.toThrow(RecordAlreadyReversedError);
      expect(await store.listRecords(shopId)).toHaveLength(2);
    });

    it('throws DuplicateRecordError, not RecordAlreadyReversedError, for a reversal sent again with the same id', async () => {
      const record = sale('rec_ussd_S1_4');
      await store.appendRecord(record);
      await store.appendRecord(createReversal(record, 'ussd', '7*1', now, 'rec_ussd_S1_2'));
      await expect(
        store.appendRecord(createReversal(record, 'ussd', '7*1', now, 'rec_ussd_S1_2'))
      ).rejects.toThrow(DuplicateRecordError);
      expect(await store.listRecords(shopId)).toHaveLength(2);
    });

    it('keeps the first record when a different record is sent with the same id', async () => {
      await store.appendRecord(sale('rec_ussd_S1_4'));
      const other = createSaleRecord(shopId, {
        id: 'rec_ussd_S1_4',
        amount: 9900,
        channel: 'ussd',
        originalWords: 'other',
        now
      });
      await expect(store.appendRecord(other)).rejects.toThrow(DuplicateRecordError);
      expect((await store.findRecordById('rec_ussd_S1_4'))?.amount).toBe(5000);
    });

    it('lets two appends of one id started together save one', async () => {
      const results = await Promise.allSettled([
        store.appendRecord(sale('rec_ussd_S1_4')),
        store.appendRecord(sale('rec_ussd_S1_4'))
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(await store.listRecords(shopId)).toHaveLength(1);
    });
  });

  describe('duplicate shops', () => {
    const make = (id: string | undefined, phone: string) =>
      createShop({ id, name: 'Shop', phone, currency: 'ZAR', timeZone: 'Africa/Johannesburg' });

    it('throws ShopAlreadyExistsError for the same phone with another id', async () => {
      await store.createShop(make('shop_ussd_A', '+27000001234'));
      await expect(store.createShop(make('shop_ussd_B', '+27000001234'))).rejects.toThrow(ShopAlreadyExistsError);
      expect((await store.findShopByPhone('+27000001234'))?.id).toBe('shop_ussd_A');
      expect(await store.findShopById('shop_ussd_B')).toBeNull();
    });

    it('throws ShopAlreadyExistsError for the same id', async () => {
      await store.createShop(make('shop_ussd_A', '+27000001234'));
      await expect(store.createShop(make('shop_ussd_A', '+27000005678'))).rejects.toThrow(ShopAlreadyExistsError);
      expect(await store.findShopByPhone('+27000005678')).toBeNull();
    });

    it('has the error name set', async () => {
      await store.createShop(make('shop_ussd_A', '+27000001234'));
      await expect(store.createShop(make('shop_ussd_A', '+27000001234'))).rejects.toMatchObject({
        name: 'ShopAlreadyExistsError'
      });
    });

    it('lets two different shops be made', async () => {
      await store.createShop(make(undefined, '+27000001234'));
      await store.createShop(make(undefined, '+27000005678'));
      expect(await store.findShopByPhone('+27000001234')).not.toBeNull();
      expect(await store.findShopByPhone('+27000005678')).not.toBeNull();
    });

    it('lets two copies made together create one shop', async () => {
      const results = await Promise.allSettled([
        store.createShop(make('shop_ussd_A', '+27000001234')),
        store.createShop(make('shop_ussd_A', '+27000001234'))
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });
  });
});
