/**
 * The ending screens (`END`): what was saved or undone, today, the closing summary, and the plain failures.
 *
 * None of them carries the hint line. The new figure on a saved or undone screen is worked out from the records
 * after the change, never from the amount just saved.
 */

import type { Currency, DayCloseSummary, TodaySummary } from '../../core/index.js';
import { MAX_CUSTOMER_NAME, MAX_ITEM } from './input.js';
import { TOO_BIG_TEXT, type Entry, type Screen } from './screen.js';
import { clip, dayLabel, money } from './text.js';

/** The figure shown after a change. A balance is positive when the customer owes and negative on credit. */
export type FigureFacts =
  | { kind: 'salesToday' | 'expensesToday'; cents: number }
  | { kind: 'balance'; customer: string; cents: number; wording: 'total' | 'now' };

export interface SavedFacts {
  entry: Entry;
  figure: FigureFacts;
}

export interface UndoneFacts {
  /** The record that was really undone. */
  entry: Entry;
  figure: FigureFacts;
}

export const NOBODY_OWES = 'Nobody owes you money.';
export const NOTHING_TO_UNDO = 'Nothing to undo.';
export const SAVE_FAILED = 'Sorry, that was not saved. Please try again.';
export const SOMETHING_WENT_WRONG = 'Sorry, something went wrong. Please dial again.';

const name = (customer: string | undefined): string => clip(customer ?? '', MAX_CUSTOMER_NAME);
const itemSuffix = (text: string | undefined): string => (text ? ` ${clip(text, MAX_ITEM)}` : '');

/** `sale R45 bread`, `spent R20 taxi`, `Tendai owes R20 sugar`, `Tendai paid R10`. */
function phrase(e: Entry, currency: Currency): string {
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

function figureSentence(f: FigureFacts, currency: Currency): string {
  switch (f.kind) {
    case 'salesToday':
      return `Sales today ${money(f.cents, currency)}.`;
    case 'expensesToday':
      return `Spent today ${money(f.cents, currency)}.`;
    case 'balance': {
      const who = name(f.customer);
      if (f.cents > 0) {
        return f.wording === 'total'
          ? `${who} owes ${money(f.cents, currency)} in total.`
          : `${who} owes ${money(f.cents, currency)} now.`;
      }
      if (f.cents === 0) return `${who} owes nothing now.`;
      return `${who} has ${money(-f.cents, currency)} credit now.`;
    }
  }
}

export function savedScreen(facts: SavedFacts, currency: Currency): Screen {
  return {
    id: 'saved',
    end: true,
    lines: [`Saved: ${phrase(facts.entry, currency)}. ${figureSentence(facts.figure, currency)}`]
  };
}

export function undoneScreen(facts: UndoneFacts, currency: Currency): Screen {
  return {
    id: 'undone',
    end: true,
    lines: [`Undone: ${phrase(facts.entry, currency)}. ${figureSentence(facts.figure, currency)}`]
  };
}

export function todayScreen(summary: TodaySummary, currency: Currency): Screen {
  return {
    id: 'today',
    end: true,
    lines: [
      'Today',
      `Sales ${money(summary.sales.total, currency)} (${summary.sales.count})`,
      `Spent ${money(summary.expenses.total, currency)}`,
      `In hand ${money(summary.moneyInHand, currency)}`
    ]
  };
}

/** The closing summary. Too long: drop the date line, then the counts in brackets. */
export function closeScreen(summary: DayCloseSummary, currency: Currency): Screen {
  const date = `Close ${dayLabel(summary.date)}`;
  const sales = `Sales ${money(summary.sales.total, currency)}`;
  const rest = [
    `Spent ${money(summary.expenses.total, currency)}`,
    `In hand ${money(summary.moneyInHand, currency)}`,
    `Credit given ${money(summary.newDebts, currency)}`,
    `Paid back ${money(summary.paymentsReceived, currency)}`,
    `Total owed ${money(summary.totalOwed, currency)}`
  ];
  const withCount = `${sales} (${summary.sales.count})`;
  return {
    id: 'close',
    end: true,
    lines: [date, withCount, ...rest],
    shrink: [
      [withCount, ...rest],
      [sales, ...rest]
    ]
  };
}

export function owesNoneScreen(): Screen {
  return { id: 'owesNone', end: true, lines: [NOBODY_OWES] };
}

export function nothingToUndoScreen(): Screen {
  return { id: 'nothingToUndo', end: true, lines: [NOTHING_TO_UNDO] };
}

export function saveFailedScreen(): Screen {
  return { id: 'saveFailed', end: true, lines: [SAVE_FAILED] };
}

export function badRequestScreen(): Screen {
  return { id: 'badRequest', end: true, lines: [SOMETHING_WENT_WRONG] };
}

export function tooBigScreen(): Screen {
  return { id: 'tooBig', end: true, lines: [TOO_BIG_TEXT] };
}
