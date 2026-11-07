/**
 * LedgerStore on Postgres, using only the `postgres` package.
 *
 * - Money is `bigint` in the database and a safe integer here: `toSafeInt` refuses anything else.
 * - Times are `timestamptz`; the store returns the ISO 8601 string that was written.
 * - Records are listed by `seq` (the order they were appended), never by `created_at`, because a fixed clock gives
 *   many records the same time stamp.
 * - The duplicate-save guard is the primary key on `records.id`: `insert ... on conflict (id) do nothing` returns no
 *   row for an id that is already held, which becomes `DuplicateRecordError`. That check comes before the unique
 *   index on `reverses_record_id`, so a repeated undo is a duplicate, not a second reversal (as in the memory store).
 * - A unique violation on any other index (two copies started together, or a second reversal) is checked against the
 *   id again: an id that is held is a `DuplicateRecordError`; otherwise the reversal index gives
 *   `RecordAlreadyReversedError`. Any other database error passes up unchanged.
 */

import type { Sql } from 'postgres';
import type { Currency } from '../../core/money/currency.js';
import type { Channel, Record, RecordKind, ReversalRecord } from '../../core/records/types.js';
import type { Shop } from '../../core/shops/types.js';
import { DEMO_PHONE_SQL_PATTERN, MAX_DEMO_SHOPS_PER_SWEEP } from '../demo.js';
import {
  DuplicateRecordError,
  RecordAlreadyReversedError,
  ShopAlreadyExistsError,
  type LedgerStore
} from '../interface.js';

// ============================================================================
// Row mapping (pure, tested without a database)
// ============================================================================

export interface ShopRow {
  id: string;
  name: string;
  phone: string;
  currency: string;
  time_zone: string;
  created_at: Date | string;
}

export interface RecordRow {
  id: string;
  shop_id: string;
  kind: string;
  amount: string | number | bigint;
  item: string | null;
  customer_display_name: string | null;
  customer_key: string | null;
  reverses_record_id: string | null;
  channel: string;
  original_words: string;
  created_at: Date | string;
}

const CURRENCIES: readonly string[] = ['ZAR', 'USD', 'KES', 'NGN', 'GHS', 'ZMW', 'BWP'];
const KINDS: readonly string[] = ['sale', 'expense', 'debt', 'payment', 'reversal'];
const CHANNELS: readonly string[] = ['ussd', 'sms', 'web'];

/** A money value read from the database. Throws unless it is a safe whole number. */
export function toSafeInt(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new RangeError('A money value from the database is not a number');
  }
  if (typeof value === 'string' && !/^-?\d+$/.test(value.trim())) {
    throw new RangeError('A money value from the database is not a whole number');
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new RangeError('A money value from the database is not a safe whole number');
  }
  return n;
}

function toIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function rowToShop(row: ShopRow): Shop {
  if (!CURRENCIES.includes(row.currency)) {
    throw new RangeError('A shop in the database has a currency the ledger does not know');
  }
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    currency: row.currency as Currency,
    timeZone: row.time_zone,
    createdAt: toIso(row.created_at)
  };
}

/** Builds the record for its kind. A column that is `null` is left out, so there is never an `item: null`. */
export function rowToRecord(row: RecordRow): Record {
  if (!KINDS.includes(row.kind)) throw new RangeError('A record in the database has a kind the ledger does not know');
  if (!CHANNELS.includes(row.channel)) throw new RangeError('A record in the database has an unknown channel');
  const kind = row.kind as RecordKind;
  const base = {
    id: row.id,
    shopId: row.shop_id,
    amount: toSafeInt(row.amount),
    createdAt: toIso(row.created_at),
    channel: row.channel as Channel,
    originalWords: row.original_words
  };
  const item = row.item === null ? {} : { item: row.item };

  switch (kind) {
    case 'sale':
    case 'expense':
      return { ...base, kind, ...item };
    case 'debt':
    case 'payment':
      if (row.customer_display_name === null || row.customer_key === null) {
        throw new RangeError('A debt or payment in the database has no customer');
      }
      return {
        ...base,
        kind,
        customerDisplayName: row.customer_display_name,
        customerKey: row.customer_key,
        ...item
      };
    case 'reversal':
      if (row.reverses_record_id === null) {
        throw new RangeError('A reversal in the database does not point at a record');
      }
      return { ...base, kind, reversesRecordId: row.reverses_record_id };
  }
}

