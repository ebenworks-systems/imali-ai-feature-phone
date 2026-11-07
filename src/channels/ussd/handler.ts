/**
 * The dialled menu: one request in, one screen out.
 *
 * Africa's Talking calls this with `sessionId`, `serviceCode`, `phoneNumber` and `text`, where `text` is everything
 * the owner has typed in the session joined by `*`. Nothing is kept between requests: the screen is worked out from
 * the phone number, the shop's records and the whole path, by replaying the path through the state machine.
 *
 *   const { response } = await handleUssd({ sessionId, serviceCode, phoneNumber, text, now: new Date(), store });
 *
 * The response starts `CON ` (the session continues) or `END ` (it ends) and is at most 182 characters after that.
 * The time comes from `now`; the clock is never read here.
 */

import {
  getDayCloseSummary,
  getTodaySummary,
  type LedgerStore,
  type Shop
} from '../../core/index.js';
import { saveDraft, undoLast, type ActionContext } from './actions.js';
import { shopIdFor } from './ids.js';
import { replay, type Draft, type MenuState, type Terminal } from './machine.js';
import { clampPage, owesPages, payWhoPages, totalOwed } from './pages.js';
import { makePorts, type MenuPorts } from './ports.js';
import { readRequest } from './request.js';
import {
  badRequestScreen,
  closeScreen,
  nothingToUndoScreen,
  owesNoneScreen,
  saveFailedScreen,
  savedScreen,
  todayScreen,
  tooBigScreen,
  undoneScreen
} from './results.js';
import { TOO_BIG_TEXT, toResponse, type Entry, type Screen, type ScreenId } from './screen.js';
import {
  amountPrompt,
  confirmBigScreen,
  confirmScreen,
  customerPrompt,
  itemPrompt,
  mainMenu,
  owesScreen,
  payWhoList,
  signupCurrency,
  signupName,
  undoConfirmScreen,
  type OwesRow
} from './screens.js';

export interface HandleUssdParams {
  /** The network's id for this dialled session. */
  sessionId: string;
  /** The short code that was dialled. Read but not used. */
  serviceCode: string;
  /** The owner's phone number, as the network gives it. */
  phoneNumber: string;
  /** Everything typed in this session, joined by `*`. Empty on the first request. */
  text: string;
  /** The time of the request. "Today" is the shop's local day at this time. */
  now: Date;
  store: LedgerStore;
}

export interface HandleUssdResult {
  response: string;
}

export async function handleUssd(params: HandleUssdParams): Promise<HandleUssdResult> {
  const { response } = await runMenu(params);
  return { response };
}

/**
 * Same work as `handleUssd`, and also says which screen was shown. For tests and `check:screens`; not exported
 * from `src/channels/index.ts`.
 */
