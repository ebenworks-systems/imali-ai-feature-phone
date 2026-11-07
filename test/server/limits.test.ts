import { describe, expect, it } from 'vitest';
import { createShop } from '../../src/core/shops/types.js';
import { createSaleRecord } from '../../src/core/records/types.js';
import { MemoryStore } from '../../src/store/memory/store.js';
import { DEMO_PHONE, OTHER_DEMO_PHONE, captureErrors, makeApp, makeShopApp, postForm, postJson } from './helpers.js';

const RATE = 'Too many requests. Please wait a minute and try again.';
const FULL = 'This shop book is full. Please start a new demo shop.';
const smsOf = (app: Parameters<typeof postJson>[0], phone: string, text = 'today') =>
  postJson(app, '/api/phone/sms', { phone, text });

describe('the 60 requests a minute per phone number (browser routes)', () => {
  it('lets 60 calls through and refuses the 61st with 429, Retry-After and a plain sentence', async () => {
    const { app } = await makeShopApp({}, [DEMO_PHONE, OTHER_DEMO_PHONE]);
    for (let i = 0; i < 60; i += 1) expect((await smsOf(app, DEMO_PHONE)).status).toBe(200);
    const refused = await smsOf(app, DEMO_PHONE);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: RATE });
    expect(refused.headers.get('retry-after')).toBe('60');
    expect(refused.headers.get('cache-control')).toBe('no-store');
  });

  it('does not count the refused request toward the 60', async () => {
    const { app, clock } = await makeShopApp({}, [DEMO_PHONE, OTHER_DEMO_PHONE]);
    for (let i = 0; i < 60; i += 1) await smsOf(app, DEMO_PHONE);
    clock.advance(30_000);
    for (let i = 0; i < 5; i += 1) expect((await smsOf(app, DEMO_PHONE)).status).toBe(429);
    clock.advance(30_001); // 60.001 s after the first 60
    expect((await smsOf(app, DEMO_PHONE)).status).toBe(200);
  });

  it('does not affect another number', async () => {
    const { app } = await makeShopApp({}, [DEMO_PHONE, OTHER_DEMO_PHONE]);
    for (let i = 0; i < 61; i += 1) await smsOf(app, DEMO_PHONE);
    expect((await smsOf(app, OTHER_DEMO_PHONE)).status).toBe(200);
  });

  it('works again after the clock moves 61 seconds', async () => {
    const { app, clock } = await makeShopApp({}, [DEMO_PHONE, OTHER_DEMO_PHONE]);
    for (let i = 0; i < 61; i += 1) await smsOf(app, DEMO_PHONE);
    expect((await smsOf(app, DEMO_PHONE)).status).toBe(429);
    clock.advance(61_000);
    expect((await smsOf(app, DEMO_PHONE)).status).toBe(200);
  });

  it('shares one count between the five browser routes', async () => {
    const { app } = makeApp();
    const q = encodeURIComponent(DEMO_PHONE);
    let n = 0;
    const calls: Array<() => Promise<Response>> = [
      () => postJson(app, '/api/phone/ussd', { phone: DEMO_PHONE }),
      () => smsOf(app, DEMO_PHONE),
      () => app.request(`/api/ledger?phone=${q}`),
      () => app.request(`/api/export?phone=${q}`),
      // each demo call comes from its own address, so only the per-phone count is in play
      () => postJson(app, '/api/phone/demo', { phone: DEMO_PHONE }, { 'x-forwarded-for': `203.0.113.${(n += 1)}` })
    ];
    for (let i = 0; i < 60; i += 1) {
      const res = await calls[i % 5]!();
      expect(res.status).not.toBe(429);
    }
    for (const call of calls) expect((await call()).status).toBe(429);
  });

  it('shares the key demo-create between demo calls that name no phone', async () => {
    const { app } = makeApp();
    let n = 0;
    const demo = () => postJson(app, '/api/phone/demo', {}, { 'x-forwarded-for': `203.0.113.${(n += 1)}` });
    for (let i = 0; i < 60; i += 1) expect((await demo()).status).toBe(201);
    const refused = await demo();
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: RATE });
    expect(refused.headers.get('retry-after')).toMatch(/^\d+$/);
    // A call that names a phone uses that phone's own count.
    expect((await postJson(app, '/api/phone/demo', { phone: DEMO_PHONE }, { 'x-forwarded-for': '198.51.100.1' })).status).toBe(201);
  });

  it("keeps the Africa's Talking routes out of the browser count: they have their own limits (limits.at.test.ts)", async () => {
    const { app } = await makeShopApp();
    for (let i = 0; i < 25; i += 1) {
      const res = await postForm(app, '/sms', { from: '+254711000000', text: 'today' });
      expect(res.status).toBe(200);
    }
    for (let i = 0; i < 60; i += 1) expect((await smsOf(app, DEMO_PHONE)).status).toBe(200);
    expect((await smsOf(app, DEMO_PHONE)).status).toBe(429);
  });
});

