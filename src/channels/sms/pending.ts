/**
 * Pending questions for the SMS channel.
 *
 * When a message could mean two amounts ("sold 2 200") or the amount is very large, the ledger asks the
 * owner a question and waits for "1", "2" or "yes". The question is kept here, one per phone number, for
 * 10 minutes. After that it is gone and the next message is read as a normal message.
 *
 * Nothing in this file touches the ledger. The store is injected into the handler, so a database-backed
 * version can replace the in-memory one later.
 */

import type { Intent } from './reader.js';

/** How long a question waits for an answer: 10 minutes. */
export const PENDING_TTL_MS = 10 * 60 * 1000;

export interface PendingQuestion {
  /**
   * 'ambiguous': the amount could mean two things. 'largeAmount': the amount is over 1,000,000.00.
   * 'signup': the phone is new, the welcome was sent, and the next message is the shop name.
   */
  kind: 'ambiguous' | 'largeAmount' | 'signup';
  /** The action to carry out once the owner answers. */
  intent?: Intent;
  /** For 'ambiguous': the amounts the owner can pick, in the order they were offered (answer "1", "2"). */
  possibleAmounts?: Array<{ cents: number; formatted: string }>;
  /** For 'largeAmount': the amount in cents waiting for a "yes". */
  largeAmount?: number;
  /** The owner's own words that started the question, kept so the saved record carries them, not "1" or "yes". */
  originalWords?: string;
  /** When the question was asked, as supplied by the caller. Expiry does not depend on this field. */
  createdAt: Date;
}

export interface PendingStore {
  /** The open question for this phone, or null when there is none or it has expired. */
  get(phone: string): Promise<PendingQuestion | null>;
  /** Save a question for this phone. It replaces any earlier question and restarts the 10 minutes. */
  set(phone: string, question: PendingQuestion): Promise<void>;
  /** Forget the question for this phone. Does nothing when there is none. */
  clear(phone: string): Promise<void>;
}

export interface InMemoryPendingStoreOptions {
  /** The time source. Defaults to the system clock. Tests pass a fake one so they never sleep. */
  now?: () => Date;
}

export class InMemoryPendingStore implements PendingStore {
  private readonly data = new Map<string, { question: PendingQuestion; expiresAt: number }>();
  private readonly now: () => Date;

  constructor(options: InMemoryPendingStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  /** Number of questions held right now, expired ones included until the next get(). For tests and logs. */
  get size(): number {
    return this.data.size;
  }

  async get(phone: string): Promise<PendingQuestion | null> {
    this.cleanupExpired();
    const entry = this.data.get(phone);
    return entry ? structuredClone(entry.question) : null;
  }

  async set(phone: string, question: PendingQuestion): Promise<void> {
    this.data.set(phone, {
      question: structuredClone(question),
      expiresAt: this.now().getTime() + PENDING_TTL_MS
    });
  }

  async clear(phone: string): Promise<void> {
    this.data.delete(phone);
  }

  /** Remove every question (for every phone) that is more than 10 minutes old. */
  private cleanupExpired(): void {
    const nowMs = this.now().getTime();
    for (const [phone, entry] of this.data) {
      // "Over 10 minutes" expires; an answer at exactly 10 minutes is still in time.
      if (nowMs > entry.expiresAt) {
        this.data.delete(phone);
      }
    }
  }
}
