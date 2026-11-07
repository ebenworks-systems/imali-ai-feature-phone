/**
 * SMS prompts - the replies that are not about a record that was saved.
 *
 * The welcome and the shop name, the two questions (which amount? yes to a very big amount?), and the plain
 * refusals. Like replies.ts these are pure functions that give plain ASCII of at most 160 characters. When
 * the data is long the least useful words go first, so the question is always still a question.
 *
 * Money is written only with formatCents.
 */

import { formatCents, type Currency } from '../../core/index.js';
import { ascii, SMS_MAX_LENGTH } from './replies.js';

export const WELCOME = 'Welcome to the Imali AI shop ledger. Reply with your shop name to start.';
export const ASK_SHOP_NAME_AGAIN = "Please reply with your shop name, for example: Thandi's Spaza.";
export const AMOUNT_MUST_BE_MORE_THAN_ZERO = 'The amount must be more than zero. Try: sold 45 bread.';
export const AMOUNT_TOO_BIG = 'That amount is too big. Please check it and try again.';
export const NOT_SAVED = 'OK, I did not save it.';
export const TRY_AGAIN = 'Sorry, that did not work. Please try again.';

/** The most characters of a shop name. */
export const SHOP_NAME_MAX = 24;

/** "<Shop> is ready. Try: sold 45 bread." */
export function shopReady(shopName: string): string {
  return `${shopName} is ready. Try: sold 45 bread.`;
}

/**
 * Make the shop name from what the owner typed: plain ASCII, single spaces, at most 24 characters.
 * Returns null when nothing usable is left (no letter or digit).
 */
export function cleanShopName(text: string): string | null {
  const name = ascii(text).slice(0, SHOP_NAME_MAX).trim();
  return /[A-Za-z0-9]/.test(name) ? name : null;
}

export interface AmountChoice {
  cents: number;
  /** How many items, when the owner's words could mean "2 items for R200". */
  quantity?: number;
}

/** "Did you mean 1) R200 for 2 or 2) R2,200? Reply 1 or 2." (requirement 27) */
export function askWhichAmount(choices: [AmountChoice, AmountChoice], currency: Currency): string {
  const [a, b] = choices;
  const withCount = (c: AmountChoice): string =>
    c.quantity !== undefined ? `${formatCents(c.cents, currency)} for ${c.quantity}` : formatCents(c.cents, currency);
  const plain = (c: AmountChoice): string => formatCents(c.cents, currency);
  return firstThatFits([
    `Did you mean 1) ${withCount(a)} or 2) ${withCount(b)}? Reply 1 or 2.`,
    `Did you mean 1) ${plain(a)} or 2) ${plain(b)}? Reply 1 or 2.`,
    `1) ${plain(a)} or 2) ${plain(b)}? Reply 1 or 2.`
  ]);
}

export type LargeAmountThing =
  | { kind: 'sale' | 'expense'; cents: number }
  | { kind: 'debt' | 'payment'; cents: number; customer: string };

/** "Reply yes to save sale R1,500,000." (requirement 30) */
export function askConfirmLargeAmount(thing: LargeAmountThing, currency: Currency): string {
  const amount = formatCents(thing.cents, currency);
  let what: string;
  switch (thing.kind) {
    case 'sale':
      what = `sale ${amount}`;
      break;
    case 'expense':
      what = `spent ${amount}`;
      break;
    case 'debt':
      what = `${ascii(thing.customer) || 'Customer'} owes ${amount}`;
      break;
    case 'payment':
      what = `${ascii(thing.customer) || 'Customer'} paid ${amount}`;
      break;
  }
  return firstThatFits([`Reply yes to save ${what}.`, `Reply yes to save ${amount}.`]);
}

/** The first candidate that fits in one text; the last one if none do (they are ordered long to short). */
function firstThatFits(candidates: string[]): string {
  return candidates.find((c) => c.length <= SMS_MAX_LENGTH) ?? candidates[candidates.length - 1];
}
