import { describe, it, expect } from 'vitest';
import { createShop, validateShopName } from '../../../src/core/shops/types';

describe('shops', () => {
  describe('createShop', () => {
    it('creates a shop with all required fields', () => {
      const shop = createShop({
        name: 'Tendai Shop',
        phone: '+27001234567',
        currency: 'ZAR',
        timeZone: 'Africa/Johannesburg'
      });

      expect(shop.id).toMatch(/^shop_/);
      expect(shop.name).toBe('Tendai Shop');
      expect(shop.phone).toBe('+27001234567');
      expect(shop.currency).toBe('ZAR');
      expect(shop.timeZone).toBe('Africa/Johannesburg');
      expect(shop.createdAt).toBeTruthy();
      // Verify createdAt is ISO 8601 UTC
      expect(new Date(shop.createdAt).toISOString()).toBe(shop.createdAt);
    });

    it('generates different IDs for different shops', () => {
      const shop1 = createShop({
        name: 'Shop 1',
        phone: '+27001234567',
        currency: 'ZAR',
        timeZone: 'Africa/Johannesburg'
      });

      const shop2 = createShop({
        name: 'Shop 2',
        phone: '+27001234568',
        currency: 'ZAR',
        timeZone: 'Africa/Johannesburg'
      });

      expect(shop1.id).not.toBe(shop2.id);
    });
  });

  describe('validateShopName', () => {
    it('accepts valid names', () => {
      expect(validateShopName('Shop')).toBe(true);
      expect(validateShopName('Tendai Shop')).toBe(true);
      expect(validateShopName('A')).toBe(true);
    });

    it('rejects empty names', () => {
      expect(validateShopName('')).toBe(false);
    });

    it('rejects names longer than 24 characters', () => {
      expect(validateShopName('This is a shop name that is way too long')).toBe(false);
      expect(validateShopName('1234567890123456789012345')).toBe(false); // 25 chars
    });

    it('accepts exactly 24 character names', () => {
      expect(validateShopName('123456789012345678901234')).toBe(true); // 24 chars
    });
  });
});
