/**
 * How often each client address may make demo shops, and how many demo shops the whole site may make a day.
 *
 * These counts are kept in the store, not in the memory of one running instance, so they hold across serverless
 * instances. The address is never kept: the caller passes a key that is a SHA-256 hash of the address with a
 * server-side salt (see `src/server/address.ts`), and this store only ever sees and keeps that hash.
 *
 * - `claimCall`: one call to `POST /api/phone/demo` from a key. Every call that is allowed counts (a call that ends
 *   in 409 counts too). A refused call is not counted, so it does not extend its own wait.
 * - `noteMade` and `madeToday`: the demo shops that were really made, for the site-wide ceiling per day.
 * - Rows older than 24 hours are removed as part of a claim.
 *
 * The memory version is here; the Postgres version is in `postgres/quota.ts` and must behave the same.
 */

/** How long a count is kept: the longest window anything asks about, 24 hours. */
export const QUOTA_KEEP_MS = 24 * 60 * 60 * 1000;

export type QuotaClaim = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface DemoQuotaStore {
  /** Counts one call from `key`, unless the key already has `limit` counted calls in the last `windowMs`. */
  claimCall(key: string, options: { limit: number; windowMs: number }): Promise<QuotaClaim>;
  /** Notes that `key` made a demo shop. */
  noteMade(key: string): Promise<void>;
  /** Demo shops made by all addresses in the last 24 hours. */
  madeToday(): Promise<number>;
}

/** What a key must look like: 64 lower-case hex digits (a SHA-256 hash). Raw addresses are refused by the stores. */
export const QUOTA_KEY_PATTERN = /^[0-9a-f]{64}$/;

export class QuotaKeyError extends Error {
  constructor() {
    super('A quota key must be a SHA-256 hash (64 hex digits), never an address');
    this.name = 'QuotaKeyError';
  }
}

export function assertQuotaKey(key: string): void {
  if (!QUOTA_KEY_PATTERN.test(key)) throw new QuotaKeyError();
}

export interface InMemoryDemoQuotaStoreOptions {
  /** The time source. Defaults to the system clock. */
  now?: () => Date;
}

export class InMemoryDemoQuotaStore implements DemoQuotaStore {
  private readonly calls = new Map<string, number[]>();
  private made: number[] = [];
  private readonly now: () => Date;

  constructor(options: InMemoryDemoQuotaStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  /** The keys held right now. For tests: they must all be hashes. */
  keys(): string[] {
    return [...this.calls.keys()];
  }

  async claimCall(key: string, options: { limit: number; windowMs: number }): Promise<QuotaClaim> {
    assertQuotaKey(key);
    const nowMs = this.now().getTime();
    this.prune(nowMs, options.windowMs);

    const inWindow = (this.calls.get(key) ?? []).filter((t) => t > nowMs - options.windowMs);
    if (inWindow.length >= options.limit) {
      this.calls.set(key, inWindow);
      const oldest = inWindow[0] as number;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + options.windowMs - nowMs) / 1000)) };
    }
    inWindow.push(nowMs);
    this.calls.set(key, inWindow);
    return { allowed: true };
  }

  async noteMade(key: string): Promise<void> {
    assertQuotaKey(key);
    this.made.push(this.now().getTime());
  }

  async madeToday(): Promise<number> {
    const cutoff = this.now().getTime() - QUOTA_KEEP_MS;
    this.made = this.made.filter((t) => t > cutoff);
    return this.made.length;
  }

  private prune(nowMs: number, windowMs: number): void {
    const cutoff = nowMs - Math.max(windowMs, QUOTA_KEEP_MS);
    for (const [key, times] of this.calls) {
      const kept = times.filter((t) => t > cutoff);
      if (kept.length === 0) this.calls.delete(key);
      else if (kept.length !== times.length) this.calls.set(key, kept);
    }
    this.made = this.made.filter((t) => t > cutoff);
  }
}