describe('the 2,000 record cap, with the real handlers', () => {
  async function fullShop(count = 2000) {
    const store = new MemoryStore();
    const shop = createShop({ name: 'Full Shop', phone: DEMO_PHONE, currency: 'ZAR', timeZone: 'Africa/Johannesburg' });
    await store.createShop(shop);
    for (let i = 0; i < count; i += 1) {
      await store.appendRecord(
        createSaleRecord(shop.id, { id: `r${i}`, amount: 100, channel: 'sms', originalWords: 'sold 1', now: new Date('2026-11-07T09:00:00Z') })
      );
    }
    return { ...makeApp({ store }), shop };
  }

  it('refuses the next record on POST /sms with the "shop book is full" sentence', async () => {
    captureErrors();
    const { app, store, shop } = await fullShop();
    const res = await postForm(app, '/sms', { from: DEMO_PHONE, text: 'sold 45 bread' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(FULL);
    expect(await store.listRecords(shop.id)).toHaveLength(2000);
  });

  it('refuses the next record on POST /api/phone/sms with the same sentence', async () => {
    captureErrors();
    const { app, store, shop } = await fullShop();
    const res = await smsOf(app, DEMO_PHONE, 'sold 45 bread');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: FULL });
    expect(await store.listRecords(shop.id)).toHaveLength(2000);
  });

  it.each(['/ussd', '/api/phone/ussd'])('shows a plain sentence and saves nothing on %s', async (path) => {
    captureErrors();
    const { app, store, shop } = await fullShop();
    const send = async (text: string) =>
      path === '/ussd'
        ? (await postForm(app, '/ussd', { sessionId: 'S1', serviceCode: '*384*46254#', phoneNumber: DEMO_PHONE, text })).text()
        : ((await (await postJson(app, '/api/phone/ussd', { phone: DEMO_PHONE, sessionId: 'S1', text })).json()) as { response: string }).response;
    expect(await send('')).toMatch(/^CON Full Shop/);
    const last = await send('1*45*bread*1');
    // The menu catches the error itself and shows its own plain sentence (it never reaches the app).
    expect(last).toMatch(/^END Sorry, something went wrong/);
    expect(last).not.toMatch(/RecordLimitError|already holds/);
    expect(await store.listRecords(shop.id)).toHaveLength(2000);
  });

  it('accepts the record that reaches 2,000 and refuses the one after it', async () => {
    captureErrors();
    const { app, store, shop } = await fullShop(1999);
    const first = await postForm(app, '/sms', { from: DEMO_PHONE, text: 'sold 45 bread' });
    expect(await first.text()).toMatch(/^Saved: sale R45/);
    expect(await store.listRecords(shop.id)).toHaveLength(2000);
    const second = await postForm(app, '/sms', { from: DEMO_PHONE, text: 'sold 45 bread' });
    expect(await second.text()).toBe(FULL);
  });

  it('still lets the owner read: today, who owes and undo of other shops are not blocked by another shop\'s cap', async () => {
    captureErrors();
    const { app } = await fullShop();
    const other = await postForm(app, '/sms', { from: '+27000005678', text: 'hello' });
    expect(other.status).toBe(200);
    const reads = await postForm(app, '/sms', { from: DEMO_PHONE, text: 'today' });
    expect(await reads.text()).toMatch(/Sales|sales/);
  });
});
