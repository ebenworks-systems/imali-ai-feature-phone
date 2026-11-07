import { describe, it, expect } from 'vitest';
import {
  InMemoryPendingStore,
  PENDING_TTL_MS,
  type PendingQuestion
} from '@/channels/sms/pending.ts';

const PHONE_A = '+27000000001';
const PHONE_B = '+27000000002';
const START = new Date('2025-11-03T08:00:00.000Z');

/** A store with a clock the test moves by hand, so nothing sleeps. */
function makeStore() {
  let nowMs = START.getTime();
  const store = new InMemoryPendingStore({ now: () => new Date(nowMs) });
  return {
    store,
    advance: (ms: number) => {
      nowMs += ms;
    }
  };
}

const ambiguous: PendingQuestion = {
  kind: 'ambiguous',
  intent: { kind: 'sale', cents: 20000, quantity: 2 },
  possibleAmounts: [
    { cents: 20000, formatted: 'R200' },
    { cents: 220000, formatted: 'R2,200' }
  ],
  createdAt: START
};

const large: PendingQuestion = {
  kind: 'largeAmount',
  intent: { kind: 'sale', cents: 150000000 },
  largeAmount: 150000000,
  createdAt: START
};

describe('InMemoryPendingStore', () => {
  describe('set, get and clear', () => {
    it('returns null when nothing was set', async () => {
      const { store } = makeStore();
      expect(await store.get(PHONE_A)).toBeNull();
    });

    it('returns the question that was set', async () => {
      const { store } = makeStore();
      await store.set(PHONE_A, ambiguous);
      expect(await store.get(PHONE_A)).toEqual(ambiguous);
    });

    it('keeps a separate question for each phone', async () => {
      const { store } = makeStore();
      await store.set(PHONE_A, ambiguous);
      await store.set(PHONE_B, large);
      expect(await store.get(PHONE_A)).toEqual(ambiguous);
      expect(await store.get(PHONE_B)).toEqual(large);
    });

    it('replaces an earlier question for the same phone', async () => {
      const { store } = makeStore();
      await store.set(PHONE_A, ambiguous);
      await store.set(PHONE_A, large);
      expect(await store.get(PHONE_A)).toEqual(large);
      expect(store.size).toBe(1);
    });

    it('clear removes only that phone', async () => {
      const { store } = makeStore();
      await store.set(PHONE_A, ambiguous);
      await store.set(PHONE_B, large);
      await store.clear(PHONE_A);
      expect(await store.get(PHONE_A)).toBeNull();
      expect(await store.get(PHONE_B)).toEqual(large);
    });

    it('clearMany removes the questions of the phones given in one call, and leaves any other phone', async () => {
      const { store } = makeStore();
      await store.set(PHONE_A, ambiguous);
      await store.set(PHONE_B, large);
      await store.set('+27000000003', large);
      await store.clearMany([PHONE_A, '+27000000003', '+27000000009']); // the last one has no question
      expect(await store.get(PHONE_A)).toBeNull();
      expect(await store.get('+27000000003')).toBeNull();
      expect(await store.get(PHONE_B)).toEqual(large);
      await expect(store.clearMany([])).resolves.toBeUndefined();
      expect(await store.get(PHONE_B)).toEqual(large);
    });

    it('clear on a phone with no question does nothing', async () => {
      const { store } = makeStore();
      await expect(store.clear(PHONE_A)).resolves.toBeUndefined();
      expect(await store.get(PHONE_A)).toBeNull();
    });

    it('does not let a caller change a saved question through the object it passed in or got back', async () => {
      const { store } = makeStore();
      const mine: PendingQuestion = { ...ambiguous, possibleAmounts: [{ cents: 1, formatted: 'R0.01' }] };
      await store.set(PHONE_A, mine);
      mine.possibleAmounts!.push({ cents: 2, formatted: 'R0.02' });

      const first = await store.get(PHONE_A);
      first!.possibleAmounts!.length = 0;

      const second = await store.get(PHONE_A);
      expect(second!.possibleAmounts).toEqual([{ cents: 1, formatted: 'R0.01' }]);
    });
  });

  describe('expiry after 10 minutes (criterion 29)', () => {
    it('uses a 10 minute lifetime', () => {
      expect(PENDING_TTL_MS).toBe(600_000);
    });

    it('still returns the question just under 10 minutes later', async () => {
      const { store, advance } = makeStore();
      await store.set(PHONE_A, ambiguous);
      advance(PENDING_TTL_MS - 1);
      expect(await store.get(PHONE_A)).toEqual(ambiguous);
    });

    it('still returns the question at exactly 10 minutes', async () => {
      const { store, advance } = makeStore();
      await store.set(PHONE_A, ambiguous);
      advance(PENDING_TTL_MS);
      expect(await store.get(PHONE_A)).toEqual(ambiguous);
    });

    it('returns null once it is over 10 minutes old', async () => {
      const { store, advance } = makeStore();
      await store.set(PHONE_A, ambiguous);
      advance(PENDING_TTL_MS + 1);
      expect(await store.get(PHONE_A)).toBeNull();
    });

    it('stays gone after it expired, even if read again', async () => {
      const { store, advance } = makeStore();
      await store.set(PHONE_A, large);
      advance(PENDING_TTL_MS + 1);
      expect(await store.get(PHONE_A)).toBeNull();
      expect(await store.get(PHONE_A)).toBeNull();
    });

    it('counts the 10 minutes from when the question was set, not from when it was last read', async () => {
      const { store, advance } = makeStore();
      await store.set(PHONE_A, ambiguous);
      advance(PENDING_TTL_MS - 1000);
      expect(await store.get(PHONE_A)).not.toBeNull();
      advance(2000);
      expect(await store.get(PHONE_A)).toBeNull();
    });

    it('does not use the createdAt the caller supplied', async () => {
      const { store } = makeStore();
      const old: PendingQuestion = { ...ambiguous, createdAt: new Date('2020-01-01T00:00:00Z') };
      await store.set(PHONE_A, old);
      expect(await store.get(PHONE_A)).toEqual(old);
    });

    it('setting a new question restarts the 10 minutes', async () => {
      const { store, advance } = makeStore();
      await store.set(PHONE_A, ambiguous);
      advance(PENDING_TTL_MS - 1000);
      await store.set(PHONE_A, large);
      advance(PENDING_TTL_MS - 1000);
      expect(await store.get(PHONE_A)).toEqual(large);
    });

    it('lets the next message be read normally after expiry: a new question can be set', async () => {
      const { store, advance } = makeStore();
      await store.set(PHONE_A, ambiguous);
      advance(PENDING_TTL_MS + 1);
      expect(await store.get(PHONE_A)).toBeNull();
      await store.set(PHONE_A, large);
      expect(await store.get(PHONE_A)).toEqual(large);
    });
  });

  describe('cleanup', () => {
    it('removes expired questions of every phone when any phone is read', async () => {
      const { store, advance } = makeStore();
      await store.set(PHONE_A, ambiguous);
      advance(PENDING_TTL_MS - 1000);
      await store.set(PHONE_B, large);
      expect(store.size).toBe(2);

      advance(2000); // A is now expired, B is not
      expect(store.size).toBe(2); // nothing is removed until a get()
      expect(await store.get(PHONE_B)).toEqual(large);
      expect(store.size).toBe(1);
    });

    it('removes everything when all questions have expired', async () => {
      const { store, advance } = makeStore();
      await store.set(PHONE_A, ambiguous);
      await store.set(PHONE_B, large);
      advance(PENDING_TTL_MS + 1);
      expect(await store.get('+27000000003')).toBeNull();
      expect(store.size).toBe(0);
    });

    it('keeps questions that are still in time', async () => {
      const { store, advance } = makeStore();
      await store.set(PHONE_A, ambiguous);
      advance(1000);
      await store.get(PHONE_B);
      expect(store.size).toBe(1);
    });
  });

  describe('default clock', () => {
    it('works without a clock option', async () => {
      const store = new InMemoryPendingStore();
      await store.set(PHONE_A, large);
      expect(await store.get(PHONE_A)).toEqual(large);
    });
  });
});
