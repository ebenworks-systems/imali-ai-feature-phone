/**
 * Phone number helpers for the server.
 *
 * `normalizePhone` is the one the dialled menu and the text handler already use (`src/channels/phone.ts`), so the
 * routes, the menu and the texts always find the same shop for a number.
 */

export { normalizePhone } from '../channels/phone.js';

/** True for a normalised demo number: `+2700000` followed by four digits (`+27 00 000 xxxx` without spaces). */
export function isDemoPhone(phone: string): boolean {
  return /^\+2700000\d{4}$/.test(phone);
}

/** The first 4 characters, `***`, and the last 2. For logs: the middle digits never show. */
export function maskPhone(phone: string): string {
  if (phone.length <= 6) return '***';
  return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
}

/**
 * The address of the caller: the first entry of `x-forwarded-for` (Vercel sets it), else `x-real-ip`, else `unknown`.
 * Anywhere but behind a proxy a caller can write this header, which only matters for the demo shop limit.
 */
export function clientAddress(headers: { get(name: string): string | null | undefined }): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  return 'unknown';
}
