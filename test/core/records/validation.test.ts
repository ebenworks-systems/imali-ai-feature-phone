import { describe, it, expect } from 'vitest';
import { validateAmount } from '../../../src/core/records/validation';

describe('record validation', () => {
  describe('validateAmount', () => {
    it('accepts positive amounts', () => {
      expect(validateAmount(1)).toEqual({ valid: true });
      expect(validateAmount(100)).toEqual({ valid: true });
      expect(validateAmount(100_000_000)).toEqual({ valid: true });
    });

    it('rejects zero', () => {
      const result = validateAmount(0);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Amount must be greater than zero');
    });

    it('rejects negative amounts', () => {
      const result = validateAmount(-100);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Amount must be greater than zero');
    });

    it('rejects non-integer amounts', () => {
      const result = validateAmount(100.5);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Amount is not a safe integer');
    });

    it('rejects unsafe integers', () => {
      const unsafeInt = Number.MAX_SAFE_INTEGER + 1;
      const result = validateAmount(unsafeInt);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Amount is not a safe integer');
    });

    it('accepts safe integers up to MAX_SAFE_INTEGER', () => {
      expect(validateAmount(Number.MAX_SAFE_INTEGER)).toEqual({ valid: true });
    });

    it('uses correct confirmation threshold (100,000,000 cents)', () => {
      // This test documents the threshold without doing validation
      // The threshold is 100,000,000 cents = 1,000,000.00
      const confirmationThreshold = 100_000_000;
      expect(validateAmount(confirmationThreshold)).toEqual({ valid: true });
      expect(validateAmount(confirmationThreshold + 1)).toEqual({ valid: true });
    });
  });
});
