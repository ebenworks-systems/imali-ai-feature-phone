import { describe, it, expect } from 'vitest';
import { normalizePhone } from '../../src/channels/phone.js';

describe('normalizePhone', () => {
  it('gives the same result for the spaced and the plain form', () => {
    expect(normalizePhone('+27 00 000 1234')).toBe('+27000001234');
    expect(normalizePhone('+27000001234')).toBe('+27000001234');
  });

  it('removes hyphens, dots and brackets', () => {
    expect(normalizePhone('+27-00-000-1234')).toBe('+27000001234');
    expect(normalizePhone('+27.00.000.1234')).toBe('+27000001234');
    expect(normalizePhone('+27 (00) 000 1234')).toBe('+27000001234');
  });

  it('adds a plus when only digits are left', () => {
    expect(normalizePhone('27000001234')).toBe('+27000001234');
    expect(normalizePhone('27 00 000 1234')).toBe('+27000001234');
  });

  it('accepts 7 to 15 digits and nothing else', () => {
    expect(normalizePhone('+1234567')).toBe('+1234567');
    expect(normalizePhone('+123456789012345')).toBe('+123456789012345');
    expect(normalizePhone('+123456')).toBeNull();
    expect(normalizePhone('+1234567890123456')).toBeNull();
  });

  it('gives null for text that is not a number', () => {
    expect(normalizePhone('0000')).toBeNull();
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('   ')).toBeNull();
    expect(normalizePhone('+')).toBeNull();
    expect(normalizePhone('+27abc00001234')).toBeNull();
    expect(normalizePhone('++27000001234')).toBeNull();
    expect(normalizePhone('+27+000001234')).toBeNull();
  });
});
