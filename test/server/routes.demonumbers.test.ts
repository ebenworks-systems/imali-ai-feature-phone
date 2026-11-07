/**
 * The Africa's Talking routes never make a shop on a demo number (`+2700000` and four digits). Only
 * `POST /api/phone/demo` does, with its limits on the client address and its cap on shops. Before this, with no
 * sender set the routes were open and the menu's and the texts' sign-up made a shop on any demo number, which
 * `POST /api/phone/ussd` then served. These tests use the real handlers, no mock.
 */

import { describe, expect, it, vi } from 'vitest';
import { InMemoryProcessedTextStore } from '../../src/store/processed.js';
import { MemoryStore } from '../../src/store/memory/store.js';
import { SENTENCES } from '../../src/server/constants.js';
import { addDemoShop, makeApp, postForm, postJson } from './helpers.js';

const KEY = 'test-callback-key-not-real';
const GHOST = '+27000009876'; // a demo number that no one has made a shop on
const NO_SHOP = SENTENCES.noShop;

/** An app on a store that counts every write, so a test can prove that nothing was written. */
function watchedApp(over: Parameters<typeof makeApp>[0] = {}) {
  const store = new MemoryStore();
  const writes = {
    createShop: vi.spyOn(store, 'createShop'),
    appendRecord: vi.spyOn(store, 'appendRecord')
  };
  const processed = new InMemoryProcessedTextStore();
  const claim = vi.spyOn(processed, 'claim');
  const sender = { send: vi.fn(async () => {}) };
  const built = makeApp({ store, processed, ...over });
  return { ...built, store, writes, claim, sender };
}

const dial = (app: Parameters<typeof postForm>[0], text: string, phoneNumber = GHOST, path = '/ussd') =>
  postForm(app, path, { sessionId: 'ATUid_ghost', serviceCode: '*384*46254#', phoneNumber, text });
const text = (app: Parameters<typeof postForm>[0], from: string, body: string, path = '/sms', id?: string) =>
  postForm(app, path, { from, text: body, ...(id ? { id } : {}) });

async function expectNothingMade(built: ReturnType<typeof watchedApp>, phone = GHOST) {
  expect(await built.store.findShopByPhone(phone)).toBeNull();
  expect(await built.store.countShopsWithPhonePrefix('')).toBe(0);
  expect(built.writes.createShop).not.toHaveBeenCalled();
  expect(built.writes.appendRecord).not.toHaveBeenCalled();
  expect(await built.pending.get(phone)).toBeNull();
}

