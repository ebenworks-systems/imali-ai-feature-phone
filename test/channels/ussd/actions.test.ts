import { describe, it, expect, beforeEach } from 'vitest';
import { saveDraft, undoLast, type ActionContext } from '../../../src/channels/ussd/actions.js';
import { recordIdFor } from '../../../src/channels/ussd/ids.js';
import type { Draft } from '../../../src/channels/ussd/machine.js';
import { MemoryStore } from '../../../src/store/memory/store.js';
import {
  createSaleRecord,
  recordDebt,
  recordExpense,
  recordPayment,
  recordSale,
  type Shop
} from '../../../src/core/index.js';
import { NOW, seedShop } from '../../helpers/fixtures.js';

const amount = (cents: number) => ({ cents, requiresConfirmation: false });
const earlier = { channel: 'sms' as const, originalWords: 'x', now: NOW };

let store: MemoryStore;
let shop: Shop;

beforeEach(async () => {
  store = new MemoryStore();
  shop = await seedShop(store);
});

const ctx = (path: string[], sessionId = 'S1'): ActionContext => ({ store, shop, sessionId, path, now: NOW });

describe('saveDraft', () => {
  it('saves a sale: one record with the right fields', async () => {
    const path = ['1', '45', 'bread', '1'];
    const out = await saveDraft(ctx(path), { kind: 'sale', cents: 4500, item: 'bread' }, 4);
    expect(out).toEqual({
      ok: true,
      facts: { entry: { kind: 'sale', cents: 4500, item: 'bread' }, figure: { kind: 'salesToday', cents: 4500 } }
    });
    const records = await store.listRecords(shop.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: recordIdFor('S1', 4),
      shopId: shop.id,
      kind: 'sale',
      amount: 4500,
      item: 'bread',
      channel: 'ussd',
      originalWords: '1*45*bread*1',
      createdAt: NOW.toISOString()
    });
  });

  it('keeps the owner typed path up to the confirming input as the original words', async () => {
    await saveDraft(ctx(['1', 'x', '45', '1', '1', 'ignored']), { kind: 'sale', cents: 4500 }, 5);
    const [record] = await store.listRecords(shop.id);
    expect(record!.originalWords).toBe('1*x*45*1*1');
  });

  it('saves an expense', async () => {
    const out = await saveDraft(ctx(['2', '20', 'taxi', '1']), { kind: 'expense', cents: 2000, item: 'taxi' }, 4);
    expect(out).toEqual({
      ok: true,
      facts: { entry: { kind: 'expense', cents: 2000, item: 'taxi' }, figure: { kind: 'expensesToday', cents: 2000 } }
    });
    expect((await store.listRecords(shop.id))[0]).toMatchObject({ kind: 'expense', amount: 2000, item: 'taxi', channel: 'ussd' });
  });

  it('saves a debt and shows the customer total', async () => {
    await recordDebt(store, shop, { ...earlier, amount: amount(3000), customer: 'Tendai' });
    const out = await saveDraft(
      ctx(['3', 'Tendai', '20', 'sugar', '1']),
      { kind: 'debt', customer: 'Tendai', cents: 2000, item: 'sugar' },
      5
    );
    expect(out).toEqual({
      ok: true,
      facts: {
        entry: { kind: 'debt', cents: 2000, customer: 'Tendai', item: 'sugar' },
        figure: { kind: 'balance', customer: 'Tendai', cents: 5000, wording: 'total' }
      }
    });
    const records = await store.listRecords(shop.id);
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({ kind: 'debt', customerDisplayName: 'Tendai', customerKey: 'tendai', item: 'sugar' });
  });

  it('saves a payment and shows what the customer owes now, or credit', async () => {
    await recordDebt(store, shop, { ...earlier, amount: amount(5000), customer: 'Tendai' });
    const out = await saveDraft(ctx(['4', '1', '10', '1']), { kind: 'payment', customer: 'Tendai', cents: 1000 }, 4);
    expect(out).toMatchObject({ ok: true, facts: { figure: { kind: 'balance', cents: 4000, wording: 'now' } } });

    const credit = await saveDraft(ctx(['4', '1', '60', '1'], 'S2'), { kind: 'payment', customer: 'tendai', cents: 6000 }, 4);
    expect(credit).toMatchObject({ ok: true, facts: { figure: { kind: 'balance', cents: -2000 } } });
  });

  it('shows the new total, not the amount saved', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(124000) });
    const out = await saveDraft(ctx(['1', '45', '1', '1']), { kind: 'sale', cents: 4500 }, 4);
    expect(out).toMatchObject({ ok: true, facts: { figure: { kind: 'salesToday', cents: 128500 } } });
    await recordExpense(store, shop, { ...earlier, amount: amount(30000) });
    const spent = await saveDraft(ctx(['2', '20', '1', '1'], 'S2'), { kind: 'expense', cents: 2000 }, 4);
    expect(spent).toMatchObject({ ok: true, facts: { figure: { kind: 'expensesToday', cents: 32000 } } });
  });

  it('a second call with the same arguments adds nothing and returns the same facts', async () => {
    const draft: Draft = { kind: 'sale', cents: 4500, item: 'bread' };
    const first = await saveDraft(ctx(['1', '45', 'bread', '1']), draft, 4);
    const second = await saveDraft(ctx(['1', '45', 'bread', '1']), draft, 4);
    expect(second).toEqual(first);
    expect(await store.listRecords(shop.id)).toHaveLength(1);
  });

  it('two calls started together add one record', async () => {
    const draft: Draft = { kind: 'debt', customer: 'Tendai', cents: 2000, item: 'sugar' };
    const path = ['3', 'Tendai', '20', 'sugar', '1'];
    const [a, b] = await Promise.all([saveDraft(ctx(path), draft, 5), saveDraft(ctx(path), draft, 5)]);
    expect(a.ok).toBe(true);
    expect(b).toEqual(a);
    expect(await store.listRecords(shop.id)).toHaveLength(1);
  });

  it('many calls started together add one record', async () => {
    const draft: Draft = { kind: 'sale', cents: 4500 };
    const outs = await Promise.all(Array.from({ length: 5 }, () => saveDraft(ctx(['1', '45', '1', '1']), draft, 4)));
    expect(outs.every((o) => o.ok)).toBe(true);
    expect(await store.listRecords(shop.id)).toHaveLength(1);
  });

  it('a record that holds the id with another amount, kind, customer or item gives ok: false and adds nothing', async () => {
    const id = recordIdFor('S1', 4);
    await store.appendRecord(
      createSaleRecord(shop.id, { id, amount: 9900, item: 'bread', channel: 'ussd', originalWords: '1*99*bread*1', now: NOW })
    );
    const path = ['1', '45', 'bread', '1'];
    expect(await saveDraft(ctx(path), { kind: 'sale', cents: 4500, item: 'bread' }, 4)).toEqual({ ok: false });
    expect(await saveDraft(ctx(path), { kind: 'sale', cents: 9900, item: 'milk' }, 4)).toEqual({ ok: false });
    expect(await saveDraft(ctx(path), { kind: 'sale', cents: 9900 }, 4)).toEqual({ ok: false });
    expect(await saveDraft(ctx(path), { kind: 'expense', cents: 9900, item: 'bread' }, 4)).toEqual({ ok: false });
    expect(await saveDraft(ctx(path), { kind: 'debt', customer: 'Tendai', cents: 9900, item: 'bread' }, 4)).toEqual({ ok: false });
    expect(await store.listRecords(shop.id)).toHaveLength(1);
    // the same record still matches
    expect((await saveDraft(ctx(path), { kind: 'sale', cents: 9900, item: 'bread' }, 4)).ok).toBe(true);
  });

  it('a record with the id in another shop gives ok: false', async () => {
    const other = await seedShop(store, { phone: '+27000009999' });
    await store.appendRecord(
      createSaleRecord(other.id, { id: recordIdFor('S1', 4), amount: 4500, channel: 'ussd', originalWords: 'x', now: NOW })
    );
    expect(await saveDraft(ctx(['1', '45', '1', '1']), { kind: 'sale', cents: 4500 }, 4)).toEqual({ ok: false });
  });

  it('matches a customer name without regard to case and spaces', async () => {
    const path = ['3', 'Tendai', '20', '1', '1'];
    await saveDraft(ctx(path), { kind: 'debt', customer: 'Tendai', cents: 2000 }, 5);
    expect((await saveDraft(ctx(path), { kind: 'debt', customer: 'tendai', cents: 2000 }, 5)).ok).toBe(true);
    expect((await saveDraft(ctx(path), { kind: 'debt', customer: 'Rudo', cents: 2000 }, 5)).ok).toBe(false);
  });

  it('the same session with a different step makes a second record', async () => {
    await saveDraft(ctx(['1', '45', '1', '1']), { kind: 'sale', cents: 4500 }, 4);
    await saveDraft(ctx(['1', '45', 'x', '1', '1']), { kind: 'sale', cents: 4500 }, 5);
    expect(await store.listRecords(shop.id)).toHaveLength(2);
  });

  it('another session with the same keys makes another record', async () => {
    await saveDraft(ctx(['1', '45', '1', '1'], 'S1'), { kind: 'sale', cents: 4500 }, 4);
    await saveDraft(ctx(['1', '45', '1', '1'], 'S2'), { kind: 'sale', cents: 4500 }, 4);
    expect(await store.listRecords(shop.id)).toHaveLength(2);
  });

  it('saves a big amount only when the owner confirmed it', async () => {
    const path = ['1', '1500000', '1', '1', '1'];
    expect(await saveDraft(ctx(path), { kind: 'sale', cents: 150000000 }, 5)).toEqual({ ok: false });
    expect(await store.listRecords(shop.id)).toHaveLength(0);
    const out = await saveDraft(ctx(path), { kind: 'sale', cents: 150000000, bigOk: true }, 5);
    expect(out).toMatchObject({ ok: true, facts: { figure: { kind: 'salesToday', cents: 150000000 } } });
    expect(await store.listRecords(shop.id)).toHaveLength(1);
  });

  it('refuses a draft with no amount, a zero amount, or a payment with no customer, and saves nothing', async () => {
    expect(await saveDraft(ctx(['x']), { kind: 'sale' }, 4)).toEqual({ ok: false });
    expect(await saveDraft(ctx(['x']), { kind: 'sale', cents: 0 }, 4)).toEqual({ ok: false });
    expect(await saveDraft(ctx(['x']), { kind: 'payment', cents: 1000 }, 4)).toEqual({ ok: false });
    expect(await store.listRecords(shop.id)).toHaveLength(0);
  });

  it('refuses a save that would leave a total that is not a safe whole number, and saves nothing', async () => {
    const huge = 9007199254740991;
    expect((await saveDraft(ctx(['1', 'a', '1', '1', '1'], 'S1'), { kind: 'sale', cents: huge, bigOk: true }, 5)).ok).toBe(true);
    const out = await saveDraft(ctx(['1', 'b', '1', '1', '1'], 'S2'), { kind: 'sale', cents: huge, bigOk: true }, 5);
    expect(out).toEqual({ ok: false });
    expect(await store.listRecords(shop.id)).toHaveLength(1);
  });

  it('throws a failing store error instead of swallowing it', async () => {
    store.appendRecord = async () => {
      throw new Error('store is down');
    };
    await expect(saveDraft(ctx(['1', '45', '1', '1']), { kind: 'sale', cents: 4500 }, 4)).rejects.toThrow('store is down');
  });
});

