/**
 * A cap on the number of records one shop may hold, for a public demo.
 *
 * `withRecordLimit` wraps a store. `appendRecord` counts the shop's records first and refuses with
 * `RecordLimitError` when the shop already holds the maximum. Everything else passes straight through.
 *
 * The count and the insert are two steps, so simultaneous writes can pass the cap by a few records. That is fine
 * for a demo cap; it is not a safety limit.
 */

import type { Record, ReversalRecord } from '../core/records/types.js';
import type { Shop } from '../core/shops/types.js';
import { DEMO_PHONE_PREFIX, isDemoNumber } from './demo.js';
import type { LedgerStore } from './interface.js';

/** The shop already holds as many records as it may. */
export class RecordLimitError extends Error {
  constructor(shopId: string, max: number) {
    super(`Shop ${shopId} already holds ${max} records`);
    this.name = 'RecordLimitError';
  }
}

export function withRecordLimit(store: LedgerStore, maxRecordsPerShop: number): LedgerStore {
  return {
    createShop: (shop: Shop): Promise<void> => store.createShop(shop),
    findShopById: (id: string): Promise<Shop | null> => store.findShopById(id),
    findShopByPhone: (phone: string): Promise<Shop | null> => store.findShopByPhone(phone),
    async appendRecord(record: Record): Promise<void> {
      const held = await store.listRecords(record.shopId);
      if (held.length >= maxRecordsPerShop) {
        throw new RecordLimitError(record.shopId, maxRecordsPerShop);
      }
      await store.appendRecord(record);
    },
    findRecordById: (id: string): Promise<Record | null> => store.findRecordById(id),
    findReversalOf: (recordId: string): Promise<ReversalRecord | null> => store.findReversalOf(recordId),
    listRecords: (shopId: string, options?: { since?: string }): Promise<Record[]> =>
      store.listRecords(shopId, options),
    countShopsWithPhonePrefix: (prefix: string): Promise<number> => store.countShopsWithPhonePrefix(prefix),
    deleteExpiredDemoShops: (createdBefore: Date, maxShops: number): Promise<string[]> =>
      store.deleteExpiredDemoShops(createdBefore, maxShops)
  };
}

// ============================================================================
// Shops
// ============================================================================

/** The store already holds as many shops (not counting demo shops) as it may. */
export class ShopLimitError extends Error {
  constructor(reason: number | 'demo-range') {
    super(
      reason === 'demo-range'
        ? 'A shop cannot be made on a number in the demo range that is not a whole demo number'
        : `The store already holds ${reason} shops that are not demo shops`
    );
    this.name = 'ShopLimitError';
  }
}

/** A store with every method passed straight through, for a wrapper to override one or two. */
function passThrough(store: LedgerStore): LedgerStore {
  return {
    createShop: (shop: Shop): Promise<void> => store.createShop(shop),
    findShopById: (id: string): Promise<Shop | null> => store.findShopById(id),
    findShopByPhone: (phone: string): Promise<Shop | null> => store.findShopByPhone(phone),
    appendRecord: (record: Record): Promise<void> => store.appendRecord(record),
    findRecordById: (id: string): Promise<Record | null> => store.findRecordById(id),
    findReversalOf: (recordId: string): Promise<ReversalRecord | null> => store.findReversalOf(recordId),
    listRecords: (shopId: string, options?: { since?: string }): Promise<Record[]> =>
      store.listRecords(shopId, options),
    countShopsWithPhonePrefix: (prefix: string): Promise<number> => store.countShopsWithPhonePrefix(prefix),
    deleteExpiredDemoShops: (createdBefore: Date, maxShops: number): Promise<string[]> =>
      store.deleteExpiredDemoShops(createdBefore, maxShops)
  };
}

/**
 * A cap on the shops that are not demo shops, so the sandbox cannot fill the database.
 *
 * `createShop` for a shop on a demo number passes straight through (the demo shops have their own cap, in the
 * demo route). For any other number it counts the shops that are not demo shops in the store and refuses with
 * `ShopLimitError` when there are already `max`. The count is made in the store each time, so it holds across
 * serverless instances. The count and the insert are two steps, so simultaneous sign-ups can pass the cap by a few
 * shops; that is fine for a sandbox cap.
 *
 * A number that starts like a demo number (`+2700000`) but is not a whole one (`+270000012345`) is refused: it would
 * be counted as a demo shop by `countShopsWithPhonePrefix`, left alone by the housekeeping and exempt from this cap.
 * No real owner has such a number.
 *
 * A repeat of a sign-up that already worked (the shop for this phone or id exists) is passed through, so the store
 * answers it with `ShopAlreadyExistsError` as before and the dialled menu can carry on with the shop it has, even
 * when the cap has been reached.
 */
export function withShopLimit(store: LedgerStore, max: number): LedgerStore {
  return {
    ...passThrough(store),
    async createShop(shop: Shop): Promise<void> {
      if (shop.phone.startsWith(DEMO_PHONE_PREFIX) && !isDemoNumber(shop.phone)) {
        const repeat = await store.findShopByPhone(shop.phone);
        if (!repeat) throw new ShopLimitError('demo-range');
      }
      if (!isDemoNumber(shop.phone)) {
        // The empty prefix matches every shop, so the first count is all shops.
        const all = await store.countShopsWithPhonePrefix('');
        const demo = await store.countShopsWithPhonePrefix(DEMO_PHONE_PREFIX);
        if (all - demo >= max) {
          const repeat = (await store.findShopByPhone(shop.phone)) ?? (await store.findShopById(shop.id));
          if (!repeat) throw new ShopLimitError(max);
        }
      }
      await store.createShop(shop);
    }
  };
}

/**
 * A store that cannot make shops. The browser phone's routes use it: only `POST /api/phone/demo` makes demo shops,
 * so if a call somehow reaches a handler that wants to sign a new owner up, the handler gets an error and nothing
 * is written.
 */
export function withoutShopCreation(store: LedgerStore): LedgerStore {
  return {
    ...passThrough(store),
    async createShop(): Promise<void> {
      throw new ShopCreationNotAllowedError();
    }
  };
}

export class ShopCreationNotAllowedError extends Error {
  constructor() {
    super('This route cannot make shops');
    this.name = 'ShopCreationNotAllowedError';
  }
}
