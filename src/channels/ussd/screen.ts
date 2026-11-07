/**
 * What a screen is, and the length guard every response passes through.
 *
 * A renderer builds a `Screen`; `toResponse` turns it into the `CON ` or `END ` text and makes sure it is at most
 * 182 characters after the prefix. Nothing else in the menu adds the prefix or counts characters.
 */

import { USSD_LIMIT } from '../limits.js';
import { HINT } from './text.js';

export const SCREEN_IDS = [
  // the session continues (CON)
  'signupName',
  'signupCurrency',
  'main',
  'amount',
  'item',
  'customer',
  'payWho',
  'confirm',
  'confirmBig',
  'owesList',
  'undoConfirm',
  // the session ends (END)
  'saved',
  'undone',
  'today',
  'close',
  'owesEnd',
  'owesNone',
  'nothingToUndo',
  'saveFailed',
  'badRequest',
  'tooBig'
] as const;

export type ScreenId = (typeof SCREEN_IDS)[number];

/** The four things the owner can record. */
export type Kind = 'sale' | 'expense' | 'debt' | 'payment';

/** One entry as the screens talk about it. */
export interface Entry {
  kind: Kind;
  cents: number;
  item?: string;
  /** For `debt` and `payment`. */
  customer?: string;
}

export interface Screen {
  id: ScreenId;
  /** True when the session ends (`END `). */
  end: boolean;
  /** First line. Dropped first when the screen is too long. */
  notice?: string;
  /** The lines of the screen, joined with a newline. */
  lines: string[];
  /** Smaller versions of `lines`, tried in order (the closing summary uses this). */
  shrink?: string[][];
  /** Add the hint line (`0 Back 00 Menu`) last, but only when the result still fits. Ignored on `end` screens. */
  hint?: boolean;
}

export const TOO_BIG_TEXT = 'These numbers are too big to show here.';

const join = (lines: string[]): string => lines.join('\n');

/**
 * The response for a screen: its prefix and its text.
 *
 * 1. `notice + lines` when it is 182 characters or fewer.
 * 2. `lines` without the notice.
 * 3. Each `shrink` version, in order.
 * 4. Otherwise `END These numbers are too big to show here.`
 * 5. Last, for a `hint` screen that continues: `\n0 Back 00 Menu` is added to the text chosen in steps 1 to 3, but
 *    only if the result still fits. The hint never causes anything else to be dropped.
 */
export function toResponse(screen: Screen): string {
  const prefix = screen.end ? 'END ' : 'CON ';

  const candidates: string[] = [];
  if (screen.notice !== undefined && screen.notice !== '') {
    candidates.push(join([screen.notice, ...screen.lines]));
  }
  candidates.push(join(screen.lines));
  for (const smaller of screen.shrink ?? []) {
    candidates.push(join(smaller));
  }

  const body = candidates.find((text) => text.length <= USSD_LIMIT);
  if (body === undefined) {
    return `END ${TOO_BIG_TEXT}`;
  }

  if (screen.hint === true && !screen.end) {
    const withHint = `${body}\n${HINT}`;
    if (withHint.length <= USSD_LIMIT) {
      return `${prefix}${withHint}`;
    }
  }
  return `${prefix}${body}`;
}
