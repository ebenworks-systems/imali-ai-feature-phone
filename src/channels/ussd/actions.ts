/**
 * The two writes the menu makes, each safe to repeat: saving a record and undoing one.
 *
 * The network can send the same request again, and two copies can arrive together. The record (or reversal) made at
 * step `n` of session `s` always has the id `rec_ussd_<s>_<n>`, and the store refuses an id it already holds with
 * `DuplicateRecordError`. So a repeat finds its record already there, checks that it is the same one, and answers
 * with the same screen. Only one record is ever added.
 */

import {
  customerKey,
  getCustomerBalance,
  getTodaySummary,
  recordDebt,
  recordExpense,
  recordPayment,
  recordSale,
  requiresConfirmation,
  undoLastRecord,
  type LedgerStore,
  type Record as LedgerRecord,
  type RecordResult,
  type Shop
} from '../../core/index.js';
import { recordIdFor } from './ids.js';
import type { Draft } from './machine.js';
import type { Entry } from './screen.js';
import type { FigureFacts, SavedFacts, UndoneFacts } from './results.js';

export interface ActionContext {
  store: LedgerStore;
  shop: Shop;
  sessionId: string;
  /** Everything the owner has typed, one entry per input. */
  path: string[];
  now: Date;
}

export type SaveOutcome = { ok: true; facts: SavedFacts } | { ok: false };
export type UndoOutcome = { ok: true; facts: UndoneFacts } | { ok: false; nothingToUndo: boolean };

function hasName(error: unknown, name: string): boolean {
  return error instanceof Error && error.name === name;
}

/** The owner's typed path up to and including the confirming input. */
function wordsUpTo(ctx: ActionContext, step: number): string {
  return ctx.path.slice(0, step).join('*');
}

// ============================================================================
// Saving
// ============================================================================

export async function saveDraft(ctx: ActionContext, draft: Draft, step: number): Promise<SaveOutcome> {
  const { store, shop } = ctx;
  const cents = draft.cents;
  if (cents === undefined || !Number.isSafeInteger(cents) || cents <= 0) return { ok: false };
  if (requiresConfirmation(cents) && draft.bigOk !== true) return { ok: false };
  if ((draft.kind === 'debt' || draft.kind === 'payment') && !(draft.customer ?? '').trim()) return { ok: false };

  const id = recordIdFor(ctx.sessionId, step);

  // 1. A repeat finds its record already there.
  let existing = await store.findRecordById(id);

  if (!existing) {
    if (!(await hasRoom(ctx, draft, cents))) return { ok: false };
    // 2. Save it, with the id that makes a second copy impossible.
    try {
      const result = await callLedger(ctx, draft, cents, id, wordsUpTo(ctx, step));
      if (!isSaved(result)) return { ok: false };
    } catch (error) {
      if (!hasName(error, 'DuplicateRecordError')) throw error;
    }
    // 3. Read it back: it is ours, or a copy that ran just before us saved it.
    existing = await store.findRecordById(id);
    if (!existing) return { ok: false };
  }

  // 4. It must be the same record the owner is saving now.
  if (!matches(existing, draft, cents, shop)) return { ok: false };

  return { ok: true, facts: await factsFor(ctx, existing, 'saved') };
}

function isSaved(result: RecordResult): boolean {
  return 'success' in result && result.success === true;
}

function callLedger(
  ctx: ActionContext,
  draft: Draft,
  cents: number,
  id: string,
  originalWords: string
): Promise<RecordResult> {
  const { store, shop, now } = ctx;
  // The owner has confirmed (twice for a big amount), so the core is told not to ask again.
  const common = {
    id,
    amount: { cents, requiresConfirmation: false },
    channel: 'ussd' as const,
    originalWords,
    now
  };
  switch (draft.kind) {
    case 'sale':
      return recordSale(store, shop, { ...common, item: draft.item });
    case 'expense':
      return recordExpense(store, shop, { ...common, item: draft.item });
    case 'debt':
      return recordDebt(store, shop, { ...common, customer: draft.customer ?? '', item: draft.item });
    case 'payment':
      return recordPayment(store, shop, { ...common, customer: draft.customer ?? '' });
  }
}