describe('undoLast', () => {
  it('undoes the last sale and shows the sales total after it', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(120000) });
    await recordSale(store, shop, { ...earlier, amount: amount(4500), item: 'bread' });
    const out = await undoLast(ctx(['7', '1']), 2);
    expect(out).toEqual({
      ok: true,
      facts: { entry: { kind: 'sale', cents: 4500, item: 'bread' }, figure: { kind: 'salesToday', cents: 120000 } }
    });
    const records = await store.listRecords(shop.id);
    expect(records).toHaveLength(3);
    expect(records[2]).toMatchObject({
      id: recordIdFor('S1', 2),
      kind: 'reversal',
      channel: 'ussd',
      originalWords: '7*1'
    });
  });

  it('undoes an expense, a debt and a payment with the figure after it', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(1000) });
    await recordExpense(store, shop, { ...earlier, amount: amount(2000), item: 'taxi' });
    expect(await undoLast(ctx(['7', '1'], 'A'), 2)).toEqual({
      ok: true,
      facts: { entry: { kind: 'expense', cents: 2000, item: 'taxi' }, figure: { kind: 'expensesToday', cents: 0 } }
    });

    await recordDebt(store, shop, { ...earlier, amount: amount(3000), customer: 'Tendai' });
    await recordDebt(store, shop, { ...earlier, amount: amount(2000), customer: 'Tendai', item: 'sugar' });
    expect(await undoLast(ctx(['7', '1'], 'B'), 2)).toEqual({
      ok: true,
      facts: {
        entry: { kind: 'debt', cents: 2000, customer: 'Tendai', item: 'sugar' },
        figure: { kind: 'balance', customer: 'Tendai', cents: 3000, wording: 'now' }
      }
    });

    await recordPayment(store, shop, { ...earlier, amount: amount(1000), customer: 'Tendai' });
    expect(await undoLast(ctx(['7', '1'], 'C'), 2)).toEqual({
      ok: true,
      facts: {
        entry: { kind: 'payment', cents: 1000, customer: 'Tendai' },
        figure: { kind: 'balance', customer: 'Tendai', cents: 3000, wording: 'now' }
      }
    });
  });

  it('a repeat returns the same facts and adds no second reversal', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(4500) });
    const first = await undoLast(ctx(['7', '1']), 2);
    const second = await undoLast(ctx(['7', '1']), 2);
    expect(second).toEqual(first);
    expect((await store.listRecords(shop.id)).filter((r) => r.kind === 'reversal')).toHaveLength(1);
  });

  it('with two records, a repeat does not undo the older one', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(1000), item: 'older' });
    await recordSale(store, shop, { ...earlier, amount: amount(2000), item: 'newer' });
    const first = await undoLast(ctx(['7', '1']), 2);
    const second = await undoLast(ctx(['7', '1']), 2);
    expect(first).toMatchObject({ ok: true, facts: { entry: { item: 'newer' } } });
    expect(second).toEqual(first);
    const records = await store.listRecords(shop.id);
    expect(records.filter((r) => r.kind === 'reversal')).toHaveLength(1);
    // the older sale is still counted
    expect(second).toMatchObject({ facts: { figure: { cents: 1000 } } });
  });

  it('two started together add one reversal', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(1000), item: 'older' });
    await recordSale(store, shop, { ...earlier, amount: amount(2000), item: 'newer' });
    const [a, b] = await Promise.all([undoLast(ctx(['7', '1']), 2), undoLast(ctx(['7', '1']), 2)]);
    expect(a.ok).toBe(true);
    expect(b).toEqual(a);
    expect(a).toMatchObject({ facts: { entry: { item: 'newer' } } });
    expect((await store.listRecords(shop.id)).filter((r) => r.kind === 'reversal')).toHaveLength(1);
  });

  it('three started together with several records still add one reversal', async () => {
    for (const n of [1, 2, 3, 4]) await recordSale(store, shop, { ...earlier, amount: amount(n * 100) });
    await Promise.all([1, 2, 3].map(() => undoLast(ctx(['7', '1']), 2)));
    expect((await store.listRecords(shop.id)).filter((r) => r.kind === 'reversal')).toHaveLength(1);
  });

  it('nothing to undo gives nothingToUndo: true', async () => {
    expect(await undoLast(ctx(['7', '1']), 2)).toEqual({ ok: false, nothingToUndo: true });
    expect(await store.listRecords(shop.id)).toHaveLength(0);
  });

  it('nothing to undo after everything is undone', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(1000) });
    expect((await undoLast(ctx(['7', '1'], 'A'), 2)).ok).toBe(true);
    expect(await undoLast(ctx(['7', '1'], 'B'), 2)).toEqual({ ok: false, nothingToUndo: true });
  });

  it('another session undoes the next record', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(1000) });
    await recordSale(store, shop, { ...earlier, amount: amount(2000) });
    await undoLast(ctx(['7', '1'], 'A'), 2);
    await undoLast(ctx(['7', '1'], 'B'), 2);
    expect((await store.listRecords(shop.id)).filter((r) => r.kind === 'reversal')).toHaveLength(2);
  });

  it('gives ok: false when the id is held by a record that is not a reversal', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(1000) });
    await store.appendRecord(
      createSaleRecord(shop.id, { id: recordIdFor('S1', 2), amount: 5, channel: 'ussd', originalWords: 'x', now: NOW })
    );
    expect(await undoLast(ctx(['7', '1']), 2)).toEqual({ ok: false, nothingToUndo: false });
  });

  it('throws a failing store error instead of swallowing it', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(1000) });
    store.appendRecord = async () => {
      throw new Error('store is down');
    };
    await expect(undoLast(ctx(['7', '1']), 2)).rejects.toThrow('store is down');
  });
});
