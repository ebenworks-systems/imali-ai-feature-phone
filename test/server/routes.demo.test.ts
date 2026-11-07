import { describe, expect, it, vi } from 'vitest';
import { createShop } from '../../src/core/shops/types.js';
import { MemoryStore } from '../../src/store/memory/store.js';
import { DEMO_PHONE, OTHER_DEMO_PHONE, captureErrors, makeApp, postJson, throwingStore } from './helpers.js';

const ledger = (phone: string) => `/api/ledger?phone=${encodeURIComponent(phone)}`;
const post = (app: Parameters<typeof postJson>[0], body: unknown, headers: Record<string, string> = {}) =>
  postJson(app, '/api/phone/demo', body, headers);

async function addShop(store: MemoryStore, phone: string) {
  await store.createShop(createShop({ name: 'Other', phone, currency: 'ZAR', timeZone: 'Africa/Johannesburg' }));
}

describe('POST /api/phone/demo', () => {
  it.each([
    ['no body', undefined],
    ['{}', '{}'],
    ['an empty string body', '']
  ])('creates a shop with a demo number and 17 records for %s, and answers 201', async (_name, body) => {
    const { app, store } = makeApp();
    const res = await app.request('/api/phone/demo', { method: 'POST', ...(body === undefined ? {} : { body }) });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.phone).toMatch(/^\+2700000\d{4}$/);
    expect(json.shop).toEqual({ name: "Thandi's Spaza", currency: 'ZAR', timeZone: 'Africa/Johannesburg' });
    expect(Object.keys(json).sort()).toEqual(['phone', 'shop']);
    const shop = await store.findShopByPhone(json.phone);
    expect(shop?.name).toBe("Thandi's Spaza");
    expect(await store.listRecords(shop!.id)).toHaveLength(17);
  });

  it('uses a given free demo number', async () => {
    const { app, store } = makeApp();
    const res = await post(app, { phone: DEMO_PHONE });
    expect(res.status).toBe(201);
    expect((await res.json()).phone).toBe(DEMO_PHONE);
    expect(await store.findShopByPhone(DEMO_PHONE)).not.toBeNull();
  });

  it('writes the number given in another form as the normalised number', async () => {
    const { app } = makeApp();
    const res = await post(app, { phone: '+27 00 000 1234' });
    expect((await res.json()).phone).toBe(DEMO_PHONE);
  });

  it('answers 409 and leaves the records as they were when the number already has a shop', async () => {
    const { app, store } = makeApp();
    await post(app, { phone: DEMO_PHONE });
    const shop = (await store.findShopByPhone(DEMO_PHONE))!;
    const before = await store.listRecords(shop.id);
    const res = await post(app, { phone: DEMO_PHONE });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'That demo number is already in use. Pick another.' });
    expect(await store.listRecords(shop.id)).toEqual(before);
    expect(await store.findShopByPhone(DEMO_PHONE)).toEqual(shop);
  });

  it('answers 400 for a number that is not a demo number', async () => {
    const { app } = makeApp({ store: throwingStore() });
    const res = await post(app, { phone: '+254711000000' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Use a demo number: +2700000 followed by 4 digits.' });
  });

  it.each([['not json'], ['[1]'], [JSON.stringify({ phone: 5 })]])('answers 400 for the body %s', async (body) => {
    const { app } = makeApp({ store: throwingStore() });
    const res = await post(app, body);
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe('string');
  });

  it('answers 503 after 20 tries when every number already has a shop', async () => {
    const store = new MemoryStore();
    const find = vi.spyOn(store, 'findShopByPhone').mockResolvedValue(
      createShop({ name: 'Taken', phone: '+27000000000', currency: 'ZAR', timeZone: 'Africa/Johannesburg' })
    );
    const { app } = makeApp({ store });
    const res = await post(app, undefined as never);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'No demo numbers are free right now. Please try again later.' });
    expect(find).toHaveBeenCalledTimes(20);
    expect(await store.countShopsWithPhonePrefix('+')).toBe(0);
  });

  it('makes a shop that works with GET /api/ledger', async () => {
    const { app } = makeApp();
    const created = await (await post(app, { phone: DEMO_PHONE })).json();
    const view = await (await app.request(ledger(created.phone))).json();
    expect(view.shop.name).toBe("Thandi's Spaza");
    expect(view.today.sales.count).toBe(3);
  });

  it('sends the demo records through the record cap (a shop that cannot hold 17 records fails)', async () => {
    // The cap is 2,000 records per shop, so 17 always fit; this checks the demo goes through the wrapped store.
    const { app, store } = makeApp();
    const spy = vi.spyOn(store, 'listRecords');
    await post(app, { phone: DEMO_PHONE });
    expect(spy).toHaveBeenCalledTimes(17); // one cap check per appended record
  });

  it('uses the injected clock: no record is later than now', async () => {
    const { app, store, clock } = makeApp();
    await post(app, { phone: DEMO_PHONE });
    const shop = (await store.findShopByPhone(DEMO_PHONE))!;
    const times = (await store.listRecords(shop.id)).map((r) => Date.parse(r.createdAt));
    expect(Math.max(...times)).toBeLessThanOrEqual(clock.now().getTime());
  });

  it('answers 500 { error } with a plain sentence when the store fails', async () => {
    captureErrors();
    const { app } = makeApp({ store: throwingStore('connection to db.internal:5432 failed') });
    const res = await post(app, { phone: DEMO_PHONE });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Sorry, something went wrong. Please try again.' });
  });
});

