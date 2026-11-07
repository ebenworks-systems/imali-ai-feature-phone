// Shop type and validation for the ledger

import { randomUUID } from 'node:crypto';
import type { Currency } from '../money/currency.js';

export interface Shop {
  id: string;
  name: string;
  phone: string; // E.164 format
  currency: Currency;
  timeZone: string; // IANA time zone, default 'Africa/Johannesburg'
  createdAt: string; // UTC ISO 8601 string
}

/**
 * Creates a new shop with generated ID and current timestamp
 */
export function createShop(
  params: Omit<Shop, 'id' | 'createdAt'>
): Shop {
  return {
    ...params,
    id: generateShopId(),
    createdAt: new Date().toISOString()
  };
}

/**
 * Validates that a shop name is valid (≤24 characters)
 */
export function validateShopName(name: string): boolean {
  return name.length > 0 && name.length <= 24;
}

/**
 * Generates a unique shop ID
 */
function generateShopId(): string {
  // A random UUID, so two serverless instances can never make the same id.
  return `shop_${randomUUID()}`;
}
