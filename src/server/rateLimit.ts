/**
 * A sliding-window rate limiter that keeps its counts in the memory of the running instance.
 *
 * On Vercel each warm function instance counts for itself, so the real ceiling is `limit` per window per instance.
 * It is a speed bump for a public demo, not a guarantee.
 */

export type RateResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface RateLimiter {
  check(key: string): RateResult;
}

const SWEEP_AT = 10_000;

export function createRateLimiter(options: { limit: number; windowMs: number; now: () => Date }): RateLimiter {
  const { limit, windowMs, now } = options;
  const seen = new Map<string, number[]>();

  return {
    check(key: string): RateResult {
      const nowMs = now().getTime();
      const cutoff = nowMs - windowMs;

      if (seen.size > SWEEP_AT) {
        for (const [k, times] of seen) {
          if (times.every((t) => t <= cutoff)) seen.delete(k);
        }
      }

      const times = (seen.get(key) ?? []).filter((t) => t > cutoff);
      if (times.length >= limit) {
        seen.set(key, times);
        const oldest = times[0] as number;
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000)) };
      }
      times.push(nowMs);
      seen.set(key, times);
      return { allowed: true };
    }
  };
}
