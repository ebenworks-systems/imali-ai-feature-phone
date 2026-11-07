import { fileURLToPath } from 'node:url';
import { beforeEach, expect, it, describe } from 'vitest';
import { createTestDatabase, describePostgres } from '../../helpers/pg.js';
// @ts-expect-error The script is plain JavaScript and has no type declarations.
import { applyMigrations } from '../../../scripts/migrate.mjs';
import { createReversal, createSaleRecord } from '../../../src/core/records/types.js';
import { createShop } from '../../../src/core/shops/types.js';
import { DuplicateRecordError } from '../../../src/store/interface.js';
import { PostgresStore } from '../../../src/store/postgres/store.js';

const SQL_DIR = fileURLToPath(new URL('../../../sql/', import.meta.url));
const NOW = '2026-11-07T10:00:00.000Z';

describePostgres('Postgres table rules', (db) => {
  const shopA = createShop({ id: 'shopA', name: 'A', phone: '+27000000001', currency: 'ZAR', timeZone: 'Africa/Johannesburg' });
  const shopB = createShop({ id: 'shopB', name: 'B', phone: '+27000000002', currency: 'ZAR', timeZone: 'Africa/Johannesburg' });

  beforeEach(async () => {
    await db().truncate();
    const store = new PostgresStore(db().sql);
    await store.createShop(shopA);
    await store.createShop(shopB);
    await store.appendRecord(
      createSaleRecord('shopA', { id: 'sale1', amount: 100, channel: 'sms', originalWords: 'x', now: new Date(NOW) })
    );
    await store.appendRecord(
      createSaleRecord('shopB', { id: 'saleB', amount: 100, channel: 'sms', originalWords: 'x', now: new Date(NOW) })
    );
  });

  /** Insert straight into the table, so only the database decides. */
  async function insert(over: Record<string, unknown>) {
    const r = {
      id: 'x1', shop_id: 'shopA', kind: 'sale', amount: 100, item: null, customer_display_name: null,
      customer_key: null, reverses_record_id: null, channel: 'sms', original_words: 'x', ...over
    };
    const sql = db().sql;
    await sql`
      insert into records (id, shop_id, kind, amount, item, customer_display_name, customer_key,
                           reverses_record_id, channel, original_words, created_at)
      values (${r.id as string}, ${r.shop_id as string}, ${r.kind as string}, ${r.amount as number},
              ${r.item as string | null}, ${r.customer_display_name as string | null},
              ${r.customer_key as string | null}, ${r.reverses_record_id as string | null},
              ${r.channel as string}, ${r.original_words as string}, ${NOW}::timestamptz)`;
  }

  describe('requirement 62: a record must fit its kind', () => {
    it.each(['sale', 'expense'])('refuses an amount of zero on a %s', async (kind) => {
      await expect(insert({ kind, amount: 0 })).rejects.toMatchObject({ code: '23514' });
    });

    it.each(['sale', 'expense'])('refuses a negative amount on a %s', async (kind) => {
      await expect(insert({ kind, amount: -5 })).rejects.toMatchObject({ code: '23514' });
    });

    it.each(['debt', 'payment'])('refuses an amount of zero on a %s', async (kind) => {
      await expect(
        insert({ kind, amount: 0, customer_display_name: 'Tendai', customer_key: 'tendai' })
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a reversal with an amount other than zero', async () => {
      await expect(insert({ kind: 'reversal', amount: 100, reverses_record_id: 'sale1' })).rejects.toMatchObject({
        code: '23514'
      });
    });

    it('accepts a reversal with amount zero', async () => {
      await expect(insert({ id: 'rev1', kind: 'reversal', amount: 0, reverses_record_id: 'sale1' })).resolves.toBeUndefined();
    });

    it.each(['debt', 'payment'])('refuses a %s without a customer', async (kind) => {
      await expect(insert({ kind })).rejects.toMatchObject({ code: '23514' });
      await expect(insert({ kind, customer_display_name: 'Tendai' })).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a sale that names a customer', async () => {
      await expect(
        insert({ customer_display_name: 'Tendai', customer_key: 'tendai' })
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a reversal without a record to reverse', async () => {
      await expect(insert({ kind: 'reversal', amount: 0 })).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a sale that points at a record to reverse', async () => {
      await expect(insert({ reverses_record_id: 'sale1' })).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a reversal of a record that does not exist', async () => {
      await expect(insert({ kind: 'reversal', amount: 0, reverses_record_id: 'nope' })).rejects.toMatchObject({
        code: '23503'
      });
    });

    it('refuses a reversal of a record from another shop', async () => {
      await expect(
        insert({ id: 'rev_x', shop_id: 'shopA', kind: 'reversal', amount: 0, reverses_record_id: 'saleB' })
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('refuses a record for a shop that does not exist', async () => {
      await expect(insert({ shop_id: 'ghost' })).rejects.toMatchObject({ code: '23503' });
    });

    it('refuses an amount above the largest safe integer', async () => {
      await expect(insert({ amount: '9007199254740992' })).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a kind and a channel the ledger does not know', async () => {
      await expect(insert({ kind: 'gift' })).rejects.toMatchObject({ code: '23514' });
      await expect(insert({ channel: 'fax' })).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a shop with a long name or an unknown currency', async () => {
      const sql = db().sql;
      await expect(
        sql`insert into shops (id, name, phone, currency, time_zone, created_at)
            values ('s9', ${'x'.repeat(25)}, '+27000000009', 'ZAR', 'UTC', ${NOW}::timestamptz)`
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        sql`insert into shops (id, name, phone, currency, time_zone, created_at)
            values ('s9', 'ok', '+27000000009', 'EUR', 'UTC', ${NOW}::timestamptz)`
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('passes a check error up from the store unchanged (requirement 63)', async () => {
      const store = new PostgresStore(db().sql);
      const bad = createSaleRecord('shopA', { id: 'zero', amount: 0, channel: 'sms', originalWords: 'x', now: new Date(NOW) });
      const error = await store.appendRecord(bad).catch((e: unknown) => e);
      expect(error).not.toBeInstanceOf(DuplicateRecordError);
      expect(error).toMatchObject({ code: '23514' });
    });
  });

  describe('the unique reversal index', () => {
    it('refuses a second reversal of a record, naming the index', async () => {
      await insert({ id: 'rev1', kind: 'reversal', amount: 0, reverses_record_id: 'sale1' });
      await expect(
        insert({ id: 'rev2', kind: 'reversal', amount: 0, reverses_record_id: 'sale1' })
      ).rejects.toMatchObject({ code: '23505', constraint_name: 'records_one_reversal_per_record' });
    });

    it('lets only one of two reversals inserted together win', async () => {
      const results = await Promise.allSettled([
        insert({ id: 'revA', kind: 'reversal', amount: 0, reverses_record_id: 'sale1' }),
        insert({ id: 'revB', kind: 'reversal', amount: 0, reverses_record_id: 'sale1' })
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ constraint_name: 'records_one_reversal_per_record' });
    });
  });

  describe('the duplicate-save guard is the primary key on the record id', () => {
    it('names records_pkey when a plain insert meets an id that is held', async () => {
      await expect(insert({ id: 'sale1' })).rejects.toMatchObject({ code: '23505', constraint_name: 'records_pkey' });
    });

    it('has no save-key column', async () => {
      const columns = await db().sql`
        select column_name from information_schema.columns
        where table_schema = ${db().schema} and table_name = 'records'`;
      expect(columns.map((c) => c.column_name)).not.toContain('save_key');
    });

    it('lets the store tell a repeated undo from a second undo', async () => {
      const store = new PostgresStore(db().sql);
      const sale = (await store.findRecordById('sale1'))!;
      await store.appendRecord(createReversal(sale, 'ussd', '7*1', new Date(NOW), 'rec_ussd_S1_2'));
      await expect(
        store.appendRecord(createReversal(sale, 'ussd', '7*1', new Date(NOW), 'rec_ussd_S1_2'))
      ).rejects.toMatchObject({ name: 'DuplicateRecordError' });
      await expect(
        store.appendRecord(createReversal(sale, 'ussd', '7*1', new Date(NOW), 'rec_ussd_S2_2'))
      ).rejects.toMatchObject({ name: 'RecordAlreadyReversedError' });
    });

    it('refuses a second shop with the same id or the same phone', async () => {
      const sql = db().sql;
      await expect(
        sql`insert into shops (id, name, phone, currency, time_zone, created_at)
            values ('shopA', 'x', '+27000000077', 'ZAR', 'UTC', ${NOW}::timestamptz)`
      ).rejects.toMatchObject({ constraint_name: 'shops_pkey' });
      await expect(
        sql`insert into shops (id, name, phone, currency, time_zone, created_at)
            values ('shopZ', 'x', '+27000000001', 'ZAR', 'UTC', ${NOW}::timestamptz)`
      ).rejects.toMatchObject({ constraint_name: 'shops_phone_unique' });
    });
  });
});

// The migration needs a schema with nothing in it, so it makes its own.
describePostgres(
  'Postgres migration',
  () => {
    it('applies every file the first time and nothing the second time', async () => {
      const url = process.env.TEST_DATABASE_URL!.trim();
      const fresh = await createTestDatabase(url, { migrate: false });
      try {
        const first = await applyMigrations(fresh.sql, SQL_DIR);
        expect(first).toEqual(['001_init.sql']);
        const second = await applyMigrations(fresh.sql, SQL_DIR);
        expect(second).toEqual([]);
        const noted = await fresh.sql`select name from schema_migrations order by name`;
        expect(noted.map((r) => r.name)).toEqual(['001_init.sql']);
        const tables = await fresh.sql`
          select table_name from information_schema.tables
          where table_schema = ${fresh.schema} order by table_name`;
        expect(tables.map((t) => t.table_name)).toEqual([
          'pending_questions', 'processed_texts', 'records', 'schema_migrations', 'shops'
        ]);
      } finally {
        await fresh.drop();
      }
    }, 30_000);
  },
  { migrate: false }
);

