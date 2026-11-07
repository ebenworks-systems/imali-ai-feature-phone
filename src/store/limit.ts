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
    countShopsWithPhonePrefix: (prefix: string): Promise<number> => store.countShopsWithPhonePrefix(prefix)
  };
}
