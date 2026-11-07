import { describe, it, expect, beforeEach } from 'vitest';
import { COUNTRIES, makePorts } from '../../../src/channels/ussd/ports.js';
import { shopIdFor } from '../../../src/channels/ussd/ids.js';
import { MemoryStore } from '../../../src/store/memory/store.js';
import { recordDebt, recordExpense, recordPayment, recordSale, undoLastRecord } from '../../../src/core/index.js';
import { DEMO_PHONE, NOW, seedShop } from '../../helpers/fixtures.js';

const amount = (cents: number) => ({ cents, requiresConfirmation: false });
const common = { channel: 'sms' as const, originalWords: 'x', now: NOW };

describe('ports: owes()', () => {
  let store: MemoryStore;
  beforeEach(() => {
    store = new MemoryStore();
  });

  it('lists customers who owe, largest first', async () => {
    const shop = await seedShop(store);
    await recordDebt(store, shop, { ...common, amount: amount(3000), customer: 'Rudo' });
    await recordDebt(store, shop, { ...common, amount: amount(5000), customer: 'Tendai' });
    await recordDebt(store, shop, { ...common, amount: amount(4000), customer: 'Zodwa' });
    const ports = makePorts({ store, shop, sessionId: 'S1', phone: DEMO_PHONE, now: NOW });
    expect((await ports.owes()).map((c) => [c.displayName, c.balance])).toEqual([
      ['Tendai', 5000],
      ['Zodwa', 4000],
      ['Rudo', 3000]
    ]);
  });

  it('breaks ties by lower-case name', async () => {
    const shop = await seedShop(store);
    for (const name of ['zodwa', 'Rudo', 'amara', 'Tendai']) {
      await recordDebt(store, shop, { ...common, amount: amount(1000), customer: name });
    }
    const ports = makePorts({ store, shop, sessionId: 'S1', phone: DEMO_PHONE, now: NOW });
    expect((await ports.owes()).map((c) => c.displayName)).toEqual(['amara', 'Rudo', 'Tendai', 'zodwa']);
  });

  it('is the same order on every call', async () => {
    const shop = await seedShop(store);
    for (const name of ['B', 'A', 'C']) {
      await recordDebt(store, shop, { ...common, amount: amount(1000), customer: name });
    }
    const ports = makePorts({ store, shop, sessionId: 'S1', phone: DEMO_PHONE, now: NOW });
    expect(await ports.owes()).toEqual(await ports.owes());
  });

  it('leaves out customers who owe nothing or hold credit', async () => {
    const shop = await seedShop(store);
    await recordDebt(store, shop, { ...common, amount: amount(2000), customer: 'Tendai' });
    await recordPayment(store, shop, { ...common, amount: amount(2000), customer: 'Tendai' }); // zero
    await recordPayment(store, shop, { ...common, amount: amount(500), customer: 'Rudo' }); // credit
    await recordDebt(store, shop, { ...common, amount: amount(100), customer: 'Zodwa' });
    const ports = makePorts({ store, shop, sessionId: 'S1', phone: DEMO_PHONE, now: NOW });
    expect((await ports.owes()).map((c) => c.displayName)).toEqual(['Zodwa']);
  });

  it('leaves out reversed debts', async () => {
    const shop = await seedShop(store);
    await recordDebt(store, shop, { ...common, amount: amount(2000), customer: 'Tendai' });
    await undoLastRecord(store, shop, common);
    const ports = makePorts({ store, shop, sessionId: 'S1', phone: DEMO_PHONE, now: NOW });
    expect(await ports.owes()).toEqual([]);
  });

  it('is empty while there is no shop', async () => {
    const ports = makePorts({ store, shop: null, sessionId: 'S1', phone: DEMO_PHONE, now: NOW });
    expect(await ports.owes()).toEqual([]);
    expect(await ports.undoTarget()).toBeNull();
  });
});

