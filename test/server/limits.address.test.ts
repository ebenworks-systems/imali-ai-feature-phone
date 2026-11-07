/**
 * Limits per client address, kept in the store where they must hold across serverless instances, and the ceiling on
 * model-reader calls.
 */

import { describe, expect, it, vi } from 'vitest';
import { InMemoryPendingStore } from '../../src/channels/sms/pending.js';
import { createApp } from '../../src/server/app.js';
import { addressKey } from '../../src/server/address.js';
import { DEFAULT_ADDRESS_SALT } from '../../src/server/constants.js';
import { MemoryStore } from '../../src/store/memory/store.js';
import { InMemoryDemoQuotaStore } from '../../src/store/quota.js';
import { DEMO_PHONE, makeApp, makeClock, makeShopApp, postForm, postJson } from './helpers.js';

const RATE = 'Too many requests. Please wait a minute and try again.';
const phoneN = (n: number) => `+2700000${String(n).padStart(4, '0')}`;
const ledger = (app: Parameters<typeof postJson>[0], phone: string, headers: Record<string, string> = {}) =>
  (app as unknown as { request: (p: string, i?: RequestInit) => Promise<Response> }).request(
    `/api/ledger?phone=${encodeURIComponent(phone)}`,
    { headers }
  );

describe('every browser route also counts against the client address: 120 a minute', () => {
  it('lets 120 requests from one address through and refuses the 121st with 429, Retry-After and a plain sentence', async () => {
    const { app } = makeApp();
    // A different phone number each time, so only the count per address is in play.
    for (let i = 0; i < 120; i += 1) expect((await ledger(app, phoneN(i))).status).toBe(404);
    const refused = await ledger(app, phoneN(500));
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: RATE });
    expect(refused.headers.get('retry-after')).toBe('60');
    expect(refused.headers.get('cache-control')).toBe('no-store');
  });

  it('counts all five browser routes together', async () => {
    const { app } = await makeShopApp({ limits: { browserPerAddress: 10 } }, [DEMO_PHONE]);
    const q = encodeURIComponent(DEMO_PHONE);
    const calls: Array<(n: number) => Promise<Response>> = [
      (n) => postJson(app, '/api/phone/ussd', { phone: phoneN(n) }),
      (n) => postJson(app, '/api/phone/sms', { phone: phoneN(n), text: 'today' }),
      () => app.request(`/api/ledger?phone=${q}`),
      () => app.request(`/api/export?phone=${q}`),
      (n) => postJson(app, '/api/phone/demo', { phone: phoneN(n + 5000) })
    ];
    for (let i = 0; i < 10; i += 1) expect((await calls[i % 5]!(i)).status).not.toBe(429);
    for (const [i, call] of calls.entries()) expect((await call(100 + i)).status, `route ${i}`).toBe(429);
  });

  it('refuses before the body is read: an over-large body from a limited address gets 429, not 413', async () => {
    const { app } = makeApp({ limits: { browserPerAddress: 1 } });
    await ledger(app, DEMO_PHONE);
    const res = await app.request('/api/phone/sms', { method: 'POST', body: 'x'.repeat(9000) });
    expect(res.status).toBe(429);
  });

  it('does not count a refused request, and works again a minute after the counted ones', async () => {
    const { app, clock } = makeApp({ limits: { browserPerAddress: 2 } });
    await ledger(app, phoneN(1));
    clock.advance(30_000);
    await ledger(app, phoneN(2));
    for (let i = 0; i < 5; i += 1) expect((await ledger(app, phoneN(3))).status).toBe(429);
    clock.advance(30_001); // 60.001 s after the first
    expect((await ledger(app, phoneN(3))).status).toBe(404);
  });

  it('counts each address on its own', async () => {
    const { app } = makeApp({ limits: { browserPerAddress: 1 } });
    expect((await ledger(app, phoneN(1), { 'x-real-ip': '192.0.2.1' })).status).toBe(404);
    expect((await ledger(app, phoneN(2), { 'x-real-ip': '192.0.2.1' })).status).toBe(429);
    expect((await ledger(app, phoneN(2), { 'x-real-ip': '192.0.2.2' })).status).toBe(404);
  });

  it('takes the address from x-real-ip, then the last x-forwarded-for entry: a made-up front changes nothing', async () => {
    const { app } = makeApp({ limits: { browserPerAddress: 1 } });
    expect((await ledger(app, phoneN(1), { 'x-forwarded-for': '1.1.1.1, 203.0.113.7' })).status).toBe(404);
    expect((await ledger(app, phoneN(2), { 'x-forwarded-for': '2.2.2.2, 203.0.113.7' })).status).toBe(429);
    expect((await ledger(app, phoneN(3), { 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '9.9.9.9' })).status).toBe(429);
    expect((await ledger(app, phoneN(4), { 'x-real-ip': '203.0.113.8', 'x-forwarded-for': '203.0.113.7' })).status).toBe(404);
  });

  it('does not touch /health, which reads nothing', async () => {
    const { app } = makeApp({ limits: { browserPerAddress: 1 } });
    await ledger(app, phoneN(1));
    expect((await app.request('/health')).status).toBe(200);
  });

  it("is separate from the Africa's Talking routes' own count", async () => {
    const { app } = makeApp({ limits: { browserPerAddress: 1 } });
    await ledger(app, phoneN(1));
    expect((await postForm(app, '/sms', { from: '+254711000000', text: 'today' })).status).toBe(200);
  });
});

