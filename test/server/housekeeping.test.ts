/**
 * Demo shops never expired, so the cap of 5,000 filled for good over the judging weeks. POST /api/phone/demo now
 * clears away the demo shops made more than 7 days ago (at most 200 a call) before it checks the cap. This is
 * housekeeping of invented demo data, not an edit of anyone's records: a shop on any other number is never touched.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Sql } from 'postgres';
import { createShop, type Shop } from '../../src/core/shops/types.js';
import { createSaleRecord } from '../../src/core/records/types.js';
import { MemoryStore } from '../../src/store/memory/store.js';
import type { PendingStore } from '../../src/channels/sms/pending.js';
import { DEMO_SWEEP_PER_CALL } from '../../src/server/constants.js';
import { PostgresPendingStore } from '../../src/store/postgres/pending.js';
import { DEMO_PHONE, OTHER_DEMO_PHONE, START, captureErrors, makeApp, postJson } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse(START);
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();
const demo = (body: unknown = {}) => (app: Parameters<typeof postJson>[0]) => postJson(app, '/api/phone/demo', body);

async function addShop(store: MemoryStore, phone: string, createdAt: string): Promise<Shop> {
  const shop = { ...createShop({ name: 'Shop', phone, currency: 'ZAR', timeZone: 'Africa/Johannesburg' }), createdAt };
  await store.createShop(shop);
  await store.appendRecord(createSaleRecord(shop.id, { amount: 4500, channel: 'sms', originalWords: 'sold 45', now: new Date(createdAt) }));
  return shop;
}

describe('POST /api/phone/demo clears away demo shops made more than 7 days ago', () => {
  it('removes an old demo shop and its records, keeps a newer one, and still makes the new shop', async () => {
    const store = new MemoryStore();
    const old = await addShop(store, '+27000001111', daysAgo(8));
    const recent = await addShop(store, '+27000002222', daysAgo(6));
    const { app } = makeApp({ store });

    expect((await demo({ phone: DEMO_PHONE })(app)).status).toBe(201);

    expect(await store.findShopByPhone('+27000001111')).toBeNull();
    expect(await store.listRecords(old.id)).toEqual([]);
    expect(await store.findShopByPhone('+27000002222')).toEqual(recent);
    expect(await store.listRecords(recent.id)).toHaveLength(1);
  });

  it('uses exactly 7 days: a shop made 7 days ago to the millisecond stays, one a millisecond older goes', async () => {
    const store = new MemoryStore();
    await addShop(store, '+27000001111', new Date(NOW - 7 * DAY).toISOString());
    await addShop(store, '+27000002222', new Date(NOW - 7 * DAY - 1).toISOString());
    const { app } = makeApp({ store });
    await demo()(app);
    expect(await store.findShopByPhone('+27000001111')).not.toBeNull();
    expect(await store.findShopByPhone('+27000002222')).toBeNull();
  });

  it('never removes a shop on a number that is not a demo number, whatever its age', async () => {
    const store = new MemoryStore();
    const shops = [];
    for (const phone of ['+254711000000', '+27711000000', '+27000111111', '+270000012345', '+2700000123']) {
      shops.push(await addShop(store, phone, '2020-01-01T00:00:00.000Z'));
    }
    const { app } = makeApp({ store });
    for (let i = 0; i < 3; i += 1) await demo()(app);
    for (const shop of shops) {
      expect(await store.findShopByPhone(shop.phone), shop.phone).toEqual(shop);
      expect(await store.listRecords(shop.id), shop.phone).toHaveLength(1);
    }
  });

  it('frees the cap: with the demo cap full of old shops, the call makes room and succeeds', async () => {
    const store = new MemoryStore();
    for (const n of ['0001', '0002', '0003']) await addShop(store, `+2700000${n}`, daysAgo(10));
    const { app } = makeApp({ store, demoLimits: { maxShops: 3 } });
    const res = await demo()(app);
    expect(res.status).toBe(201);
    expect(await store.countShopsWithPhonePrefix('+2700000')).toBe(1);
  });

  it('does not free the cap when the shops are not old, and the answer is still 503', async () => {
    const store = new MemoryStore();
    for (const n of ['0001', '0002', '0003']) await addShop(store, `+2700000${n}`, daysAgo(1));
    const { app } = makeApp({ store, demoLimits: { maxShops: 3 } });
    expect((await demo()(app)).status).toBe(503);
    expect(await store.countShopsWithPhonePrefix('+2700000')).toBe(3);
  });

  it('removes at most 50 shops a call, so the cost of one call is bounded', async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 120; i += 1) await addShop(store, `+2700000${String(i).padStart(4, '0')}`, daysAgo(9));
    const { app } = makeApp({ store });
    const spy = vi.spyOn(store, 'deleteExpiredDemoShops');
    expect((await demo({ phone: '+27000009999' })(app)).status).toBe(201);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![1]).toBe(50);
    expect(DEMO_SWEEP_PER_CALL).toBe(50);
    expect(await store.countShopsWithPhonePrefix('+2700000')).toBe(120 - 50 + 1);
    // The next calls take the rest.
    expect((await demo({ phone: '+27000009998' })(app)).status).toBe(201);
    expect(await store.countShopsWithPhonePrefix('+2700000')).toBe(120 - 100 + 2);
    expect((await demo({ phone: '+27000009997' })(app)).status).toBe(201);
    expect(await store.countShopsWithPhonePrefix('+2700000')).toBe(3);
  });

  it('keeps a shop a judge made until 7 days after it was made, and removes it after that', async () => {
    const store = new MemoryStore();
    const { app, clock } = makeApp({ store });
    expect((await demo({ phone: DEMO_PHONE })(app)).status).toBe(201);
    // The shop's createdAt is the time it was made; its oldest invented record is about 2 days earlier.
    const made = (await store.findShopByPhone(DEMO_PHONE))!;
    expect(made.createdAt).toBe(START);

    clock.advance(6 * DAY); // 6 days later another judge starts a demo: the sweep runs, the shop stays
    expect((await demo({ phone: OTHER_DEMO_PHONE })(app)).status).toBe(201);
    expect(await store.findShopByPhone(DEMO_PHONE)).toEqual(made);
    expect(await store.listRecords(made.id)).toHaveLength(17);

    clock.advance(DAY); // exactly 7 days after it was made: still kept
    expect((await demo({ phone: '+27000003333' })(app)).status).toBe(201);
    expect(await store.findShopByPhone(DEMO_PHONE)).toEqual(made);

    clock.advance(1); // a millisecond past 7 days: removed, with its records
    expect((await demo({ phone: '+27000004444' })(app)).status).toBe(201);
    expect(await store.findShopByPhone(DEMO_PHONE)).toBeNull();
    expect(await store.listRecords(made.id)).toEqual([]);
  });

  it('asks the store for the shops made before now minus 7 days, using the app clock', async () => {
    const store = new MemoryStore();
    const { app, clock } = makeApp({ store });
    const spy = vi.spyOn(store, 'deleteExpiredDemoShops');
    await demo()(app);
    expect(spy.mock.calls[0]![0]).toEqual(new Date(NOW - 7 * DAY));
    clock.advance(3 * DAY);
    await demo()(app);
    expect(spy.mock.calls[1]![0]).toEqual(new Date(NOW - 4 * DAY));
  });

  it('runs before the cap check, and not for a refused call (a 429 reads and writes no shop)', async () => {
    const store = new MemoryStore();
    const order: string[] = [];
    vi.spyOn(store, 'deleteExpiredDemoShops').mockImplementation(async () => {
      order.push('sweep');
      return [];
    });
    const count = store.countShopsWithPhonePrefix.bind(store);
    vi.spyOn(store, 'countShopsWithPhonePrefix').mockImplementation(async (prefix: string) => {
      order.push('count');
      return count(prefix);
    });
    const { app } = makeApp({ store, demoLimits: { perAddress: 1 } });
    await demo()(app);
    expect(order.slice(0, 2)).toEqual(['sweep', 'count']);
    order.length = 0;
    expect((await demo()(app)).status).toBe(429);
    expect(order).toEqual([]);
  });

  it('clears the waiting question of a shop it removes, and leaves the question of any other number', async () => {
    const store = new MemoryStore();
    await addShop(store, '+27000001111', daysAgo(9));
    const { app, pending, clock } = makeApp({ store });
    await pending.set('+27000001111', { kind: 'largeAmount', largeAmount: 1, createdAt: clock.now() });
    await pending.set('+254711000000', { kind: 'largeAmount', largeAmount: 1, createdAt: clock.now() });
    await demo()(app);
    expect(await pending.get('+27000001111')).toBeNull();
    expect(await pending.get('+254711000000')).not.toBeNull();
  });

  it('clears the waiting questions of all the shops it removes in one call, not one call for each shop', async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 50; i += 1) await addShop(store, `+2700000${String(i).padStart(4, '0')}`, daysAgo(9));
    const { app, pending, clock } = makeApp({ store });
    await pending.set('+27000000007', { kind: 'largeAmount', largeAmount: 1, createdAt: clock.now() });
    await pending.set('+254711000000', { kind: 'largeAmount', largeAmount: 1, createdAt: clock.now() });
    const clear = vi.spyOn(pending, 'clear');
    const clearMany = vi.spyOn(pending, 'clearMany');
    await demo({ phone: DEMO_PHONE })(app);
    expect(clear).not.toHaveBeenCalled();
    expect(clearMany).toHaveBeenCalledTimes(1);
    expect(clearMany.mock.calls[0]![0]).toHaveLength(50);
    expect(await pending.get('+27000000007')).toBeNull();
    expect(await pending.get('+254711000000')).not.toBeNull();
  });

  it('does not touch the pending store when the sweep removes nothing', async () => {
    const { app, pending } = makeApp();
    const spies = [vi.spyOn(pending, 'clear'), vi.spyOn(pending, 'clearMany')];
    await demo({ phone: DEMO_PHONE })(app);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('on the Postgres pending store, sends one statement for 50 removed shops and no per-shop call', async () => {
    // The Postgres ledger store already deletes the questions in the same transaction as the shops. Here the ledger
    // store is the memory one, so the shops are removed, and the pending store is the Postgres class on a fake `sql`.
    const statements: Array<{ text: string; values: unknown[] }> = [];
    const sql = Object.assign(
      vi.fn((first: unknown, ...values: unknown[]) => {
        if (Array.isArray(first) && 'raw' in first) {
          statements.push({ text: (first as unknown as string[]).join('?').replace(/\s+/g, ' ').trim(), values });
          return Promise.resolve([]);
        }
        return { list: first }; // sql([...phones]) used as a list helper
      }),
      {}
    ) as unknown as Sql;
    const pending: PendingStore = new PostgresPendingStore(sql);
    const clear = vi.spyOn(pending, 'clear');

    const store = new MemoryStore();
    for (let i = 0; i < 50; i += 1) await addShop(store, `+2700000${String(i).padStart(4, '0')}`, daysAgo(9));
    const { app } = makeApp({ store, pending });
    expect((await demo({ phone: DEMO_PHONE })(app)).status).toBe(201);

    expect(clear).not.toHaveBeenCalled();
    expect(statements).toHaveLength(1);
    expect(statements[0]!.text).toBe('delete from pending_questions where phone in ?');
    expect((statements[0]!.values[0] as { list: string[] }).list).toHaveLength(50);
  });

  it('lets a number that was cleared away be used for a new shop', async () => {
    const store = new MemoryStore();
    await addShop(store, DEMO_PHONE, daysAgo(9));
    const { app } = makeApp({ store });
    const res = await demo({ phone: DEMO_PHONE })(app);
    expect(res.status).toBe(201); // not 409: the old shop on that number was cleared first
    const shop = (await store.findShopByPhone(DEMO_PHONE))!;
    expect(await store.listRecords(shop.id)).toHaveLength(17);
  });

  it('does not stop the call when the housekeeping fails: the error is logged and the shop is made', async () => {
    const log = captureErrors();
    const store = new MemoryStore();
    vi.spyOn(store, 'deleteExpiredDemoShops').mockRejectedValue(new Error('housekeeping failed'));
    const { app } = makeApp({ store });
    expect((await demo({ phone: OTHER_DEMO_PHONE })(app)).status).toBe(201);
    expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toContain('housekeeping failed');
  });
});

describe('no code path deletes a non-demo shop or a single record', () => {
  it('the store method takes no prefix and no id: what counts as a demo shop is decided inside the store', () => {
    expect(MemoryStore.prototype.deleteExpiredDemoShops.length).toBe(2); // (createdBefore, maxShops) and nothing else
  });

  it('is the only way the stores remove anything: no method deletes by record id or by shop id', () => {
    const names = Object.getOwnPropertyNames(MemoryStore.prototype).filter((name) => /delete|remove|clear/i.test(name));
    expect(names.sort()).toEqual(['clear', 'deleteExpiredDemoShops']);
  });

  it('even a bad caller cannot widen it: a cutoff in the far future still keeps every non-demo shop', async () => {
    const store = new MemoryStore();
    const real = await addShop(store, '+254711000000', daysAgo(1000));
    await store.deleteExpiredDemoShops(new Date('2999-01-01T00:00:00.000Z'), Number.MAX_SAFE_INTEGER);
    expect(await store.findShopByPhone('+254711000000')).toEqual(real);
    expect(await store.listRecords(real.id)).toHaveLength(1);
  });
});

describe('the source: where shops and records can be removed', () => {
  const root = new URL('../../src/', import.meta.url);

  async function sourceFiles(dir = root, found: string[] = []): Promise<string[]> {
    const { readdirSync, statSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    for (const name of readdirSync(dir)) {
      const url = new URL(name + (statSync(new URL(name, dir)).isDirectory() ? '/' : ''), dir);
      if (name.endsWith('/')) continue;
      if (statSync(url).isDirectory()) await sourceFiles(url, found);
      else if (name.endsWith('.ts')) found.push(fileURLToPath(url));
    }
    return found;
  }

  it('only src/store/postgres/store.ts has SQL that deletes shops or records, and only the one method uses it', async () => {
    const { readFileSync } = await import('node:fs');
    const code = (file: string) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const withDelete = (await sourceFiles()).filter((file) => /delete\s+from\s+(shops|records)\b/i.test(code(file)));
    expect(withDelete.map((file) => file.replace(/^.*\/src\//, 'src/'))).toEqual(['src/store/postgres/store.ts']);
    const text = code(withDelete[0]!);
    expect(text.match(/delete\s+from\s+(shops|records)\b/gi)).toHaveLength(2); // records, then shops, in one method
  });

  it('only the demo route calls the housekeeping', async () => {
    const { readFileSync } = await import('node:fs');
    const callers = (await sourceFiles())
      .filter((file) => /\.deleteExpiredDemoShops\(|deleteExpiredDemoShops:/.test(readFileSync(file, 'utf8')))
      .map((file) => file.replace(/^.*\/src\//, 'src/'))
      .sort();
    // The two stores define it, the interface declares it, limit.ts passes it through, and the demo route calls it.
    expect(callers).toEqual(['src/server/routes/browser.ts', 'src/store/limit.ts']);
  });
});