describe('ports: undoTarget()', () => {
  it('is null when there is nothing to undo', async () => {
    const store = new MemoryStore();
    const shop = await seedShop(store);
    const ports = makePorts({ store, shop, sessionId: 'S1', phone: DEMO_PHONE, now: NOW });
    expect(await ports.undoTarget()).toBeNull();
  });

  it('describes each kind of record', async () => {
    const store = new MemoryStore();
    const shop = await seedShop(store);
    const ports = makePorts({ store, shop, sessionId: 'S1', phone: DEMO_PHONE, now: NOW });

    await recordSale(store, shop, { ...common, amount: amount(4500), item: 'bread' });
    expect(await ports.undoTarget()).toMatchObject({ kind: 'sale', cents: 4500, item: 'bread' });

    await recordExpense(store, shop, { ...common, amount: amount(2000), item: 'taxi' });
    expect(await ports.undoTarget()).toMatchObject({ kind: 'expense', cents: 2000, item: 'taxi' });

    await recordDebt(store, shop, { ...common, amount: amount(2000), customer: 'Tendai', item: 'sugar' });
    expect(await ports.undoTarget()).toMatchObject({ kind: 'debt', cents: 2000, customer: 'Tendai', item: 'sugar' });

    await recordPayment(store, shop, { ...common, amount: amount(1000), customer: 'Tendai' });
    const target = await ports.undoTarget();
    expect(target).toMatchObject({ kind: 'payment', cents: 1000, customer: 'Tendai' });
    expect(target?.item).toBeUndefined();
  });

  it('is the record that undoLastRecord then undoes', async () => {
    const store = new MemoryStore();
    const shop = await seedShop(store);
    const ports = makePorts({ store, shop, sessionId: 'S1', phone: DEMO_PHONE, now: NOW });
    await recordSale(store, shop, { ...common, amount: amount(1000) });
    await recordExpense(store, shop, { ...common, amount: amount(200), item: 'airtime' });
    await recordDebt(store, shop, { ...common, amount: amount(300), customer: 'Rudo' });

    for (let i = 0; i < 3; i += 1) {
      const target = await ports.undoTarget();
      const result = await undoLastRecord(store, shop, common);
      expect(result.success).toBe(true);
      if (result.success && target) {
        expect(result.data.reversal.reversesRecordId).toBe(target.id);
        expect(result.data.reversedRecord).toMatchObject({ kind: target.kind, amount: target.cents });
      }
    }
    expect(await ports.undoTarget()).toBeNull();
  });
});

describe('ports: createShop()', () => {
  it('has the country list from the design', () => {
    expect(COUNTRIES.map((c) => [c.currency, c.timeZone])).toEqual([
      ['ZAR', 'Africa/Johannesburg'],
      ['USD', 'Africa/Johannesburg'],
      ['KES', 'Africa/Nairobi'],
      ['NGN', 'Africa/Lagos'],
      ['GHS', 'Africa/Accra'],
      ['ZMW', 'Africa/Lusaka'],
      ['BWP', 'Africa/Gaborone']
    ]);
  });

  for (let choice = 1; choice <= 7; choice += 1) {
    it(`choice ${choice} makes a shop with the right currency and time zone`, async () => {
      const store = new MemoryStore();
      const ports = makePorts({ store, shop: null, sessionId: 'S1', phone: DEMO_PHONE, now: NOW });
      const shop = await ports.createShop('Demo Spaza', choice);
      const country = COUNTRIES[choice - 1]!;
      expect(shop).toMatchObject({
        id: shopIdFor('S1'),
        name: 'Demo Spaza',
        phone: DEMO_PHONE,
        currency: country.currency,
        timeZone: country.timeZone,
        createdAt: NOW.toISOString()
      });
      expect(await store.findShopByPhone(DEMO_PHONE)).toEqual(shop);
      expect(ports.shop).toEqual(shop);
    });
  }

  it('uses the normalised phone number it is given', async () => {
    const store = new MemoryStore();
    const ports = makePorts({ store, shop: null, sessionId: 'S1', phone: '+27000001234', now: NOW });
    await ports.createShop('Demo Spaza', 1);
    expect(await store.findShopByPhone('+27000001234')).not.toBeNull();
  });

  it('calling it twice gives one shop', async () => {
    const store = new MemoryStore();
    const ports = makePorts({ store, shop: null, sessionId: 'S1', phone: DEMO_PHONE, now: NOW });
    const first = await ports.createShop('Demo Spaza', 3);
    const second = await ports.createShop('Demo Spaza', 3);
    expect(second).toEqual(first);
  });

  it('two copies made together give one shop', async () => {
    const store = new MemoryStore();
    const a = makePorts({ store, shop: null, sessionId: 'S1', phone: DEMO_PHONE, now: NOW });
    const b = makePorts({ store, shop: null, sessionId: 'S1', phone: DEMO_PHONE, now: NOW });
    const [x, y] = await Promise.all([a.createShop('Demo Spaza', 1), b.createShop('Demo Spaza', 1)]);
    expect(x.id).toBe(y.id);
    expect(a.shop).toEqual(b.shop);
  });

  it('uses a shop another session made for the same phone', async () => {
    const store = new MemoryStore();
    const other = await seedShop(store, { id: shopIdFor('OTHER'), name: 'First Shop', currency: 'KES' });
    const ports = makePorts({ store, shop: null, sessionId: 'S1', phone: DEMO_PHONE, now: NOW });
    const shop = await ports.createShop('Second Name', 1);
    expect(shop).toEqual(other);
    expect(ports.shop).toEqual(other);
  });

  it('refuses a choice outside 1 to 7', async () => {
    const ports = makePorts({ store: new MemoryStore(), shop: null, sessionId: 'S1', phone: DEMO_PHONE, now: NOW });
    await expect(ports.createShop('Demo', 0)).rejects.toThrow(RangeError);
    await expect(ports.createShop('Demo', 8)).rejects.toThrow(RangeError);
  });

  it('lets another kind of store error through', async () => {
    const store = new MemoryStore();
    store.createShop = async () => {
      throw new Error('store is down');
    };
    const ports = makePorts({ store, shop: null, sessionId: 'S1', phone: DEMO_PHONE, now: NOW });
    await expect(ports.createShop('Demo', 1)).rejects.toThrow('store is down');
  });
});
