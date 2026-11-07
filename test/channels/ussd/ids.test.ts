import { describe, it, expect } from 'vitest';
import { recordIdFor, shopIdFor } from '../../../src/channels/ussd/ids.js';

describe('ids', () => {
  it('builds the record id from the session and the step', () => {
    expect(recordIdFor('ATUid_123', 4)).toBe('rec_ussd_ATUid_123_4');
  });

  it('builds the shop id from the session', () => {
    expect(shopIdFor('ATUid_123')).toBe('shop_ussd_ATUid_123');
  });

  it('gives the same id on every call', () => {
    expect(recordIdFor('S1', 4)).toBe(recordIdFor('S1', 4));
    expect(shopIdFor('S1')).toBe(shopIdFor('S1'));
  });

  it('gives different ids for a different step or session', () => {
    expect(recordIdFor('S1', 4)).not.toBe(recordIdFor('S1', 5));
    expect(recordIdFor('S1', 4)).not.toBe(recordIdFor('S2', 4));
    expect(shopIdFor('S1')).not.toBe(shopIdFor('S2'));
  });

  it('starts with the prefixes the core and the store expect', () => {
    expect(recordIdFor('S', 1)).toMatch(/^rec_/);
    expect(shopIdFor('S')).toMatch(/^shop_/);
  });
});
