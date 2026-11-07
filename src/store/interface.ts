// LedgerStore interface - minimal async storage abstraction
//
// The Postgres store must give the same two errors as the memory store: DuplicateRecordError from a primary key on
// the record id, and ShopAlreadyExistsError from a unique index on the shop's phone (and the shop id).

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
 * Error thrown when appending a record whose id the store already holds.
 *
 * The dialled menu gives a record an id made from the session, so a repeated request tries to append the same id.
 * The store checks this BEFORE any other check, so a repeated undo is never mistaken for a second reversal.
 */
export class DuplicateRecordError extends Error {
  constructor(recordId: string) {
    super(`Record ${recordId} already exists`);
    this.name = 'DuplicateRecordError';
  }
}

/**
 * Error thrown when creating a shop whose id, or whose phone number, already has a shop.
 */
export class ShopAlreadyExistsError extends Error {
  constructor(detail: string) {
    super(`Shop already exists: ${detail}`);
    this.name = 'ShopAlreadyExistsError';
  }
}

/**
 * Minimal LedgerStore interface with no business logic
 * All business logic lives in the core, not in the store
 */
export interface LedgerStore {
  /**
   * Creates a new shop
   * Throws ShopAlreadyExistsError when the id or the phone number already has a shop, and changes nothing
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
   * Throws DuplicateRecordError when the id is already held (checked first), changing nothing
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
