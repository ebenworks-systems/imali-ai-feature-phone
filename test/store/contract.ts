/**
 * The checks every LedgerStore must pass. Not named *.test.ts, so Vitest does not run it alone: the memory store
 * test and the Postgres store test each call `runLedgerStoreContract` with their own harness.
 *
 * Every check makes its shop before it appends a record, because the Postgres tables have a foreign key from a
 * record to its shop.
 */

import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { generateExport } from '../../src/core/export/generator.js';
import { createShop, type Shop } from '../../src/core/shops/types.js';
import {
  createDebtRecord,
  createExpenseRecord,
  createPaymentRecord,
  createReversal,
  createSaleRecord,
  type Record as LedgerRecord
} from '../../src/core/records/types.js';
import {
  DuplicateRecordError,
  RecordAlreadyReversedError,
  ShopAlreadyExistsError,
  type LedgerStore
} from '../../src/store/interface.js';

export interface LedgerStoreHarness {
  /** A store with no shops and no records. Called before every check. */
  make(): Promise<LedgerStore>;
  /** Called once after the last check. */
  teardown?(): Promise<void>;
}

const NOW = new Date('2024-01-15T10:30:00.000Z');

function makeShop(phone = '+27000001234', id?: string): Shop {
  return createShop({ id, name: 'Test Shop', phone, currency: 'ZAR', timeZone: 'Africa/Johannesburg' });
}

