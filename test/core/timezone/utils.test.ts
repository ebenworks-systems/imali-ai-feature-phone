import { describe, it, expect } from 'vitest';
import {
  getShopLocalDate,
  getShopDayBounds,
  isTodayInShopTimeZone
} from '../../../src/core/timezone/utils';
import { createShop } from '../../../src/core/shops/types';

describe('timezone utilities', () => {
  describe('getShopLocalDate', () => {
    it('converts UTC to shop time zone', () => {
      const shop = createShop({
        name: 'Test Shop',
        phone: '+27001234567',
        currency: 'ZAR',
        timeZone: 'Africa/Johannesburg'
      });

      // 2024-01-15 10:00:00 UTC = 2024-01-15 12:00:00 in Johannesburg (UTC+2)
      const utcDate = new Date('2024-01-15T10:00:00Z');
      const localDate = getShopLocalDate(shop, utcDate);

      expect(localDate).toBe('2024-01-15');
    });

    it('handles dates in different time zones', () => {
      const shop = createShop({
        name: 'Test Shop',
        phone: '+254001234567',
        currency: 'KES',
        timeZone: 'Africa/Nairobi'
      });

      // 2024-01-15 10:00:00 UTC = 2024-01-15 13:00:00 in Nairobi (UTC+3)
      const utcDate = new Date('2024-01-15T10:00:00Z');
      const localDate = getShopLocalDate(shop, utcDate);

      expect(localDate).toBe('2024-01-15');
    });

    it('handles day boundaries correctly', () => {
      const shop = createShop({
        name: 'Test Shop',
        phone: '+27001234567',
        currency: 'ZAR',
        timeZone: 'Africa/Johannesburg'
      });

      // Just before UTC midnight
      const beforeMidnight = new Date('2024-01-15T22:00:00Z');
      expect(getShopLocalDate(shop, beforeMidnight)).toBe('2024-01-16');

      // Just after UTC midnight
      const afterMidnight = new Date('2024-01-15T22:01:00Z');
      expect(getShopLocalDate(shop, afterMidnight)).toBe('2024-01-16');
    });
  });

  describe('getShopDayBounds', () => {
    it('returns correct UTC bounds for a day in shop time zone', () => {
      const shop = createShop({
        name: 'Test Shop',
        phone: '+27001234567',
        currency: 'ZAR',
        timeZone: 'Africa/Johannesburg'
      });

      const bounds = getShopDayBounds(shop, '2024-01-15');

      // The start should be a Date object
      expect(bounds.start).toBeInstanceOf(Date);
      expect(bounds.end).toBeInstanceOf(Date);

      // End should be 24 hours after start
      expect(bounds.end.getTime() - bounds.start.getTime()).toBe(
        24 * 60 * 60 * 1000
      );
    });

    it('contains timestamps from the correct local day', () => {
      const shop = createShop({
        name: 'Test Shop',
        phone: '+27001234567',
        currency: 'ZAR',
        timeZone: 'Africa/Johannesburg'
      });

      const bounds = getShopDayBounds(shop, '2024-01-15');

      // All times within the bounds should be from 2024-01-15 in shop time zone
      const testTime1 = new Date(bounds.start.getTime() + 1000);
      expect(getShopLocalDate(shop, testTime1)).toBe('2024-01-15');

      const testTime2 = new Date(bounds.start.getTime() + 12 * 60 * 60 * 1000);
      expect(getShopLocalDate(shop, testTime2)).toBe('2024-01-15');

      const testTime3 = new Date(bounds.end.getTime() - 1000);
      expect(getShopLocalDate(shop, testTime3)).toBe('2024-01-15');
    });

    it('handles different time zones', () => {
      // Note: On 2024-01-15, both Johannesburg (UTC+2) and Nairobi (UTC+3) are in their
      // respective standard times. However, the day boundaries in UTC will be different.
      const johannesburg = createShop({
        name: 'JNB Shop',
        phone: '+27001234567',
        currency: 'ZAR',
        timeZone: 'Africa/Johannesburg'
      });

      const nairobi = createShop({
        name: 'NRB Shop',
        phone: '+254001234567',
        currency: 'KES',
        timeZone: 'Africa/Nairobi'
      });

      const boundsJNB = getShopDayBounds(johannesburg, '2024-01-15');
      const boundsNRB = getShopDayBounds(nairobi, '2024-01-15');

      // Both should contain the correct local day for their respective time zones
      expect(getShopLocalDate(johannesburg, boundsJNB.start)).toBe('2024-01-15');
      expect(getShopLocalDate(nairobi, boundsNRB.start)).toBe('2024-01-15');

      // Each should span 24 hours
      expect(boundsJNB.end.getTime() - boundsJNB.start.getTime()).toBe(
        24 * 60 * 60 * 1000
      );
      expect(boundsNRB.end.getTime() - boundsNRB.start.getTime()).toBe(
        24 * 60 * 60 * 1000
      );
    });
  });

  describe('isTodayInShopTimeZone', () => {
    it('returns true for today', () => {
      const shop = createShop({
        name: 'Test Shop',
        phone: '+27001234567',
        currency: 'ZAR',
        timeZone: 'Africa/Johannesburg'
      });

      const now = new Date('2024-01-15T15:00:00Z');
      const timestamp = '2024-01-15T10:00:00Z';

      expect(isTodayInShopTimeZone(shop, timestamp, now)).toBe(true);
    });

    it('returns false for yesterday', () => {
      const shop = createShop({
        name: 'Test Shop',
        phone: '+27001234567',
        currency: 'ZAR',
        timeZone: 'Africa/Johannesburg'
      });

      const now = new Date('2024-01-15T15:00:00Z');
      const timestamp = '2024-01-14T15:00:00Z';

      expect(isTodayInShopTimeZone(shop, timestamp, now)).toBe(false);
    });

    it('returns false for tomorrow', () => {
      const shop = createShop({
        name: 'Test Shop',
        phone: '+27001234567',
        currency: 'ZAR',
        timeZone: 'Africa/Johannesburg'
      });

      const now = new Date('2024-01-15T15:00:00Z');
      const timestamp = '2024-01-16T15:00:00Z';

      expect(isTodayInShopTimeZone(shop, timestamp, now)).toBe(false);
    });

    it('handles day boundary correctly (21:59:59Z and 22:00:00Z same UTC date different local days)', () => {
      // This tests the critical case mentioned in the spec:
      // 21:59:59Z and 22:00:00Z on the same UTC date fall on different local days
      // in Africa/Johannesburg (UTC+2)
      const shop = createShop({
        name: 'Test Shop',
        phone: '+27001234567',
        currency: 'ZAR',
        timeZone: 'Africa/Johannesburg'
      });

      // Set "now" to 2024-01-16T00:00:01Z (just after midnight UTC on Jan 16)
      // This is 2024-01-16 02:00:01 in Johannesburg (next day locally)
      const now = new Date('2024-01-16T00:00:01Z');

      // 21:59:59Z on 2024-01-15 UTC is 23:59:59 on 2024-01-15 in Johannesburg (still same day)
      const timestamp1 = '2024-01-15T21:59:59Z';
      // 22:00:00Z on 2024-01-15 UTC is 00:00:00 on 2024-01-16 in Johannesburg (next day)
      const timestamp2 = '2024-01-15T22:00:00Z';

      // timestamp1 (21:59:59Z) should be yesterday in Johannesburg
      expect(isTodayInShopTimeZone(shop, timestamp1, now)).toBe(false);

      // timestamp2 (22:00:00Z) should be today in Johannesburg
      expect(isTodayInShopTimeZone(shop, timestamp2, now)).toBe(true);
    });

    it('respects different time zones', () => {
      const shop = createShop({
        name: 'Test Shop',
        phone: '+254001234567',
        currency: 'KES',
        timeZone: 'Africa/Nairobi'
      });

      const now = new Date('2024-01-15T15:00:00Z');
      const timestamp = '2024-01-15T10:00:00Z';

      expect(isTodayInShopTimeZone(shop, timestamp, now)).toBe(true);
    });
  });
});
