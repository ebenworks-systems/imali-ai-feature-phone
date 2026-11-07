import { describe, it, expect } from 'vitest';
import { formatCents, getCurrencyInfo } from '@/core/money/format.ts';

describe('formatCents', () => {
  describe('ZAR currency', () => {
    it('formats zero cents as R0', () => {
      expect(formatCents(0, 'ZAR')).toBe('R0');
    });

    it('formats small amount without decimals', () => {
      expect(formatCents(4500, 'ZAR')).toBe('R45');
    });

    it('formats amount with cents', () => {
      expect(formatCents(4550, 'ZAR')).toBe('R45.50');
    });

    it('formats amount with single digit cents', () => {
      expect(formatCents(4550, 'ZAR')).toBe('R45.50');
    });

    it('formats with thousands comma', () => {
      expect(formatCents(120000, 'ZAR')).toBe('R1,200');
    });

    it('formats large amount with thousands', () => {
      expect(formatCents(1234567, 'ZAR')).toBe('R12,345.67');
    });

    it('formats very large amount', () => {
      expect(formatCents(999999999, 'ZAR')).toBe('R9,999,999.99');
    });

    it('formats maximum safe integer', () => {
      expect(formatCents(9007199254740991, 'ZAR')).toBe('R90,071,992,547,409.91');
    });
  });

  describe('other currencies', () => {
    it('formats USD', () => {
      expect(formatCents(4550, 'USD')).toBe('$45.50');
    });

    it('formats NGN', () => {
      expect(formatCents(120000, 'NGN')).toBe('N1,200');
    });

    it('formats GHS', () => {
      expect(formatCents(120000, 'GHS')).toBe('GHS1,200');
    });

    it('formats KES', () => {
      expect(formatCents(4550, 'KES')).toBe('KSh45.50');
    });

    it('formats ZMW', () => {
      expect(formatCents(120000, 'ZMW')).toBe('K1,200');
    });

    it('formats BWP', () => {
      expect(formatCents(4550, 'BWP')).toBe('P45.50');
    });
  });

  describe('edge cases', () => {
    it('formats negative amounts with the sign before the symbol', () => {
      expect(formatCents(-4550, 'ZAR')).toBe('-R45.50');
      expect(formatCents(-6000, 'ZAR')).toBe('-R60');
    });

    it('formats with trailing zeros', () => {
      expect(formatCents(4500, 'ZAR')).toBe('R45');
    });
  });

  describe('alwaysShowDecimals option', () => {
    it('shows decimals when enabled', () => {
      expect(formatCents(4500, 'ZAR', { alwaysShowDecimals: true })).toBe('R45.00');
    });

    it('shows decimals when enabled with zero', () => {
      expect(formatCents(0, 'ZAR', { alwaysShowDecimals: true })).toBe('R0.00');
    });
  });

  describe('negative amounts (sign before the symbol, every currency)', () => {
    const symbols = [
      ['ZAR', 'R'],
      ['USD', '$'],
      ['KES', 'KSh'],
      ['NGN', 'N'],
      ['GHS', 'GHS'],
      ['ZMW', 'K'],
      ['BWP', 'P']
    ] as const;

    for (const [currency, symbol] of symbols) {
      it(`${currency}: -${symbol}60, -${symbol}45.50 and -${symbol}1,200`, () => {
        expect(formatCents(-6000, currency)).toBe(`-${symbol}60`);
        expect(formatCents(-4550, currency)).toBe(`-${symbol}45.50`);
        expect(formatCents(-120000, currency)).toBe(`-${symbol}1,200`);
        expect(formatCents(-5, currency)).toBe(`-${symbol}0.05`);
      });

      it(`${currency}: never puts the sign after the symbol`, () => {
        expect(formatCents(-6000, currency)).not.toContain(`${symbol}-`);
      });
    }

    it('keeps the thousands comma and the cents', () => {
      expect(formatCents(-123456789, 'KES')).toBe('-KSh1,234,567.89');
    });

    it('works with alwaysShowDecimals', () => {
      expect(formatCents(-6000, 'ZAR', { alwaysShowDecimals: true })).toBe('-R60.00');
    });

    it('never signs zero', () => {
      expect(formatCents(0, 'ZAR')).toBe('R0');
      expect(formatCents(-0, 'ZAR')).toBe('R0');
      expect(formatCents(0, 'ZAR', { alwaysShowDecimals: true })).toBe('R0.00');
    });

    it('leaves positive amounts as they were', () => {
      expect(formatCents(6000, 'ZAR')).toBe('R60');
      expect(formatCents(4550, 'KES')).toBe('KSh45.50');
    });

    it('is plain ASCII', () => {
      expect(/^[\x20-\x7e]+$/.test(formatCents(-123456789, 'GHS'))).toBe(true);
    });
  });
});
