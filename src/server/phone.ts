/**
 * Phone number helpers for the server.
 *
 * `normalizePhone` is the one the dialled menu and the text handler already use (`src/channels/phone.ts`), so the
 * routes, the menu and the texts always find the same shop for a number.
 */

import { isDemoNumber } from '../store/demo.js';

export { normalizePhone } from '../channels/phone.js';

/** True for a normalised demo number: `+2700000` followed by four digits (`+27 00 000 xxxx` without spaces). */
export function isDemoPhone(phone: string): boolean {
  return isDemoNumber(phone);
}

/** The first 4 characters, `***`, and the last 2. For logs: the middle digits never show. */
export function maskPhone(phone: string): string {
  if (phone.length <= 6) return '***';
  return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
}

/** The longest address kept. A real one is at most 45 characters (IPv6); a longer header value is cut. */
const MAX_ADDRESS_LENGTH = 64;

/**
 * The address of the caller, for the limits.
 *
 * 1. `x-real-ip`. Vercel sets it to the address that connected to it, and a caller cannot write it.
 * 2. The last entry of `x-forwarded-for`. A proxy adds the address it saw to the end of that header, so the entry on
 *    the right is the one the platform added. The first entry is whatever the caller wrote, so it is never used.
 * 3. `unknown`, one shared key (a local run behind no proxy, and tests).
 */
export function clientAddress(headers: { get(name: string): string | null | undefined }): string {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real.slice(0, MAX_ADDRESS_LENGTH);
  const entries = headers.get('x-forwarded-for')?.split(',') ?? [];
  const last = entries[entries.length - 1]?.trim();
  if (last) return last.slice(0, MAX_ADDRESS_LENGTH);
  return 'unknown';
}
