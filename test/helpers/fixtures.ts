/**
 * Small builders shared by the menu tests. All names, numbers and figures are invented; phone numbers are in the
 * fiction range `+27 00 000 xxxx`.
 */

import { createShop, type Currency, type LedgerStore, type Shop } from '../../src/core/index.js';

export const DEMO_PHONE = '+27000001234';
/** A fixed "now": 12:30 in Johannesburg on Mon 3 Nov 2025. */
export const NOW = new Date('2025-11-03T10:30:00.000Z');

export async function seedShop(
  store: LedgerStore,
  over: Partial<Pick<Shop, 'name' | 'phone' | 'currency' | 'timeZone' | 'id'>> = {}
): Promise<Shop> {
  const shop = createShop({
    id: over.id,
    name: over.name ?? 'Demo Spaza',
    phone: over.phone ?? DEMO_PHONE,
    currency: (over.currency ?? 'ZAR') as Currency,
    timeZone: over.timeZone ?? 'Africa/Johannesburg'
  });
  await store.createShop(shop);
  return shop;
}
