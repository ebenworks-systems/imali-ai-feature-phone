/**
 * Text callbacks that have already been handled.
 *
 * Africa's Talking can send the same incoming-text callback again (a slow answer, a network retry). It gives each
 * incoming text an `id`. The `/sms` route claims (phone, id) before it calls the text handler, so a repeat does not
 * save twice and gets the reply of the first call.
 *
 * - `claim` returns `new` to exactly one caller. Any later caller gets `working` (no reply stored yet) or `done`
 *   with the stored reply.
 * - `finish` stores the reply (an error sentence counts as a reply). Nothing forgets a claim: the handler may already
 *   have saved a record before it failed, and a second run would save it twice. Entries go only when they are 48
 *   hours old; a claim deletes the older ones.
 *
 * The Postgres version is in `postgres/processed.ts` and must behave the same.
 */

/** How long a handled text is remembered: 48 hours. */
export const PROCESSED_TEXT_TTL_MS = 48 * 60 * 60 * 1000;

export type TextClaim =
  /** This call won the claim and must handle the message. */
  | { status: 'new' }
  /** The message was handled before; this is the reply that was given. */
  | { status: 'done'; reply: string }
  /** The message was claimed and has no reply yet: the first call is still running. */
  | { status: 'working' };

export interface ProcessedTextStore {
  claim(phone: string, messageId: string): Promise<TextClaim>;
  finish(phone: string, messageId: string, reply: string): Promise<void>;
}

export interface InMemoryProcessedTextStoreOptions {
  /** The time source. Defaults to the system clock. */
  now?: () => Date;
  /** How long an entry is kept. Defaults to 48 hours. */
  ttlMs?: number;
}

export class InMemoryProcessedTextStore implements ProcessedTextStore {
  // A keyed set of ids: the value is the reply (null while the first call is still running).
  private readonly entries = new Map<string, { reply: string | null; at: number }>();
  private readonly now: () => Date;
  private readonly ttlMs: number;

  constructor(options: InMemoryProcessedTextStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? PROCESSED_TEXT_TTL_MS;
  }

  /** Number of entries held right now. For tests. */
  get size(): number {
    return this.entries.size;
  }

  async claim(phone: string, messageId: string): Promise<TextClaim> {
    const nowMs = this.now().getTime();
    for (const [key, entry] of this.entries) {
      if (nowMs - entry.at > this.ttlMs) this.entries.delete(key);
    }
    const key = keyOf(phone, messageId);
    const held = this.entries.get(key);
    if (!held) {
      // No await between the check and the set, so two simultaneous claims cannot both win.
      this.entries.set(key, { reply: null, at: nowMs });
      return { status: 'new' };
    }
    return held.reply === null ? { status: 'working' } : { status: 'done', reply: held.reply };
  }

  async finish(phone: string, messageId: string, reply: string): Promise<void> {
    const key = keyOf(phone, messageId);
    const held = this.entries.get(key);
    this.entries.set(key, { reply, at: held?.at ?? this.now().getTime() });
  }
}

function keyOf(phone: string, messageId: string): string {
  return `${phone}\0${messageId}`;
}
