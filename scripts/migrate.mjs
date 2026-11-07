// Applies the files in sql/ that have not been applied yet, in name order, each in one transaction.
//
//   npm run db:migrate        (reads DATABASE_URL from the environment or from .env)
//
// `applyMigrations(sql, dir)` is exported for the tests. The script below runs only when started directly.
// It never prints the value of DATABASE_URL.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import postgres from 'postgres';

/**
 * Creates `schema_migrations` if it is missing, then applies each `NNN_name.sql` in `dir` that is not listed there,
 * in name order. A file and its note in `schema_migrations` go in one transaction, so a failed file changes nothing.
 * Returns the names applied this time (an empty list when there was nothing to do).
 */
export async function applyMigrations(sql, dir) {
  await sql`
    create table if not exists schema_migrations (
      name        text primary key,
      applied_at  timestamptz not null default now()
    )`;

  const files = (await readdir(dir)).filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
  const done = new Set((await sql`select name from schema_migrations`).map((row) => row.name));
  const applied = [];

  for (const name of files) {
    if (done.has(name)) continue;
    const text = await readFile(path.join(dir, name), 'utf8');
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`insert into schema_migrations (name) values (${name})`;
      });
    } catch (error) {
      if (error && typeof error === 'object') error.migrationName = name;
      throw error;
    }
    applied.push(name);
  }
  return applied;
}

/** The message with the connection string (if the driver put it in) replaced, so it can be printed. */
export function withoutUrl(message, url) {
  return url === '' ? message : message.split(url).join('[DATABASE_URL]');
}

async function main() {
  const url = (process.env.DATABASE_URL ?? '').trim();
  if (url === '') {
    console.error('DATABASE_URL is not set. Put it in .env or the environment.');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10, onnotice: () => {} });
  let code = 0;
  try {
    const applied = await applyMigrations(sql, fileURLToPath(new URL('../sql/', import.meta.url)));
    if (applied.length === 0) {
      console.log('Nothing to apply.');
    } else {
      for (const name of applied) console.log(`applied ${name}`);
    }
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    // The message comes from the driver or the server. Make sure it cannot carry the connection string.
    const message = withoutUrl(raw, url);
    const name = error && typeof error === 'object' && 'migrationName' in error ? error.migrationName : null;
    console.error(name ? `Migration ${name} failed: ${message}` : `Could not apply the migrations: ${message}`);
    code = 1;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