describe.each([
  ['with no callback key (a local run)', undefined],
  ['with the callback key set and given', KEY]
])('POST /ussd for a demo number with no shop, %s', (_name, key) => {
  const q = key ? `?k=${key}` : '';
  const options = key ? { callbackKey: key } : {};

  it('answers END with a short plain sentence on every step of the sign-up, and makes no shop', async () => {
    const built = watchedApp(options);
    // The four calls that signed up a shop on a demo number before.
    for (const entry of ['', '1', '1*Rudo Shop', '1*Rudo Shop*1']) {
      const res = await dial(built.app, entry, GHOST, `/ussd${q}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/plain');
      const body = await res.text();
      expect(body).toBe(`END ${NO_SHOP}`);
      expect(body.slice(4).length).toBeLessThanOrEqual(182);
      expect(body).toMatch(/^[\x20-\x7e]+$/);
    }
    await expectNothingMade(built);
  });

  it('leaves the browser phone with no shop: POST /api/phone/ussd still answers 404 for the number', async () => {
    const built = watchedApp(options);
    for (const entry of ['', '1', '1*Rudo Shop', '1*Rudo Shop*1']) await dial(built.app, entry, GHOST, `/ussd${q}`);
    const res = await postJson(built.app, '/api/phone/ussd', { phone: GHOST, text: '' });
    expect(res.status).toBe(404);
    expect((await built.app.request(`/api/ledger?phone=${encodeURIComponent(GHOST)}`)).status).toBe(404);
  });

  it('refuses the number written with spaces too', async () => {
    const built = watchedApp(options);
    const res = await dial(built.app, '', '+27 00 000 9876', `/ussd${q}`);
    expect(await res.text()).toBe(`END ${NO_SHOP}`);
    await expectNothingMade(built);
  });

  it('lets a demo number that has a shop use it', async () => {
    const built = watchedApp(options);
    await addDemoShop(built.store, GHOST, 'Thandi');
    built.writes.createShop.mockClear();
    const res = await dial(built.app, '', GHOST, `/ussd${q}`);
    const body = await res.text();
    expect(body).toMatch(/^CON /);
    expect(body).toContain('Thandi');
    // Record a sale to the end: 1 Sale, 45, no item, yes.
    for (const path of ['1', '1*45', '1*45*1', '1*45*1*1']) {
      const step = await dial(built.app, path, GHOST, `/ussd${q}`);
      expect(await step.text()).not.toContain(NO_SHOP);
    }
    const shop = (await built.store.findShopByPhone(GHOST))!;
    expect(await built.store.listRecords(shop.id)).toHaveLength(1);
    expect(built.writes.createShop).not.toHaveBeenCalled();
    expect(await built.store.countShopsWithPhonePrefix('')).toBe(1);
  });

  it('still lets a number that is not a demo number sign up', async () => {
    const built = watchedApp(options);
    const res = await dial(built.app, '', '+254711000099', `/ussd${q}`);
    const body = await res.text();
    expect(body).toMatch(/^(CON|END) /);
    expect(body).not.toContain(NO_SHOP);
    for (const entry of ['1', '1*Rudo Shop', '1*Rudo Shop*1']) await dial(built.app, entry, '+254711000099', `/ussd${q}`);
    expect(await built.store.findShopByPhone('+254711000099')).not.toBeNull();
  });
});

describe.each([
  ['with no callback key (a local run)', undefined],
  ['with the callback key set and given', KEY]
])('POST /sms for a demo number with no shop, %s', (_name, key) => {
  const q = key ? `?k=${key}` : '';
  const options = key ? { callbackKey: key } : {};

  it('makes no shop, writes nothing, claims nothing, asks nothing and sends no text', async () => {
    const built = watchedApp({ ...options });
    const sender = { send: vi.fn(async () => {}) };
    const built2 = watchedApp({ ...options, smsSender: sender });
    for (const b of [built, built2]) {
      for (const [i, line] of ['hi', 'Rudo Shop', 'sold 3 bread 45', 'today'].entries()) {
        const res = await text(b.app, GHOST, line, `/sms${q}`, `ATXid_${i}`);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(NO_SHOP);
      }
      expect(b.claim).not.toHaveBeenCalled();
      await expectNothingMade(b);
    }
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('answers a repeated message id the same way, and never stores it', async () => {
    const built = watchedApp(options);
    for (let i = 0; i < 2; i += 1) {
      expect(await (await text(built.app, GHOST, 'hi', `/sms${q}`, 'ATXid_same')).text()).toBe(NO_SHOP);
    }
    expect(built.claim).not.toHaveBeenCalled();
    await expectNothingMade(built);
  });

  it('leaves the browser phone with no shop: POST /api/phone/sms still answers 404 for the number', async () => {
    const built = watchedApp(options);
    await text(built.app, GHOST, 'hi', `/sms${q}`);
    await text(built.app, GHOST, 'Rudo Shop', `/sms${q}`);
    const res = await postJson(built.app, '/api/phone/sms', { phone: GHOST, text: 'today' });
    expect(res.status).toBe(404);
  });

  it('refuses the number written with spaces too', async () => {
    const built = watchedApp(options);
    expect(await (await text(built.app, '+27 00 000 9876', 'hi', `/sms${q}`)).text()).toBe(NO_SHOP);
    await expectNothingMade(built);
  });

  it('lets a demo number that has a shop use it, and sends no text to it', async () => {
    const sender = { send: vi.fn(async () => {}) };
    const built = watchedApp({ ...options, smsSender: sender });
    await addDemoShop(built.store, GHOST, 'Thandi');
    built.writes.createShop.mockClear();
    const res = await text(built.app, GHOST, 'sold 3 bread 45', `/sms${q}`, 'ATXid_1');
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/^Saved: sale R45/);
    const shop = (await built.store.findShopByPhone(GHOST))!;
    expect(await built.store.listRecords(shop.id)).toHaveLength(1);
    expect(built.writes.createShop).not.toHaveBeenCalled();
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('still lets a number that is not a demo number sign up and sends the reply to it', async () => {
    const sender = { send: vi.fn(async () => {}) };
    const built = watchedApp({ ...options, smsSender: sender });
    const first = await text(built.app, '+254711000099', 'hi', `/sms${q}`);
    expect(await first.text()).not.toBe(NO_SHOP);
    expect(sender.send).toHaveBeenCalledTimes(1);
    await text(built.app, '+254711000099', 'Rudo Shop', `/sms${q}`);
    expect(await built.store.findShopByPhone('+254711000099')).not.toBeNull();
  });
});

describe('with the callback key set but not given', () => {
  it('answers 403 on both routes for a demo number, before the store is looked at', async () => {
    const built = watchedApp({ callbackKey: KEY });
    const find = vi.spyOn(built.store, 'findShopByPhone');
    expect((await dial(built.app, '', GHOST, '/ussd')).status).toBe(403);
    expect((await dial(built.app, '', GHOST, '/ussd?k=wrong')).status).toBe(403);
    expect((await text(built.app, GHOST, 'hi', '/sms')).status).toBe(403);
    expect((await text(built.app, GHOST, 'hi', '/sms?k=wrong')).status).toBe(403);
    expect(find).not.toHaveBeenCalled();
    await expectNothingMade(built);
  });
});

describe('only POST /api/phone/demo makes a demo shop', () => {
  it('makes the shop with its invented records, and then both routes serve it', async () => {
    const built = watchedApp();
    expect((await dial(built.app, '', GHOST)).status).toBe(200);
    expect((await postJson(built.app, '/api/phone/demo', { phone: GHOST })).status).toBe(201);
    const shop = (await built.store.findShopByPhone(GHOST))!;
    expect(shop.name).toBe("Thandi's Spaza");
    expect(await built.store.listRecords(shop.id)).toHaveLength(17);
    expect(await (await dial(built.app, '', GHOST)).text()).toMatch(/^CON Thandi's Spaza/);
    expect(await (await text(built.app, GHOST, 'today')).text()).toMatch(/Today|sales/i);
  });

  it('does not leave a half-made shop when the shop is cleared away between the look and the handler', async () => {
    const built = watchedApp();
    await addDemoShop(built.store, GHOST, 'Thandi');
    built.writes.createShop.mockClear();
    // The route finds the shop, then the shop vanishes before the handler's own look: the handler's store cannot make one.
    const find = built.store.findShopByPhone.bind(built.store);
    let calls = 0;
    vi.spyOn(built.store, 'findShopByPhone').mockImplementation(async (phone: string) => {
      calls += 1;
      return calls === 1 ? find(phone) : null;
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Only the first look in each request (the route's) finds the shop; the menu's own look finds none, so it takes
    // the number for a new owner and goes through its sign-up.
    let last = new Response();
    for (const entry of ['', '1', '1*Rudo Shop', '1*Rudo Shop*1']) {
      calls = 0; // the first look of each request is the route's
      last = await dial(built.app, entry, GHOST);
    }

    expect(last.status).toBe(200);
    expect(await last.text()).toMatch(/^END /);
    // The sign-up was reached and refused by the store the route handed over.
    expect(log.mock.calls.map((call) => String(call[0])).join('\n')).toContain('ShopCreationNotAllowedError');
    expect(built.writes.createShop).not.toHaveBeenCalled();
    expect(await built.store.countShopsWithPhonePrefix('')).toBe(1);
  });
});