describe('the per-address limit: 10 calls an hour', () => {
  const FIRST = { 'x-forwarded-for': '203.0.113.7' };

  it('lets the 10th call from an address through and refuses the 11th with 429, Retry-After and a sentence', async () => {
    const { app, clock } = makeApp();
    for (let i = 0; i < 10; i += 1) {
      const res = await post(app, { phone: `+2700000${String(1000 + i)}` }, FIRST);
      expect(res.status).toBe(201);
      clock.advance(1000);
    }
    const refused = await post(app, { phone: '+27000002000' }, FIRST);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: 'Too many demo shops from this address. Please try again later.' });
    const retry = Number(refused.headers.get('retry-after'));
    expect(retry).toBeGreaterThan(3580);
    expect(retry).toBeLessThanOrEqual(3600);
    expect(refused.headers.get('cache-control')).toBe('no-store');
  });

  it('does not count a refused call: it does not extend the window', async () => {
    const { app, clock } = makeApp({ demoLimits: { perAddress: 2 } });
    await post(app, { phone: '+27000001001' }, FIRST);
    clock.advance(30 * 60_000);
    await post(app, { phone: '+27000001002' }, FIRST);
    clock.advance(10 * 60_000);
    for (let i = 0; i < 5; i += 1) expect((await post(app, { phone: '+27000001003' }, FIRST)).status).toBe(429);
    // 61 minutes after the first call: it has left the window, the second has not.
    clock.advance(21 * 60_000 + 1000);
    expect((await post(app, { phone: '+27000001003' }, FIRST)).status).toBe(201);
  });

  it('does not affect another address', async () => {
    const { app } = makeApp({ demoLimits: { perAddress: 1 } });
    expect((await post(app, { phone: '+27000001001' }, FIRST)).status).toBe(201);
    expect((await post(app, { phone: '+27000001002' }, FIRST)).status).toBe(429);
    expect((await post(app, { phone: '+27000001002' }, { 'x-forwarded-for': '198.51.100.9' })).status).toBe(201);
  });

  it('takes the first entry of x-forwarded-for as the address', async () => {
    const { app } = makeApp({ demoLimits: { perAddress: 1 } });
    expect((await post(app, { phone: '+27000001001' }, { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })).status).toBe(201);
    expect((await post(app, { phone: '+27000001002' }, { 'x-forwarded-for': '203.0.113.7, 10.0.0.2' })).status).toBe(429);
    expect((await post(app, { phone: '+27000001002' }, { 'x-forwarded-for': '10.0.0.1, 203.0.113.7' })).status).toBe(201);
  });

  it('works again after 61 minutes', async () => {
    const { app, clock } = makeApp({ demoLimits: { perAddress: 1 } });
    await post(app, { phone: '+27000001001' }, FIRST);
    expect((await post(app, { phone: '+27000001002' }, FIRST)).status).toBe(429);
    clock.advance(61 * 60_000);
    expect((await post(app, { phone: '+27000001002' }, FIRST)).status).toBe(201);
  });

  it('counts calls that name a phone number and calls that end in 409', async () => {
    const { app } = makeApp({ demoLimits: { perAddress: 3 } });
    expect((await post(app, { phone: DEMO_PHONE }, FIRST)).status).toBe(201);
    expect((await post(app, { phone: DEMO_PHONE }, FIRST)).status).toBe(409);
    expect((await post(app, { phone: OTHER_DEMO_PHONE }, FIRST)).status).toBe(201);
    expect((await post(app, { phone: '+27000001111' }, FIRST)).status).toBe(429);
  });

  it('counts a call with a bad body or a bad number too', async () => {
    const { app } = makeApp({ demoLimits: { perAddress: 2 } });
    expect((await post(app, 'not json', FIRST)).status).toBe(400);
    expect((await post(app, { phone: '+254711000000' }, FIRST)).status).toBe(400);
    expect((await post(app, { phone: DEMO_PHONE }, FIRST)).status).toBe(429);
  });

  it('counts calls with no x-forwarded-for together under "unknown"', async () => {
    const { app } = makeApp({ demoLimits: { perAddress: 2 } });
    expect((await post(app, {})).status).toBe(201);
    expect((await post(app, {})).status).toBe(201);
    expect((await post(app, {})).status).toBe(429);
    // A real address is a different key.
    expect((await post(app, {}, FIRST)).status).toBe(201);
  });

  it('falls back to x-real-ip', async () => {
    const { app } = makeApp({ demoLimits: { perAddress: 1 } });
    expect((await post(app, {}, { 'x-real-ip': '192.0.2.5' })).status).toBe(201);
    expect((await post(app, {}, { 'x-real-ip': '192.0.2.5' })).status).toBe(429);
    expect((await post(app, {}, { 'x-real-ip': '192.0.2.6' })).status).toBe(201);
  });

  it('makes no store call for a refused call', async () => {
    const { app } = makeApp({ store: throwingStore(), demoLimits: { perAddress: 0 } });
    const res = await post(app, { phone: DEMO_PHONE }, FIRST);
    expect(res.status).toBe(429);
  });

  it('has a default of 10 an hour', async () => {
    const { app } = makeApp();
    let status = 0;
    for (let i = 0; i < 11; i += 1) status = (await post(app, {}, FIRST)).status;
    expect(status).toBe(429);
  });
});

