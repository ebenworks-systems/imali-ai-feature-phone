/**
 * PendingStore on Postgres: the one question the text handler waits on for each phone number.
 *
 * A question is kept for 10 minutes, measured with the injected clock (not the database clock). An answer at
 * exactly 10 minutes is still in time, as in `InMemoryPendingStore`. `set` deletes the expired questions.
 */

import type { Sql } from 'postgres';
import { PENDING_TTL_MS, type PendingQuestion, type PendingStore } from '../../channels/sms/pending.js';

export interface PostgresPendingOptions {
  /** How long a question waits. Defaults to 10 minutes. */
  ttlMs?: number;
  /** The time source. Defaults to the system clock. */
  now?: () => Date;
}

interface PendingRow {
  kind: PendingQuestion['kind'];
  payload: Omit<PendingQuestion, 'kind' | 'createdAt'>;
  created_at: Date | string;
}

export class PostgresPendingStore implements PendingStore {
  private readonly ttlMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly sql: Sql,
    options: PostgresPendingOptions = {}
  ) {
    this.ttlMs = options.ttlMs ?? PENDING_TTL_MS;
    this.now = options.now ?? (() => new Date());
  }

  async get(phone: string): Promise<PendingQuestion | null> {
    const now = this.now().toISOString();
    const rows = await this.sql<PendingRow[]>`
      select kind, payload, created_at from pending_questions
      where phone = ${phone} and expires_at >= ${now}::timestamptz`;
    const row = rows[0];
    if (!row) return null;
    return { ...row.payload, kind: row.kind, createdAt: new Date(row.created_at) };
  }

  async set(phone: string, question: PendingQuestion): Promise<void> {
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.ttlMs).toISOString();
    const { kind, createdAt, ...rest } = question;
    // The payload is the question without `kind` and `createdAt` (they have their own columns).
    const payload = this.sql.json(JSON.parse(JSON.stringify(rest)) as Parameters<Sql['json']>[0]);
    const created = new Date(createdAt).toISOString();
    const nowIso = now.toISOString();
    await this.sql`delete from pending_questions where expires_at < ${nowIso}::timestamptz`;
    await this.sql`
      insert into pending_questions (phone, kind, payload, created_at, expires_at)
      values (${phone}, ${kind}, ${payload}, ${created}::timestamptz, ${expiresAt}::timestamptz)
      on conflict (phone) do update
        set kind = excluded.kind, payload = excluded.payload,
            created_at = excluded.created_at, expires_at = excluded.expires_at`;
  }

  async clear(phone: string): Promise<void> {
    await this.sql`delete from pending_questions where phone = ${phone}`;
  }
}
