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

  it('takes x-real-ip first (Vercel sets it to the connecting address)', () => {
    expect(clientAddress(headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientAddress(headers({ 'x-real-ip': ' 198.51.100.2 ' }))).toBe('198.51.100.2');
    expect(clientAddress(headers({ 'x-real-ip': '198.51.100.2', 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe(
      '198.51.100.2'
    );
  });

  it('then the rightmost entry of x-forwarded-for, trimmed, never the leftmost (a caller can write that one)', () => {
    expect(clientAddress(headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('10.0.0.1');
    expect(clientAddress(headers({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.7  ' }))).toBe('203.0.113.7');
    expect(clientAddress(headers({ 'x-forwarded-for': '  203.0.113.7  ' }))).toBe('203.0.113.7');
    expect(clientAddress(headers({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('then unknown', () => {
    expect(clientAddress(headers({}))).toBe('unknown');
  });

  it('treats a blank header as missing', () => {
    expect(clientAddress(headers({ 'x-forwarded-for': '   ' }))).toBe('unknown');
    expect(clientAddress(headers({ 'x-forwarded-for': '', 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientAddress(headers({ 'x-real-ip': '   ', 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
    // The rightmost entry is blank: there is no address to use, so the shared key is used, never an earlier entry.
    expect(clientAddress(headers({ 'x-forwarded-for': '203.0.113.7, ' }))).toBe('unknown');
  });

  it('cuts a very long value, so a header cannot be used to fill memory', () => {
    expect(clientAddress(headers({ 'x-real-ip': 'a'.repeat(500) }))).toHaveLength(64);
    expect(clientAddress(headers({ 'x-real-ip': `2001:db8::${'1:'.repeat(300)}` })).length).toBeLessThanOrEqual(64);
  });

  describe('IPv6', () => {
    const real = (address: string) => clientAddress(headers({ 'x-real-ip': address }));

    it('counts two addresses in one /64 as one client', () => {
      expect(real('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(real('2001:db8:1:2:1111:2222:3333:4444'));
      expect(real('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2');
    });

    it('counts two addresses in different /64s apart', () => {
      expect(real('2001:db8:1:2::1')).not.toBe(real('2001:db8:1:3::1'));
      expect(real('2001:db8:1:2::1')).not.toBe(real('2001:db8:2:2::1'));
      expect(real('2001:db8:1:2::1')).not.toBe(real('2001:db9:1:2::1'));
    });

    it('expands "::" first, so the four groups are the real ones', () => {
      // `2001:db8::1` is 2001:db8:0:0:0:0:0:1, whose /64 is 2001:db8:0:0, not 2001:db8:1.
      expect(real('2001:db8::1')).toBe('2001:db8:0:0');
      expect(real('2001:db8::1')).toBe(real('2001:0db8:0000:0000:ffff:0:0:2'));
      expect(real('2001:db8:1:2:3::')).toBe('2001:db8:1:2');
      expect(real('2001::')).toBe('2001:0:0:0');
      expect(real('::')).toBe('0:0:0:0');
      expect(real('::1')).toBe('0:0:0:0');
      expect(real('1:2::3:4:5')).toBe('1:2:0:0'); // 1:2:0:0:0:3:4:5
      expect(real('1::2:3:4:5:6:7')).toBe('1:0:2:3'); // 1:0:2:3:4:5:6:7
    });

    it('ignores case, leading zeros, brackets, a port and a zone', () => {
      const expected = '2001:db8:1:2';
      expect(real('2001:DB8:0001:0002::5')).toBe(expected);
      expect(real('[2001:db8:1:2::5]')).toBe(expected);
      expect(real('[2001:db8:1:2::5]:443')).toBe(expected);
      expect(real('fe80::1%eth0')).toBe('fe80:0:0:0');
    });

    it('counts an IPv4-mapped IPv6 address as the IPv4 address', () => {
      expect(real('::ffff:192.0.2.1')).toBe('192.0.2.1');
      expect(real('::FFFF:192.0.2.1')).toBe('192.0.2.1');
      expect(real('0:0:0:0:0:ffff:192.0.2.1')).toBe('192.0.2.1');
      expect(real('::ffff:c000:201')).toBe('192.0.2.1'); // the same address in hexadecimal groups
      expect(real('::ffff:192.0.2.1')).toBe(real('192.0.2.1'));
      expect(real('::ffff:192.0.2.1')).not.toBe(real('::ffff:192.0.2.2'));
    });

    it('does not take another address with the ffff group for a mapped one', () => {
      expect(real('1::ffff:192.0.2.1')).toBe('1:0:0:0');
      expect(real('::fffe:192.0.2.1')).toBe('0:0:0:0');
    });

    it('works for the x-forwarded-for fallback too', () => {
      const a = clientAddress(headers({ 'x-forwarded-for': '1.1.1.1, 2001:db8:1:2:a:b:c:d' }));
      const b = clientAddress(headers({ 'x-forwarded-for': '9.9.9.9, 2001:db8:1:2:e:f:0:1' }));
      expect(a).toBe('2001:db8:1:2');
      expect(b).toBe(a);
    });

    it('counts text with a ":" that is not an IPv6 address under the shared key, so writing a new string gains nothing', () => {
      for (const text of ['1:2:3', 'zzzz::1', '1::2::3', '1:2:3:4:5:6:7:8:9', '12345::1', '::ffff:999.0.0.1', ':::']) {
        expect(real(text), text).toBe('unknown');
      }
    });
  });

  describe('IPv4', () => {
    const real = (address: string) => clientAddress(headers({ 'x-real-ip': address }));

    it('stays as it is', () => {
      expect(real('203.0.113.7')).toBe('203.0.113.7');
      expect(real('198.51.100.2')).toBe('198.51.100.2');
    });

    it('drops a port, which some proxies add', () => {
      expect(real('203.0.113.7:51234')).toBe('203.0.113.7');
    });
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
