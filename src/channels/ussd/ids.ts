/**
 * Ids derived from the session, so a repeated request makes the same id and the store can refuse the copy.
 *
 * The `sessionId` is checked (letters, digits, `_`, `-`, `.`, at most 100) before it gets here, so the ids are safe
 * in a key. `step` is a number, so `S_1` with step 2 and `S` with step `1_2` cannot both exist.
 */

/** The id of the record made at `step` (inputs read, counting the confirming one) in session `sessionId`. */
export function recordIdFor(sessionId: string, step: number): string {
  return `rec_ussd_${sessionId}_${step}`;
}

/** The id of the shop made in session `sessionId`. */
export function shopIdFor(sessionId: string): string {
  return `shop_ussd_${sessionId}`;
}
