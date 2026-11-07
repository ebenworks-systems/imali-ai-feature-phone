/**
 * Only POST /api/phone/demo makes demo shops. The browser phone's ussd and sms routes used to hand a demo number with
 * no shop to the real handlers, which signed a new owner up: one client could walk through all 10,000 demo numbers,
 * past the per-address limit and the cap, and "Start demo shop" then failed for everyone. These tests use the real
 * handlers (nothing is mocked).
 */

import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/store/memory/store.js';
import { DEMO_PHONE, OTHER_DEMO_PHONE, captureErrors, makeApp, makeShopApp, postJson } from './helpers.js';

const NO_SHOP = { error: 'No demo shop on this number. Press Start demo shop.' };
const ussd = (app: Parameters<typeof postJson>[0], phone: string, text: string, sessionId = 'S1') =>
  postJson(app, '/api/phone/ussd', { phone, text, sessionId });
const sms = (app: Parameters<typeof postJson>[0], phone: string, text: string) =>
  postJson(app, '/api/phone/sms', { phone, text });

async function shopCount(store: MemoryStore): Promise<number> {
  return store.countShopsWithPhonePrefix('');
}

describe('a demo number with no shop', () => {
  it('is refused on POST /api/phone/ussd with 404 and a plain sentence, and no shop is made (text "A*1")', async () => {
    const { app, store } = makeApp();
    const res = await ussd(app, DEMO_PHONE, 'A*1');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NO_SHOP);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await store.findShopByPhone(DEMO_PHONE)).toBeNull();
    expect(await shopCount(store as MemoryStore)).toBe(0);
  });

  it('is refused on POST /api/phone/ussd at every step of the sign-up, not only the last', async () => {
    const { app, store } = makeApp();
    for (const text of ['', 'A', 'A*1', 'A*1*1', '1']) {
      expect((await ussd(app, DEMO_PHONE, text)).status, text).toBe(404);
    }
    expect(await shopCount(store as MemoryStore)).toBe(0);
  });

  it('is refused on POST /api/phone/sms: "hi" and then a name make no shop and keep no question', async () => {
    const { app, store, pending } = makeApp();
    const hi = await sms(app, DEMO_PHONE, 'hi');
    expect(hi.status).toBe(404);
    expect(await hi.json()).toEqual(NO_SHOP);
    const name = await sms(app, DEMO_PHONE, "Thandi's Spaza");
    expect(name.status).toBe(404);
    expect(await store.findShopByPhone(DEMO_PHONE)).toBeNull();
    expect(await shopCount(store as MemoryStore)).toBe(0);
    expect(await pending.get(DEMO_PHONE)).toBeNull(); // not even the "waiting for a shop name" question
  });

  it('cannot be used to walk through the demo numbers: many numbers make no shops and leave the demo button working', async () => {
    const { app, store } = makeApp({ demoLimits: { perAddress: 1, maxShops: 3 }, limits: { browserPerAddress: 100_000 } });
    for (let i = 0; i < 100; i += 1) {
      const phone = `+2700000${String(i).padStart(4, '0')}`;
      expect((await ussd(app, phone, 'A*1', `S${i}`)).status).toBe(404);
      expect((await sms(app, phone, 'hi')).status).toBe(404);
    }
    expect(await store.countShopsWithPhonePrefix('+2700000')).toBe(0);
    // The one honest call that is allowed still makes its shop.
    expect((await postJson(app, '/api/phone/demo', {})).status).toBe(201);
  });

  it('is refused before any handler runs, and nothing is written even when a handler would have written', async () => {
    captureErrors();
    const { app, store, pending } = makeApp();
    const writes: string[] = [];
    for (const name of ['createShop', 'appendRecord'] as const) {
      const original = store[name].bind(store);
      (store as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
        writes.push(name);
        return (original as (...a: unknown[]) => unknown)(...args);
      };
    }
    await ussd(app, DEMO_PHONE, 'A*1');
    await sms(app, DEMO_PHONE, 'hi');
    expect(writes).toEqual([]);
    expect(await pending.get(DEMO_PHONE)).toBeNull();
  });

  it('is still refused after 60 calls from the number are over (the rate limit and the 404 are separate)', async () => {
    const { app } = makeApp();
    let last = 0;
    for (let i = 0; i < 61; i += 1) last = (await sms(app, DEMO_PHONE, 'hi')).status;
    expect(last).toBe(429);
  });
});

describe('a demo number that has a shop', () => {
  it('still works on both routes', async () => {
    const { app } = await makeShopApp();
    const menu = (await (await ussd(app, DEMO_PHONE, '')).json()) as { response: string };
    expect(menu.response).toMatch(/^CON Thandi's Spaza/);
    const reply = (await (await sms(app, DEMO_PHONE, 'today')).json()) as { reply: string };
    expect(reply.reply).toMatch(/^Today: sales/);
  });

  it('works for a shop made by POST /api/phone/demo', async () => {
    const { app } = makeApp();
    const made = await postJson(app, '/api/phone/demo', { phone: OTHER_DEMO_PHONE });
    expect(made.status).toBe(201);
    expect((await ussd(app, OTHER_DEMO_PHONE, '')).status).toBe(200);
    expect((await sms(app, OTHER_DEMO_PHONE, 'today')).status).toBe(200);
  });

  it('does not make a second shop for a number that has one, whatever is sent', async () => {
    const { app, store } = await makeShopApp();
    await ussd(app, DEMO_PHONE, 'A*1');
    await sms(app, DEMO_PHONE, 'hi');
    expect(await shopCount(store as MemoryStore)).toBe(1);
  });
});

describe('the browser routes cannot sign an owner up even if the shop vanishes after the check', () => {
  // The shop is cleared away (the 7-day housekeeping) between the route's check and the handler's own look: the route's
  // lookup (every odd call) finds a shop, the handler's (every even call) finds none, so it would sign a new owner up.
  function vanishingStore() {
    const store = new MemoryStore();
    let calls = 0;
    store.findShopByPhone = async (phone: string) => {
      calls += 1;
      return calls % 2 === 1
        ? { id: 'gone', name: 'Gone', phone, currency: 'ZAR', timeZone: 'Africa/Johannesburg', createdAt: '2026-11-07T10:00:00.000Z' }
        : null;
    };
    return store;
  }

  it.each([
    ['ussd', (app: Parameters<typeof postJson>[0]) => ussd(app, DEMO_PHONE, 'A*1')],
    ['sms', (app: Parameters<typeof postJson>[0]) => sms(app, DEMO_PHONE, 'Thandi')]
  ])('POST /api/phone/%s writes no shop', async (_name, call) => {
    captureErrors();
    const store = vanishingStore();
    const { app } = makeApp({ store });
    await call(app);
    await call(app); // a second message: for a text, this is the one that would carry the shop name
    expect(await store.countShopsWithPhonePrefix('')).toBe(0);
  });
});