export function runLedgerStoreContract(label: string, harness: LedgerStoreHarness): void {
  describe(label, () => {
    let store: LedgerStore;

    beforeEach(async () => {
      store = await harness.make();
    });

    afterAll(async () => {
      await harness.teardown?.();
    });

    describe('shops', () => {
      it('creates a shop and finds it by id and by phone', async () => {
        const shop = makeShop();
        await store.createShop(shop);
        expect(await store.findShopById(shop.id)).toEqual(shop);
        expect(await store.findShopByPhone('+27000001234')).toEqual(shop);
      });

      it('returns null for a shop that does not exist', async () => {
        expect(await store.findShopById('nonexistent')).toBeNull();
        expect(await store.findShopByPhone('+27000009999')).toBeNull();
      });

      it('throws ShopAlreadyExistsError for the same phone with another id, and keeps the first shop', async () => {
        await store.createShop(makeShop('+27000001234', 'shop_ussd_A'));
        await expect(store.createShop(makeShop('+27000001234', 'shop_ussd_B'))).rejects.toThrow(ShopAlreadyExistsError);
        expect((await store.findShopByPhone('+27000001234'))?.id).toBe('shop_ussd_A');
        expect(await store.findShopById('shop_ussd_B')).toBeNull();
      });

      it('throws ShopAlreadyExistsError for the same id with another phone', async () => {
        await store.createShop(makeShop('+27000001234', 'shop_ussd_A'));
        await expect(store.createShop(makeShop('+27000005678', 'shop_ussd_A'))).rejects.toThrow(ShopAlreadyExistsError);
        expect(await store.findShopByPhone('+27000005678')).toBeNull();
      });

      it('sets the error name', async () => {
        await store.createShop(makeShop('+27000001234', 'shop_ussd_A'));
        await expect(store.createShop(makeShop('+27000001234', 'shop_ussd_A'))).rejects.toMatchObject({
          name: 'ShopAlreadyExistsError'
        });
      });

      it('lets two copies made together create one shop', async () => {
        const results = await Promise.allSettled([
          store.createShop(makeShop('+27000001234', 'shop_ussd_A')),
          store.createShop(makeShop('+27000001234', 'shop_ussd_A'))
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      });

      it('counts shops by phone prefix, as plain text', async () => {
        expect(await store.countShopsWithPhonePrefix('+2700000')).toBe(0);
        await store.createShop(makeShop('+27000001234'));
        await store.createShop(makeShop('+27000005678'));
        await store.createShop(makeShop('+27000111111'));
        await store.createShop(makeShop('+254711000000'));
        expect(await store.countShopsWithPhonePrefix('+2700000')).toBe(2);
        expect(await store.countShopsWithPhonePrefix('+27')).toBe(3);
        expect(await store.countShopsWithPhonePrefix('+2547')).toBe(1);
        expect(await store.countShopsWithPhonePrefix('+9')).toBe(0);
        // % and _ are not wildcards
        expect(await store.countShopsWithPhonePrefix('%')).toBe(0);
        expect(await store.countShopsWithPhonePrefix('+2700000_')).toBe(0);
      });

      it('counts every shop for the empty prefix (the cap on shops that are not demo shops uses this)', async () => {
        expect(await store.countShopsWithPhonePrefix('')).toBe(0);
        await store.createShop(makeShop('+27000001234'));
        await store.createShop(makeShop('+254711000000'));
        expect(await store.countShopsWithPhonePrefix('')).toBe(2);
      });
    });

    describe('records', () => {
      let shop: Shop;

      beforeEach(async () => {
        shop = makeShop();
        await store.createShop(shop);
      });

      const sale = (id: string, amount = 5000, now = NOW) =>
        createSaleRecord(shop.id, { id, amount, channel: 'sms', originalWords: `sold ${amount}`, now });

      it('appends and finds a record by id', async () => {
        const record = sale('r1');
        await store.appendRecord(record);
        expect(await store.findRecordById('r1')).toEqual(record);
      });

      it('returns null for a record that does not exist', async () => {
        expect(await store.findRecordById('nonexistent')).toBeNull();
      });

      it('keeps every field of all five kinds', async () => {
        const base = createSaleRecord(shop.id, {
          id: 'r_sale',
          amount: 4500,
          item: 'bread',
          channel: 'ussd',
          originalWords: '1*45*bread',
          now: NOW
        });
        const records: LedgerRecord[] = [
          base,
          createExpenseRecord(shop.id, { id: 'r_exp', amount: 2000, item: 'taxi', channel: 'sms', originalWords: 'spent 20 taxi', now: NOW }),
          createExpenseRecord(shop.id, { id: 'r_exp2', amount: 100, channel: 'web', originalWords: 'spent 1', now: NOW }),
          createDebtRecord(shop.id, { id: 'r_debt', amount: 3000, customer: '  Tendai   M ', item: 'sugar', channel: 'sms', originalWords: 'Tendai owes 30 sugar', now: NOW }),
          createPaymentRecord(shop.id, { id: 'r_pay', amount: 1000, customer: 'tendai m', channel: 'sms', originalWords: 'Tendai paid 10', now: NOW }),
          createReversal(base, 'sms', 'undo', NOW, 'r_rev')
        ];
        for (const r of records) await store.appendRecord(r);
        for (const r of records) expect(await store.findRecordById(r.id)).toEqual(r);
        const reversal = await store.findRecordById('r_rev');
        expect(reversal).toMatchObject({ kind: 'reversal', amount: 0, reversesRecordId: 'r_sale' });
        const debt = await store.findRecordById('r_debt');
        expect(debt).toMatchObject({ customerDisplayName: 'Tendai M', customerKey: 'tendai m' });
      });

      it('lists the records of one shop only', async () => {
        const other = makeShop('+27000005678');
        await store.createShop(other);
        await store.appendRecord(sale('r1'));
        await store.appendRecord(
          createSaleRecord(other.id, { id: 'r_other', amount: 100, channel: 'sms', originalWords: 'x', now: NOW })
        );
        expect((await store.listRecords(shop.id)).map((r) => r.id)).toEqual(['r1']);
        expect(await store.listRecords('no_such_shop')).toEqual([]);
      });

      it('lists records in the order they were appended, also when the time stamps are equal', async () => {
        const ids = ['z', 'a', 'm', 'b', 'y'];
        for (const id of ids) await store.appendRecord(sale(id));
        expect((await store.listRecords(shop.id)).map((r) => r.id)).toEqual(ids);
      });

      it('lists in append order even when a later record has an earlier time stamp', async () => {
        await store.appendRecord(sale('late', 100, new Date('2024-01-15T12:00:00.000Z')));
        await store.appendRecord(sale('early', 100, new Date('2024-01-15T08:00:00.000Z')));
        expect((await store.listRecords(shop.id)).map((r) => r.id)).toEqual(['late', 'early']);
      });

      it('returns a new array each time, which the caller may change', async () => {
        await store.appendRecord(sale('r1'));
        await store.appendRecord(sale('r2'));
        const first = await store.listRecords(shop.id);
        first.reverse();
        first.push(sale('not_saved'));
        expect((await store.listRecords(shop.id)).map((r) => r.id)).toEqual(['r1', 'r2']);
        const second = await store.listRecords(shop.id, { since: '2000-01-01T00:00:00.000Z' });
        second.pop();
        expect(await store.listRecords(shop.id)).toHaveLength(2);
      });

      it('leaves the stored order alone when generateExport sorts its copy', async () => {
        await store.appendRecord(sale('late', 100, new Date('2024-01-15T12:00:00.000Z')));
        await store.appendRecord(sale('early', 100, new Date('2024-01-15T08:00:00.000Z')));
        const data = await generateExport(store, shop);
        expect(data.records.map((r) => r.id)).toEqual(['early', 'late']);
        expect((await store.listRecords(shop.id)).map((r) => r.id)).toEqual(['late', 'early']);
      });

      it('filters by since, and since is inclusive', async () => {
        await store.appendRecord(sale('early', 100, new Date('2024-01-15T10:00:00.000Z')));
        await store.appendRecord(sale('exact', 100, new Date('2024-01-15T10:30:00.000Z')));
        await store.appendRecord(sale('late', 100, new Date('2024-01-15T11:00:00.000Z')));
        const list = await store.listRecords(shop.id, { since: '2024-01-15T10:30:00.000Z' });
        expect(list.map((r) => r.id)).toEqual(['exact', 'late']);
      });

      it('returns the same ISO string that was written, to the millisecond', async () => {
        const at = new Date('2024-03-09T23:59:59.987Z');
        await store.appendRecord(sale('r1', 100, at));
        expect((await store.findRecordById('r1'))?.createdAt).toBe('2024-03-09T23:59:59.987Z');
      });

      it('round trips amounts up to Number.MAX_SAFE_INTEGER', async () => {
        await store.appendRecord(sale('big', Number.MAX_SAFE_INTEGER));
        const found = await store.findRecordById('big');
        expect(found?.amount).toBe(Number.MAX_SAFE_INTEGER);
        expect(Number.isSafeInteger(found?.amount)).toBe(true);
        expect((await store.listRecords(shop.id))[0]?.amount).toBe(Number.MAX_SAFE_INTEGER);
      });

      it('returns an empty list for a shop with no records', async () => {
        expect(await store.listRecords(shop.id)).toEqual([]);
      });
    });

    describe('reversals', () => {
      let shop: Shop;

      beforeEach(async () => {
        shop = makeShop();
        await store.createShop(shop);
      });

      const sale = (id: string) =>
        createSaleRecord(shop.id, { id, amount: 5000, channel: 'sms', originalWords: 'sold 50', now: NOW });

      it('stores and finds a reversal', async () => {
        const record = sale('r1');
        const reversal = createReversal(record, 'sms', 'undo', NOW, 'rev1');
        await store.appendRecord(record);
        await store.appendRecord(reversal);
        expect(await store.findReversalOf('r1')).toEqual(reversal);
      });

      it('returns null when there is no reversal', async () => {
        await store.appendRecord(sale('r1'));
        expect(await store.findReversalOf('r1')).toBeNull();
        expect(await store.findReversalOf('nonexistent')).toBeNull();
      });

      it('throws RecordAlreadyReversedError for a second reversal with a new id, and keeps the first', async () => {
        const record = sale('r1');
        const first = createReversal(record, 'sms', 'undo', NOW, 'rev1');
        await store.appendRecord(record);
        await store.appendRecord(first);
        await expect(store.appendRecord(createReversal(record, 'sms', 'undo', NOW, 'rev2'))).rejects.toThrow(
          RecordAlreadyReversedError
        );
        expect(await store.findReversalOf('r1')).toEqual(first);
        expect(await store.findRecordById('rev2')).toBeNull();
        expect(await store.listRecords(shop.id)).toHaveLength(2);
      });

      it('sets the RecordAlreadyReversedError name', async () => {
        const record = sale('r1');
        await store.appendRecord(record);
        await store.appendRecord(createReversal(record, 'sms', 'undo', NOW, 'rev1'));
        await expect(
          store.appendRecord(createReversal(record, 'sms', 'undo', NOW, 'rev2'))
        ).rejects.toMatchObject({ name: 'RecordAlreadyReversedError' });
      });

      it('lets only one of two reversals started together win', async () => {
        const record = sale('r1');
        await store.appendRecord(record);
        const results = await Promise.allSettled([
          store.appendRecord(createReversal(record, 'sms', 'undo', NOW, 'revA')),
          store.appendRecord(createReversal(record, 'sms', 'undo', NOW, 'revB'))
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
        expect(rejected.reason).toBeInstanceOf(RecordAlreadyReversedError);
        expect(await store.listRecords(shop.id)).toHaveLength(2);
      });
    });

    describe('duplicate record ids (the duplicate-save guard)', () => {
      let shop: Shop;

      beforeEach(async () => {
        shop = makeShop();
        await store.createShop(shop);
      });

      const sale = (id: string, amount = 5000) =>
        createSaleRecord(shop.id, { id, amount, channel: 'ussd', originalWords: '1*50*1*1', now: NOW });

      it('throws DuplicateRecordError for a second append of the same id and keeps one copy', async () => {
        await store.appendRecord(sale('rec_ussd_S1_4'));
        await expect(store.appendRecord(sale('rec_ussd_S1_4'))).rejects.toThrow(DuplicateRecordError);
        await expect(store.appendRecord(sale('rec_ussd_S1_4'))).rejects.toMatchObject({ name: 'DuplicateRecordError' });
        expect(await store.listRecords(shop.id)).toHaveLength(1);
      });

      it('keeps the first record when a different record arrives with the same id', async () => {
        await store.appendRecord(sale('rec_ussd_S1_4', 5000));
        await expect(store.appendRecord(sale('rec_ussd_S1_4', 9900))).rejects.toThrow(DuplicateRecordError);
        expect((await store.findRecordById('rec_ussd_S1_4'))?.amount).toBe(5000);
      });

      it('throws DuplicateRecordError, not RecordAlreadyReversedError, for a reversal sent again with the same id', async () => {
        const record = sale('rec_ussd_S1_4');
        await store.appendRecord(record);
        await store.appendRecord(createReversal(record, 'ussd', '7*1', NOW, 'rec_ussd_S1_2'));
        const again = store.appendRecord(createReversal(record, 'ussd', '7*1', NOW, 'rec_ussd_S1_2'));
        await expect(again).rejects.toThrow(DuplicateRecordError);
        await expect(again).rejects.not.toThrow(RecordAlreadyReversedError);
        expect(await store.listRecords(shop.id)).toHaveLength(2);
      });

      it('lets two appends of one id started together save one', async () => {
        const results = await Promise.allSettled([
          store.appendRecord(sale('rec_ussd_S1_4')),
          store.appendRecord(sale('rec_ussd_S1_4'))
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        expect(rejected).toHaveLength(1);
        expect(rejected[0]?.reason).toBeInstanceOf(DuplicateRecordError);
        expect(await store.listRecords(shop.id)).toHaveLength(1);
      });

      it('lets two reversals of one id started together make one reversal', async () => {
        const record = sale('rec_ussd_S1_4');
        await store.appendRecord(record);
        const results = await Promise.allSettled([
          store.appendRecord(createReversal(record, 'ussd', '7*1', NOW, 'rec_ussd_S1_2')),
          store.appendRecord(createReversal(record, 'ussd', '7*1', NOW, 'rec_ussd_S1_2'))
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        expect(rejected[0]?.reason).toBeInstanceOf(DuplicateRecordError);
        expect(await store.listRecords(shop.id)).toHaveLength(2);
      });
    });

    describe('deleteExpiredDemoShops (housekeeping of invented demo data)', () => {
      const DAY = 24 * 60 * 60 * 1000;
      const CUTOFF = new Date('2026-11-01T00:00:00.000Z');
      const old = new Date(CUTOFF.getTime() - DAY).toISOString();
      const fresh = new Date(CUTOFF.getTime() + DAY).toISOString();

      const shopMadeAt = (phone: string, createdAt: string, id?: string): Shop => ({ ...makeShop(phone, id), createdAt });

      /** A shop with a sale, a debt and a sale that was undone (so a reversal points at a record of the same shop). */
      async function addRecords(shop: Shop): Promise<string[]> {
        const kept = createSaleRecord(shop.id, { amount: 4500, channel: 'sms', originalWords: 'sold 45', now: NOW });
        const undone = createSaleRecord(shop.id, { amount: 99900, channel: 'sms', originalWords: 'sold 999', now: NOW });
        const debt = createDebtRecord(shop.id, { amount: 3000, customer: 'Tendai', channel: 'sms', originalWords: 'Tendai owes 30', now: NOW });
        const reversal = createReversal(undone, 'sms', 'undo', NOW);
        for (const record of [kept, undone, debt, reversal]) await store.appendRecord(record);
        return [kept.id, undone.id, debt.id, reversal.id];
      }

      it('removes a demo shop made before the cutoff with every record, and gives back its phone number', async () => {
        const shop = shopMadeAt('+27000001234', old);
        await store.createShop(shop);
        const ids = await addRecords(shop);

        expect(await store.deleteExpiredDemoShops(CUTOFF, 200)).toEqual(['+27000001234']);

        expect(await store.findShopById(shop.id)).toBeNull();
        expect(await store.findShopByPhone('+27000001234')).toBeNull();
        expect(await store.listRecords(shop.id)).toEqual([]);
        for (const id of ids) expect(await store.findRecordById(id)).toBeNull();
        expect(await store.findReversalOf(ids[1]!)).toBeNull();
        expect(await store.countShopsWithPhonePrefix('+2700000')).toBe(0);
      });

      it('lets the number, the shop id and the record ids be used again afterwards', async () => {
        const shop = shopMadeAt('+27000001234', old);
        await store.createShop(shop);
        const ids = await addRecords(shop);
        await store.deleteExpiredDemoShops(CUTOFF, 200);

        await store.createShop(shopMadeAt('+27000001234', fresh, shop.id));
        const again = createSaleRecord(shop.id, { id: ids[1]!, amount: 100, channel: 'sms', originalWords: 'x', now: NOW });
        await store.appendRecord(again);
        // The old reversal is gone with its shop, so the same record can be undone again.
        await store.appendRecord(createReversal(again, 'sms', 'undo', NOW));
        expect(await store.listRecords(shop.id)).toHaveLength(2);
      });

      it('keeps a demo shop made at the cutoff or after it, with its records', async () => {
        const atCutoff = shopMadeAt('+27000001111', CUTOFF.toISOString());
        const newer = shopMadeAt('+27000002222', fresh);
        await store.createShop(atCutoff);
        await store.createShop(newer);
        await addRecords(atCutoff);
        await addRecords(newer);

        expect(await store.deleteExpiredDemoShops(CUTOFF, 200)).toEqual([]);

        expect(await store.findShopByPhone('+27000001111')).toEqual(atCutoff);
        expect(await store.findShopByPhone('+27000002222')).toEqual(newer);
        expect(await store.listRecords(atCutoff.id)).toHaveLength(4);
        expect(await store.listRecords(newer.id)).toHaveLength(4);
      });

      it('never removes a shop on a number that is not a demo number, whatever its age, or its records', async () => {
        const ancient = '2000-01-01T00:00:00.000Z';
        const phones = [
          '+254711000000', // a real-looking number
          '+27711000000', // a South African number
          '+27000111111', // starts with +27 but is not the demo range
          '+270000012345', // the demo prefix with five digits after it
          '+2700000123', // the demo prefix with three digits after it
          '+27000009', // shorter still
          '+2700000', // the prefix alone
          '+270000012a4' // a letter among the digits
        ];
        const shops: Shop[] = [];
        for (const phone of phones) {
          const shop = shopMadeAt(phone, ancient);
          await store.createShop(shop);
          await addRecords(shop);
          shops.push(shop);
        }

        expect(await store.deleteExpiredDemoShops(new Date('2100-01-01T00:00:00.000Z'), 1000)).toEqual([]);

        for (const shop of shops) {
          expect(await store.findShopByPhone(shop.phone), shop.phone).toEqual(shop);
          expect(await store.listRecords(shop.id), shop.phone).toHaveLength(4);
        }
      });

      it('removes only the demo shops among a mix, and leaves the other shops and their records as they were', async () => {
        const demoOld = shopMadeAt('+27000001234', old);
        const demoFresh = shopMadeAt('+27000005678', fresh);
        const real = shopMadeAt('+254711000000', old);
        for (const shop of [demoOld, demoFresh, real]) {
          await store.createShop(shop);
          await addRecords(shop);
        }
        const before = await store.listRecords(real.id);

        expect(await store.deleteExpiredDemoShops(CUTOFF, 200)).toEqual(['+27000001234']);

        expect(await store.findShopByPhone('+27000005678')).toEqual(demoFresh);
        expect(await store.listRecords(demoFresh.id)).toHaveLength(4);
        expect(await store.findShopByPhone('+254711000000')).toEqual(real);
        expect(await store.listRecords(real.id)).toEqual(before);
      });

      it('removes at most the number asked for, oldest first', async () => {
        const phones = ['+27000000001', '+27000000002', '+27000000003', '+27000000004'];
        // Made newest first, so the order of the numbers is not the order of the ages.
        const ages = [4, 1, 3, 2];
        for (const [i, phone] of phones.entries()) {
          await store.createShop(shopMadeAt(phone, new Date(CUTOFF.getTime() - ages[i]! * DAY).toISOString()));
        }

        expect(await store.deleteExpiredDemoShops(CUTOFF, 2)).toEqual(['+27000000001', '+27000000003']);
        expect(await store.countShopsWithPhonePrefix('+2700000')).toBe(2);
        expect(await store.deleteExpiredDemoShops(CUTOFF, 2)).toEqual(['+27000000004', '+27000000002']);
        expect(await store.countShopsWithPhonePrefix('+2700000')).toBe(0);
      });

      it.each([0, -5, Number.NaN])('removes nothing when asked for %s shops', async (count) => {
        await store.createShop(shopMadeAt('+27000001234', old));
        expect(await store.deleteExpiredDemoShops(CUTOFF, count)).toEqual([]);
        expect(await store.findShopByPhone('+27000001234')).not.toBeNull();
      });

      it('removes nothing when the cutoff is not a real date', async () => {
        await store.createShop(shopMadeAt('+27000001234', old));
        expect(await store.deleteExpiredDemoShops(new Date('not a date'), 200)).toEqual([]);
        expect(await store.findShopByPhone('+27000001234')).not.toBeNull();
      });

      it('does nothing when there is nothing to remove', async () => {
        expect(await store.deleteExpiredDemoShops(CUTOFF, 200)).toEqual([]);
      });
    });
  });
}
