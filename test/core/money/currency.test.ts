import { describe, it, expect } from 'vitest';
import { getCurrencyInfo, type Currency } from '../../../src/core/money/currency';

describe('currency', () => {
  it('returns correct info for ZAR', () => {
    const info = getCurrencyInfo('ZAR');
    expect(info.symbol).toBe('R');
    expect(info.decimals).toBe(2);
  });

  it('returns correct info for USD', () => {
    const info = getCurrencyInfo('USD');
    expect(info.symbol).toBe('$');
    expect(info.decimals).toBe(2);
  });

  it('returns correct info for KES', () => {
    const info = getCurrencyInfo('KES');
    expect(info.symbol).toBe('KSh');
    expect(info.decimals).toBe(2);
  });

  it('returns correct info for NGN', () => {
    const info = getCurrencyInfo('NGN');
    expect(info.symbol).toBe('N');
    expect(info.decimals).toBe(2);
  });

  it('returns correct info for GHS', () => {
    const info = getCurrencyInfo('GHS');
    expect(info.symbol).toBe('GHS');
    expect(info.decimals).toBe(2);
  });

  it('returns correct info for ZMW', () => {
    const info = getCurrencyInfo('ZMW');
    expect(info.symbol).toBe('K');
    expect(info.decimals).toBe(2);
  });

  it('returns correct info for BWP', () => {
    const info = getCurrencyInfo('BWP');
    expect(info.symbol).toBe('P');
    expect(info.decimals).toBe(2);
  });
});