describe('the cap on demo shops: 5,000 in all', () => {
  it('answers 503 with a plain sentence and creates nothing at the cap', async () => {
    const store = new MemoryStore();
    for (const n of ['0001', '0002', '0003']) await addShop(store, `+2700000${n}`);
    const { app } = makeApp({ store, demoLimits: { maxShops: 3 } });
    const res = await post(app, {});
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'The demo is full right now. Please try again later.' });
    expect(await store.countShopsWithPhonePrefix('+2700000')).toBe(3);
    const named = await post(app, { phone: '+27000009999' });
    expect(named.status).toBe(503);
    expect(await store.findShopByPhone('+27000009999')).toBeNull();
  });

  it('does not count a shop whose number is not a demo number', async () => {
    const store = new MemoryStore();
    await addShop(store, '+254711000000');
    await addShop(store, '+254711000001');
    await addShop(store, '+27000001234');
    const { app } = makeApp({ store, demoLimits: { maxShops: 2 } });
    expect((await post(app, { phone: '+27000005678' })).status).toBe(201); // one demo shop so far, so there was room
    expect((await post(app, { phone: '+27000009999' })).status).toBe(503); // now two of two
  });

  it('succeeds at one below the cap', async () => {
    const store = new MemoryStore();
    for (const n of ['0001', '0002']) await addShop(store, `+2700000${n}`);
    const { app } = makeApp({ store, demoLimits: { maxShops: 3 } });
    expect((await post(app, {})).status).toBe(201);
    expect((await post(app, {})).status).toBe(503);
  });

  it('has a default of 5,000', async () => {
    const store = new MemoryStore();
    vi.spyOn(store, 'countShopsWithPhonePrefix').mockResolvedValue(4999);
    const { app } = makeApp({ store });
    expect((await post(app, {})).status).toBe(201);
    vi.spyOn(store, 'countShopsWithPhonePrefix').mockResolvedValue(5000);
    expect((await post(app, {})).status).toBe(503);
  });

  it('counts demo shops with the prefix +2700000', async () => {
    const store = new MemoryStore();
    const spy = vi.spyOn(store, 'countShopsWithPhonePrefix');
    const { app } = makeApp({ store });
    await post(app, {});
    expect(spy).toHaveBeenCalledWith('+2700000');
  });

  it('is checked after the phone checks, so a bad number is still a 400', async () => {
    const store = new MemoryStore();
    vi.spyOn(store, 'countShopsWithPhonePrefix').mockResolvedValue(9999);
    const { app } = makeApp({ store });
    expect((await post(app, { phone: '+254711000000' })).status).toBe(400);
  });
});