/** Same shop, kind, amount, customer and item. */
function matches(record: LedgerRecord, draft: Draft, cents: number, shop: Shop): boolean {
  if (record.kind === 'reversal') return false;
  if (record.shopId !== shop.id || record.kind !== draft.kind || record.amount !== cents) return false;
  if (record.kind === 'debt' || record.kind === 'payment') {
    if (record.customerKey !== customerKey(draft.customer ?? '')) return false;
  }
  const itemOfDraft = draft.kind === 'payment' ? undefined : draft.item;
  return (record.item ?? undefined) === (itemOfDraft ?? undefined);
}

/**
 * True when saving this amount leaves every figure the screens show a safe whole number of cents, so a record is
 * never saved and then left without a screen to show it.
 */
async function hasRoom(ctx: ActionContext, draft: Draft, cents: number): Promise<boolean> {
  const { store, shop, now } = ctx;
  const safe = Number.isSafeInteger;
  const today = await getTodaySummary(store, shop, now);
  switch (draft.kind) {
    case 'sale':
      return safe(today.sales.total + cents) && safe(today.moneyInHand + cents);
    case 'expense':
      return safe(today.expenses.total + cents) && safe(today.moneyInHand - cents);
    case 'debt': {
      const balance = await getCustomerBalance(store, shop, draft.customer ?? '');
      return safe(balance + cents) && safe(today.newDebts + cents) && safe(today.totalOwed + cents);
    }
    case 'payment': {
      const balance = await getCustomerBalance(store, shop, draft.customer ?? '');
      return safe(balance - cents) && safe(today.paymentsReceived + cents) && safe(today.moneyInHand + cents);
    }
  }
}

// ============================================================================
// Undoing
// ============================================================================

export async function undoLast(ctx: ActionContext, step: number): Promise<UndoOutcome> {
  const { store, shop, now } = ctx;
  const id = recordIdFor(ctx.sessionId, step);

  // 1. A repeat finds its reversal already there.
  let reversal = await store.findRecordById(id);

  if (!reversal) {
    // 2. Ask the ledger to undo, with the id that makes a second reversal impossible.
    try {
      const result = await undoLastRecord(store, shop, {
        id,
        channel: 'ussd',
        originalWords: wordsUpTo(ctx, step),
        now
      });
      if (!result.success && result.error !== 'Nothing to undo') {
        return { ok: false, nothingToUndo: false };
      }
    } catch (error) {
      if (!hasName(error, 'DuplicateRecordError')) throw error;
    }
    // 3. Read it back. If there is nothing, a copy that ran just before us took the only record.
    reversal = await store.findRecordById(id);
    if (!reversal) return { ok: false, nothingToUndo: true };
  }

  if (reversal.kind !== 'reversal' || reversal.shopId !== shop.id) {
    return { ok: false, nothingToUndo: false };
  }

  // 4. Name the record that was really undone, and show the figure after the undo.
  const undone = await store.findRecordById(reversal.reversesRecordId);
  if (!undone) return { ok: false, nothingToUndo: false };
  return { ok: true, facts: await factsFor(ctx, undone, 'undone') };
}

// ============================================================================
// The new figure, read from the records as they are now
// ============================================================================

async function factsFor(
  ctx: ActionContext,
  record: LedgerRecord,
  mode: 'saved' | 'undone'
): Promise<{ entry: Entry; figure: FigureFacts }> {
  const { store, shop, now } = ctx;
  if (record.kind === 'reversal') {
    throw new Error('A reversal has no figure of its own');
  }

  if (record.kind === 'sale' || record.kind === 'expense') {
    const today = await getTodaySummary(store, shop, now);
    const entry: Entry = { kind: record.kind, cents: record.amount, ...(record.item ? { item: record.item } : {}) };
    return record.kind === 'sale'
      ? { entry, figure: { kind: 'salesToday', cents: today.sales.total } }
      : { entry, figure: { kind: 'expensesToday', cents: today.expenses.total } };
  }

  const balance = await getCustomerBalance(store, shop, record.customerDisplayName);
  const entry: Entry = {
    kind: record.kind,
    cents: record.amount,
    customer: record.customerDisplayName,
    ...(record.kind === 'debt' && record.item ? { item: record.item } : {})
  };
  // Saving a debt reads "owes R50 in total"; every other balance reads "owes R40 now".
  const wording = mode === 'saved' && record.kind === 'debt' ? 'total' : 'now';
  return { entry, figure: { kind: 'balance', customer: record.customerDisplayName, cents: balance, wording } };
}
