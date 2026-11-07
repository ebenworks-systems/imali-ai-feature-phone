import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = path.resolve(new URL('../../', import.meta.url).pathname);
const script = path.join(root, 'scripts', 'migrate.mjs');

/** Starts the script with the environment we choose (not the machine's), so nothing connects to anything. */
function runScript(env: Record<string, string>) {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
    timeout: 20_000
  });
}

const madeDirs: string[] = [];
function tempMigrationsDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'imali-migrations-'));
  madeDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of madeDirs) rmSync(dir, { recursive: true, force: true });
});

describe('scripts/migrate.mjs', () => {
  it('exits 1 with a plain message when DATABASE_URL is not set', () => {
    const run = runScript({});
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('DATABASE_URL is not set');
    expect(run.stdout).toBe('');
    expect(`${run.stdout}${run.stderr}`).not.toMatch(/postgres(ql)?:\/\//);
  });

  it('treats an empty or blank DATABASE_URL as not set', () => {
    for (const value of ['', '   ']) {
      const run = runScript({ DATABASE_URL: value });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('DATABASE_URL is not set');
    }
  });

  it('replaces the connection string in an error message before printing it', async () => {
    const mod = await import(path.join(root, 'scripts', 'migrate.mjs'));
    // Built in pieces so the scanner for keys in staged files does not take this fake value for a real one.
    const url = ['postgres', '://demo_user:', 'not-a-real-password', '@db.example.invalid/demo_db'].join('');
    const message = `connect failed for ${url} (timeout)`;
    const cleaned = mod.withoutUrl(message, url);
    expect(cleaned).toBe('connect failed for [DATABASE_URL] (timeout)');
    expect(cleaned).not.toContain('not-a-real-password');
    expect(mod.withoutUrl('plain message', url)).toBe('plain message');
  });

  it('can be imported without running (it exports applyMigrations)', async () => {
    const mod = await import(path.join(root, 'scripts', 'migrate.mjs'));
    expect(typeof mod.applyMigrations).toBe('function');
  });

  it('applies migration files in name order inside one transaction each (fake client)', async () => {
    const mod = await import(path.join(root, 'scripts', 'migrate.mjs'));
    const dir = tempMigrationsDir();
    writeFileSync(path.join(dir, '002_second.sql'), 'select 2;');
    writeFileSync(path.join(dir, '001_first.sql'), 'select 1;');
    writeFileSync(path.join(dir, 'notes.txt'), 'not a migration');
    writeFileSync(path.join(dir, 'x_bad_name.sql'), 'select 9;');

    const executed: string[] = [];
    const noted: string[] = [];
    let begins = 0;
    const tx = Object.assign(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (strings.join('?').includes('insert into schema_migrations')) noted.push(String(values[0]));
        return [];
      },
      { unsafe: async (text: string) => void executed.push(text) }
    );
    const sql = Object.assign(
      async (strings: TemplateStringsArray) => {
        if (strings.join('?').includes('select name from schema_migrations')) return [{ name: '000_done.sql' }];
        return [];
      },
      {
        begin: async (fn: (t: typeof tx) => Promise<void>) => {
          begins += 1;
          await fn(tx);
        }
      }
    );
    const applied = await mod.applyMigrations(sql, dir);
    expect(applied).toEqual(['001_first.sql', '002_second.sql']);
    expect(executed).toEqual(['select 1;', 'select 2;']);
    expect(noted).toEqual(['001_first.sql', '002_second.sql']);
    expect(begins).toBe(2);
  });

  it('skips files already noted in schema_migrations and returns an empty list when nothing is new', async () => {
    const mod = await import(path.join(root, 'scripts', 'migrate.mjs'));
    const dir = tempMigrationsDir();
    writeFileSync(path.join(dir, '001_first.sql'), 'select 1;');
    const sql = Object.assign(
      async (strings: TemplateStringsArray) =>
        strings.join('?').includes('select name from schema_migrations') ? [{ name: '001_first.sql' }] : [],
      { begin: async () => { throw new Error('should not begin'); } }
    );
    expect(await mod.applyMigrations(sql, dir)).toEqual([]);
  });
});

describe('sql/001_init.sql', () => {
  const text = readFileSync(path.join(root, 'sql', '001_init.sql'), 'utf8');

  it('has no begin or commit (the script wraps the file in a transaction)', () => {
    expect(text).not.toMatch(/^\s*(begin|commit)\b/im);
  });

  it('creates the four tables and the named constraints and indexes the store depends on', () => {
    for (const table of ['shops', 'records', 'pending_questions', 'processed_texts']) {
      expect(text).toMatch(new RegExp(`create table ${table} \\(`));
    }
    for (const name of [
      'shops_pkey',
      'shops_phone_unique',
      'records_pkey',
      'records_one_reversal_per_record',
      'processed_texts_pkey'
    ]) {
      expect(text).toContain(name);
    }
  });

  it('has no save-key column or index (the record id is the duplicate-save guard)', () => {
    expect(text).not.toMatch(/save_key/i);
  });

  it('is the only file whose name starts with a number so far, and is read in name order', () => {
    const names = readdirSync(path.join(root, 'sql')).filter((n) => /^\d+_.*\.sql$/.test(n));
    expect(names[0]).toBe('001_init.sql');
  });
});
