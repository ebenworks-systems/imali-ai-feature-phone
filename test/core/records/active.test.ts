// Tests for active records function

import { describe, it, expect } from 'vitest';
import { activeRecords } from '../../../src/core/records/active.js';
import { createSaleRecord, createReversal } from '../../../src/core/records/types.js';

describe('activeRecords', () => {
  const shopId = 'shop_1';
  const now = new Date('2025-11-03T10:30:00Z');
  const channel = 'ussd' as const;

  it('returns empty lists for empty input', () => {
    const result = activeRecords([]);

    expect(result.active).toEqual([]);
    expect(result.reversedIds).toEqual(new Set());
  });

  it('returns single record when only one record exists', () => {
    const sale = createSaleRecord(shopId, {
      amount: 5000,
      item: 'bread',
      channel,
      originalWords: 'sold 50 bread',
      now
    });

    const result = activeRecords([sale]);

    expect(result.active).toEqual([sale]);
    expect(result.reversedIds).toEqual(new Set());
  });

  it('excludes a record that has been reversed', () => {
    const sale = createSaleRecord(shopId, {
      amount: 5000,
      item: 'bread',
      channel,
      originalWords: 'sold 50 bread',
      now
    });

    const reversal = createReversal(sale, channel, 'undo', now);

    const result = activeRecords([sale, reversal]);

    expect(result.active).toEqual([]);
    expect(result.reversedIds).toEqual(new Set([sale.id]));
  });

  it('handles reversal listed before the record it reverses', () => {
    const sale = createSaleRecord(shopId, {
      amount: 5000,
      item: 'bread',
      channel,
      originalWords: 'sold 50 bread',
      now
    });

    const reversal = createReversal(sale, channel, 'undo', now);

    // Reversal listed before the original record
    const result = activeRecords([reversal, sale]);

    expect(result.active).toEqual([]);
    expect(result.reversedIds).toEqual(new Set([sale.id]));
  });

  it('handles multiple records with one reversed', () => {
    const sale1 = createSaleRecord(shopId, {
      amount: 5000,
      item: 'bread',
      channel,
      originalWords: 'sold 50 bread',
      now
    });

    const sale2 = createSaleRecord(shopId, {
      amount: 3000,
      item: 'milk',
      channel,
      originalWords: 'sold 30 milk',
      now
    });

    const reversal = createReversal(sale1, channel, 'undo', now);

    const result = activeRecords([sale1, reversal, sale2]);

    expect(result.active).toEqual([sale2]);
    expect(result.reversedIds).toEqual(new Set([sale1.id]));
  });
});
