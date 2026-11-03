// Export data generation for the ledger

import type { LedgerStore } from '../../store/interface.js';
import type { Shop } from '../shops/types.js';
import type { Record } from '../records/types.js';

export interface ExportData {
  format: 'imali-ai-ledger-export';
  version: 1;
  exportedAt: string; // ISO 8601 UTC
  shop: Shop;
  records: Record[];
}

/**
 * Generates export data for a shop
 * Includes all records in chronological order (order they were made)
 * Includes reversal records in the export
 * Uses string timestamps (UTC ISO 8601) consistently
 */
export async function generateExport(
  store: LedgerStore,
  shop: Shop
): Promise<ExportData> {
  // Get all records for this shop (already in creation order from store)
  const records = await store.listRecords(shop.id);

  // Sort by creation time to ensure chronological order
  const sortedRecords = records.sort((a, b) => {
    const aTime = new Date(a.createdAt).getTime();
    const bTime = new Date(b.createdAt).getTime();
    return aTime - bTime;
  });

  return {
    format: 'imali-ai-ledger-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    shop,
    records: sortedRecords
  };
}
