import { createHash } from 'node:crypto';

/**
 * The key a client address is kept under in the store: the SHA-256 of the server-side salt and the address, as 64
 * lower-case hex digits. The address itself is never written to the database or a log.
 *
 * The same salt in every instance gives the same key for the same address, so every instance counts alike. The
 * `\0` between the two stops one salt and address from running into another pair.
 */
export function addressKey(address: string, salt: string): string {
  return createHash('sha256').update(salt).update('\0').update(address).digest('hex');
}
