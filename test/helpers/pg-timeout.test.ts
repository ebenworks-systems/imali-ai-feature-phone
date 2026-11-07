import { describe, expect, it, vi } from 'vitest';

/**
 * describePostgres gives its tests 30 s and its hooks 60 s. Run here with a fake `postgres` and a stubbed
 * TEST_DATABASE_URL, so no database is needed. The fake accepts the schema the helper asks for.
 */
vi.hoisted(() => {
  process.env.TEST_DATABASE_URL = 'postgres://fake.invalid/none';
});

vi.mock('postgres', () => ({
  default: (_url: string, options: { connection?: { options?: string } }) => ({
    unsafe: async (query: string) => {
      if (query !== 'show search_path') return [];
      const match = /-c search_path=(\S+)/.exec(options.connection?.options ?? '');
      return [{ search_path: match ? match[1] : '"$user", public' }];
    },
    end: async () => {}
  })
}));
vi.mock('../../scripts/migrate.mjs', () => ({ applyMigrations: async () => [] }));

import { POSTGRES_HOOK_TIMEOUT_MS, POSTGRES_TEST_TIMEOUT_MS, describePostgres } from './pg.js';

const seen: Record<string, number | undefined> = {};

describePostgres('a suite built on describePostgres', (db) => {
  it('has the 30 s test timeout without setting one itself', ({ task }) => {
    seen.test = task.timeout;
    expect(db().schema).toMatch(/^t_[0-9a-f]{12}$/);
  });
});

describe('describePostgres timeouts', () => {
  it('uses 30 s for tests and 60 s for hooks', () => {
    expect(POSTGRES_TEST_TIMEOUT_MS).toBe(30_000);
    expect(POSTGRES_HOOK_TIMEOUT_MS).toBe(60_000);
  });

  it('gave the suite test the 30 s timeout (the suite above has already run)', () => {
    expect(seen.test).toBe(30_000);
  });
});
