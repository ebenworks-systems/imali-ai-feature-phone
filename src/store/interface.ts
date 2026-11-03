// LedgerStore interface - minimal async storage abstraction

import type { Shop } from '../core/shops/types.js';
import type { Record, ReversalRecord } from '../core/records/types.js';

/**
 * Error thrown when attempting to reverse a record that is already reversed
 */
export class RecordAlreadyReversedError extends Error {
  constructor(recordId: string) {
    super(`Record ${recordId} is already reversed`);
    this.name = 'RecordAlreadyReversedError';
  }
}

/**
 * Minimal LedgerStore interface with no business logic
 * All business logic lives in the core, not in the store
 */
export interface LedgerStore {
  /**
   * Creates a new shop
   */
  createShop(shop: Shop): Promise<void>;

  /**
   * Finds a shop by ID, returns null if not found
   */
  findShopById(id: string): Promise<Shop | null>;

  /**
   * Finds a shop by phone number, returns null if not found
   */
  findShopByPhone(phone: string): Promise<Shop | null>;

  /**
   * Appends a record to the store
   * Throws RecordAlreadyReversedError if trying to reverse a record that's already reversed
   */
  appendRecord(record: Record): Promise<void>;

  /**
   * Finds a record by ID, returns null if not found
   */
  findRecordById(id: string): Promise<Record | null>;

  /**
   * Finds the reversal record for a given record, returns null if not found or not reversed
   */
  findReversalOf(recordId: string): Promise<ReversalRecord | null>;

  /**
   * Lists all records for a shop, optionally filtered by since timestamp
   */
  listRecords(
    shopId: string,
    options?: {
      since?: string; // UTC ISO 8601 timestamp
    }
  ): Promise<Record[]>;
}
