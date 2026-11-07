import { timingSafeEqual } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { keyMatches } from '../../src/server/callbackKey.js';

// Wrap the real function so the test can see how it is called.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

describe('keyMatches', () => {
  it('matches an equal key', () => {
    expect(keyMatches('abc-123', 'abc-123')).toBe(true);
  });

  it.each([
    ['abc-124', 'abc-123'],
    ['bbc-123', 'abc-123'],
    ['', 'abc-123'],
    ['abc-12', 'abc-123'],
    ['abc-1234', 'abc-123'],
    ['ABC-123', 'abc-123'],
    [' abc-123', 'abc-123']
  ])('does not match %j against %j', (given, expected) => {
    expect(keyMatches(given, expected)).toBe(false);
  });

  it('does not match a missing key', () => {
    expect(keyMatches(undefined, 'abc-123')).toBe(false);
  });

  it('does not let an empty key match an empty expected key given as undefined', () => {
    expect(keyMatches(undefined, '')).toBe(false);
  });

  it('compares two 32-byte digests with timingSafeEqual every time, also for a missing key or a key of another length', () => {
    const spy = vi.mocked(timingSafeEqual);
    spy.mockClear();
    keyMatches('x', 'abc-123');
    keyMatches(undefined, 'abc-123');
    keyMatches('a-much-longer-key-than-the-expected-one', 'abc-123');
    expect(spy).toHaveBeenCalledTimes(3);
    for (const [a, b] of spy.mock.calls) {
      expect((a as Buffer).length).toBe(32);
      expect((b as Buffer).length).toBe(32);
    }
  });
});
