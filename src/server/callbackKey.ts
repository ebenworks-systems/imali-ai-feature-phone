import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * True when `given` equals `expected`, compared in constant time.
 *
 * Both values are hashed with SHA-256 first, so the two buffers have the same length (which `timingSafeEqual` needs)
 * and neither the content nor the length of the key shows in the timing. The comparison runs even when `given` is
 * missing, so a missing key takes as long to refuse as a wrong one.
 */
export function keyMatches(given: string | undefined, expected: string): boolean {
  const a = createHash('sha256').update(given ?? '').digest();
  const b = createHash('sha256').update(expected).digest();
  const same = timingSafeEqual(a, b);
  return same && given !== undefined;
}
