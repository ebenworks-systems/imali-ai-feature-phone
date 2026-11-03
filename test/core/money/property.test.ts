import { describe, it, expect } from 'vitest';
import { parseAmount, requiresConfirmation } from '@/core/money/parse.ts';
import { formatCents } from '@/core/money/format.ts';
import { fc } from 'vitest';

describe('parse/format round-trip', () => {
  it('format then parse returns same amount', () => {
    // Test a range of amounts from 1 to 100,000,000
    const testCases = [
      1, 10, 100, 1000, 10000, 100000, 1000000,
      99999, 999999, 9999999, 99999999, 100000000
    ];
    
    for (const cents of testCases) {
      const formatted = formatCents(cents, 'ZAR');
      const result = parseAmount(formatted, 'ZAR');
      
      expect(result.type).toBe('success');
      if (result.type === 'success') {
        expect(result.amount.cents).toBe(cents);
        expect(result.amount.requiresConfirmation).toBe(cents > 100000000);
      }
    }
  });

  it('format then parse with decimals', () => {
    const testCases = [
      10, 100, 500, 990, 1000, 1001, 1234, 12345, 123456
    ];
    
    for (const cents of testCases) {
      const formatted = formatCents(cents, 'ZAR');
      const result = parseAmount(formatted, 'ZAR');
      
      expect(result.type).toBe('success');
      if (result.type === 'success') {
        expect(result.amount.cents).toBe(cents);
      }
    }
  });
});

describe('parse ambiguity detection', () => {
  it('detects ambiguous patterns', () => {
    const ambiguousCases = [
      '2 200',
      '5 500',
      '10 100'
    ];
    
    for (const input of ambiguousCases) {
      const result = parseAmount(input, 'ZAR');
      expect(result.type).toBe('ambiguous');
      if (result.type === 'ambiguous') {
        expect(result.possibleAmounts).toHaveLength(2);
      }
    }
  });
});

describe('requiresConfirmation property', () => {
  it('correctly flags amounts over threshold', () => {
    expect(requiresConfirmation(100000000)).toBe(false); // exactly threshold
    expect(requiresConfirmation(100000001)).toBe(true);  // over threshold
    expect(requiresConfirmation(99999999)).toBe(false);  // under threshold
  });
});
