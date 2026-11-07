/**
 * ProcessedTextStore on Postgres (table `processed_texts`).
 *
 * The primary key (phone, message_id) decides which of two simultaneous claims wins: `insert ... on conflict do
 * nothing` returns a row for exactly one of them.
 */

import type { Sql } from 'postgres';
import { PROCESSED_TEXT_TTL_MS, type ProcessedTextStore, type TextClaim } from '../processed.js';

export interface PostgresProcessedTextOptions {
  /** The time source. Defaults to the system clock. */
  now?: () => Date;
  /** How long an entry is kept. Defaults to 48 hours. */
  ttlMs?: number;
}

export class PostgresProcessedTextStore implements ProcessedTextStore {
  private readonly now: () => Date;
  private readonly ttlMs: number;

  constructor(
    private readonly sql: Sql,
    options: PostgresProcessedTextOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? PROCESSED_TEXT_TTL_MS;
  }

  async claim(phone: string, messageId: string): Promise<TextClaim> {
    const now = this.now();
    const nowIso = now.toISOString();
    const oldest = new Date(now.getTime() - this.ttlMs).toISOString();
    await this.sql`delete from processed_texts where created_at < ${oldest}::timestamptz`;

    // Two tries: only the age sweep deletes rows, but if it ran between our insert and our select, insert again.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const inserted = await this.sql<Array<{ message_id: string }>>`
        insert into processed_texts (phone, message_id, created_at)
        values (${phone}, ${messageId}, ${nowIso}::timestamptz)
        on conflict do nothing
        returning message_id`;
      if (inserted.length > 0) return { status: 'new' };

      const held = await this.sql<Array<{ reply: string | null }>>`
        select reply from processed_texts where phone = ${phone} and message_id = ${messageId}`;
      const row = held[0];
      if (row) return row.reply === null ? { status: 'working' } : { status: 'done', reply: row.reply };
    }
    return { status: 'working' };
  }

  async finish(phone: string, messageId: string, reply: string): Promise<void> {
    await this.sql`
      update processed_texts set reply = ${reply} where phone = ${phone} and message_id = ${messageId}`;
  }
}
