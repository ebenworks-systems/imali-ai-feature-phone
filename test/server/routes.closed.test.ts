/**
 * The Africa's Talking callbacks with no callback key. With the sender set and no key they used to be open: anyone
 * could read and write the ledger of any number and make the server send texts from the account. Now they answer 503.
 * Also the limits on /ussd and /sms, the cap on shops that are not demo shops, and the shop found by id (a session id
 * is chosen by the client). The real handlers run; nothing is mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryProcessedTextStore } from '../../src/store/processed.js';
import { MemoryStore } from '../../src/store/memory/store.js';
import {
  DEMO_PHONE,
  OTHER_DEMO_PHONE,
  captureErrors,
  makeApp,
  postForm,
  postJson,
  throwingStore
} from './helpers.js';

const OWNER = '+254711000000';
const OTHER_OWNER = '+254711000001';
const KEY = 'test-callback-key-not-real';
const CLOSED = 'This service is not set up yet. Please try again later.';
const RATE = 'Too many requests. Please wait a minute and try again.';
const ussdFields = (over: Record<string, string> = {}) => ({
  sessionId: 'S1',
  serviceCode: '*384*46254#',
  phoneNumber: OWNER,
  text: '',
  ...over
});
const smsFields = (over: Record<string, string> = {}) => ({ from: OWNER, text: 'today', ...over });

beforeEach(() => {
  captureErrors();
});

describe('the sender is set but there is no callback key (refuseCallbacks)', () => {
  function closedApp(extra: Parameters<typeof makeApp>[0] = {}) {
    const sender = { send: vi.fn(async () => {}) };
    const processed = new InMemoryProcessedTextStore();
    const claim = vi.spyOn(processed, 'claim');
    const built = makeApp({ store: throwingStore(), processed, smsSender: sender, refuseCallbacks: true, ...extra });
    return { ...built, sender, claim };
  }

  it('answers 503 text/plain with a plain sentence on POST /ussd and POST /sms', async () => {
    const { app } = closedApp();
    for (const res of [await postForm(app, '/ussd', ussdFields()), await postForm(app, '/sms', smsFields())]) {
      expect(res.status).toBe(503);
      expect(res.headers.get('content-type')).toContain('text/plain');
      expect(await res.text()).toBe(CLOSED);
    }
  });

  it('reads and writes nothing, and sends no text: not the store, the claim, the handlers or the sender', async () => {
    const { app, sender, claim } = closedApp();
    // The store throws on any use, so a 503 (and not a 500) proves it was not touched.
    await postForm(app, '/sms', smsFields({ id: 'ATXid_1' }));
    await postForm(app, '/ussd', ussdFields());
    expect(claim).not.toHaveBeenCalled();
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('answers before the body is read: a 9 KB body gets 503, not 413', async () => {
    const { app } = closedApp();
    const res = await postForm(app, '/sms', smsFields({ text: 'x'.repeat(9000) }));
    expect(res.status).toBe(503);
  });

  it('is not opened by any ?k=, because there is no key to match', async () => {
    const { app } = closedApp();
    for (const query of ['', '?k=', '?k=anything', `?k=${KEY}`]) {
      expect((await postForm(app, `/sms${query}`, smsFields())).status, query).toBe(503);
    }
  });

  it('does not close the browser routes or /health', async () => {
    const { app } = closedApp({ store: new MemoryStore() });
    expect((await app.request('/health')).status).toBe(200);
    expect((await postJson(app, '/api/phone/demo', { phone: DEMO_PHONE })).status).toBe(201);
    expect((await postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: 'today' })).status).toBe(200);
    expect((await postJson(app, '/api/phone/ussd', { phone: DEMO_PHONE })).status).toBe(200);
    expect((await app.request(`/api/ledger?phone=${encodeURIComponent(DEMO_PHONE)}`)).status).toBe(200);
  });

  it('gives way to a key: with a key set, the callbacks work with the right ?k= and answer 403 without', async () => {
    const { app } = closedApp({ store: new MemoryStore(), callbackKey: KEY });
    expect((await postForm(app, '/sms', smsFields())).status).toBe(403);
    expect((await postForm(app, `/sms?k=${KEY}`, smsFields())).status).toBe(200);
  });

  it('is off by default, so a run with no sender stays open', async () => {
    const { app } = makeApp();
    expect((await postForm(app, '/sms', smsFields())).status).toBe(200);
    expect((await postForm(app, '/ussd', ussdFields())).status).toBe(200);
  });
});

describe("limits on the Africa's Talking routes", () => {
  it('lets 30 requests a minute from one phone number through and refuses the 31st: /sms with 429 and Retry-After', async () => {
    const sender = { send: vi.fn(async () => {}) };
    const { app } = makeApp({ smsSender: sender });
    for (let i = 0; i < 30; i += 1) expect((await postForm(app, '/sms', smsFields())).status).toBe(200);
    sender.send.mockClear();
    const refused = await postForm(app, '/sms', smsFields());
    expect(refused.status).toBe(429);
    expect(await refused.text()).toBe(RATE);
    expect(refused.headers.get('retry-after')).toBe('60');
    expect(sender.send).not.toHaveBeenCalled(); // a flood must not cost us texts
  });

  it('answers /ussd for a phone number over its limit with an END screen the owner can read', async () => {
    const { app } = makeApp();
    for (let i = 0; i < 30; i += 1) await postForm(app, '/ussd', ussdFields({ sessionId: `S${i}` }));
    const refused = await postForm(app, '/ussd', ussdFields({ sessionId: 'S99' }));
    expect(refused.status).toBe(200);
    expect(await refused.text()).toBe(`END ${RATE}`);
  });

  it('counts /ussd and /sms together for a phone number, and each number on its own', async () => {
    const { app } = makeApp();
    for (let i = 0; i < 15; i += 1) await postForm(app, '/sms', smsFields());
    for (let i = 0; i < 15; i += 1) await postForm(app, '/ussd', ussdFields({ sessionId: `S${i}` }));
    expect((await postForm(app, '/sms', smsFields())).status).toBe(429);
    expect((await postForm(app, '/sms', smsFields({ from: OTHER_OWNER }))).status).toBe(200);
  });

  it('works again a minute later, and a refused request does not count', async () => {
    const { app, clock } = makeApp({ limits: { atPerPhone: 2 } });
    await postForm(app, '/sms', smsFields());
    clock.advance(30_000);
    await postForm(app, '/sms', smsFields());
    for (let i = 0; i < 4; i += 1) expect((await postForm(app, '/sms', smsFields())).status).toBe(429);
    clock.advance(30_001);
    expect((await postForm(app, '/sms', smsFields())).status).toBe(200);
  });

  it('limits each client address too: 300 a minute, whatever the phone numbers', async () => {
    const { app } = makeApp({ limits: { atPerAddress: 3 } });
    const from = (n: number) => `+2547110000${String(n).padStart(2, '0')}`;
    for (let i = 0; i < 3; i += 1) expect((await postForm(app, '/sms', smsFields({ from: from(i) }))).status).toBe(200);
    const refused = await postForm(app, '/ussd', ussdFields({ phoneNumber: from(9) }));
    expect(refused.status).toBe(429);
    expect(await refused.text()).toBe(RATE);
    expect(refused.headers.get('retry-after')).toBe('60');
    // Another address is not held back.
    expect((await postForm(app, '/sms', smsFields({ from: from(8) }), { 'x-real-ip': '192.0.2.44' })).status).toBe(200);
  });

  it('has a default of 300 a minute per address', async () => {
    const { app } = makeApp({ limits: { atPerPhone: 100_000 } });
    for (let i = 0; i < 300; i += 1) expect((await postForm(app, '/sms', smsFields({ from: `+25471100${i}` }))).status).toBe(200);
    expect((await postForm(app, '/sms', smsFields())).status).toBe(429);
  });

  it('counts a call only after the key check: a wrong key uses up nobody\'s limit', async () => {
    const { app } = makeApp({ callbackKey: KEY, limits: { atPerAddress: 1, atPerPhone: 1 } });
    for (let i = 0; i < 5; i += 1) expect((await postForm(app, '/sms', smsFields())).status).toBe(403);
    expect((await postForm(app, `/sms?k=${KEY}`, smsFields())).status).toBe(200);
  });

  it('leaves the browser routes to their own limits', async () => {
    const { app } = makeApp({ limits: { atPerAddress: 1 } });
    await postForm(app, '/sms', smsFields());
    expect((await postJson(app, '/api/phone/demo', { phone: DEMO_PHONE })).status).toBe(201);
  });
});

describe('the cap on shops that are not demo shops (2,000)', () => {
  const signUpBySms = async (app: Parameters<typeof postForm>[0], from: string, name = 'Shop') => {
    await postForm(app, '/sms', smsFields({ from, text: 'hi' }));
    return (await (await postForm(app, '/sms', smsFields({ from, text: name }))).text()).trim();
  };

  it('stops the next sign-up by text with a plain sentence, and makes no shop', async () => {
    const store = new MemoryStore();
    const { app } = makeApp({ store, limits: { otherShops: 2 } });
    expect(await signUpBySms(app, '+254711000001')).toMatch(/is ready/);
    expect(await signUpBySms(app, '+254711000002')).toMatch(/is ready/);
    expect(await signUpBySms(app, '+254711000003')).toBe('Sorry, no new shops can be added right now. Please try again later.');
    expect(await store.findShopByPhone('+254711000003')).toBeNull();
    expect(await store.countShopsWithPhonePrefix('')).toBe(2);
  });

  it('stops the next sign-up by the dialled menu, and makes no shop', async () => {
    const store = new MemoryStore();
    const { app } = makeApp({ store, limits: { otherShops: 1 } });
    const ok = await (await postForm(app, '/ussd', ussdFields({ phoneNumber: '+254711000001', sessionId: 'A', text: 'First*1' }))).text();
    expect(ok).toMatch(/^CON First/);
    const refused = await (await postForm(app, '/ussd', ussdFields({ phoneNumber: '+254711000002', sessionId: 'B', text: 'Second*1' }))).text();
    expect(refused).toMatch(/^END /);
    expect(await store.findShopByPhone('+254711000002')).toBeNull();
    expect(await store.countShopsWithPhonePrefix('')).toBe(1);
  });

  it('lets the owners who have a shop carry on at the cap, and lets a repeated sign-up request through', async () => {
    const { app } = makeApp({ limits: { otherShops: 1 } });
    const first = await postForm(app, '/ussd', ussdFields({ sessionId: 'A', text: 'First*1' }));
    expect(await first.text()).toMatch(/^CON First/);
    const repeat = await postForm(app, '/ussd', ussdFields({ sessionId: 'A', text: 'First*1' }));
    expect(await repeat.text()).toMatch(/^CON First/);
    expect(await (await postForm(app, '/sms', smsFields({ text: 'sold 45 bread' }))).text()).toMatch(/^Saved: sale R45/);
  });

  it('does not count demo shops, and does not stop a demo shop being made', async () => {
    const store = new MemoryStore();
    const { app } = makeApp({ store, limits: { otherShops: 1 } });
    expect((await postJson(app, '/api/phone/demo', { phone: DEMO_PHONE })).status).toBe(201);
    expect((await postJson(app, '/api/phone/demo', { phone: OTHER_DEMO_PHONE })).status).toBe(201);
    expect(await signUpBySms(app, '+254711000001')).toMatch(/is ready/);
    expect(await signUpBySms(app, '+254711000002')).toMatch(/no new shops/);
  });

  it('has a default of 2,000, counted in the store', async () => {
    const store = new MemoryStore();
    const count = vi.spyOn(store, 'countShopsWithPhonePrefix');
    count.mockImplementation(async (prefix: string) => (prefix === '' ? 2001 : 1)); // 2,000 that are not demo shops
    const { app } = makeApp({ store });
    await postForm(app, '/sms', smsFields({ text: 'hi' }));
    expect(await (await postForm(app, '/sms', smsFields({ text: 'Shop' }))).text()).toMatch(/no new shops/);
    count.mockImplementation(async (prefix: string) => (prefix === '' ? 2000 : 1)); // 1,999
    expect(await (await postForm(app, '/sms', smsFields({ text: 'Shop' }))).text()).toMatch(/is ready/);
  });
});

describe('a session id chosen by the client does not hand over another phone\'s shop', () => {
  it('answers the second phone with the plain sorry screen, not the first phone\'s menu', async () => {
    const store = new MemoryStore();
    const { app } = makeApp({ store });
    // Phone A signs up with session SAME.
    const a = await (await postForm(app, '/ussd', ussdFields({ phoneNumber: OWNER, sessionId: 'SAME', text: 'Shop of A*1' }))).text();
    expect(a).toMatch(/^CON Shop of A/);
    // Phone B dials with A's session id and names its own shop.
    const b = await (await postForm(app, '/ussd', ussdFields({ phoneNumber: OTHER_OWNER, sessionId: 'SAME', text: 'Shop of B*1' }))).text();
    expect(b).toMatch(/^END Sorry, something went wrong/);
    expect(b).not.toContain('Shop of A');
    expect(await store.findShopByPhone(OTHER_OWNER)).toBeNull();
    expect((await store.findShopByPhone(OWNER))?.name).toBe('Shop of A');
  });

  it('and A can still use its own shop afterwards', async () => {
    const { app } = makeApp();
    await postForm(app, '/ussd', ussdFields({ phoneNumber: OWNER, sessionId: 'SAME', text: 'Shop of A*1' }));
    await postForm(app, '/ussd', ussdFields({ phoneNumber: OTHER_OWNER, sessionId: 'SAME', text: 'Shop of B*1' }));
    const again = await (await postForm(app, '/ussd', ussdFields({ phoneNumber: OWNER, sessionId: 'NEW', text: '' }))).text();
    expect(again).toMatch(/^CON Shop of A/);
  });
});