describe('the demo-shop limits are kept in the store, so every instance counts alike', () => {
  /** Two "instances": two apps with their own memory but one store, one pending store and one quota store. */
  function twoInstances(demoLimits: { perAddress?: number; perDay?: number; maxShops?: number } = {}) {
    const clock = makeClock();
    const store = new MemoryStore();
    const quota = new InMemoryDemoQuotaStore({ now: clock.now });
    const build = () =>
      createApp({ store, pending: new InMemoryPendingStore({ now: clock.now }), quota, now: clock.now, demoLimits });
    return { a: build(), b: build(), clock, store, quota };
  }
  const post = (app: Parameters<typeof postJson>[0], body: unknown, ip = '203.0.113.7') =>
    postJson(app, '/api/phone/demo', body, { 'x-real-ip': ip });

  it('holds the 10 an hour per address across instances: the 11th call is refused on whichever instance it reaches', async () => {
    const { a, b } = twoInstances();
    for (let i = 0; i < 10; i += 1) expect((await post(i % 2 ? a : b, {})).status).toBe(201);
    expect((await post(a, {})).status).toBe(429);
    expect((await post(b, {})).status).toBe(429);
    expect((await post(a, {}, '198.51.100.1')).status).toBe(201);
  });

  it('gives a Retry-After in seconds and counts the call that ended in 409', async () => {
    const { a, b } = twoInstances({ perAddress: 2 });
    expect((await post(a, { phone: DEMO_PHONE })).status).toBe(201);
    expect((await post(b, { phone: DEMO_PHONE })).status).toBe(409);
    const refused = await post(a, {});
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toMatch(/^\d+$/);
  });

  it('holds the daily ceiling across instances, counting shops that were made (not refused or 409 calls)', async () => {
    const { a, b } = twoInstances({ perDay: 3, perAddress: 100 });
    expect((await post(a, {}, '192.0.2.1')).status).toBe(201);
    expect((await post(b, { phone: DEMO_PHONE }, '192.0.2.2')).status).toBe(201);
    expect((await post(a, { phone: DEMO_PHONE }, '192.0.2.3')).status).toBe(409); // made nothing, so not counted
    expect((await post(b, {}, '192.0.2.4')).status).toBe(201);
    const full = await post(a, {}, '192.0.2.5');
    expect(full.status).toBe(503);
    expect(await full.json()).toEqual({ error: 'The demo is full right now. Please try again later.' });
    expect((await post(b, {}, '192.0.2.6')).status).toBe(503);
  });

  it('frees the daily ceiling after 24 hours', async () => {
    const { a, clock } = twoInstances({ perDay: 1, perAddress: 100 });
    expect((await post(a, {}, '192.0.2.1')).status).toBe(201);
    expect((await post(a, {}, '192.0.2.2')).status).toBe(503);
    clock.advance(24 * 3_600_000 + 1000);
    expect((await post(a, {}, '192.0.2.3')).status).toBe(201);
  });

  it('has a default ceiling of 1,000 shops a day', async () => {
    const { a, quota } = twoInstances({ perAddress: 100_000 });
    const spy = vi.spyOn(quota, 'madeToday');
    spy.mockResolvedValue(999);
    expect((await post(a, {})).status).toBe(201);
    spy.mockResolvedValue(1000);
    expect((await post(a, {}, '192.0.2.9')).status).toBe(503);
  });

  it('makes nothing and counts nothing for a refused call', async () => {
    const { a, store, quota } = twoInstances({ perAddress: 1 });
    await post(a, {});
    const made = await store.countShopsWithPhonePrefix('');
    expect((await post(a, {})).status).toBe(429);
    expect(await store.countShopsWithPhonePrefix('')).toBe(made);
    expect(await quota.madeToday()).toBe(1);
  });
});

