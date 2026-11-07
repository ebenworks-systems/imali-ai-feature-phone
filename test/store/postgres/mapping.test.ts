import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';
import {
  DuplicateRecordError,
  RecordAlreadyReversedError,
  ShopAlreadyExistsError
} from '../../../src/store/interface.js';
import {
  PostgresStore,
  rowToRecord,
  rowToShop,
  toSafeInt,
  uniqueViolation,
  type RecordRow
} from '../../../src/store/postgres/store.js';
import { createReversal, createSaleRecord } from '../../../src/core/records/types.js';
import { createShop } from '../../../src/core/shops/types.js';

const AT = new Date('2026-11-07T10:00:00.123Z');

function row(over: Partial<RecordRow>): RecordRow {
  return {
    id: 'r1',
    shop_id: 'shop1',
    kind: 'sale',
    amount: '4500',
    item: null,
    customer_display_name: null,
    customer_key: null,
    reverses_record_id: null,
    channel: 'sms',
    original_words: 'sold 45',
    created_at: AT,
    ...over
  };
}

/** A pretend PostgresError: the store reads `code` and `constraint_name`, so a plain object with them is enough. */
function pgError(constraint: string, code = '23505') {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    name: 'PostgresError',
    code,
    constraint_name: constraint
  });
}

/** A fake `sql` tag: records the query text and gives the next prepared answer (or throws it). */
function fakeSql(...answers: Array<unknown[] | Error>) {
  const queries: string[] = [];
  const fn = vi.fn(async (strings: TemplateStringsArray) => {
    queries.push(strings.join('?'));
    const next = answers.shift() ?? [];
    if (next instanceof Error) throw next;
    return next;
  });
  return { sql: fn as unknown as Sql, queries, fn };
}

