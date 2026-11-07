/**
 * The state machine: reads the whole typed path, one input at a time, and says which screen to show.
 *
 * Nothing is kept between requests. Every request replays `text` from the first screen, so the screen depends only
 * on the phone number, the shop's records and the path. A path that reaches a saving or looking-up step stops
 * there with a `Terminal`; the handler carries it out.
 *
 * `0` goes back one screen and `00` goes to the main menu (or to the first sign-up screen while there is no shop),
 * from any screen, before the screen's own rules: so `0` and `00` can never be an amount, a name or an item.
 */

import { requiresConfirmation } from '../../core/index.js';
import { readAmount, readCustomerName, readItem, readShopName } from './input.js';
import { clampPage, owesPages, payWhoPages } from './pages.js';
import type { MenuPorts } from './ports.js';
import type { Kind } from './screen.js';
import type { OwesRow } from './screens.js';
import { NOTICE } from './text.js';

export type { Kind } from './screen.js';

export interface Draft {
  kind: Kind;
  customer?: string;
  cents?: number;
  item?: string;
  /** The owner said yes to the big-amount screen. */
  bigOk?: boolean;
}

export type Frame =
  | { id: 'signupName' }
  | { id: 'signupCurrency'; name: string }
  | { id: 'main' }
  | { id: 'amount'; draft: Draft }
  | { id: 'item'; draft: Draft }
  | { id: 'customer'; draft: Draft }
  | { id: 'payWho'; page: number }
  | { id: 'confirm'; draft: Draft }
  | { id: 'confirmBig'; draft: Draft }
  | { id: 'owesList'; page: number }
  | { id: 'undoConfirm' };

export type Terminal =
  /** `step` is the number of inputs read, counting the confirming one. */
  | { type: 'save'; draft: Draft; step: number }
  | { type: 'undo'; step: number }
  | { type: 'today' }
  | { type: 'close' }
  | { type: 'owesEnd'; page: number }
  | { type: 'owesNone' }
  | { type: 'nothingToUndo' };

export interface MenuState {
  /** The screens the owner has walked through; the last one is on show. */
  frames: Frame[];
  /** Shown as the first line, from the last input only. */
  notice?: string;
  /** Set when the path reached a step that ends the session. */
  terminal?: Terminal;
}

/** One input's effect on the stack. */
type Step =
  | { to: 'push'; frame: Frame }
  | { to: 'replace'; frames: Frame[]; notice?: string }
  | { to: 'stay'; notice?: string }
  | { to: 'end'; terminal: Terminal }
  | { to: 'signedUp' };

const stay = (notice?: string): Step => ({ to: 'stay', notice });
const choose = (): Step => stay(NOTICE.choose);

export async function replay(inputs: string[], ports: MenuPorts, start: 'signup' | 'main'): Promise<MenuState> {
  let signedUp = start === 'main';
  let frames: Frame[] = [start === 'main' ? { id: 'main' } : { id: 'signupName' }];
  let notice: string | undefined;

  const bottom = (): Frame => (signedUp ? { id: 'main' } : { id: 'signupName' });

  for (let index = 0; index < inputs.length; index += 1) {
    const input = (inputs[index] ?? '').trim();
    const step = index + 1;
    notice = undefined;

    if (input === '00') {
      frames = [bottom()];
      continue;
    }
    if (input === '0') {
      if (frames.length > 1) frames = frames.slice(0, -1);
      continue;
    }

    const top = frames[frames.length - 1]!;
    const result = await transition(top, input, step, ports);

    switch (result.to) {
      case 'push':
        frames = [...frames, result.frame];
        break;
      case 'replace':
        frames = result.frames;
        notice = result.notice;
        break;
      case 'stay':
        notice = result.notice;
        break;
      case 'signedUp':
        signedUp = true;
        frames = [{ id: 'main' }];
        break;
      case 'end':
        return { frames, terminal: result.terminal };
    }
  }

  return notice === undefined ? { frames } : { frames, notice };
}

// ============================================================================
// The transition table, one function per kind of screen
// ============================================================================

async function transition(top: Frame, input: string, step: number, ports: MenuPorts): Promise<Step> {
  switch (top.id) {
    case 'signupName':
      return signupName(input);
    case 'signupCurrency':
      return signupCurrency(top.name, input, ports);
    case 'main':
      return mainMenu(input, ports);
    case 'customer':
      return customer(top.draft, input);
    case 'payWho':
      return payWho(top.page, input, ports);
    case 'amount':
      return amount(top.draft, input, ports);
    case 'item':
      return item(top.draft, input);
    case 'confirm':
      return confirm(top.draft, input, step);
    case 'confirmBig':
      return confirmBig(top.draft, input, step);
    case 'owesList':
      return owesList(top.page, input, ports);
    case 'undoConfirm':
      return undoConfirm(input, step);
  }
}

const MAIN: Frame[] = [{ id: 'main' }];

function signupName(input: string): Step {
  const name = readShopName(input);
  return name.ok ? { to: 'push', frame: { id: 'signupCurrency', name: name.value } } : stay(name.notice);
}

