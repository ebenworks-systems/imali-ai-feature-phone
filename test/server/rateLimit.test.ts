import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../../src/server/rateLimit.js';

function setup(limit = 60, windowMs = 60_000) {
  const clock = { ms: Date.parse('2026-11-07T10:00:00.000Z') };
  const limiter = createRateLimiter({ limit, windowMs, now: () => new Date(clock.ms) });
  return { clock, limiter };
}

describe('createRateLimiter', () => {
  it('allows 60 and refuses the 61st with retryAfterSeconds', () => {
    const { limiter, clock } = setup();
    for (let i = 0; i < 60; i += 1) {
      expect(limiter.check('+27000001234')).toEqual({ allowed: true });
      clock.ms += 100;
    }
    const refused = limiter.check('+27000001234');
    expect(refused.allowed).toBe(false);
    // The oldest request was 6.0 seconds ago, so it leaves the window in 54 seconds.
    expect(refused).toEqual({ allowed: false, retryAfterSeconds: 54 });
  });

  it('does not let a refused call extend the window', () => {
    const { limiter, clock } = setup(2, 60_000);
    limiter.check('k');
    clock.ms += 10_000;
    limiter.check('k');
    clock.ms += 10_000;
    for (let i = 0; i < 5; i += 1) {
      expect(limiter.check('k').allowed).toBe(false);
      clock.ms += 1000;
    }
    // 30 s after the first call it is 60 s... move to 60.001 s after the first: the first has left the window.
    clock.ms = Date.parse('2026-11-07T10:00:00.000Z') + 60_001;
    expect(limiter.check('k')).toEqual({ allowed: true });
  });

  it('allows calls again after the window', () => {
    const { limiter, clock } = setup(3, 60_000);
    for (let i = 0; i < 3; i += 1) limiter.check('k');
    expect(limiter.check('k').allowed).toBe(false);
    clock.ms += 61_000;
    expect(limiter.check('k')).toEqual({ allowed: true });
  });

  it('keeps two keys separate', () => {
    const { limiter } = setup(1, 60_000);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
    expect(limiter.check('b').allowed).toBe(true);
  });

  it('reports at least one second', () => {
    const { limiter, clock } = setup(1, 1000);
    limiter.check('k');
    clock.ms += 999;
    expect(limiter.check('k')).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it('removes keys whose times are all expired once there are more than 10,000 keys', () => {
    const { limiter, clock } = setup(1, 60_000);
    for (let i = 0; i < 10_001; i += 1) limiter.check(`k${i}`);
    clock.ms += 61_000;
    // The sweep runs on the next check; afterwards an old key is fresh again and nothing throws.
    expect(limiter.check('new')).toEqual({ allowed: true });
    expect(limiter.check('k0')).toEqual({ allowed: true });
  });

  it('works as the demo limiter: 10 an hour per address', () => {
    const { limiter, clock } = setup(10, 3_600_000);
    for (let i = 0; i < 10; i += 1) {
      expect(limiter.check('203.0.113.7').allowed).toBe(true);
      clock.ms += 60_000;
    }
    const refused = limiter.check('203.0.113.7');
    expect(refused).toEqual({ allowed: false, retryAfterSeconds: 3000 });
    expect(limiter.check('198.51.100.2').allowed).toBe(true);
    clock.ms += 3_000_000;
    expect(limiter.check('203.0.113.7')).toEqual({ allowed: true });
  });
});
