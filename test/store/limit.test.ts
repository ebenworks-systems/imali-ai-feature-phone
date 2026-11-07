import { describe, expect, it, vi } from 'vitest';
import { createShop } from '../../src/core/shops/types.js';
import { createReversal, createSaleRecord } from '../../src/core/records/types.js';
import { DuplicateRecordError } from '../../src/store/interface.js';
import {
  RecordLimitError,
  ShopCreationNotAllowedError,
  ShopLimitError,
  withoutShopCreation,
  withRecordLimit,
  withShopLimit
} from '../../src/store/limit.js';
import { MemoryStore } from '../../src/store/memory/store.js';

const NOW = new Date('2026-11-07T10:00:00.000Z');

async function setup(max: number) {
  const inner = new MemoryStore();
  const store = withRecordLimit(inner, max);
  const a = createShop({ name: 'A', phone: '+27000000001', currency: 'ZAR', timeZone: 'Africa/Johannesburg' });
  const b = createShop({ name: 'B', phone: '+27000000002', currency: 'ZAR', timeZone: 'Africa/Johannesburg' });
  await store.createShop(a);
  await store.createShop(b);
  const sale = (shopId: string, id: string) =>
    createSaleRecord(shopId, { id, amount: 100, channel: 'sms', originalWords: 'sold 1', now: NOW });
  return { inner, store, a, b, sale };
}

describe('withRecordLimit', () => {
  it('accepts records up to the cap and refuses the next one with RecordLimitError', async () => {
    const { store, a, sale } = await setup(3);
    await store.appendRecord(sale(a.id, 'r1'));
    await store.appendRecord(sale(a.id, 'r2'));
    await store.appendRecord(sale(a.id, 'r3'));
    await expect(store.appendRecord(sale(a.id, 'r4'))).rejects.toThrow(RecordLimitError);
    await expect(store.appendRecord(sale(a.id, 'r4'))).rejects.toMatchObject({ name: 'RecordLimitError' });
    expect(await store.listRecords(a.id)).toHaveLength(3);
    expect(await store.findRecordById('r4')).toBeNull();
  });

  it('refuses a reversal too once the shop is at the cap', async () => {
    const { store, a, sale } = await setup(2);
    const first = sale(a.id, 'r1');
    await store.appendRecord(first);
    await store.appendRecord(sale(a.id, 'r2'));
    await expect(store.appendRecord(createReversal(first, 'sms', 'undo', NOW, 'rev'))).rejects.toThrow(RecordLimitError);
  });

  it('does not affect other shops', async () => {
    const { store, a, b, sale } = await setup(1);
    await store.appendRecord(sale(a.id, 'r1'));
    await expect(store.appendRecord(sale(a.id, 'r2'))).rejects.toThrow(RecordLimitError);
    await store.appendRecord(sale(b.id, 'r3'));
    expect(await store.listRecords(b.id)).toHaveLength(1);
  });

  it('passes the inner store errors through below the cap', async () => {
    const { store, a, sale } = await setup(5);
    await store.appendRecord(sale(a.id, 'r1'));
    await expect(store.appendRecord(sale(a.id, 'r1'))).rejects.toThrow(DuplicateRecordError);
  });

  it('passes reads, shop calls and the shop count through', async () => {
    const { store, a, sale } = await setup(5);
    await store.appendRecord(sale(a.id, 'r1'));
    expect(await store.findShopById(a.id)).toEqual(a);
    expect(await store.findShopByPhone(a.phone)).toEqual(a);
    expect((await store.findRecordById('r1'))?.id).toBe('r1');
    expect(await store.findReversalOf('r1')).toBeNull();
    expect(await store.listRecords(a.id, { since: NOW.toISOString() })).toHaveLength(1);
    expect(await store.countShopsWithPhonePrefix('+2700000')).toBe(2);
  });

  it('hands the since option to the inner store', async () => {
    const inner = new MemoryStore();
    const spy = vi.spyOn(inner, 'listRecords');
    const store = withRecordLimit(inner, 5);
    await store.listRecords('x', { since: '2026-01-01T00:00:00.000Z' });
    expect(spy).toHaveBeenCalledWith('x', { since: '2026-01-01T00:00:00.000Z' });
  });
});

