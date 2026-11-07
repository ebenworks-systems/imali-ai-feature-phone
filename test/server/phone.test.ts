import { describe, expect, it } from 'vitest';
import { SENTENCES } from '../../src/server/constants.js';
import { clientAddress, isDemoPhone, maskPhone, normalizePhone } from '../../src/server/phone.js';
import { normalizePhone as channelNormalize } from '../../src/channels/phone.js';

describe('normalizePhone', () => {
  it('is the function the dialled menu and the text handler use', () => {
    expect(normalizePhone).toBe(channelNormalize);
  });

  it.each([
    ['+27 00 000 1234', '+27000001234'],
    ['+27-00-000-1234', '+27000001234'],
    ['27000001234', '+27000001234'],
    ['(+27) 00 000 1234', '+27000001234'],
    ['+27.00.000.1234', '+27000001234'],
    ['+254711000000', '+254711000000']
  ])('turns %s into %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it.each(['abc', '12', '', '+', '1234567890123456', '+1234567890123456', '+27 00 abc'])('refuses %j', (raw) => {
    expect(normalizePhone(raw)).toBeNull();
  });
});

describe('isDemoPhone', () => {
  it('accepts +27000001234', () => {
    expect(isDemoPhone('+27000001234')).toBe(true);
    expect(isDemoPhone('+27000000000')).toBe(true);
    expect(isDemoPhone('+27000009999')).toBe(true);
  });

  it.each(['+27000011234', '+2700000123', '+27000001234 5', '+254711000000', '27000001234', '+270000012345', ''])(
    'refuses %j',
    (phone) => {
      expect(isDemoPhone(phone)).toBe(false);
    }
  );
});

describe('maskPhone', () => {
  it('shows the first four characters and the last two, never the middle digits', () => {
    const masked = maskPhone('+27000001234');
    expect(masked).toBe('+270***34');
    expect(masked).not.toContain('000012');
    expect(masked).not.toContain('1234');
  });

  it('hides a short number completely', () => {
    expect(maskPhone('+2712')).toBe('***');
    expect(maskPhone('')).toBe('***');
  });
});

describe('clientAddress', () => {
  const headers = (h: Record<string, string>) => ({ get: (name: string) => h[name.toLowerCase()] ?? null });

  it('takes the first entry of x-forwarded-for, trimmed', () => {
    expect(clientAddress(headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
    expect(clientAddress(headers({ 'x-forwarded-for': '  203.0.113.7  ' }))).toBe('203.0.113.7');
    expect(clientAddress(headers({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip, then to unknown', () => {
    expect(clientAddress(headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientAddress(headers({}))).toBe('unknown');
  });

  it('treats a blank x-forwarded-for as missing', () => {
    expect(clientAddress(headers({ 'x-forwarded-for': '   ' }))).toBe('unknown');
    expect(clientAddress(headers({ 'x-forwarded-for': ' , 10.0.0.1', 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientAddress(headers({ 'x-forwarded-for': '', 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
  });
});

describe('SENTENCES', () => {
  const all = Object.values(SENTENCES).map((v) => (typeof v === 'function' ? v('phone') : v));

  it('are plain ASCII and shorter than 100 characters', () => {
    expect(all.length).toBeGreaterThan(10);
    for (const sentence of all) {
      expect(sentence).toMatch(/^[\x20-\x7e]+$/);
      expect(sentence.length).toBeLessThan(100);
    }
  });

  it('fit a text message and a menu screen, so they can be sent as replies', () => {
    for (const sentence of all) expect(sentence.length).toBeLessThanOrEqual(160 - 4);
  });
});
