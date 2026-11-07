import type { ModelReader } from '../ai/reader.js';
import { createRateLimiter } from './rateLimit.js';

/**
 * A ceiling on the calls to the optional model reader, all callers together.
 *
 * Beyond `limit` calls in `windowMs` the wrapper answers `null` at once and does not call the reader, so the rules
 * answer alone (`handleText` reads a `null` proposal as "not understood", exactly as when there is no reader). A call
 * that is skipped is not counted. The count is in the memory of the running instance, so on Vercel it is per instance.
 */
export function withReaderLimit(
  reader: ModelReader,
  options: { limit: number; windowMs: number; now: () => Date }
): ModelReader {
  const limiter = createRateLimiter(options);
  return {
    async read(text: string) {
      if (!limiter.check('reader').allowed) return null;
      return reader.read(text);
    }
  };
}