const shopOn = (phone: string, id?: string) =>
  createShop({ id, name: 'Shop', phone, currency: 'ZAR', timeZone: 'Africa/Johannesburg' });

describe('withShopLimit', () => {
  it('accepts shops that are not demo shops up to the cap and refuses the next with ShopLimitError', async () => {
    const inner = new MemoryStore();
    const store = withShopLimit(inner, 2);
    await store.createShop(shopOn('+254711000001'));
    await store.createShop(shopOn('+254711000002'));
    await expect(store.createShop(shopOn('+254711000003'))).rejects.toThrow(ShopLimitError);
    await expect(store.createShop(shopOn('+254711000003'))).rejects.toMatchObject({ name: 'ShopLimitError' });
    expect(await inner.findShopByPhone('+254711000003')).toBeNull();
    expect(await inner.countShopsWithPhonePrefix('')).toBe(2);
  });

  it('does not count demo shops toward the cap, and does not stop a demo shop being made', async () => {
    const inner = new MemoryStore();
    const store = withShopLimit(inner, 1);
    await store.createShop(shopOn('+27000001234'));
    await store.createShop(shopOn('+27000005678'));
    await store.createShop(shopOn('+254711000001'));
    await expect(store.createShop(shopOn('+254711000002'))).rejects.toThrow(ShopLimitError);
    await store.createShop(shopOn('+27000009999')); // a demo number is not held back by the cap on the others
  });

  it('refuses a number that starts like a demo number but is not a whole one, so it cannot slip past both caps', async () => {
    const inner = new MemoryStore();
    const store = withShopLimit(inner, 1);
    for (const phone of ['+270000012345', '+2700000123', '+2700000']) {
      await expect(store.createShop(shopOn(phone)), phone).rejects.toThrow(ShopLimitError);
      expect(await inner.findShopByPhone(phone)).toBeNull();
    }
    // A number in the same country that is outside the demo range is an ordinary shop.
    await store.createShop(shopOn('+27000111111'));
    await expect(store.createShop(shopOn('+27000222222'))).rejects.toThrow(ShopLimitError);
  });

  it('lets a repeat of a sign-up that already worked through at the cap, so the store answers it as before', async () => {
    const store = withShopLimit(new MemoryStore(), 1);
    const shop = shopOn('+254711000001', 'shop_ussd_S1');
    await store.createShop(shop);
    await expect(store.createShop(shop)).rejects.toMatchObject({ name: 'ShopAlreadyExistsError' });
    await expect(store.createShop(shopOn('+254711000001', 'shop_ussd_S2'))).rejects.toMatchObject({
      name: 'ShopAlreadyExistsError'
    });
    await expect(store.createShop(shopOn('+254711000009', 'shop_ussd_S1'))).rejects.toMatchObject({
      name: 'ShopAlreadyExistsError'
    });
  });

  it('passes every other call straight through', async () => {
    const store = withShopLimit(new MemoryStore(), 1);
    const shop = shopOn('+254711000001');
    await store.createShop(shop);
    expect(await store.findShopByPhone('+254711000001')).toEqual(shop);
    expect(await store.findShopById(shop.id)).toEqual(shop);
    expect(await store.deleteExpiredDemoShops(new Date('2100-01-01'), 200)).toEqual([]);
  });
});

describe('withoutShopCreation', () => {
  it('refuses to make a shop, writes nothing, and passes reads and records through', async () => {
    const inner = new MemoryStore();
    const existing = shopOn('+27000001234');
    await inner.createShop(existing);
    const store = withoutShopCreation(inner);

    await expect(store.createShop(shopOn('+27000005678'))).rejects.toThrow(ShopCreationNotAllowedError);
    expect(await inner.findShopByPhone('+27000005678')).toBeNull();

    expect(await store.findShopByPhone('+27000001234')).toEqual(existing);
    await store.appendRecord(createSaleRecord(existing.id, { id: 'r1', amount: 100, channel: 'web', originalWords: 'x', now: NOW }));
    expect(await inner.listRecords(existing.id)).toHaveLength(1);
  });
});