async function signupCurrency(name: string, input: string, ports: MenuPorts): Promise<Step> {
  if (!/^[1-7]$/.test(input)) return choose();
  await ports.createShop(name, Number(input));
  return { to: 'signedUp' };
}

async function mainMenu(input: string, ports: MenuPorts): Promise<Step> {
  switch (input) {
    case '1':
      return { to: 'push', frame: { id: 'amount', draft: { kind: 'sale' } } };
    case '2':
      return { to: 'push', frame: { id: 'amount', draft: { kind: 'expense' } } };
    case '3':
      return { to: 'push', frame: { id: 'customer', draft: { kind: 'debt' } } };
    case '4': {
      const rows = await owesRows(ports);
      return rows.length === 0
        ? { to: 'push', frame: { id: 'customer', draft: { kind: 'payment' } } }
        : { to: 'push', frame: { id: 'payWho', page: 1 } };
    }
    case '5':
      return { to: 'end', terminal: { type: 'today' } };
    case '6': {
      const rows = await owesRows(ports);
      if (rows.length === 0) return { to: 'end', terminal: { type: 'owesNone' } };
      const pages = owesPages(rows, currencyOf(ports));
      return pages.length === 1
        ? { to: 'end', terminal: { type: 'owesEnd', page: 1 } }
        : { to: 'push', frame: { id: 'owesList', page: 1 } };
    }
    case '7':
      return (await ports.undoTarget()) === null
        ? { to: 'end', terminal: { type: 'nothingToUndo' } }
        : { to: 'push', frame: { id: 'undoConfirm' } };
    case '8':
      return { to: 'end', terminal: { type: 'close' } };
    default:
      return choose();
  }
}

function customer(draft: Draft, input: string): Step {
  const name = readCustomerName(input);
  return name.ok
    ? { to: 'push', frame: { id: 'amount', draft: { ...draft, customer: name.value } } }
    : stay(name.notice);
}

async function payWho(page: number, input: string, ports: MenuPorts): Promise<Step> {
  const rows = await owesRows(ports);
  const pages = payWhoPages(rows, currencyOf(ports));
  const current = clampPage(page, pages.length);
  const range = pages[current - 1];

  if (input === '8') {
    return { to: 'push', frame: { id: 'customer', draft: { kind: 'payment' } } };
  }
  if (input === '9') {
    return current < pages.length ? { to: 'push', frame: { id: 'payWho', page: current + 1 } } : choose();
  }
  const pick = /^[1-7]$/.test(input) ? Number(input) : 0;
  if (range && pick >= 1 && pick <= range.end - range.start) {
    const row = rows[range.start + pick - 1]!;
    return { to: 'push', frame: { id: 'amount', draft: { kind: 'payment', customer: row.name } } };
  }
  return choose();
}

function amount(draft: Draft, input: string, ports: MenuPorts): Step {
  const read = readAmount(input, currencyOf(ports));
  if (!read.ok) return stay(read.notice);
  const next: Draft = { ...draft, cents: read.cents };
  return draft.kind === 'payment'
    ? { to: 'push', frame: { id: 'confirm', draft: next } }
    : { to: 'push', frame: { id: 'item', draft: next } };
}

function item(draft: Draft, input: string): Step {
  if (input === '1') return { to: 'push', frame: { id: 'confirm', draft } };
  const read = readItem(input);
  return read.ok ? { to: 'push', frame: { id: 'confirm', draft: { ...draft, item: read.value } } } : stay(read.notice);
}

function confirm(draft: Draft, input: string, step: number): Step {
  if (input === '1') {
    return requiresConfirmation(draft.cents ?? 0)
      ? { to: 'push', frame: { id: 'confirmBig', draft } }
      : { to: 'end', terminal: { type: 'save', draft, step } };
  }
  if (input === '2') return { to: 'replace', frames: MAIN, notice: NOTICE.notSaved };
  return choose();
}

function confirmBig(draft: Draft, input: string, step: number): Step {
  if (input === '1') return { to: 'end', terminal: { type: 'save', draft: { ...draft, bigOk: true }, step } };
  if (input === '2') return { to: 'replace', frames: MAIN, notice: NOTICE.notSaved };
  return choose();
}

async function owesList(page: number, input: string, ports: MenuPorts): Promise<Step> {
  if (input !== '9') return choose();
  const rows = await owesRows(ports);
  const pages = owesPages(rows, currencyOf(ports));
  const next = clampPage(page, pages.length) + 1;
  if (next >= pages.length) {
    return { to: 'end', terminal: { type: 'owesEnd', page: Math.max(1, pages.length) } };
  }
  return { to: 'push', frame: { id: 'owesList', page: next } };
}

function undoConfirm(input: string, step: number): Step {
  if (input === '1') return { to: 'end', terminal: { type: 'undo', step } };
  if (input === '2') return { to: 'replace', frames: MAIN, notice: NOTICE.notUndone };
  return choose();
}

// ----------------------------------------------------------------------------

async function owesRows(ports: MenuPorts): Promise<OwesRow[]> {
  return (await ports.owes()).map((c) => ({ name: c.displayName, owed: c.balance }));
}

function currencyOf(ports: MenuPorts) {
  if (!ports.shop) {
    throw new Error('The menu needs a shop here');
  }
  return ports.shop.currency;
}
