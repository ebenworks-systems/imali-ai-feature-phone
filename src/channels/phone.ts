/**
 * One written form for a phone number, so the dialled menu and the text messages find the same shop.
 *
 * Africa's Talking sends `+27000001234`; people and tests write `+27 00 000 1234`. Both become `+27000001234`.
 */

/**
 * Removes spaces, hyphens, dots and brackets, and adds a leading `+` when only digits are left.
 * Returns null unless the result is `+` and 7 to 15 digits.
 */
export function normalizePhone(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[\s\-.()]/g, '');
  const withPlus = /^\d+$/.test(cleaned) ? `+${cleaned}` : cleaned;
  return /^\+\d{7,15}$/.test(withPlus) ? withPlus : null;
}
