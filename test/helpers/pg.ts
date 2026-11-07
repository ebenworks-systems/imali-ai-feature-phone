/**
 * A throwaway schema for the Postgres tests.
 *
 * The tests run only when TEST_DATABASE_URL is set. Each suite makes a schema named `t_` plus random hex, applies
 * `sql/` inside it, and drops it at the end, so the tests never read or change data in other schemas.
 *
 * The schema is chosen with the libpq `options` start-up parameter (`-c search_path=<schema>`). Neon's proxy drops a
 * plain `search_path` start-up parameter but honours `options`, and plain PostgreSQL honours both. Right after
 * connecting, the helper runs `show search_path` and throws if the answer is not exactly the suite's schema, before
 * any migration or test runs. A pooled URL, or any proxy that drops the option, therefore stops the suite with a
 * clear error and can never write into `public`.
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
  /** Empties all five tables. */
  truncate(): Promise<void>;
  /** Drops the schema and closes the connection. */
  drop(): Promise<void>;
}

/** The start-up parameters that put a connection in `schema` (hex names only, so safe to put in the option). */
export function schemaConnection(schema: string): { options: string } {
  return { options: `-c search_path=${schema}` };
}

/**
 * Throws unless the connection's `search_path` is exactly `schema`. The error names the schema and what the
 * server answered, and says what to check.
 */
export async function assertSearchPath(
  sql: { unsafe(query: string): PromiseLike<ReadonlyArray<Record<string, unknown>>> },
  schema: string
): Promise<void> {
  const rows = await sql.unsafe('show search_path');
  const actual = rows[0]?.search_path;
  if (actual !== schema) {
    throw new Error(
      `The test connection is not in its own schema: expected search_path "${schema}" but the server says ` +
        `${JSON.stringify(actual ?? null)}. Nothing was migrated or run. TEST_DATABASE_URL must be a direct ` +
        `connection (not Neon's pooled one) to a server that honours the "options" start-up parameter.`
    );
  }
}

/**
 * A test against a remote database (Neon) can take several seconds for one round trip plus its work: one took 5.6 s
 * against vitest's default of 5 s. Every test in a `describePostgres` suite gets 30 s, and its hooks get 60 s, so the
 * tests themselves carry no timeout.
 */
export const POSTGRES_TEST_TIMEOUT_MS = 30_000;
export const POSTGRES_HOOK_TIMEOUT_MS = 60_000;

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
    connection: schemaConnection(schema)
  });
  try {
    await assertSearchPath(sql, schema);
    if (options.migrate !== false) {
      await applyMigrations(sql, SQL_DIR);
    }
  } catch (error) {
    await dropSchema(url, schema, sql);
    throw error;
  }

  return {
    sql,
    schema,
    async truncate() {
      await sql.unsafe('truncate records, shops, pending_questions, processed_texts, demo_quota restart identity cascade');
    },
    async drop() {
      await dropSchema(url, schema, sql);
    }
  };
}

/** Closes the suite's connection, then drops its schema from a separate connection. */
async function dropSchema(url: string, schema: string, sql: Sql): Promise<void> {
  await sql.end({ timeout: 5 });
  const cleaner = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await cleaner.unsafe(`drop schema if exists ${schema} cascade`);
  } finally {
    await cleaner.end({ timeout: 5 });
  }
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
  describe(name, { timeout: POSTGRES_TEST_TIMEOUT_MS }, () => {
    let db: TestDatabase | undefined;
    beforeAll(async () => {
      db = await createTestDatabase(url, options);
    }, POSTGRES_HOOK_TIMEOUT_MS);
    afterAll(async () => {
      await db?.drop();
    }, POSTGRES_HOOK_TIMEOUT_MS);
    body(() => {
      if (!db) throw new Error('The test database is not ready');
      return db;
    });
  });
}
