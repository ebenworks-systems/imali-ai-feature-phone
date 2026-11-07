/**
 * Pages that do not move.
 *
 * A list page must hold the same rows whether or not a notice (or the hint line) is showing, or the row numbers
 * would shift when the owner mistypes. So the budget for a page always reserves room for the notice that can
 * appear on a list (`Choose a number from the list.`) and for the `9 More` line, and the hint is never counted:
 * it is added only if the finished screen has room.
 */

import type { Currency } from '../../core/index.js';
import { USSD_LIMIT } from '../limits.js';
import { owesHeader, owesRow, payWhoRow, type OwesRow } from './screens.js';
import { LABEL, NOTICE } from './text.js';

export interface PageRange {
  start: number;
  /** Exclusive. */
  end: number;
}

/** The notice and its newline: the only notice a list screen can show. */
const NOTICE_ROOM = NOTICE.choose.length + 1;
const MORE_ROOM = LABEL.more.length;

/**
 * Splits rows into pages, filling each page greedily. Each row costs its length plus a newline. A page holds at
 * most `maxRows` rows and at least one, even if that one row is longer than the budget.
 */
export function paginate(rowLengths: number[], budget: number, maxRows: number): PageRange[] {
  const pages: PageRange[] = [];
  const limit = Math.max(1, maxRows);
  let start = 0;
  while (start < rowLengths.length) {
    let end = start;
    let used = 0;
    while (end < rowLengths.length && end - start < limit) {
      const cost = rowLengths[end]! + 1;
      if (end > start && used + cost > budget) break;
      used += cost;
      end += 1;
    }
    pages.push({ start, end });
    start = end;
  }
  return pages;
}

/** Room for the rows of a paid-back page: the limit less the notice, the title, `8 Other name` and `9 More`. */
export function payWhoBudget(): number {
  return USSD_LIMIT - NOTICE_ROOM - (LABEL.whoPaidBack.length + 1) - (LABEL.otherName.length + 1) - MORE_ROOM;
}

/** Room for the rows of a who-owes page: the limit less the notice, the `Owed to you: ...` line and `9 More`. */
export function owesBudget(headerLength: number): number {
  return Math.max(0, USSD_LIMIT - NOTICE_ROOM - (headerLength + 1) - MORE_ROOM);
}

/** At most 7 customers on a paid-back page, so that the numbers 8 and 9 stay free. */
export const PAY_WHO_MAX_ROWS = 7;

/** The pages of the paid-back list. Row `1` is as long as any other row number, so it stands for them all. */
export function payWhoPages(rows: OwesRow[], currency: Currency): PageRange[] {
  return paginate(
    rows.map((row) => payWhoRow(1, row, currency).length),
    payWhoBudget(),
    PAY_WHO_MAX_ROWS
  );
}

/** What all the customers on the list owe: the figure on the first line of the who-owes screens. */
export function totalOwed(rows: OwesRow[]): number {
  return rows.reduce((sum, row) => sum + row.owed, 0);
}

/** The pages of the who-owes list. There is no row limit; only the room on the screen. */
export function owesPages(rows: OwesRow[], currency: Currency): PageRange[] {
  const header = owesHeader(totalOwed(rows), currency);
  return paginate(
    rows.map((row) => owesRow(row, currency).length),
    owesBudget(header.length),
    Number.POSITIVE_INFINITY
  );
}

/** A page number (1 to N) kept within the pages that exist, because the records can change between requests. */
export function clampPage(page: number, pageCount: number): number {
  return Math.min(Math.max(1, page), Math.max(1, pageCount));
}
