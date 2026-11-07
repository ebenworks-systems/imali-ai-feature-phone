import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Sql } from 'postgres';
import { PostgresDemoQuotaStore } from '../../../src/store/postgres/quota.js';
import { QuotaKeyError } from '../../../src/store/quota.js';
import { describePostgres } from '../../helpers/pg.js';
import { KEY_A, runDemoQuotaContract } from '../quota.js';

describePostgres('PostgresDemoQuotaStore', (db) => {
  runDemoQuotaContract('DemoQuotaStore checks', {
    make: async (clock) => {
      await db().truncate();
      return new PostgresDemoQuotaStore(db().sql, { now: () => clock.now });
    }
  });
});

/**
 * A fake `sql` that records each statement and the values given to it, and gives prepared answers, so the shape of
 * the statements is checked without a database. `begin` runs its function with a transaction that records too.
 */
function fakeSql(...answers: unknown[][]) {
  const log: Array<{ where: 'sql' | 'tx'; text: string; values: unknown[] }> = [];
  let began = 0;
  const make = (where: 'sql' | 'tx') =>
    vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      log.push({ where, text: strings.join('?'), values });
      return answers.shift() ?? [];
    });
  const tx = make('tx');
  const sql = Object.assign(make('sql'), {
    begin: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      began += 1;
      return fn(tx);
    })
  });
  return { sql: sql as unknown as Sql, log, began: () => began };
}

const NOW = new Date('2026-11-07T10:00:00.000Z');
const now = () => NOW;
const HOURLY = { limit: 10, windowMs: 3_600_000 };

describe('PostgresDemoQuotaStore (fake sql, no connection)', () => {
  it('claims in one transaction: the lock on the key, the count, then the insert', async () => {
    const { sql, log, began } = fakeSql([], [], [{ n: 9, oldest: null }], []);
    expect(await new PostgresDemoQuotaStore(sql, { now }).claimCall(KEY_A, HOURLY)).toEqual({ allowed: true });
    expect(began()).toBe(1);
    const inTx = log.filter((entry) => entry.where === 'tx');
    expect(inTx[0]!.text).toMatch(/pg_advisory_xact_lock/);
    expect(inTx[0]!.values).toEqual([KEY_A]);
    expect(inTx[1]!.text).toMatch(/select count\(\*\)::int as n, min\(happened_at\) as oldest from demo_quota/);
    expect(inTx[1]!.text).toMatch(/address_hash = \? and kind = 'call'/);
    expect(inTx[2]!.text).toMatch(/insert into demo_quota \(address_hash, kind, happened_at\)/);
    expect(inTx[2]!.values[0]).toBe(KEY_A);
  });

  it('prunes rows older than 24 hours first, in a small batch, outside the lock and without waiting', async () => {
    const { sql, log } = fakeSql([], [], [{ n: 0, oldest: null }], []);
    await new PostgresDemoQuotaStore(sql, { now }).claimCall(KEY_A, HOURLY);
    expect(log[0]!.where).toBe('sql');
    expect(log[0]!.text).toMatch(/delete from demo_quota where id in \(\s*select id from demo_quota where happened_at < \?::timestamptz order by id limit \?\s+for update skip locked\)/);
    expect(log[0]!.values).toEqual(['2026-11-06T10:00:00.000Z', 500]);
  });

  it('inserts nothing and says how long to wait when the key is at its limit', async () => {
    const oldest = new Date(NOW.getTime() - 50 * 60_000);
    const { sql, log } = fakeSql([], [], [{ n: 10, oldest }]);
    expect(await new PostgresDemoQuotaStore(sql, { now }).claimCall(KEY_A, HOURLY)).toEqual({
      allowed: false,
      retryAfterSeconds: 10 * 60
    });
    expect(log.some((entry) => /insert into/.test(entry.text))).toBe(false);
  });

  it('counts only calls inside the window', async () => {
    const { sql, log } = fakeSql([], [], [{ n: 0, oldest: null }], []);
    await new PostgresDemoQuotaStore(sql, { now }).claimCall(KEY_A, HOURLY);
    const count = log.find((entry) => /count\(\*\)/.test(entry.text))!;
    expect(count.values).toEqual([KEY_A, '2026-11-07T09:00:00.000Z']);
  });

  it('refuses a key that is not a hash before it sends any statement', async () => {
    const { sql, log, began } = fakeSql();
    const store = new PostgresDemoQuotaStore(sql, { now });
    await expect(store.claimCall('203.0.113.7', HOURLY)).rejects.toBeInstanceOf(QuotaKeyError);
    await expect(store.noteMade('203.0.113.7')).rejects.toBeInstanceOf(QuotaKeyError);
    expect(log).toEqual([]);
    expect(began()).toBe(0);
  });

  it('notes a made shop with the key and the time, and counts the made shops of the last 24 hours', async () => {
    const { sql, log } = fakeSql([], [{ n: 7 }]);
    const store = new PostgresDemoQuotaStore(sql, { now });
    await store.noteMade(KEY_A);
    expect(log[0]!.text).toMatch(/insert into demo_quota \(address_hash, kind, happened_at\) values \(\?, 'made', \?::timestamptz\)/);
    expect(log[0]!.values).toEqual([KEY_A, NOW.toISOString()]);
    expect(await store.madeToday()).toBe(7);
    expect(log[1]!.text).toMatch(/kind = 'made' and happened_at > /);
    expect(log[1]!.values).toEqual(['2026-11-06T10:00:00.000Z']);
  });
});

describe('sql/002_demo_quota.sql', () => {
  const text = readFileSync(new URL('../../../sql/002_demo_quota.sql', import.meta.url), 'utf8');
  const code = text.replace(/--.*$/gm, '');

  it('has no begin or commit, and creates the one table', () => {
    expect(code).not.toMatch(/^\s*(begin|commit)\b/im);
    expect(code).toMatch(/create table demo_quota \(/);
  });

  it('keeps a hash and never an address: the column only accepts 64 hex digits', () => {
    expect(code).toMatch(/address_hash\s+text not null check \(address_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(code).not.toMatch(/\b(ip|ip_address|address)\s+(text|inet|varchar)/i);
  });

  it('is applied after 001 and does not touch the first file', () => {
    expect(code).not.toMatch(/alter table (shops|records|pending_questions|processed_texts)/i);
  });
});
