/**
 * The checks every DemoQuotaStore must pass. Not named *.test.ts: the memory test and the Postgres test each call
 * `runDemoQuotaContract` with their own harness.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { QuotaKeyError, type DemoQuotaStore } from '../../src/store/quota.js';
import { addressKey } from '../../src/server/address.js';

export interface DemoQuotaHarness {
  /** A fresh, empty store whose clock is the one the test moves. Called before every check. */
  make(clock: { now: Date }): Promise<DemoQuotaStore>;
  teardown?(): Promise<void>;
}

const HOUR = 60 * 60 * 1000;
const START = '2026-11-07T10:00:00.000Z';
export const KEY_A = addressKey('203.0.113.7', 'test-salt');
export const KEY_B = addressKey('198.51.100.9', 'test-salt');
const HOURLY = { limit: 3, windowMs: HOUR };

export function runDemoQuotaContract(label: string, harness: DemoQuotaHarness): void {
  describe(label, () => {
    const clock = { now: new Date(START) };
    let store: DemoQuotaStore;

    beforeEach(async () => {
      clock.now = new Date(START);
      store = await harness.make(clock);
    });

    afterAll(async () => {
      await harness.teardown?.();
    });

    describe('claimCall', () => {
      it('lets a key make `limit` calls in the window and refuses the next', async () => {
        for (let i = 0; i < 3; i += 1) expect(await store.claimCall(KEY_A, HOURLY)).toEqual({ allowed: true });
        const refused = await store.claimCall(KEY_A, HOURLY);
        expect(refused.allowed).toBe(false);
      });

      it('says how long to wait: until the oldest counted call leaves the window', async () => {
        await store.claimCall(KEY_A, HOURLY);
        clock.now = new Date(clock.now.getTime() + 10 * 60_000);
        await store.claimCall(KEY_A, HOURLY);
        await store.claimCall(KEY_A, HOURLY);
        clock.now = new Date(clock.now.getTime() + 5 * 60_000);
        expect(await store.claimCall(KEY_A, HOURLY)).toEqual({ allowed: false, retryAfterSeconds: 45 * 60 });
      });

      it('does not count a refused call, so it does not extend its own wait', async () => {
        const limit = { limit: 2, windowMs: HOUR };
        await store.claimCall(KEY_A, limit);
        clock.now = new Date(clock.now.getTime() + 30 * 60_000);
        await store.claimCall(KEY_A, limit);
        clock.now = new Date(clock.now.getTime() + 10 * 60_000);
        for (let i = 0; i < 5; i += 1) expect((await store.claimCall(KEY_A, limit)).allowed).toBe(false);
        // 61 minutes after the first call: it has left the window, the second has not.
        clock.now = new Date(clock.now.getTime() + 21 * 60_000 + 1000);
        expect(await store.claimCall(KEY_A, limit)).toEqual({ allowed: true });
      });

      it('counts each key on its own', async () => {
        for (let i = 0; i < 3; i += 1) await store.claimCall(KEY_A, HOURLY);
        expect((await store.claimCall(KEY_A, HOURLY)).allowed).toBe(false);
        expect(await store.claimCall(KEY_B, HOURLY)).toEqual({ allowed: true });
      });

      it('lets a key in again once the window has passed', async () => {
        for (let i = 0; i < 3; i += 1) await store.claimCall(KEY_A, HOURLY);
        clock.now = new Date(clock.now.getTime() + HOUR + 1000);
        expect(await store.claimCall(KEY_A, HOURLY)).toEqual({ allowed: true });
      });

      it('refuses every call when the limit is 0', async () => {
        expect((await store.claimCall(KEY_A, { limit: 0, windowMs: HOUR })).allowed).toBe(false);
      });

      it('lets exactly `limit` of many simultaneous claims through (as when instances claim together)', async () => {
        const results = await Promise.all(Array.from({ length: 8 }, () => store.claimCall(KEY_A, HOURLY)));
        expect(results.filter((r) => r.allowed)).toHaveLength(3);
      });

      it('refuses a key that is not a SHA-256 hash, so a raw address can never be kept', async () => {
        for (const raw of ['203.0.113.7', 'unknown', '2001:db8::1', '', KEY_A.toUpperCase(), KEY_A.slice(1)]) {
          await expect(store.claimCall(raw, HOURLY), raw).rejects.toBeInstanceOf(QuotaKeyError);
          await expect(store.noteMade(raw), raw).rejects.toBeInstanceOf(QuotaKeyError);
        }
        expect(await store.madeToday()).toBe(0);
      });
    });

    describe('noteMade and madeToday', () => {
      it('counts the demo shops made by all addresses in the last 24 hours', async () => {
        expect(await store.madeToday()).toBe(0);
        await store.noteMade(KEY_A);
        await store.noteMade(KEY_A);
        await store.noteMade(KEY_B);
        expect(await store.madeToday()).toBe(3);
      });

      it('forgets a shop made more than 24 hours ago', async () => {
        await store.noteMade(KEY_A);
        clock.now = new Date(clock.now.getTime() + 23 * HOUR);
        await store.noteMade(KEY_B);
        expect(await store.madeToday()).toBe(2);
        clock.now = new Date(clock.now.getTime() + 2 * HOUR); // the first is now 25 hours old
        expect(await store.madeToday()).toBe(1);
      });

      it('does not count calls, only shops that were made', async () => {
        await store.claimCall(KEY_A, HOURLY);
        await store.claimCall(KEY_A, HOURLY);
        expect(await store.madeToday()).toBe(0);
      });
    });

    describe('old rows', () => {
      it('are removed as part of a claim, so they do not pile up (the count of calls only looks inside the window)', async () => {
        for (let i = 0; i < 3; i += 1) await store.claimCall(KEY_A, HOURLY);
        clock.now = new Date(clock.now.getTime() + 25 * HOUR);
        expect(await store.claimCall(KEY_A, HOURLY)).toEqual({ allowed: true });
      });
    });
  });
}
