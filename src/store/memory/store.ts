// In-memory implementation of LedgerStore

import type { Shop } from '../../core/shops/types.js';
import type { Record, ReversalRecord } from '../../core/records/types.js';
import {
  LedgerStore,
  DuplicateRecordError,
  RecordAlreadyReversedError,
  ShopAlreadyExistsError
} from '../interface.js';

/**
 * In-memory implementation of LedgerStore for testing and local development
 */
export class MemoryStore implements LedgerStore {
  private shops: Map<string, Shop> = new Map();
  private shopsByPhone: Map<string, Shop> = new Map();
  private records: Map<string, Record> = new Map();
  private recordsByShop: Map<string, Record[]> = new Map();
  private reversalsByRecordId: Map<string, ReversalRecord> = new Map();
  private reverseIndexByRecordId: Map<string, boolean> = new Map(); // Track which records are reversed

  async createShop(shop: Shop): Promise<void> {
    if (this.shops.has(shop.id)) {
      throw new ShopAlreadyExistsError(`id ${shop.id}`);
    }
    if (this.shopsByPhone.has(shop.phone)) {
      throw new ShopAlreadyExistsError('phone number');
    }
    this.shops.set(shop.id, shop);
    this.shopsByPhone.set(shop.phone, shop);
  }

  async findShopById(id: string): Promise<Shop | null> {
    return this.shops.get(id) || null;
  }

  async findShopByPhone(phone: string): Promise<Shop | null> {
    return this.shopsByPhone.get(phone) || null;
  }

  async appendRecord(record: Record): Promise<void> {
    // The same id again is refused first, before any other check, and nothing changes.
    if (this.records.has(record.id)) {
      throw new DuplicateRecordError(record.id);
    }

    // Check if this is a reversal of an already-reversed record
    if (record.kind === 'reversal') {
      const reversedRecordId = record.reversesRecordId;
      if (this.reverseIndexByRecordId.has(reversedRecordId)) {
        throw new RecordAlreadyReversedError(reversedRecordId);
      }
      // Mark the original record as reversed
      this.reverseIndexByRecordId.set(reversedRecordId, true);
      // Store the reversal for findReversalOf
      this.reversalsByRecordId.set(reversedRecordId, record);
    }

    // Store the record
    this.records.set(record.id, record);

    // Index by shop for listRecords
    if (!this.recordsByShop.has(record.shopId)) {
      this.recordsByShop.set(record.shopId, []);
    }
    this.recordsByShop.get(record.shopId)!.push(record);
  }

  async findRecordById(id: string): Promise<Record | null> {
    return this.records.get(id) || null;
  }

  async findReversalOf(recordId: string): Promise<ReversalRecord | null> {
    return this.reversalsByRecordId.get(recordId) || null;
  }

  async listRecords(
    shopId: string,
    options?: {
      since?: string;
    }
  ): Promise<Record[]> {
    const records = this.recordsByShop.get(shopId) || [];

    if (!options?.since) {
      return records;
    }

    const sinceTimestamp = new Date(options.since).getTime();
    return records.filter(record => {
      const recordTime = new Date(record.createdAt).getTime();
      return recordTime >= sinceTimestamp;
    });
  }

  /**
   * Clears all data (useful for testing)
   */
  clear(): void {
    this.shops.clear();
    this.shopsByPhone.clear();
    this.records.clear();
    this.recordsByShop.clear();
    this.reversalsByRecordId.clear();
    this.reverseIndexByRecordId.clear();
  }
}
