import { describe, it, expect } from 'vitest';
import { parseAmount, requiresConfirmation, isSafeInteger } from '@/core/money/parse.ts';

describe('parseAmount', () => {
  describe('ZAR currency', () => {
    it('parses plain integer', () => {
      const result = parseAmount('45', 'ZAR');
      expect(result).toEqual({
        type: 'success',
        amount: { cents: 4500, requiresConfirmation: false }
      });
    });

    it('parses with currency symbol', () => {
      const result = parseAmount('R45', 'ZAR');
      expect(result).toEqual({
        type: 'success',
        amount: { cents: 4500, requiresConfirmation: false }
      });
    });

    it('parses with decimals', () => {
      const result = parseAmount('45.50', 'ZAR');
      expect(result).toEqual({
        type: 'success',
        amount: { cents: 4550, requiresConfirmation: false }
      });
    });

    it('parses with decimal comma', () => {
      const result = parseAmount('45,50', 'ZAR');
      expect(result).toEqual({
        type: 'success',
        amount: { cents: 4550, requiresConfirmation: false }
      });
    });

    it('parses with decimal comma single digit', () => {
      const result = parseAmount('45,5', 'ZAR');
      expect(result).toEqual({
        type: 'success',
        amount: { cents: 4550, requiresConfirmation: false }
      });
    });

    it('parses with thousands comma', () => {
      const result = parseAmount('1,200', 'ZAR');
      expect(result).toEqual({
        type: 'success',
        amount: { cents: 120000, requiresConfirmation: false }
      });
    });

    it('parses with thousands space', () => {
      const result = parseAmount('1 200', 'ZAR');
      expect(result).toEqual({
        type: 'success',
        amount: { cents: 120000, requiresConfirmation: false }
      });
    });

    it('parses with both thousands and decimals', () => {
      const result = parseAmount('1,200.50', 'ZAR');
      expect(result).toEqual({
        type: 'success',
        amount: { cents: 120050, requiresConfirmation: false }
      });
    });

    it('parses with thousands space and decimals', () => {
      const result = parseAmount('1 200.50', 'ZAR');
      expect(result).toEqual({
        type: 'success',
        amount: { cents: 120050, requiresConfirmation: false }
      });
    });

    it('parses large amount', () => {
      const result = parseAmount('999999.99', 'ZAR');
      expect(result).toEqual({
        type: 'success',
        amount: { cents: 99999999, requiresConfirmation: false }
      });
    });

    it('flags large amount needing confirmation', () => {
      const result = parseAmount('1000000.01', 'ZAR');
      expect(result).toEqual({
        type: 'success',
        amount: { cents: 100000001, requiresConfirmation: true }
      });
    });
  });

  describe('ambiguous parsing', () => {
    it('detects ambiguous format "2 200"', () => {
      const result = parseAmount('2 200', 'ZAR');
      expect(result.type).toBe('ambiguous');
      if (result.type === 'ambiguous') {
        expect(result.possibleAmounts).toEqual([
          { cents: 2200, requiresConfirmation: false },  // one sale of 2200
          { cents: 400, requiresConfirmation: false }     // 2 items at 200 each
        ]);
      }
    });

    it('detects ambiguous format "5 500"', () => {
      const result = parseAmount('5 500', 'ZAR');
      expect(result.type).toBe('ambiguous');
      if (result.type === 'ambiguous') {
        expect(result.possibleAmounts).toEqual([
          { cents: 5500, requiresConfirmation: false },  // one sale of 5500
          { cents: 2500, requiresConfirmation: false }     // 5 items at 500 each
        ]);
      }
    });
  });

  describe('error cases', () => {
    it('returns error for empty string', () => {
      const result = parseAmount('', 'ZAR');
      expect(result).toEqual({ type: 'error', reason: 'Empty amount' });
    });

    it('returns error for invalid format', () => {
      const result = parseAmount('abc', 'ZAR');
      expect(result).toEqual({ type: 'error', reason: 'Invalid amount format' });
    });

    it('returns error for negative amount', () => {
      const result = parseAmount('-45', 'ZAR');
      expect(result).toEqual({ type: 'error', reason: 'Invalid amount format' });
    });

    it('returns error for currency symbol only', () => {
      const result = parseAmount('R', 'ZAR');
      expect(result).toEqual({ type: 'error', reason: 'Missing amount' });
    });
  });

  describe('other currencies', () => {
    it('parses USD amount', () => {
      const result = parseAmount('$45.50', 'USD');
      expect(result).toEqual({
        type: 'success',
        amount: { cents: 4550, requiresConfirmation: false }
      });
    });

    it('parses NGN amount', () => {
      const result = parseAmount('N45', 'NGN');
      expect(result).toEqual({
        type: 'success',
        amount: { cents: 4500, requiresConfirmation: false }
      });
    });

    it('parses GHS amount', () => {
      const result = parseAmount('GHS45', 'GHS');
      expect(result).toEqual({
        type: 'success',
        amount: { cents: 4500, requiresConfirmation: false }
      });
    });
  });
});

describe('requiresConfirmation', () => {
  it('returns false for amounts under threshold', () => {
    expect(requiresConfirmation(100000000)).toBe(false);
    expect(requiresConfirmation(99999999)).toBe(false);
  });

  it('returns true for amounts over threshold', () => {
    expect(requiresConfirmation(100000001)).toBe(true);
    expect(requiresConfirmation(200000000)).toBe(true);
  });
});

describe('isSafeInteger', () => {
  it('returns true for safe integers', () => {
    expect(isSafeInteger(0)).toBe(true);
    expect(isSafeInteger(100)).toBe(true);
    expect(isSafeInteger(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('returns false for unsafe integers', () => {
    expect(isSafeInteger(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });
});
