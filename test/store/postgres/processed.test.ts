import { describe, expect, it, vi } from 'vitest';
import type { Sql } from 'postgres';
import { PostgresProcessedTextStore } from '../../../src/store/postgres/processed.js';
import { describePostgres } from '../../helpers/pg.js';
import { runProcessedTextContract } from '../processed.js';

describePostgres('PostgresProcessedTextStore', (db) => {
  runProcessedTextContract('ProcessedTextStore checks', {
    make: async (clock) => {
      await db().truncate();
      return new PostgresProcessedTextStore(db().sql, { now: () => clock.now });
    }
  });
});

/** A fake `sql` tag that gives prepared answers, so the three answers of `claim` are checked without a database. */
function fakeSql(...answers: unknown[][]) {
  const queries: string[] = [];
  const fn = vi.fn(async (strings: TemplateStringsArray) => {
    queries.push(strings.join('?'));
    return answers.shift() ?? [];
  });
  return { sql: fn as unknown as Sql, queries, fn };
}

describe('PostgresProcessedTextStore (fake sql, no connection)', () => {
  const now = () => new Date('2026-11-07T10:00:00.000Z');

  it('deletes old rows, then inserts on conflict do nothing, and answers new when a row came back', async () => {
    const { sql, queries } = fakeSql([], [{ message_id: 'm1' }]);
    expect(await new PostgresProcessedTextStore(sql, { now }).claim('+27000001234', 'm1')).toEqual({ status: 'new' });
    expect(queries[0]).toMatch(/delete from processed_texts where created_at </);
    expect(queries[1]).toMatch(/insert into processed_texts/);
    expect(queries[1]).toMatch(/on conflict do nothing/);
    expect(queries[1]).toMatch(/returning message_id/);
  });

  it('answers working when the row has no reply, and done when it has one', async () => {
    const working = fakeSql([], [], [{ reply: null }]);
    expect(await new PostgresProcessedTextStore(working.sql, { now }).claim('p', 'm')).toEqual({ status: 'working' });
    const done = fakeSql([], [], [{ reply: 'Saved.' }]);
    expect(await new PostgresProcessedTextStore(done.sql, { now }).claim('p', 'm')).toEqual({ status: 'done', reply: 'Saved.' });
  });

  it('tries the insert once more when the row vanished between the insert and the select', async () => {
    const { sql } = fakeSql([], [], [], [{ message_id: 'm' }]);
    expect(await new PostgresProcessedTextStore(sql, { now }).claim('p', 'm')).toEqual({ status: 'new' });
  });

  it('answers working when the row keeps vanishing', async () => {
    const { sql } = fakeSql([], [], [], [], []);
    expect(await new PostgresProcessedTextStore(sql, { now }).claim('p', 'm')).toEqual({ status: 'working' });
  });

  it('deletes rows older than 48 hours by default', async () => {
    const { sql, fn } = fakeSql([], [{ message_id: 'm' }]);
    await new PostgresProcessedTextStore(sql, { now }).claim('p', 'm');
    expect(fn.mock.calls[0]!.slice(1)).toEqual(['2026-11-05T10:00:00.000Z']);
  });

  it('stores the reply on finish', async () => {
    const { sql, queries, fn } = fakeSql();
    await new PostgresProcessedTextStore(sql, { now }).finish('p', 'm', 'Saved.');
    expect(queries[0]).toMatch(/update processed_texts set reply/);
    expect(fn.mock.calls[0]!.slice(1)).toEqual(['Saved.', 'p', 'm']);
  });

  it('has no way to forget a claim', () => {
    expect('release' in new PostgresProcessedTextStore(fakeSql().sql, { now })).toBe(false);
  });
});
