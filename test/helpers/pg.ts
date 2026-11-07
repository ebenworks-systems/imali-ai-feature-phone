/**
 * A throwaway schema for the Postgres tests.
 *
 * The tests run only when TEST_DATABASE_URL is set. Each suite makes a schema named `t_` plus random hex, applies
 * `sql/` inside it, and drops it at the end, so the tests never read or change data in other schemas.
 * `search_path` is sent as a start-up parameter, so TEST_DATABASE_URL must be a direct connection, not Neon's pooled one.
 */

import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe } from 'vitest';
import postgres, { type Sql } from 'postgres';
// @ts-expect-error The script is plain JavaScript and has no type declarations.
import { applyMigrations } from '../../scripts/migrate.mjs';

const SQL_DIR = fileURLToPath(new URL('../../sql/', import.meta.url));

export interface TestDatabase {
  sql: Sql;
  schema: string;
  /** Empties all four tables. */
  truncate(): Promise<void>;
  /** Drops the schema and closes the connection. */
  drop(): Promise<void>;
}

/** Names the missing variable once, so a skipped suite tells the reader how to run it. */
export const SKIP_NOTE = 'skipped: set TEST_DATABASE_URL to run';

export async function createTestDatabase(url: string, options: { migrate?: boolean } = {}): Promise<TestDatabase> {
  const schema = `t_${randomBytes(6).toString('hex')}`; // hex only, so it is safe in a statement
  const admin = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await admin.unsafe(`create schema ${schema}`);
  } finally {
    await admin.end({ timeout: 5 });
  }

  const sql = postgres(url, {
    max: 3,
    prepare: false,
    onnotice: () => {},
    connection: { search_path: schema }
  });
  if (options.migrate !== false) {
    await applyMigrations(sql, SQL_DIR);
  }

  return {
    sql,
    schema,
    async truncate() {
      await sql.unsafe('truncate records, shops, pending_questions, processed_texts restart identity cascade');
    },
    async drop() {
      await sql.end({ timeout: 5 });
      const cleaner = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
      try {
        await cleaner.unsafe(`drop schema if exists ${schema} cascade`);
      } finally {
        await cleaner.end({ timeout: 5 });
      }
    }
  };
}

/**
 * `describe` for a suite that needs a database. Without TEST_DATABASE_URL the suite is skipped and its name says why
 * (`vitest --reporter=verbose` shows it). With it, the suite gets a schema of its own, dropped at the end.
 */
export function describePostgres(
  name: string,
  body: (db: () => TestDatabase) => void,
  options: { migrate?: boolean } = {}
): void {
  const url = process.env.TEST_DATABASE_URL?.trim();
  if (!url) {
    describe.skip(`${name} (${SKIP_NOTE})`, () => body(() => {
      throw new Error(`TEST_DATABASE_URL is not set`);
    }));
    return;
  }
  describe(name, () => {
    let db: TestDatabase | undefined;
    beforeAll(async () => {
      db = await createTestDatabase(url, options);
    }, 60_000);
    afterAll(async () => {
      await db?.drop();
    }, 60_000);
    body(() => {
      if (!db) throw new Error('The test database is not ready');
      return db;
    });
  });
}