// ============================================================================
// Error mapping
// ============================================================================

/** The code and constraint of a Postgres unique-violation, or null for any other error. */
export function uniqueViolation(error: unknown): { constraint: string } | null {
  if (typeof error !== 'object' || error === null) return null;
  const e = error as { code?: unknown; constraint_name?: unknown };
  if (e.code !== '23505') return null;
  return { constraint: typeof e.constraint_name === 'string' ? e.constraint_name : '' };
}

// ============================================================================
// The store
// ============================================================================

export class PostgresStore implements LedgerStore {
  constructor(private readonly sql: Sql) {}

  async createShop(shop: Shop): Promise<void> {
    const sql = this.sql;
    try {
      await sql`
        insert into shops (id, name, phone, currency, time_zone, created_at)
        values (${shop.id}, ${shop.name}, ${shop.phone}, ${shop.currency}, ${shop.timeZone}, ${shop.createdAt}::timestamptz)`;
    } catch (error) {
      const violation = uniqueViolation(error);
      if (violation?.constraint === 'shops_pkey') throw new ShopAlreadyExistsError(`id ${shop.id}`);
      if (violation?.constraint === 'shops_phone_unique') throw new ShopAlreadyExistsError('phone number');
      throw error;
    }
  }

  async findShopById(id: string): Promise<Shop | null> {
    const rows = await this.sql<ShopRow[]>`
      select id, name, phone, currency, time_zone, created_at from shops where id = ${id}`;
    return rows[0] ? rowToShop(rows[0]) : null;
  }

  async findShopByPhone(phone: string): Promise<Shop | null> {
    const rows = await this.sql<ShopRow[]>`
      select id, name, phone, currency, time_zone, created_at from shops where phone = ${phone}`;
    return rows[0] ? rowToShop(rows[0]) : null;
  }

  async appendRecord(record: Record): Promise<void> {
    if (!Number.isSafeInteger(record.amount)) {
      throw new RangeError('A record amount must be a safe whole number of cents');
    }
    const item = 'item' in record && record.item !== undefined ? record.item : null;
    const customerName = 'customerDisplayName' in record ? record.customerDisplayName : null;
    const customerKey = 'customerKey' in record ? record.customerKey : null;
    const reverses = record.kind === 'reversal' ? record.reversesRecordId : null;
    const sql = this.sql;

    let rows: ArrayLike<unknown>;
    try {
      // The conflict rule names only `id`: the id is checked first, and a repeat inserts nothing.
      rows = await sql`
        insert into records (id, shop_id, kind, amount, item, customer_display_name, customer_key,
                             reverses_record_id, channel, original_words, created_at)
        values (${record.id}, ${record.shopId}, ${record.kind}, ${record.amount}, ${item}, ${customerName},
                ${customerKey}, ${reverses}, ${record.channel}, ${record.originalWords},
                ${record.createdAt}::timestamptz)
        on conflict (id) do nothing
        returning id`;
    } catch (error) {
      // Two copies of one request started together can still reach a unique index other than the one named in
      // `on conflict` before Postgres sees the conflict on the id. So after any unique violation, look the id up:
      // if it is held, this was a repeat (the same answer the memory store gives), whatever index complained.
      const violation = uniqueViolation(error);
      if (violation === null) throw error;
      if (await this.idIsHeld(record.id)) throw new DuplicateRecordError(record.id);
      if (violation.constraint === 'records_one_reversal_per_record') {
        throw new RecordAlreadyReversedError((record as ReversalRecord).reversesRecordId);
      }
      throw error;
    }
    if (rows.length === 0) throw new DuplicateRecordError(record.id);
  }

