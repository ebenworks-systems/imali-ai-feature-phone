import { describe, expect, it } from 'vitest';
import { InMemoryProcessedTextStore, PROCESSED_TEXT_TTL_MS } from '../../src/store/processed.js';
import { runProcessedTextContract } from './processed.js';

runProcessedTextContract('InMemoryProcessedTextStore contract', {
  make: async (clock) => new InMemoryProcessedTextStore({ now: () => clock.now })
});

describe('InMemoryProcessedTextStore only', () => {
  it('has no way to forget a claim', () => {
    expect('release' in new InMemoryProcessedTextStore()).toBe(false);
  });

  it('keeps entries for 48 hours', () => {
    expect(PROCESSED_TEXT_TTL_MS).toBe(48 * 60 * 60 * 1000);
  });

  it('removes expired entries from memory on the next claim', async () => {
    let now = new Date('2026-11-07T10:00:00.000Z');
    const store = new InMemoryProcessedTextStore({ now: () => now });
    await store.claim('+27000001234', 'a');
    await store.claim('+27000001234', 'b');
    expect(store.size).toBe(2);
    now = new Date(now.getTime() + PROCESSED_TEXT_TTL_MS + 1000);
    await store.claim('+27000001234', 'c');
    expect(store.size).toBe(1);
  });
});
