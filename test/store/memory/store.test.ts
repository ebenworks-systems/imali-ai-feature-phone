import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../../src/store/memory/store';
import { createShop } from '../../../src/core/shops/types';
import { createSaleRecord } from '../../../src/core/records/types';
import { runLedgerStoreContract } from '../contract';

// The shared checks (shops, records, order, copies, reversals, duplicate ids, the count by phone prefix).
runLedgerStoreContract('MemoryStore contract', {
  make: async () => new MemoryStore()
});

describe('MemoryStore only', () => {
  it('clear() removes shops, records and reversals', async () => {
    const store = new MemoryStore();
    const shop = createShop({ name: 'S', phone: '+27000001234', currency: 'ZAR', timeZone: 'Africa/Johannesburg' });
    await store.createShop(shop);
    await store.appendRecord(
      createSaleRecord(shop.id, { id: 'r1', amount: 100, channel: 'sms', originalWords: 'x', now: new Date() })
    );
    store.clear();
    expect(await store.findShopById(shop.id)).toBeNull();
    expect(await store.findRecordById('r1')).toBeNull();
    expect(await store.listRecords(shop.id)).toEqual([]);
    expect(await store.countShopsWithPhonePrefix('+27')).toBe(0);
  });
});
