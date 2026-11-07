/**
 * DemoQuotaStore on Postgres: the table `demo_quota` (sql/002_demo_quota.sql).
 *
 * - `claimCall` runs in one transaction that first takes an advisory lock on the key (`pg_advisory_xact_lock`), so two
 *   instances claiming for the same address cannot both read "9 calls" and both write the 10th. The lock is released
 *   at the end of the transaction, which also makes it safe through a pooled connection.
 * - Old rows (more than 24 hours) are removed in small batches before the claim, with `for update skip locked`, so
 *   two instances pruning at once never wait for each other.
 * - Times come from the injected clock, not the database clock, as in the other Postgres stores.
 * - The table only accepts a key shaped like a SHA-256 hash, and so does this class, so an address cannot reach it.
 */

import type { Sql } from 'postgres';
import { assertQuotaKey, QUOTA_KEEP_MS, type DemoQuotaStore, type QuotaClaim } from '../quota.js';

export interface PostgresDemoQuotaOptions {
  /** The time source. Defaults to the system clock. */
  now?: () => Date;
}

/** The most old rows one claim removes. The rest go on the next claim. */
const PRUNE_BATCH = 500;

export class PostgresDemoQuotaStore implements DemoQuotaStore {
  private readonly now: () => Date;

  constructor(
    private readonly sql: Sql,
    options: PostgresDemoQuotaOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async claimCall(key: string, options: { limit: number; windowMs: number }): Promise<QuotaClaim> {
    assertQuotaKey(key);
    const now = this.now();
    const nowMs = now.getTime();
    const keepFrom = new Date(nowMs - Math.max(options.windowMs, QUOTA_KEEP_MS)).toISOString();
    const windowStart = new Date(nowMs - options.windowMs).toISOString();
    const at = now.toISOString();

    await this.sql`
      delete from demo_quota where id in (
        select id from demo_quota where happened_at < ${keepFrom}::timestamptz order by id limit ${PRUNE_BATCH}
        for update skip locked)`;

    return await this.sql.begin(async (tx): Promise<QuotaClaim> => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      const rows = await tx<Array<{ n: number | string; oldest: Date | string | null }>>`
        select count(*)::int as n, min(happened_at) as oldest from demo_quota
        where address_hash = ${key} and kind = 'call' and happened_at > ${windowStart}::timestamptz`;
      const n = Number(rows[0]?.n ?? 0);
      if (n >= options.limit) {
        const oldest = rows[0]?.oldest ? new Date(rows[0].oldest).getTime() : nowMs;
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + options.windowMs - nowMs) / 1000)) };
      }
      await tx`insert into demo_quota (address_hash, kind, happened_at) values (${key}, 'call', ${at}::timestamptz)`;
      return { allowed: true };
    });
  }

  async noteMade(key: string): Promise<void> {
    assertQuotaKey(key);
    await this.sql`
      insert into demo_quota (address_hash, kind, happened_at) values (${key}, 'made', ${this.now().toISOString()}::timestamptz)`;
  }

  async madeToday(): Promise<number> {
    const since = new Date(this.now().getTime() - QUOTA_KEEP_MS).toISOString();
    const rows = await this.sql<Array<{ n: number | string }>>`
      select count(*)::int as n from demo_quota where kind = 'made' and happened_at > ${since}::timestamptz`;
    return Number(rows[0]?.n ?? 0);
  }
}
