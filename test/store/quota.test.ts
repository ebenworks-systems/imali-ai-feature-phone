import { describe, expect, it } from 'vitest';
import { InMemoryDemoQuotaStore } from '../../src/store/quota.js';
import { runDemoQuotaContract, KEY_A } from './quota.js';

// The shared checks (limits per key, waiting time, old rows, the daily count, keys that must be hashes).
runDemoQuotaContract('InMemoryDemoQuotaStore contract', {
  make: async (clock) => new InMemoryDemoQuotaStore({ now: () => clock.now })
});

describe('InMemoryDemoQuotaStore only', () => {
  it('keeps only the keys it was given, and forgets a key whose calls are all old', async () => {
    const clock = { now: new Date('2026-11-07T10:00:00.000Z') };
    const store = new InMemoryDemoQuotaStore({ now: () => clock.now });
    await store.claimCall(KEY_A, { limit: 3, windowMs: 3_600_000 });
    expect(store.keys()).toEqual([KEY_A]);
    clock.now = new Date(clock.now.getTime() + 25 * 3_600_000);
    await store.claimCall('f'.repeat(64), { limit: 3, windowMs: 3_600_000 });
    expect(store.keys()).toEqual(['f'.repeat(64)]);
  });
});