describe('toSafeInt', () => {
  it('reads strings, numbers and bigints that are safe whole numbers', () => {
    expect(toSafeInt('0')).toBe(0);
    expect(toSafeInt('4500')).toBe(4500);
    expect(toSafeInt(4500)).toBe(4500);
    expect(toSafeInt(4500n)).toBe(4500);
    expect(toSafeInt('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('throws on a value that is not a safe integer', () => {
    expect(() => toSafeInt('9007199254740992')).toThrow(RangeError);
    expect(() => toSafeInt(9007199254740993n)).toThrow(RangeError);
    expect(() => toSafeInt(1.5)).toThrow(RangeError);
    expect(() => toSafeInt('1.5')).toThrow(RangeError);
    expect(() => toSafeInt('abc')).toThrow(RangeError);
    expect(() => toSafeInt('')).toThrow(RangeError);
    expect(() => toSafeInt(NaN)).toThrow(RangeError);
    expect(() => toSafeInt(null)).toThrow(RangeError);
    expect(() => toSafeInt(undefined)).toThrow(RangeError);
  });
});

describe('rowToShop', () => {
  it('maps the columns and writes the time as the ISO string', () => {
    expect(
      rowToShop({ id: 's1', name: "Thandi's Spaza", phone: '+27000001234', currency: 'ZAR', time_zone: 'Africa/Johannesburg', created_at: AT })
    ).toEqual({
      id: 's1',
      name: "Thandi's Spaza",
      phone: '+27000001234',
      currency: 'ZAR',
      timeZone: 'Africa/Johannesburg',
      createdAt: '2026-11-07T10:00:00.123Z'
    });
  });

  it('refuses a currency the ledger does not know', () => {
    expect(() => rowToShop({ id: 's', name: 'n', phone: 'p', currency: 'EUR', time_zone: 'UTC', created_at: AT })).toThrow(RangeError);
  });
});

describe('rowToRecord', () => {
  it('builds a sale without an item key when the item is null', () => {
    const record = rowToRecord(row({}));
    expect(record).toEqual({
      id: 'r1', shopId: 'shop1', kind: 'sale', amount: 4500, channel: 'sms',
      originalWords: 'sold 45', createdAt: '2026-11-07T10:00:00.123Z'
    });
    expect('item' in record).toBe(false);
  });

  it('builds a sale and an expense with an item', () => {
    expect(rowToRecord(row({ item: 'bread' }))).toMatchObject({ kind: 'sale', item: 'bread' });
    expect(rowToRecord(row({ kind: 'expense', item: 'taxi' }))).toMatchObject({ kind: 'expense', item: 'taxi' });
  });

  it('builds a debt and a payment with the customer, and no null fields', () => {
    const debt = rowToRecord(row({ kind: 'debt', customer_display_name: 'Tendai', customer_key: 'tendai', item: 'sugar' }));
    expect(debt).toMatchObject({ kind: 'debt', customerDisplayName: 'Tendai', customerKey: 'tendai', item: 'sugar' });
    const payment = rowToRecord(row({ kind: 'payment', customer_display_name: 'Tendai', customer_key: 'tendai' }));
    expect(payment).toMatchObject({ kind: 'payment', customerDisplayName: 'Tendai', customerKey: 'tendai' });
    expect('item' in payment).toBe(false);
    for (const record of [debt, payment]) {
      expect(Object.values(record).includes(null as never)).toBe(false);
    }
  });

  it('builds a reversal that points at a record', () => {
    const reversal = rowToRecord(row({ kind: 'reversal', amount: '0', reverses_record_id: 'r0' }));
    expect(reversal).toMatchObject({ kind: 'reversal', amount: 0, reversesRecordId: 'r0' });
    expect(Object.values(reversal).includes(null as never)).toBe(false);
  });

  it('reads a bigint amount at the top of the safe range and refuses one beyond it', () => {
    expect(rowToRecord(row({ amount: '9007199254740991' })).amount).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => rowToRecord(row({ amount: '9007199254740992' }))).toThrow(RangeError);
  });

  it('accepts a time the driver gave back as a string', () => {
    expect(rowToRecord(row({ created_at: '2026-11-07T10:00:00.123Z' })).createdAt).toBe('2026-11-07T10:00:00.123Z');
  });

  it('refuses rows that cannot be a record', () => {
    expect(() => rowToRecord(row({ kind: 'gift' }))).toThrow(RangeError);
    expect(() => rowToRecord(row({ channel: 'fax' }))).toThrow(RangeError);
    expect(() => rowToRecord(row({ kind: 'debt' }))).toThrow(RangeError);
    expect(() => rowToRecord(row({ kind: 'reversal', amount: '0' }))).toThrow(RangeError);
  });
});

describe('uniqueViolation', () => {
  it('gives the constraint of a 23505 error and null for anything else', () => {
    expect(uniqueViolation(pgError('records_pkey'))).toEqual({ constraint: 'records_pkey' });
    expect(uniqueViolation(pgError('records_pkey', '23503'))).toBeNull();
    expect(uniqueViolation(new Error('boom'))).toBeNull();
    expect(uniqueViolation(null)).toBeNull();
    expect(uniqueViolation('23505')).toBeNull();
  });
});

describe('PostgresStore error mapping (fake sql, no connection)', () => {
  const shop = createShop({ id: 'shop1', name: 'S', phone: '+27000001234', currency: 'ZAR', timeZone: 'Africa/Johannesburg' });
  const sale = createSaleRecord('shop1', { id: 'r1', amount: 100, channel: 'sms', originalWords: 'x', now: AT });

  it('maps shops_pkey and shops_phone_unique to ShopAlreadyExistsError', async () => {
    for (const constraint of ['shops_pkey', 'shops_phone_unique']) {
      const { sql } = fakeSql(pgError(constraint));
      await expect(new PostgresStore(sql).createShop(shop)).rejects.toThrow(ShopAlreadyExistsError);
    }
  });

  it('lets any other createShop error pass up unchanged', async () => {
    const boom = pgError('something_else', '23514');
    await expect(new PostgresStore(fakeSql(boom).sql).createShop(shop)).rejects.toBe(boom);
    const other = pgError('other_unique');
    await expect(new PostgresStore(fakeSql(other).sql).createShop(shop)).rejects.toBe(other);
  });

  it('turns an insert that returned no row (the id is already held) into DuplicateRecordError', async () => {
    const { sql, queries } = fakeSql([]);
    await expect(new PostgresStore(sql).appendRecord(sale)).rejects.toThrow(DuplicateRecordError);
    expect(queries[0]).toMatch(/on conflict \(id\) do nothing/);
    expect(queries[0]).toMatch(/returning id/);
  });

  it('appends when the insert returns the id', async () => {
    const { sql } = fakeSql([{ id: 'r1' }]);
    await expect(new PostgresStore(sql).appendRecord(sale)).resolves.toBeUndefined();
  });

  it('maps the reversal index to RecordAlreadyReversedError, naming the reversed record, when the id is not held', async () => {
    const reversal = createReversal(sale, 'sms', 'undo', AT, 'rev2');
    const { sql, queries } = fakeSql(pgError('records_one_reversal_per_record'), []);
    const error = await new PostgresStore(sql).appendRecord(reversal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RecordAlreadyReversedError);
    expect((error as Error).message).toContain('r1');
    expect(queries[1]).toMatch(/select 1 as held from records where id/);
  });

  it('gives DuplicateRecordError, not RecordAlreadyReversedError, when the reversal index complains but the id is held', async () => {
    const reversal = createReversal(sale, 'ussd', '7*1', AT, 'rec_ussd_S1_2');
    const { sql } = fakeSql(pgError('records_one_reversal_per_record'), [{ held: 1 }]);
    await expect(new PostgresStore(sql).appendRecord(reversal)).rejects.toThrow(DuplicateRecordError);
  });

  it.each(['records_pkey', 'records_shop_id_id_unique'])(
    'maps a violation of %s on an id that is held to DuplicateRecordError',
    async (constraint) => {
      const { sql } = fakeSql(pgError(constraint), [{ held: 1 }]);
      await expect(new PostgresStore(sql).appendRecord(sale)).rejects.toThrow(DuplicateRecordError);
    }
  );

  it('lets a unique violation on an id that is not held pass up unchanged', async () => {
    const odd = pgError('records_shop_id_id_unique');
    await expect(new PostgresStore(fakeSql(odd, []).sql).appendRecord(sale)).rejects.toBe(odd);
  });

  it('lets any other database error pass up unchanged', async () => {
    const fk = pgError('records_reverses_fk', '23503');
    await expect(new PostgresStore(fakeSql(fk).sql).appendRecord(sale)).rejects.toBe(fk);
    const timeout = new Error('connection timeout');
    await expect(new PostgresStore(fakeSql(timeout).sql).appendRecord(sale)).rejects.toBe(timeout);
  });

  it('refuses an amount that is not a safe whole number before it reaches the database', async () => {
    const { sql, fn } = fakeSql();
    const bad = { ...sale, amount: 1.5 };
    await expect(new PostgresStore(sql).appendRecord(bad)).rejects.toThrow(RangeError);
    await expect(new PostgresStore(sql).appendRecord({ ...sale, amount: 2 ** 53 })).rejects.toThrow(RangeError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('sends missing optional fields as null, never undefined (the driver refuses undefined)', async () => {
    const { fn, sql } = fakeSql([{ id: 'r1' }]);
    await new PostgresStore(sql).appendRecord(sale);
    const values = fn.mock.calls[0]!.slice(1) as unknown[];
    expect(values).not.toContain(undefined);
    expect(values).toContain(null);
  });

  it('counts shops with a plain-text prefix', async () => {
    const { sql, queries, fn } = fakeSql([{ n: 7 }]);
    expect(await new PostgresStore(sql).countShopsWithPhonePrefix('+2700000')).toBe(7);
    expect(queries[0]).toMatch(/starts_with\(phone/);
    expect(fn.mock.calls[0]!.slice(1)).toEqual(['+2700000']);
  });

  it('lists with the same order as the append order (order by seq)', async () => {
    const { sql, queries } = fakeSql([]);
    await new PostgresStore(sql).listRecords('shop1');
    expect(queries[0]).toMatch(/order by seq/);
    expect(queries[0]).not.toMatch(/order by created_at/);
  });

  it('returns nothing for a since that is not a date, as the memory store does', async () => {
    const { sql, fn } = fakeSql();
    expect(await new PostgresStore(sql).listRecords('shop1', { since: 'not a date' })).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});
