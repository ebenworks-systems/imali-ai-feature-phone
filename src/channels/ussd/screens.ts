/**
 * The screens the owner answers: sign-up, the main menu, the prompts, the lists and the confirm screens.
 *
 * Each renderer returns a `Screen`. The prefix, the 182-character guard and the hint line are added by
 * `toResponse`. Names and items are made plain ASCII and clipped here (a shop name to 24 characters, a customer
 * name and an item to 20), because they may have been stored by a text message.
 */

import type { Currency } from '../../core/index.js';
import { MAX_CUSTOMER_NAME, MAX_ITEM, MAX_SHOP_NAME } from './input.js';
import type { Entry, Kind, Screen } from './screen.js';
import { LABEL, clip, money } from './text.js';

export const WELCOME = 'Welcome to the Imali AI ledger. Your shop name?';

/** The seven money choices at sign-up. */
export const CURRENCY_CHOICES = [
  '1 R South Africa',
  '2 $ US dollar',
  '3 KSh Kenya',
  '4 N Nigeria',
  '5 GHS Ghana',
  '6 K Zambia',
  '7 P Botswana'
] as const;

function withNotice(screen: Screen, notice: string | undefined): Screen {
  return notice === undefined ? screen : { ...screen, notice };
}

const name = (customer: string | undefined): string => clip(customer ?? '', MAX_CUSTOMER_NAME);
const item = (text: string | undefined): string => clip(text ?? '', MAX_ITEM);
const itemSuffix = (text: string | undefined): string => (text ? ` ${item(text)}` : '');

// ----------------------------------------------------------------------------
// Sign-up (no hint: there is no menu yet)
// ----------------------------------------------------------------------------

export function signupName(notice?: string): Screen {
  return withNotice({ id: 'signupName', end: false, lines: [WELCOME] }, notice);
}

export function signupCurrency(notice?: string): Screen {
  return withNotice(
    { id: 'signupCurrency', end: false, lines: ['Which money do you use?', ...CURRENCY_CHOICES] },
    notice
  );
}

// ----------------------------------------------------------------------------
// Main menu (fixed by .kiro/steering/screens.md; no hint)
// ----------------------------------------------------------------------------

export function mainMenu(a: {
  shopName: string;
  salesToday: number;
  currency: Currency;
  notice?: string;
}): Screen {
  return withNotice(
    {
      id: 'main',
      end: false,
      lines: [
        clip(a.shopName, MAX_SHOP_NAME),
        `Today: sales ${money(a.salesToday, a.currency)}`,
        '1 Sale',
        '2 Expense',
        '3 Owes (credit)',
        '4 Paid back',
        '5 Today',
        '6 Who owes',
        '7 Undo last',
        '8 Close day'
      ]
    },
    a.notice
  );
}

// ----------------------------------------------------------------------------
// Prompts for typed answers (hint)
// ----------------------------------------------------------------------------

export function amountPrompt(a: { kind: Kind; customer?: string; notice?: string }): Screen {
  const text =
    a.kind === 'sale'
      ? 'Sale amount?'
      : a.kind === 'expense'
        ? 'Amount spent?'
        : a.kind === 'debt'
          ? `How much does ${name(a.customer)} owe?`
          : `How much did ${name(a.customer)} pay?`;
  return withNotice({ id: 'amount', end: false, lines: [text], hint: true }, a.notice);
}

export function customerPrompt(notice?: string): Screen {
  return withNotice({ id: 'customer', end: false, lines: ['Customer name?'], hint: true }, notice);
}

export function itemPrompt(a: { kind: Kind; customer?: string; notice?: string }): Screen {
  const text =
    a.kind === 'sale'
      ? 'What was sold? 1 to skip'
      : a.kind === 'expense'
        ? 'What was it for? 1 to skip'
        : `What did ${name(a.customer)} take? 1 to skip`;
  return withNotice({ id: 'item', end: false, lines: [text], hint: true }, a.notice);
}

// ----------------------------------------------------------------------------
// Lists (hint on the CON screens)
// ----------------------------------------------------------------------------

export interface OwesRow {
  name: string;
  /** Cents the customer owes (above zero). */
  owed: number;
}

