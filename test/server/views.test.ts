import { describe, expect, it } from 'vitest';
import { createShop, type Shop } from '../../src/core/index.js';
import {
  createDebtRecord,
  createExpenseRecord,
  createReversal,
  createSaleRecord
} from '../../src/core/records/types.js';
import { buildDemoRecords, buildDemoShop } from '../../src/server/demo.js';
import { buildLedgerView } from '../../src/server/views.js';
import { MemoryStore } from '../../src/store/memory/store.js';

const NOW = new Date('2026-11-07T10:00:00.000Z'); // 12:00 in Johannesburg

async function demoStore() {
  const store = new MemoryStore();
  const shop = buildDemoShop('+27000001234', NOW);
  await store.createShop(shop);
  for (const r of buildDemoRecords(shop, NOW)) await store.appendRecord(r);
  return { store, shop };
}

describe('buildLedgerView', () => {
  it('gives the shop, the local date and today\'s figures as { cents, text }', async () => {
    const { store, shop } = await demoStore();
    const view = await buildLedgerView(store, shop, NOW);
    expect(view.shop).toEqual({ name: "Thandi's Spaza", phone: '+27000001234', currency: 'ZAR', timeZone: 'Africa/Johannesburg' });
    expect(view.today.date).toBe('2026-11-07');
    expect(view.today.sales).toEqual({ total: { cents: 19500, text: 'R195' }, count: 3 });
    expect(view.today.expenses).toEqual({ cents: 2000, text: 'R20' });
    // sales 195 + payments 15 - expenses 20
    expect(view.today.moneyInHand.cents).toBe(19500 + 1500 - 2000);
    expect(view.today.moneyInHand.text).toBe('R190');
    expect(view.today.newDebts).toEqual({ cents: 2500, text: 'R25' });
    expect(view.today.paymentsReceived).toEqual({ cents: 1500, text: 'R15' });
    expect(view.today.totalOwed).toEqual({ cents: 7500, text: 'R75' });
  });

  it('lists who owes, largest first', async () => {
    const { store, shop } = await demoStore();
    const view = await buildLedgerView(store, shop, NOW);
    expect(view.owes).toEqual({
      customers: [
        { name: 'Rudo', owed: { cents: 3000, text: 'R30' } },
        { name: 'Sipho', owed: { cents: 2500, text: 'R25' } },
        { name: 'Tendai', owed: { cents: 2000, text: 'R20' } }
      ],
      more: 0
    });
  });

  it('gives the last 20 records newest first, and marks the reversed one', async () => {
    const { store, shop } = await demoStore();
    const view = await buildLedgerView(store, shop, NOW);
    expect(view.records).toHaveLength(17);
    expect(view.records[0]!.originalWords).toBe('sold sweets 30');
    const all = await store.listRecords(shop.id);
    expect(view.records.map((r) => r.id)).toEqual([...all].reverse().map((r) => r.id));
    const slip = view.records.find((r) => r.originalWords === 'sold 999 bread')!;
    expect(slip.reversed).toBe(true);
    const reversal = view.records.find((r) => r.kind === 'reversal')!;
    expect(reversal.reversesRecordId).toBe(slip.id);
    expect(reversal.reversed).toBe(false);
    expect(view.records.filter((r) => r.reversed)).toHaveLength(1);
  });

  it('shows the customer on a debt and a payment and the item where there is one', async () => {
    const { store, shop } = await demoStore();
    const view = await buildLedgerView(store, shop, NOW);
    const sipho = view.records.find((r) => r.originalWords === 'Sipho owes 25 bread')!;
    expect(sipho).toMatchObject({ kind: 'debt', customer: 'Sipho', item: 'bread' });
    const paid = view.records.find((r) => r.originalWords === 'Rudo paid 15')!;
    expect(paid.customer).toBe('Rudo');
    expect('item' in paid).toBe(false);
  });

  it('limits who-owes to 20 customers and says how many are not shown', async () => {
    const store = new MemoryStore();
    const shop = createShop({ name: 'Big', phone: '+27000005555', currency: 'ZAR', timeZone: 'Africa/Johannesburg' });
    await store.createShop(shop);
    for (let i = 1; i <= 23; i += 1) {
      await store.appendRecord(
        createDebtRecord(shop.id, { amount: i * 100, customer: `Customer ${i}`, channel: 'sms', originalWords: 'x', now: NOW })
      );
    }
    const view = await buildLedgerView(store, shop, NOW);
    expect(view.owes.customers).toHaveLength(20);
    expect(view.owes.more).toBe(3);
    expect(view.owes.customers[0]).toEqual({ name: 'Customer 23', owed: { cents: 2300, text: 'R23' } });
    expect(view.owes.customers[19]!.name).toBe('Customer 4');
  });

  it('limits the records to the last 20', async () => {
    const store = new MemoryStore();
    const shop = createShop({ name: 'Busy', phone: '+27000006666', currency: 'ZAR', timeZone: 'Africa/Johannesburg' });
    await store.createShop(shop);
    for (let i = 1; i <= 25; i += 1) {
      await store.appendRecord(
        createSaleRecord(shop.id, { id: `s${i}`, amount: i * 100, channel: 'sms', originalWords: `sold ${i}`, now: NOW })
      );
    }
    const view = await buildLedgerView(store, shop, NOW);
    expect(view.records).toHaveLength(20);
    expect(view.records[0]!.id).toBe('s25');
    expect(view.records[19]!.id).toBe('s6');
  });

  it('writes a negative money in hand with the minus sign first', async () => {
    const store = new MemoryStore();
    const shop: Shop = createShop({ name: 'Loss', phone: '+27000007777', currency: 'ZAR', timeZone: 'Africa/Johannesburg' });
    await store.createShop(shop);
    await store.appendRecord(
      createExpenseRecord(shop.id, { amount: 6000, item: 'taxi', channel: 'sms', originalWords: 'spent 60 taxi', now: NOW })
    );
    const view = await buildLedgerView(store, shop, NOW);
    expect(view.today.moneyInHand).toEqual({ cents: -6000, text: '-R60' });
  });

  it('formats money for the shop currency, and every text is plain ASCII', async () => {
    const store = new MemoryStore();
    const shop = createShop({ name: 'Naija', phone: '+27000008888', currency: 'NGN', timeZone: 'Africa/Lagos' });
    await store.createShop(shop);
    const sale = createSaleRecord(shop.id, { amount: 99999999, channel: 'sms', originalWords: 'sold 999999.99', now: NOW });
    await store.appendRecord(sale);
    await store.appendRecord(createReversal(createSaleRecord(shop.id, { id: 'x', amount: 1, channel: 'sms', originalWords: 'y', now: NOW }), 'sms', 'undo', NOW));
    const view = await buildLedgerView(store, shop, NOW);
    expect(view.today.sales.total.text).toBe('N999,999.99');
    const texts = JSON.stringify(view).match(/"text":"[^"]*"/g) ?? [];
    expect(texts.length).toBeGreaterThan(5);
    for (const t of texts) expect(t).toMatch(/^[\x20-\x7e]+$/);
  });

  it('copes with a shop that has no records', async () => {
    const store = new MemoryStore();
    const shop = createShop({ name: 'New', phone: '+27000009999', currency: 'ZAR', timeZone: 'Africa/Johannesburg' });
    await store.createShop(shop);
    const view = await buildLedgerView(store, shop, NOW);
    expect(view.records).toEqual([]);
    expect(view.owes).toEqual({ customers: [], more: 0 });
    expect(view.today.sales).toEqual({ total: { cents: 0, text: 'R0' }, count: 0 });
  });
});
