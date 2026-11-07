import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Drives createTestDatabase with a fake `postgres` so no database is needed. The fake answers `show search_path`
 * the way Neon's proxy does when it drops the start-up parameter: with `"$user", public`.
 */
const calls = vi.hoisted(() => ({
  connects: [] as Array<{ url: string; options: Record<string, unknown> }>,
  statements: [] as string[],
  searchPath: { value: '' as string | ((options: Record<string, unknown>) => string) }
}));

vi.mock('postgres', () => ({
  default: (url: string, options: Record<string, unknown>) => {
    calls.connects.push({ url, options });
    const answer = calls.searchPath.value;
    return {
      unsafe: async (query: string) => {
        calls.statements.push(query);
        if (query === 'show search_path') {
          const value = typeof answer === 'function' ? answer(options) : answer;
          return [{ search_path: value }];
        }
        return [];
      },
      end: async () => {}
    };
  }
}));

const applied = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../scripts/migrate.mjs', () => ({
  applyMigrations: async () => {
    applied.count += 1;
  }
}));

import { assertSearchPath, createTestDatabase, schemaConnection } from './pg.js';

beforeEach(() => {
  calls.connects.length = 0;
  calls.statements.length = 0;
  applied.count = 0;
});

/** What a server that honours the libpq `options` parameter answers. */
function honoursOptions(options: Record<string, unknown>): string {
  const connection = options.connection as { options?: string } | undefined;
  const match = /-c search_path=(\S+)/.exec(connection?.options ?? '');
  return match ? match[1] : '"$user", public';
}

describe('schemaConnection', () => {
  it('sends the schema in the libpq options parameter, not as a bare search_path', () => {
    expect(schemaConnection('t_ab12')).toEqual({ options: '-c search_path=t_ab12' });
  });
});

describe('assertSearchPath', () => {
  it('passes when the server answers exactly the schema', async () => {
    const sql = { unsafe: async () => [{ search_path: 't_ab12' }] };
    await expect(assertSearchPath(sql, 't_ab12')).resolves.toBeUndefined();
  });

  it('throws a clear error for the answer a dropped parameter gives', async () => {
    const sql = { unsafe: async () => [{ search_path: '"$user", public' }] };
    await expect(assertSearchPath(sql, 't_ab12')).rejects.toThrow(/t_ab12.*"\\"\$user\\", public"/);
  });

  it('throws when the schema is only part of the answer', async () => {
    const sql = { unsafe: async () => [{ search_path: 't_ab12, public' }] };
    await expect(assertSearchPath(sql, 't_ab12')).rejects.toThrow('not in its own schema');
  });
});

describe('createTestDatabase', () => {
  it('connects with the options parameter and migrates inside the schema', async () => {
    calls.searchPath.value = honoursOptions;
    const db = await createTestDatabase('postgres://fake/db');
    const suite = calls.connects[1].options.connection as Record<string, unknown>;
    expect(suite).toEqual({ options: `-c search_path=${db.schema}` });
    expect(suite).not.toHaveProperty('search_path');
    expect(applied.count).toBe(1);
  });

  it('throws before any migration when the server drops the option, and drops the schema it made', async () => {
    calls.searchPath.value = '"$user", public';
    await expect(createTestDatabase('postgres://fake/db')).rejects.toThrow(/not in its own schema/);
    expect(applied.count).toBe(0);
    expect(calls.statements.some((s) => /^drop schema if exists t_[0-9a-f]{12} cascade$/.test(s))).toBe(true);
  });

  it('checks the search path even when the suite skips migrations', async () => {
    calls.searchPath.value = '"$user", public';
    await expect(createTestDatabase('postgres://fake/db', { migrate: false })).rejects.toThrow(/not in its own schema/);
  });
});
