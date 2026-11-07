import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sql } from 'postgres';
import { PostgresPendingStore } from '../../../src/store/postgres/pending.js';
import { PostgresStore } from '../../../src/store/postgres/store.js';
import { createShop } from '../../../src/core/shops/types.js';
import { createSaleRecord } from '../../../src/core/records/types.js';
import { describePostgres } from '../../helpers/pg.js';

const CUTOFF = new Date('2026-10-31T10:00:00.000Z');

/**
 * A fake `sql` that records each statement and its values and gives prepared answers, so the statements of
 * `deleteExpiredDemoShops` are checked without a database. `begin` runs its function with a transaction `tx`, which
 * is both a tag (a statement) and a helper (`tx(list)` for `in ${tx(list)}`), as in the `postgres` package.
 */
function fakeSql(...answers: unknown[][]) {
  const log: Array<{ text: string; values: unknown[] }> = [];
  let began = 0;
  const tx = Object.assign(
    vi.fn((first: unknown, ...values: unknown[]) => {
      if (Array.isArray(first) && 'raw' in first) {
        log.push({ text: (first as unknown as string[]).join('?'), values });
        return Promise.resolve(answers.shift() ?? []);
      }
      return { list: first };
    }),
    {}
  );
  const sql = {
    begin: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      began += 1;
      return fn(tx);
    })
  };
  return { sql: sql as unknown as Sql, log, began: () => began };
}

const SHOPS = [
  { id: 'shop_1', phone: '+27000000001' },
  { id: 'shop_2', phone: '+27000000002' }
];

describe('PostgresStore.deleteExpiredDemoShops (fake sql, no connection)', () => {
  it('does everything in one transaction: pending questions, then records, then the shops', async () => {
    const { sql, log, began } = fakeSql(SHOPS, [], [], []);
    const phones = await new PostgresStore(sql).deleteExpiredDemoShops(CUTOFF, 200);

    expect(phones).toEqual(['+27000000001', '+27000000002']);
    expect(began()).toBe(1);
    expect(log).toHaveLength(4);
    expect(log[1]!.text).toMatch(/^\s*delete from pending_questions where phone in \?$/);
    expect(log[2]!.text).toMatch(/^\s*delete from records where shop_id in \?$/);
    expect(log[3]!.text).toMatch(/^\s*delete from shops where id in \? and phone ~ \?$/);
  });

  it('selects only demo numbers older than the cutoff, oldest first, locked, with the limit', async () => {
    const { sql, log } = fakeSql(SHOPS, [], [], []);
    await new PostgresStore(sql).deleteExpiredDemoShops(CUTOFF, 200);

    expect(log[0]!.text).toMatch(/from shops\s+where phone ~ \? and created_at < \?::timestamptz\s+order by created_at, id\s+limit \?\s+for update/);
    // The pattern is the store's own: the whole number, the prefix and exactly four digits. The caller supplies none.
    expect(log[0]!.values).toEqual(['^\\+2700000[0-9]{4}$', CUTOFF.toISOString(), 200]);
  });

  it('repeats the demo test on the delete of the shops, so no statement can remove a shop on another number', async () => {
    const { sql, log } = fakeSql(SHOPS, [], [], []);
    await new PostgresStore(sql).deleteExpiredDemoShops(CUTOFF, 200);
    expect(log[3]!.values).toEqual([{ list: ['shop_1', 'shop_2'] }, '^\\+2700000[0-9]{4}$']);
  });

  it('removes records only by the shops it selected, all in one statement, never one record by its id', async () => {
    const { sql, log } = fakeSql(SHOPS, [], [], []);
    await new PostgresStore(sql).deleteExpiredDemoShops(CUTOFF, 200);
    expect(log[1]!.values).toEqual([{ list: ['+27000000001', '+27000000002'] }]);
    expect(log[2]!.values).toEqual([{ list: ['shop_1', 'shop_2'] }]);
    for (const entry of log) expect(entry.text).not.toMatch(/delete from records where (id|seq|reverses_record_id)\b/);
  });

  it('stops after the select when there is nothing to remove', async () => {
    const { sql, log, began } = fakeSql([]);
    expect(await new PostgresStore(sql).deleteExpiredDemoShops(CUTOFF, 200)).toEqual([]);
    expect(began()).toBe(1);
    expect(log).toHaveLength(1);
  });

  it('never asks for more than 1000 shops, whatever the caller says', async () => {
    const { sql, log } = fakeSql([]);
    await new PostgresStore(sql).deleteExpiredDemoShops(CUTOFF, 1_000_000);
    expect(log[0]!.values[2]).toBe(1000);
  });

  it.each([0, -3, Number.NaN])('sends nothing at all for a limit of %s', async (limit) => {
    const { sql, log, began } = fakeSql();
    expect(await new PostgresStore(sql).deleteExpiredDemoShops(CUTOFF, limit)).toEqual([]);
    expect(began()).toBe(0);
    expect(log).toEqual([]);
  });

  it('sends nothing for a cutoff that is not a real date', async () => {
    const { sql, log, began } = fakeSql();
    expect(await new PostgresStore(sql).deleteExpiredDemoShops(new Date('nope'), 200)).toEqual([]);
    expect(began()).toBe(0);
    expect(log).toEqual([]);
  });
});

describePostgres('PostgresStore.deleteExpiredDemoShops, with pending questions', (db) => {
  const DAY = 24 * 60 * 60 * 1000;
  let store: PostgresStore;
  let pending: PostgresPendingStore;
  const now = new Date('2026-11-07T10:00:00.000Z');

  beforeEach(async () => {
    await db().truncate();
    store = new PostgresStore(db().sql);
    pending = new PostgresPendingStore(db().sql, { now: () => now });
  });

  it("removes the shop's waiting question with it, and leaves the question of any other number", async () => {
    const old = { ...createShop({ name: 'Old', phone: '+27000001234', currency: 'ZAR', timeZone: 'Africa/Johannesburg' }), createdAt: new Date(now.getTime() - 9 * DAY).toISOString() };
    const real = { ...createShop({ name: 'Real', phone: '+254711000000', currency: 'ZAR', timeZone: 'Africa/Johannesburg' }), createdAt: new Date(now.getTime() - 99 * DAY).toISOString() };
    await store.createShop(old);
    await store.createShop(real);
    await store.appendRecord(createSaleRecord(old.id, { amount: 100, channel: 'sms', originalWords: 'x', now }));
    await pending.set('+27000001234', { kind: 'largeAmount', largeAmount: 1, createdAt: now });
    await pending.set('+254711000000', { kind: 'largeAmount', largeAmount: 1, createdAt: now });

    expect(await store.deleteExpiredDemoShops(new Date(now.getTime() - 7 * DAY), 200)).toEqual(['+27000001234']);

    expect(await pending.get('+27000001234')).toBeNull();
    expect(await pending.get('+254711000000')).not.toBeNull();
    expect(await store.findShopByPhone('+254711000000')).toEqual(real);
  });
});
