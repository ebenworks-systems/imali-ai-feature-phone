/**
 * The checks every ProcessedTextStore must pass. Not named *.test.ts: the memory test and the Postgres test each
 * call `runProcessedTextContract` with their own harness.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { ProcessedTextStore } from '../../src/store/processed.js';

export interface ProcessedTextHarness {
  /** A fresh, empty store whose clock is the one the test moves. Called before every check. */
  make(clock: { now: Date }): Promise<ProcessedTextStore>;
  teardown?(): Promise<void>;
}

const HOUR = 60 * 60 * 1000;

export function runProcessedTextContract(label: string, harness: ProcessedTextHarness): void {
  describe(label, () => {
    const clock = { now: new Date('2026-11-07T10:00:00.000Z') };
    let store: ProcessedTextStore;

    beforeEach(async () => {
      clock.now = new Date('2026-11-07T10:00:00.000Z');
      store = await harness.make(clock);
    });

    afterAll(async () => {
      await harness.teardown?.();
    });

    it('gives the first claim as new', async () => {
      expect(await store.claim('+27000001234', 'ATXid_1')).toEqual({ status: 'new' });
    });

    it('says working to a second claim before finish', async () => {
      await store.claim('+27000001234', 'ATXid_1');
      expect(await store.claim('+27000001234', 'ATXid_1')).toEqual({ status: 'working' });
      expect(await store.claim('+27000001234', 'ATXid_1')).toEqual({ status: 'working' });
    });

    it('gives done with the same reply after finish', async () => {
      await store.claim('+27000001234', 'ATXid_1');
      await store.finish('+27000001234', 'ATXid_1', 'Saved: sale R45 (3 bread).');
      expect(await store.claim('+27000001234', 'ATXid_1')).toEqual({
        status: 'done',
        reply: 'Saved: sale R45 (3 bread).'
      });
      expect(await store.claim('+27000001234', 'ATXid_1')).toEqual({
        status: 'done',
        reply: 'Saved: sale R45 (3 bread).'
      });
    });

    it('keeps a reply with quotes, newlines and non-ASCII characters exactly', async () => {
      const reply = "It's \"quoted\"\nnew line \\ back";
      await store.claim('+27000001234', 'ATXid_2');
      await store.finish('+27000001234', 'ATXid_2', reply);
      expect(await store.claim('+27000001234', 'ATXid_2')).toEqual({ status: 'done', reply });
    });

    it('treats another phone, or another id, as separate', async () => {
      await store.claim('+27000001234', 'ATXid_1');
      expect(await store.claim('+27000005678', 'ATXid_1')).toEqual({ status: 'new' });
      expect(await store.claim('+27000001234', 'ATXid_2')).toEqual({ status: 'new' });
    });

    it('lets exactly one of several claims started together win', async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, () => store.claim('+27000001234', 'ATXid_race'))
      );
      expect(results.filter((r) => r.status === 'new')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'working')).toHaveLength(5);
    });

    it('keeps an entry 47 hours old and deletes one 49 hours old at the next claim', async () => {
      await store.claim('+27000001234', 'ATXid_old');
      await store.finish('+27000001234', 'ATXid_old', 'reply');

      clock.now = new Date(clock.now.getTime() + 47 * HOUR);
      expect(await store.claim('+27000001234', 'ATXid_old')).toEqual({ status: 'done', reply: 'reply' });

      clock.now = new Date(clock.now.getTime() + 2 * HOUR); // 49 hours after the first claim
      expect(await store.claim('+27000001234', 'ATXid_other')).toEqual({ status: 'new' });
      expect(await store.claim('+27000001234', 'ATXid_old')).toEqual({ status: 'new' });
    });
  });
}
