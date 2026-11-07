import { describe, expect, it, vi } from 'vitest';
import { createShop } from '../../src/core/shops/types.js';
import { createReversal, createSaleRecord } from '../../src/core/records/types.js';
import { DuplicateRecordError } from '../../src/store/interface.js';
import { RecordLimitError, withRecordLimit } from '../../src/store/limit.js';
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