  private async idIsHeld(id: string): Promise<boolean> {
    const rows = await this.sql`select 1 as held from records where id = ${id}`;
    return rows.length > 0;
  }

  async findRecordById(id: string): Promise<Record | null> {
    const rows = await this.sql<RecordRow[]>`
      select id, shop_id, kind, amount, item, customer_display_name, customer_key, reverses_record_id,
             channel, original_words, created_at
      from records where id = ${id}`;
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async findReversalOf(recordId: string): Promise<ReversalRecord | null> {
    const rows = await this.sql<RecordRow[]>`
      select id, shop_id, kind, amount, item, customer_display_name, customer_key, reverses_record_id,
             channel, original_words, created_at
      from records where reverses_record_id = ${recordId}`;
    const record = rows[0] ? rowToRecord(rows[0]) : null;
    return record && record.kind === 'reversal' ? record : null;
  }

  async listRecords(shopId: string, options?: { since?: string }): Promise<Record[]> {
    const since = options?.since ? options.since : null;
    if (since !== null && Number.isNaN(new Date(since).getTime())) return [];
    const rows = await this.sql<RecordRow[]>`
      select id, shop_id, kind, amount, item, customer_display_name, customer_key, reverses_record_id,
             channel, original_words, created_at
      from records
      where shop_id = ${shopId}
        and (${since}::timestamptz is null or created_at >= ${since}::timestamptz)
      order by seq`;
    return rows.map(rowToRecord);
  }

  async countShopsWithPhonePrefix(prefix: string): Promise<number> {
    // starts_with, not like: the prefix needs no escaping.
    const rows = await this.sql<Array<{ n: number | string }>>`
      select count(*)::int as n from shops where starts_with(phone, ${prefix})`;
    return toSafeInt(rows[0]?.n ?? 0);
  }

  /**
   * Housekeeping of invented demo data, in one transaction: the oldest demo shops made before `createdBefore` (at
   * most `maxShops`), their pending questions, their records and then the shops themselves.
   *
   * The demo test is `phone ~ DEMO_PHONE_SQL_PATTERN`, written in this method and not taken from the caller, and it
   * is repeated on the final `delete from shops`, so no statement here can remove a shop on another number. Records
   * are removed only by `shop_id` of those shops, all of them in one statement (the foreign keys between a shop's own
   * records are checked at the end of the statement). The selected shops are locked `for update`, so a record being
   * added to one of them waits and then fails on the foreign key rather than being half kept.
   */
  async deleteExpiredDemoShops(createdBefore: Date, maxShops: number): Promise<string[]> {
    const cutoff = createdBefore.getTime();
    const limit = Number.isFinite(maxShops) ? Math.min(Math.max(0, Math.floor(maxShops)), MAX_DEMO_SHOPS_PER_SWEEP) : 0;
    if (!Number.isFinite(cutoff) || limit === 0) return [];
    const before = createdBefore.toISOString();

    return await this.sql.begin(async (tx) => {
      const shops = await tx<Array<{ id: string; phone: string }>>`
        select id, phone from shops
        where phone ~ ${DEMO_PHONE_SQL_PATTERN} and created_at < ${before}::timestamptz
        order by created_at, id
        limit ${limit}
        for update`;
      if (shops.length === 0) return [];
      const ids = shops.map((shop) => shop.id);
      const phones = shops.map((shop) => shop.phone);

      await tx`delete from pending_questions where phone in ${tx(phones)}`;
      await tx`delete from records where shop_id in ${tx(ids)}`;
      await tx`delete from shops where id in ${tx(ids)} and phone ~ ${DEMO_PHONE_SQL_PATTERN}`;
      return phones;
    });
  }
}

export function createPostgresStore(sql: Sql): LedgerStore {
  return new PostgresStore(sql);
}