/** The text of one paid-back row, `1 Tendai R50`. The page budgets use its length. */
export function payWhoRow(n: number, row: OwesRow, currency: Currency): string {
  return `${n} ${clip(row.name, MAX_CUSTOMER_NAME)} ${money(row.owed, currency)}`;
}

/** A who-owes row, `Tendai R50`. Not numbered: the owner cannot pick one. */
export function owesRow(row: OwesRow, currency: Currency): string {
  return `${clip(row.name, MAX_CUSTOMER_NAME)} ${money(row.owed, currency)}`;
}

/** The paid-back list: the customers on this page (`1`..`7`), `8 Other name`, and `9 More` when more follow. */
export function payWhoList(a: {
  rows: OwesRow[];
  hasMore: boolean;
  currency: Currency;
  notice?: string;
}): Screen {
  const lines = [
    LABEL.whoPaidBack,
    ...a.rows.map((row, i) => payWhoRow(i + 1, row, a.currency)),
    LABEL.otherName,
    ...(a.hasMore ? [LABEL.more] : [])
  ];
  return withNotice({ id: 'payWho', end: false, lines, hint: true }, a.notice);
}

/** The line at the top of the who-owes screens. The page budget uses its length. */
export function owesHeader(totalOwed: number, currency: Currency): string {
  return `Owed to you: ${money(totalOwed, currency)}`;
}

/**
 * A who-owes screen. With `hasMore` it continues (`owesList`, with `9 More` and the hint); the last or only
 * screen has no `9 More` and ends the session (`owesEnd`, no hint).
 */
export function owesScreen(a: {
  totalOwed: number;
  rows: OwesRow[];
  hasMore: boolean;
  currency: Currency;
  notice?: string;
}): Screen {
  const lines = [owesHeader(a.totalOwed, a.currency), ...a.rows.map((row) => owesRow(row, a.currency))];
  if (a.hasMore) {
    return withNotice({ id: 'owesList', end: false, lines: [...lines, LABEL.more], hint: true }, a.notice);
  }
  return withNotice({ id: 'owesEnd', end: true, lines }, a.notice);
}

// ----------------------------------------------------------------------------
// Confirm screens (hint)
// ----------------------------------------------------------------------------

/** `sale R45 bread`, `expense R20 taxi`, `Tendai owes R20 sugar`, `Tendai paid R10`. */
function savePhrase(e: Entry, currency: Currency): string {
  const m = money(e.cents, currency);
  switch (e.kind) {
    case 'sale':
      return `sale ${m}${itemSuffix(e.item)}`;
    case 'expense':
      return `expense ${m}${itemSuffix(e.item)}`;
    case 'debt':
      return `${name(e.customer)} owes ${m}${itemSuffix(e.item)}`;
    case 'payment':
      return `${name(e.customer)} paid ${m}`;
  }
}

/** `sale R45 bread`, `spent R20 taxi`, `Tendai owes R20 sugar`, `Tendai paid R10`: how a past entry is named. */
export function pastPhrase(e: Entry, currency: Currency): string {
  const m = money(e.cents, currency);
  switch (e.kind) {
    case 'sale':
      return `sale ${m}${itemSuffix(e.item)}`;
    case 'expense':
      return `spent ${m}${itemSuffix(e.item)}`;
    case 'debt':
      return `${name(e.customer)} owes ${m}${itemSuffix(e.item)}`;
    case 'payment':
      return `${name(e.customer)} paid ${m}`;
  }
}

export function confirmScreen(a: { entry: Entry; currency: Currency; notice?: string }): Screen {
  return withNotice(
    { id: 'confirm', end: false, lines: [`Save ${savePhrase(a.entry, a.currency)}? 1 Yes 2 No`], hint: true },
    a.notice
  );
}

export function confirmBigScreen(a: { cents: number; currency: Currency; notice?: string }): Screen {
  return withNotice(
    {
      id: 'confirmBig',
      end: false,
      lines: [`That is a big amount: ${money(a.cents, a.currency)}. 1 Yes, save 2 No`],
      hint: true
    },
    a.notice
  );
}

export function undoConfirmScreen(a: { entry: Entry; currency: Currency; notice?: string }): Screen {
  return withNotice(
    { id: 'undoConfirm', end: false, lines: [`Undo ${pastPhrase(a.entry, a.currency)}? 1 Yes 2 No`], hint: true },
    a.notice
  );
}
