/**
 * The one place a Postgres connection is made. Nothing in `src/core` or `src/channels` imports `postgres`.
 */

import postgres, { type Sql } from 'postgres';

/**
 * A client that connects on the first query.
 *
 * - at most 3 connections, so a serverless function does not use up a small database;
 * - no prepared statements, so it works through Neon's pooled (PgBouncer) connection string;
 * - gives up connecting after 10 seconds, and closes idle connections after 20;
 * - notices from the server are dropped (they are not errors and may name tables).
 */
export function connectPostgres(url: string): Sql {
  return postgres(url, {
    max: 3,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    onnotice: () => {}
  });
}

/** Ends the pool, waiting up to 5 seconds for running queries. */
export async function closePostgres(sql: Sql): Promise<void> {
  await sql.end({ timeout: 5 });
}