describe('the address is kept only as a salted SHA-256 hash', () => {
  const ADDRESSES = ['203.0.113.7', '198.51.100.9', '2001:db8::1', 'unknown'];

  async function keysFor(salt?: string, headers: Record<string, string> = { 'x-real-ip': ADDRESSES[0]! }) {
    const clock = makeClock();
    const quota = new InMemoryDemoQuotaStore({ now: clock.now });
    const app = createApp({
      store: new MemoryStore(),
      pending: new InMemoryPendingStore({ now: clock.now }),
      quota,
      now: clock.now,
      ...(salt !== undefined ? { addressSalt: salt } : {})
    });
    await postJson(app, '/api/phone/demo', {}, headers);
    return quota.keys();
  }

  it('gives the store 64 hex digits, never the address, for every kind of address header', async () => {
    for (const address of ADDRESSES) {
      const keys = await keysFor(undefined, { 'x-real-ip': address });
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatch(/^[0-9a-f]{64}$/);
      expect(keys[0]).not.toContain(address);
    }
    const none = await keysFor(undefined, {});
    expect(none[0]).toMatch(/^[0-9a-f]{64}$/); // even the shared key "unknown" is hashed
  });

  it('is the SHA-256 of the salt and the address, and a different salt gives a different key', async () => {
    const [withSalt] = await keysFor('my-server-salt');
    expect(withSalt).toBe(addressKey(ADDRESSES[0]!, 'my-server-salt'));
    const [other] = await keysFor('another-salt');
    expect(other).not.toBe(withSalt);
  });

  it('uses a fixed built-in salt when none is set, so every instance counts alike', async () => {
    const [first] = await keysFor();
    const [second] = await keysFor();
    expect(first).toBe(second);
    expect(first).toBe(addressKey(ADDRESSES[0]!, DEFAULT_ADDRESS_SALT));
    const [blank] = await keysFor('   ');
    expect(blank).toBe(first);
  });

  it('keeps two addresses apart', () => {
    expect(addressKey('203.0.113.7', 's')).not.toBe(addressKey('203.0.113.8', 's'));
    expect(addressKey('a', 'bc')).not.toBe(addressKey('ab', 'c')); // salt and address cannot run into each other
  });
});

describe('the ceiling on model-reader calls: 200 an hour across all callers', () => {
  // A shop on the number, so the browser route reaches the handler.
  async function seeded(readerPerHour: number) {
    const reader = { read: vi.fn(async () => null) };
    const made = await makeShopApp({ reader, limits: { readerPerHour, browserPerAddress: 100_000 } }, [DEMO_PHONE]);
    return { ...made, reader };
  }
  const unreadable = (n: number) => `zzzz qqqq wwww ${n}`;
  const SORRY = /^Sorry, I did not get that/;

  it('asks the reader for the first calls and skips it beyond the ceiling, and the rules answer alone', async () => {
    const { app, reader } = await seeded(3);
    for (let i = 0; i < 3; i += 1) {
      const reply = (await (await postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: unreadable(i) })).json()) as { reply: string };
      expect(reply.reply).toMatch(SORRY);
    }
    expect(reader.read).toHaveBeenCalledTimes(3);
    const beyond = (await (await postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: unreadable(9) })).json()) as { reply: string };
    expect(reader.read).toHaveBeenCalledTimes(3); // not asked again
    expect(beyond.reply).toMatch(SORRY); // the rules' own answer
    // A message the rules can read is still read and saved.
    const sold = (await (await postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: 'sold 45 bread' })).json()) as { reply: string };
    expect(sold.reply).toMatch(/^Saved: sale R45/);
  });

  it('counts the browser and the Africa\'s Talking routes together', async () => {
    const { app, reader, store } = await seeded(2);
    await store.createShop({
      id: 'shop_at',
      name: 'AT shop',
      phone: '+254711000000',
      currency: 'KES',
      timeZone: 'Africa/Nairobi',
      createdAt: '2026-11-07T10:00:00.000Z'
    });
    await postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: unreadable(1) });
    await postForm(app, '/sms', { from: '+254711000000', text: unreadable(2) });
    await postForm(app, '/sms', { from: '+254711000000', text: unreadable(3) });
    expect(reader.read).toHaveBeenCalledTimes(2);
  });

  it('asks again once the hour has passed', async () => {
    const { app, reader, clock } = await seeded(1);
    await postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: unreadable(1) });
    await postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: unreadable(2) });
    expect(reader.read).toHaveBeenCalledTimes(1);
    clock.advance(3_600_001);
    await postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: unreadable(3) });
    expect(reader.read).toHaveBeenCalledTimes(2);
  });

  it('has a default of 200 an hour', async () => {
    const reader = { read: vi.fn(async () => null) };
    const phones = [1, 2, 3, 4, 5].map(phoneN);
    const { app } = await makeShopApp({ reader, limits: { browserPerAddress: 100_000 } }, phones);
    // 41 messages from each of 5 numbers (the limit per number is 60 a minute): 205 unreadable messages in all.
    for (let i = 0; i < 205; i += 1) {
      await postJson(app, '/api/phone/sms', { phone: phones[i % 5], text: unreadable(i) });
    }
    expect(reader.read).toHaveBeenCalledTimes(200);
  });

  it('does not change anything when no reader is set', async () => {
    const { app } = await makeShopApp();
    const reply = (await (await postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: unreadable(1) })).json()) as { reply: string };
    expect(reply.reply).toMatch(SORRY);
  });
});
