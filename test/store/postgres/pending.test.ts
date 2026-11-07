import { beforeEach, expect, it } from 'vitest';
import { PENDING_TTL_MS, type PendingQuestion } from '../../../src/channels/sms/pending.js';
import { PostgresPendingStore } from '../../../src/store/postgres/pending.js';
import { describePostgres } from '../../helpers/pg.js';

const PHONE_A = '+27000000001';
const PHONE_B = '+27000000002';
const START = new Date('2026-11-07T08:00:00.000Z');
const MINUTE = 60_000;

const ambiguous: PendingQuestion = {
  kind: 'ambiguous',
  intent: { kind: 'ambiguous', options: [{ cents: 20000, quantity: 2 }, { cents: 220000 }], base: { kind: 'sale' } },
  possibleAmounts: [
    { cents: 20000, formatted: 'R200' },
    { cents: 220000, formatted: 'R2,200' }
  ],
  originalWords: 'sold 2 200',
  createdAt: START
};

const large: PendingQuestion = {
  kind: 'largeAmount',
  intent: { kind: 'sale', cents: 150000000, item: 'fridge' },
  largeAmount: 150000000,
  originalWords: 'sold fridge 1500000',
  createdAt: START
};

const signup: PendingQuestion = { kind: 'signup', createdAt: START };

describePostgres('PostgresPendingStore', (db) => {
  const clock = { now: START };
  let store: PostgresPendingStore;

  beforeEach(async () => {
    clock.now = START;
    await db().truncate();
    store = new PostgresPendingStore(db().sql, { now: () => clock.now });
  });

  it('keeps the ten minute wait the in-memory store uses', () => {
    expect(PENDING_TTL_MS).toBe(10 * MINUTE);
  });

  it('returns null when nothing was set', async () => {
    expect(await store.get(PHONE_A)).toBeNull();
  });

  it('returns a question equal to the one set, with its Date and its intent', async () => {
    await store.set(PHONE_A, ambiguous);
    const back = await store.get(PHONE_A);
    expect(back).toEqual(ambiguous);
    expect(back?.createdAt).toBeInstanceOf(Date);
    expect(back?.createdAt.toISOString()).toBe(START.toISOString());
  });

  it('round trips an ambiguous question with possibleAmounts, a large-amount question and a sign-up question', async () => {
    await store.set(PHONE_A, ambiguous);
    await store.set(PHONE_B, large);
    expect(await store.get(PHONE_A)).toEqual(ambiguous);
    expect(await store.get(PHONE_B)).toEqual(large);
    await store.set('+27000000003', signup);
    expect(await store.get('+27000000003')).toEqual(signup);
  });

  it('replaces the earlier question for the same phone', async () => {
    await store.set(PHONE_A, ambiguous);
    await store.set(PHONE_A, large);
    expect(await store.get(PHONE_A)).toEqual(large);
    const rows = await db().sql`select count(*)::int as n from pending_questions where phone = ${PHONE_A}`;
    expect(rows[0]?.n).toBe(1);
  });

  it('clears a question, and clearing nothing does nothing', async () => {
    await store.set(PHONE_A, ambiguous);
    await store.clear(PHONE_A);
    expect(await store.get(PHONE_A)).toBeNull();
    await expect(store.clear(PHONE_B)).resolves.toBeUndefined();
  });

  it('keeps a question at 9 minutes and at exactly 10, and drops it at 11', async () => {
    await store.set(PHONE_A, ambiguous);
    clock.now = new Date(START.getTime() + 9 * MINUTE);
    expect(await store.get(PHONE_A)).toEqual(ambiguous);
    clock.now = new Date(START.getTime() + 10 * MINUTE);
    expect(await store.get(PHONE_A)).toEqual(ambiguous);
    clock.now = new Date(START.getTime() + 11 * MINUTE);
    expect(await store.get(PHONE_A)).toBeNull();
  });

  it('restarts the ten minutes when a question is set again', async () => {
    await store.set(PHONE_A, ambiguous);
    clock.now = new Date(START.getTime() + 8 * MINUTE);
    await store.set(PHONE_A, ambiguous);
    clock.now = new Date(START.getTime() + 15 * MINUTE);
    expect(await store.get(PHONE_A)).toEqual(ambiguous);
  });

  it('deletes the expired questions of every phone when a question is set', async () => {
    await store.set(PHONE_A, ambiguous);
    clock.now = new Date(START.getTime() + 11 * MINUTE);
    await store.set(PHONE_B, large);
    const rows = await db().sql`select phone from pending_questions order by phone`;
    expect(rows.map((r) => r.phone)).toEqual([PHONE_B]);
  });

  it('uses the injected ttl', async () => {
    const short = new PostgresPendingStore(db().sql, { now: () => clock.now, ttlMs: MINUTE });
    await short.set(PHONE_A, ambiguous);
    clock.now = new Date(START.getTime() + 2 * MINUTE);
    expect(await short.get(PHONE_A)).toBeNull();
  });
});