export async function runMenu(params: HandleUssdParams): Promise<{ response: string; screen: ScreenId }> {
  let screen: Screen;
  try {
    screen = await buildScreen(params);
  } catch (error) {
    // Only the name and the message: never the phone number, the typed text or a name.
    const name = error instanceof Error ? error.name : 'Error';
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ussd: ${name}: ${message}`);
    screen = badRequestScreen();
  }
  const response = toResponse(screen);
  const tooBig = response === `END ${TOO_BIG_TEXT}`;
  return { response, screen: tooBig ? 'tooBig' : screen.id };
}

async function buildScreen(params: HandleUssdParams): Promise<Screen> {
  const read = readRequest(params);
  if (!read.ok) {
    return badRequestScreen();
  }
  const { sessionId, phone, inputs } = read.request;
  const { store, now } = params;

  const found = await store.findShopByPhone(phone);
  // No shop yet, or the shop was made earlier in this same session: the sign-up inputs are read again, so the
  // inputs after them go to the main menu.
  const start = found === null || found.id === shopIdFor(sessionId) ? 'signup' : 'main';

  const ports = makePorts({ store, shop: found, sessionId, phone, now });
  const state = await replay(inputs, ports, start);

  const ctx = { store, ports, sessionId, inputs, now };
  return state.terminal ? runTerminal(ctx, state.terminal) : renderTop(ctx, state);
}

interface Context {
  store: LedgerStore;
  ports: MenuPorts;
  sessionId: string;
  inputs: string[];
  now: Date;
}

function shopOf(ctx: Context): Shop {
  if (!ctx.ports.shop) {
    throw new Error('The menu needs a shop here');
  }
  return ctx.ports.shop;
}

/** A figure that is not a safe whole number of cents cannot be shown truthfully. */
function safe(figures: number[]): boolean {
  return figures.every((n) => Number.isSafeInteger(n));
}

// ============================================================================
// Screens that ask the owner something
// ============================================================================

async function renderTop(ctx: Context, state: MenuState): Promise<Screen> {
  const frame = state.frames[state.frames.length - 1]!;
  const notice = state.notice;

  switch (frame.id) {
    case 'signupName':
      return signupName(notice);
    case 'signupCurrency':
      return signupCurrency(notice);
    case 'main': {
      const shop = shopOf(ctx);
      const today = await getTodaySummary(ctx.store, shop, ctx.now);
      if (!safe([today.sales.total])) return tooBigScreen();
      return mainMenu({ shopName: shop.name, salesToday: today.sales.total, currency: shop.currency, notice });
    }
    case 'amount':
      return amountPrompt({ kind: frame.draft.kind, customer: frame.draft.customer, notice });
    case 'item':
      return itemPrompt({ kind: frame.draft.kind, customer: frame.draft.customer, notice });
    case 'customer':
      return customerPrompt(notice);
    case 'payWho':
      return renderPayWho(ctx, frame.page, notice);
    case 'owesList':
      return renderOwes(ctx, frame.page, notice);
    case 'confirm':
      return confirmScreen({ entry: entryOf(frame.draft), currency: shopOf(ctx).currency, notice });
    case 'confirmBig':
      return confirmBigScreen({ cents: frame.draft.cents ?? 0, currency: shopOf(ctx).currency, notice });
    case 'undoConfirm': {
      const target = await ctx.ports.undoTarget();
      if (!target) return nothingToUndoScreen();
      const entry: Entry = {
        kind: target.kind,
        cents: target.cents,
        ...(target.item ? { item: target.item } : {}),
        ...(target.customer ? { customer: target.customer } : {})
      };
      return undoConfirmScreen({ entry, currency: shopOf(ctx).currency, notice });
    }
  }
}

function entryOf(draft: Draft): Entry {
  return {
    kind: draft.kind,
    cents: draft.cents ?? 0,
    ...(draft.item ? { item: draft.item } : {}),
    ...(draft.customer ? { customer: draft.customer } : {})
  };
}

async function owesRows(ctx: Context): Promise<OwesRow[]> {
  return (await ctx.ports.owes()).map((c) => ({ name: c.displayName, owed: c.balance }));
}

async function renderPayWho(ctx: Context, page: number, notice: string | undefined): Promise<Screen> {
  const currency = shopOf(ctx).currency;
  const rows = await owesRows(ctx);
  const pages = payWhoPages(rows, currency);
  const current = clampPage(page, pages.length);
  const range = pages[current - 1];
  return payWhoList({
    rows: range ? rows.slice(range.start, range.end) : [],
    hasMore: current < pages.length,
    currency,
    notice
  });
}

/**
 * One page of the who-owes list. The last page has no `9 More` and ends the session. `isLast` is for a path that
 * already reached its last page: it ends even if the records changed and a later page now exists.
 */
async function renderOwes(ctx: Context, page: number, notice: string | undefined, isLast = false): Promise<Screen> {
  const currency = shopOf(ctx).currency;
  const rows = await owesRows(ctx);
  if (rows.length === 0) return owesNoneScreen();
  const pages = owesPages(rows, currency);
  const current = clampPage(page, pages.length);
  const range = pages[current - 1]!;
  const total = totalOwed(rows);
  if (!safe([total])) return tooBigScreen();
  return owesScreen({
    totalOwed: total,
    rows: rows.slice(range.start, range.end),
    hasMore: !isLast && current < pages.length,
    currency,
    notice
  });
}

// ============================================================================
// Steps that end the session
// ============================================================================

async function runTerminal(ctx: Context, terminal: Terminal): Promise<Screen> {
  const { store, now } = ctx;

  switch (terminal.type) {
    case 'today': {
      const shop = shopOf(ctx);
      const summary = await getTodaySummary(store, shop, now);
      const figures = [summary.sales.total, summary.expenses.total, summary.moneyInHand];
      return safe(figures) ? todayScreen(summary, shop.currency) : tooBigScreen();
    }
    case 'close': {
      const shop = shopOf(ctx);
      const summary = await getDayCloseSummary(store, shop, { now });
      const figures = [
        summary.sales.total,
        summary.expenses.total,
        summary.moneyInHand,
        summary.newDebts,
        summary.paymentsReceived,
        summary.totalOwed
      ];
      return safe(figures) ? closeScreen(summary, shop.currency) : tooBigScreen();
    }
    case 'owesNone':
      return owesNoneScreen();
    case 'owesEnd':
      return renderOwes(ctx, terminal.page, undefined, true);
    case 'nothingToUndo':
      return nothingToUndoScreen();
    case 'save': {
      const shop = shopOf(ctx);
      const outcome = await saveDraft(actionContext(ctx, shop), terminal.draft, terminal.step);
      return outcome.ok ? savedScreen(outcome.facts, shop.currency) : saveFailedScreen();
    }
    case 'undo': {
      const shop = shopOf(ctx);
      const outcome = await undoLast(actionContext(ctx, shop), terminal.step);
      if (outcome.ok) return undoneScreen(outcome.facts, shop.currency);
      return outcome.nothingToUndo ? nothingToUndoScreen() : saveFailedScreen();
    }
  }
}

function actionContext(ctx: Context, shop: Shop): ActionContext {
  return { store: ctx.store, shop, sessionId: ctx.sessionId, path: ctx.inputs, now: ctx.now };
}
