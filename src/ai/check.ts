/**
 * The rule check on what a model proposes (requirement 47).
 *
 * The model only proposes. This check decides, and it works for any ModelReader. A proposal is accepted only
 * when everything it says can be found in the owner's own words:
 *
 * - the kind is sale, expense, debt or payment (anything else is refused);
 * - the amount substring occurs in the message (ignoring case), as a whole number, and parseAmount reads it
 *   in the shop's currency as exactly the cents the proposal claims (so "45" is 4500 cents, not 45);
 * - the customer substring occurs in the message (ignoring case), as a whole word, and has at least one letter.
 *   A customer is required for debt and payment and refused for sale and expense;
 * - an item the model adds is kept only if it also occurs in the message; otherwise it is left off.
 *
 * What comes back is a new Intent built from the owner's own words, not the proposal's object: the customer
 * is written the way the owner typed it. A refused proposal gives { kind: 'unknown' }, which the handler
 * answers with the unknown reply.
 */

import { customerKey, parseAmount, type Currency } from '../core/index.js';
import type { Intent } from '../channels/sms/reader.js';
import type { Proposal } from './reader.js';

const REFUSED: Intent = { kind: 'unknown' };

/** Check a proposal against the owner's message. Never throws. */
export function checkProposal(
  proposal: Proposal | null | undefined,
  text: string,
  currency: Currency
): Intent {
  try {
    return check(proposal, text, currency) ?? REFUSED;
  } catch {
    return REFUSED;
  }
}

function check(proposal: Proposal | null | undefined, text: string, currency: Currency): Intent | null {
  if (!proposal || typeof proposal !== 'object' || typeof text !== 'string') return null;
  const intent = proposal.intent as unknown as Record<string, unknown> | null | undefined;
  if (!intent || typeof intent !== 'object') return null;

  const kind = intent.kind;
  if (kind !== 'sale' && kind !== 'expense' && kind !== 'debt' && kind !== 'payment') return null;

  // The amount: it must be in the message, and mean exactly the cents claimed.
  const cents = intent.cents;
  if (typeof cents !== 'number' || !Number.isSafeInteger(cents)) return null;
  if (typeof proposal.amountSubstring !== 'string') return null;
  const amountText = proposal.amountSubstring.trim();
  if (amountText === '' || !amountOccurs(text, amountText)) return null;
  const parsed = parseAmount(amountText, currency);
  if (parsed.type !== 'success' || parsed.amount.cents !== cents) return null;

  // The customer: required for debt and payment, refused for sale and expense.
  const claimedCustomer = typeof intent.customer === 'string' ? intent.customer.trim() : '';
  const customerText =
    typeof proposal.customerSubstring === 'string' ? proposal.customerSubstring.trim() : '';

  if (kind === 'sale' || kind === 'expense') {
    if (customerText !== '' || claimedCustomer !== '') return null;
  }

  let customer: string | undefined;
  if (kind === 'debt' || kind === 'payment') {
    if (customerText === '') return null;
    // A name has at least one letter: "20" or "--" is not a person.
    if (!/\p{L}/u.test(customerText)) return null;
    // The intent must name the same person as the substring that was checked.
    if (customerKey(claimedCustomer) !== customerKey(customerText)) return null;
    const typed = wordOccurrence(text, customerText);
    if (typed === null) return null;
    customer = typed;
  }

  // The item is not required. If the model made one up, leave it off rather than record it.
  let item: string | undefined;
  if (typeof intent.item === 'string' && intent.item.trim() !== '') {
    const typed = wordOccurrence(text, intent.item.trim());
    if (typed !== null) item = typed.toLowerCase();
  }

  switch (kind) {
    case 'sale':
      return { kind: 'sale', cents, ...(item !== undefined ? { item } : {}) };
    case 'expense':
      return { kind: 'expense', cents, ...(item !== undefined ? { item } : {}) };
    case 'debt':
      return { kind: 'debt', customer: customer!, cents, ...(item !== undefined ? { item } : {}) };
    case 'payment':
      return { kind: 'payment', customer: customer!, cents };
  }
}

// ============================================================================
// Finding the model's words in the owner's message
// ============================================================================

/**
 * True when `needle` occurs in `text` (ignoring case) as a whole number. "45" is not found in "450" or in
 * "4.5", and "200" is not found in "2 200" (where the owner typed 2,200 or 2 items).
 */
export function amountOccurs(text: string, needle: string): boolean {
  if (needle === '') return false;
  const hay = text.toLowerCase();
  const find = needle.toLowerCase();
  let from = 0;
  for (;;) {
    const at = hay.indexOf(find, from);
    if (at === -1) return false;
    if (wholeNumber(hay, at, at + find.length)) return true;
    from = at + 1;
  }
}

function wholeNumber(hay: string, start: number, end: number): boolean {
  const before = hay.slice(0, start);
  const match = hay.slice(start, end);
  const after = hay.slice(end);

  if (/\d$/.test(before)) return false; // part of a longer number on the left
  if (/\d[.,]$/.test(before)) return false; // the cents or a thousands group of a number on the left
  if (/^\d{3}(?!\d)/.test(match) && /\d\s$/.test(before)) return false; // "2 200": 200 is a thousands group

  if (/^\d/.test(after)) return false; // part of a longer number on the right
  if (/^[.,]\d/.test(after)) return false; // the start of its cents or a thousands group
  if (/\d$/.test(match) && /^\s\d{3}(?!\d)/.test(after)) return false; // "2 200": 2 is the front of 2,200
  return true;
}

/**
 * The text as the owner typed it, if `needle` occurs in `text` (ignoring case) as a whole word.
 * Returns null when it does not occur.
 */
export function wordOccurrence(text: string, needle: string): string | null {
  if (needle === '') return null;
  const hay = text.toLowerCase();
  const find = needle.toLowerCase();
  let from = 0;
  for (;;) {
    const at = hay.indexOf(find, from);
    if (at === -1) return null;
    const before = hay.slice(0, at);
    const after = hay.slice(at + find.length);
    if (!/[\p{L}\p{N}]$/u.test(before) && !/^[\p{L}\p{N}]/u.test(after)) {
      // Lower-casing can change the length of a few exotic characters; then use the words as proposed.
      return hay.length === text.length ? text.slice(at, at + find.length) : needle;
    }
    from = at + 1;
  }
}
