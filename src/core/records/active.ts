// Active records - records that are not reversed

import type { Record, ReversalRecord } from './types.js';

export interface ActiveRecordsResult {
  active: Record[];
  reversedIds: Set<string>;
}

/**
 * Returns all non-reversal records that have not been reversed.
 *
 * A record is "active" if:
 * - It is not a reversal record
 * - It has not been reversed by any reversal record in the same list
 *
 * This function processes the entire record list once instead of doing
 * per-record lookups via store.findReversalOf(). It scans for all reversal
 * records and builds a set of reversed record IDs, then filters the main
 * list.
 *
 * @param records All records for a shop, in any order
 * @returns Object with:
 *   - active: non-reversal records that are not reversed, in original order
 *   - reversedIds: set of all record IDs that have been reversed
 */
export function activeRecords(records: Record[]): ActiveRecordsResult {
  // First pass: collect all reversal records and build set of reversed IDs
  const reversedIds = new Set<string>();

  for (const record of records) {
    if (record.kind === 'reversal') {
      reversedIds.add((record as ReversalRecord).reversesRecordId);
    }
  }

  // Second pass: collect all non-reversal records that are not reversed
  const active: Record[] = [];

  for (const record of records) {
    if (record.kind !== 'reversal' && !reversedIds.has(record.id)) {
      active.push(record);
    }
  }

  return {
    active,
    reversedIds
  };
}
