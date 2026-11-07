import { describe, it, expect } from 'vitest';
import { USSD_LIMIT, SMS_LIMIT, isPlainAscii, ussdProblems, smsProblems } from '../../src/channels/limits.js';

describe('limits', () => {
  it('has the two limits from the steering file', () => {
    expect(USSD_LIMIT).toBe(182);
    expect(SMS_LIMIT).toBe(160);
  });
});

describe('isPlainAscii', () => {
  it('accepts characters 32 to 126 and a newline', () => {
    expect(isPlainAscii('Hello R1,240.50 ~ {ok}\nnext')).toBe(true);
    expect(isPlainAscii('')).toBe(true);
  });

  it('refuses emoji, curly quotes, an em dash and an accented letter', () => {
    expect(isPlainAscii('hi \u{1F600}')).toBe(false);
    expect(isPlainAscii('it\u2019s')).toBe(false);
    expect(isPlainAscii('a \u2014 b')).toBe(false);
    expect(isPlainAscii('caf\u00e9')).toBe(false);
  });

  it('refuses a tab, a carriage return and DEL', () => {
    expect(isPlainAscii('a\tb')).toBe(false);
    expect(isPlainAscii('a\rb')).toBe(false);
    expect(isPlainAscii('a\x7fb')).toBe(false);
  });
});

describe('ussdProblems', () => {
  it('passes a body of exactly 182 characters', () => {
    expect(ussdProblems(`CON ${'a'.repeat(182)}`)).toEqual([]);
    expect(ussdProblems(`END ${'a'.repeat(182)}`)).toEqual([]);
  });

  it('fails a body of 183 characters', () => {
    expect(ussdProblems(`CON ${'a'.repeat(183)}`)).toEqual(['over 182 characters']);
  });

  it('does not count the prefix', () => {
    // 186 characters in all, 182 after the prefix.
    expect(`CON ${'a'.repeat(182)}`.length).toBe(186);
    expect(ussdProblems(`CON ${'a'.repeat(182)}`)).toEqual([]);
  });

  it('counts a newline as a character', () => {
    expect(ussdProblems(`CON ${'a'.repeat(100)}\n${'b'.repeat(81)}`)).toEqual([]);
    expect(ussdProblems(`CON ${'a'.repeat(100)}\n${'b'.repeat(82)}`)).toEqual(['over 182 characters']);
  });

  it('reports a missing prefix', () => {
    expect(ussdProblems('Hello')).toEqual(['no CON/END prefix']);
    expect(ussdProblems('con Hello')).toEqual(['no CON/END prefix']);
    expect(ussdProblems('CON')).toEqual(['no CON/END prefix']);
    expect(ussdProblems('')).toEqual(['no CON/END prefix']);
  });

  it('reports non-ASCII text', () => {
    expect(ussdProblems('CON hi \u{1F600}')).toEqual(['not plain ASCII']);
    expect(ussdProblems('END it\u2019s')).toEqual(['not plain ASCII']);
    expect(ussdProblems('END a \u2014 b')).toEqual(['not plain ASCII']);
    expect(ussdProblems('END caf\u00e9')).toEqual(['not plain ASCII']);
  });

  it('reports every problem together', () => {
    expect(ussdProblems(`${'\u00e9'.repeat(183)}`)).toEqual([
      'no CON/END prefix',
      'over 182 characters',
      'not plain ASCII'
    ]);
  });
});

describe('smsProblems', () => {
  it('passes exactly 160 characters and fails 161', () => {
    expect(smsProblems('a'.repeat(160))).toEqual([]);
    expect(smsProblems('a'.repeat(161))).toEqual(['over 160 characters']);
  });

  it('reports non-ASCII text', () => {
    expect(smsProblems('Saved: sale R45 \u00e9')).toEqual(['not plain ASCII']);
    expect(smsProblems('\u{1F600}')).toEqual(['not plain ASCII']);
  });
});
