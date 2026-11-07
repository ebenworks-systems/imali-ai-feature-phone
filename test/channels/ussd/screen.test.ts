import { describe, it, expect } from 'vitest';
import { SCREEN_IDS, toResponse, type Screen } from '../../../src/channels/ussd/screen.js';
import { HINT } from '../../../src/channels/ussd/text.js';
import { ussdProblems } from '../../../src/channels/limits.js';

const screen = (over: Partial<Screen> = {}): Screen => ({ id: 'amount', end: false, lines: ['Sale amount?'], ...over });

/** One line of exactly n characters. */
const line = (n: number): string => 'a'.repeat(n);

describe('SCREEN_IDS', () => {
  it('lists every screen once', () => {
    expect(new Set(SCREEN_IDS).size).toBe(SCREEN_IDS.length);
    expect(SCREEN_IDS).toHaveLength(21);
  });
});

describe('toResponse: prefix and length', () => {
  it('starts CON when the session continues and END when it ends', () => {
    expect(toResponse(screen())).toBe('CON Sale amount?');
    expect(toResponse(screen({ id: 'today', end: true, lines: ['Today'] }))).toBe('END Today');
  });

  it('joins lines with a newline and puts the notice first', () => {
    expect(toResponse(screen({ notice: 'Oops.', lines: ['a', 'b'] }))).toBe('CON Oops.\na\nb');
  });

  it('passes a body of exactly 182 characters', () => {
    const r = toResponse(screen({ lines: [line(182)] }));
    expect(r).toBe(`CON ${line(182)}`);
    expect(ussdProblems(r)).toEqual([]);
  });

  it('does not count the prefix', () => {
    expect(toResponse(screen({ end: true, lines: [line(182)] })).length).toBe(186);
  });

  it('drops the notice first when 183 would not fit', () => {
    // notice 20 + newline + lines 162 = 183
    const r = toResponse(screen({ notice: line(20), lines: [line(162)] }));
    expect(r).toBe(`CON ${line(162)}`);
    // one shorter fits with the notice
    const fits = toResponse(screen({ notice: line(20), lines: [line(161)] }));
    expect(fits).toBe(`CON ${line(20)}\n${line(161)}`);
  });

  it('uses a shrink version when dropping the notice is not enough, in order', () => {
    const lines = [line(100), line(100)];
    const r1 = toResponse(screen({ id: 'close', end: true, lines, shrink: [[line(100), line(50)], [line(10)]] }));
    expect(r1).toBe(`END ${line(100)}\n${line(50)}`);
    const r2 = toResponse(screen({ id: 'close', end: true, lines, shrink: [[line(100), line(100)], [line(10)]] }));
    expect(r2).toBe(`END ${line(10)}`);
  });

  it('tries the notice, then no notice, then each shrink version', () => {
    const r = toResponse(
      screen({ notice: 'N', lines: [line(182)], shrink: [[line(150)], [line(10)]] })
    );
    // "N\n" + 182 is too long; 182 alone fits.
    expect(r).toBe(`CON ${line(182)}`);
  });

  it('falls back to the too-big screen when nothing fits', () => {
    const r = toResponse(screen({ end: true, lines: [line(300)], shrink: [[line(250)], [line(200)]] }));
    expect(r).toBe('END These numbers are too big to show here.');
    expect(ussdProblems(r)).toEqual([]);
  });

  it('ends the session on the fall-back even for a CON screen', () => {
    expect(toResponse(screen({ lines: [line(300)] }))).toBe('END These numbers are too big to show here.');
  });

  it('never returns a response over the limit', () => {
    for (const n of [1, 100, 181, 182, 183, 190, 500]) {
      expect(ussdProblems(toResponse(screen({ notice: line(30), lines: [line(n)], hint: true })))).toEqual([]);
    }
  });
});

describe('toResponse: the hint line', () => {
  it('is 14 characters, so the hint and its newline add 15', () => {
    expect(HINT).toBe('0 Back 00 Menu');
    expect(`\n${HINT}`).toHaveLength(15);
  });

  it('is the last line when it fits', () => {
    expect(toResponse(screen({ hint: true }))).toBe(`CON Sale amount?\n${HINT}`);
    expect(toResponse(screen({ notice: 'Oops.', hint: true }))).toBe(`CON Oops.\nSale amount?\n${HINT}`);
  });

  it('is shown when the whole response is exactly 182 characters', () => {
    // body 167 + newline + 14 = 182
    const r = toResponse(screen({ lines: [line(167)], hint: true }));
    expect(r).toBe(`CON ${line(167)}\n${HINT}`);
    expect(r.length - 4).toBe(182);
    expect(ussdProblems(r)).toEqual([]);
  });

  it('is left out when the response would be 183, and nothing else changes', () => {
    const withoutHint = toResponse(screen({ lines: [line(168)] }));
    const r = toResponse(screen({ lines: [line(168)], hint: true }));
    expect(r).toBe(withoutHint);
    expect(r).toBe(`CON ${line(168)}`);
    expect(r).not.toContain(HINT);
  });

  it('is left out before the notice is dropped', () => {
    // notice 20 + newline + lines 150 = 171; with the hint 186: the hint goes, the notice stays.
    const r = toResponse(screen({ notice: line(20), lines: [line(150)], hint: true }));
    expect(r).toBe(`CON ${line(20)}\n${line(150)}`);
  });

  it('never makes the notice drop (same screen with and without the hint differs only by the hint)', () => {
    for (let n = 100; n <= 190; n += 1) {
      const base = toResponse(screen({ notice: line(20), lines: [line(n)] }));
      const hinted = toResponse(screen({ notice: line(20), lines: [line(n)], hint: true }));
      expect(hinted === base || hinted === `${base}\n${HINT}`).toBe(true);
    }
  });

  it('is shown after the notice is dropped when the shorter text leaves room for it', () => {
    // notice 20 + newline + 170 = 191: the notice drops; 170 + 15 = 185: the hint does not fit either.
    expect(toResponse(screen({ notice: line(20), lines: [line(170)], hint: true }))).toBe(`CON ${line(170)}`);
    // notice 30 + newline + 160 = 191: the notice drops; 160 + 15 = 175: the hint fits.
    expect(toResponse(screen({ notice: line(30), lines: [line(160)], hint: true }))).toBe(
      `CON ${line(160)}\n${HINT}`
    );
  });

  it('is not added to a shrink version that already fills the screen, and is added to one that leaves room', () => {
    const tight = toResponse(screen({ lines: [line(300)], shrink: [[line(182)]], hint: true }));
    expect(tight).toBe(`CON ${line(182)}`);
    const roomy = toResponse(screen({ lines: [line(300)], shrink: [[line(100)]], hint: true }));
    expect(roomy).toBe(`CON ${line(100)}\n${HINT}`);
  });

  it('is never shown on a screen without hint: true', () => {
    expect(toResponse(screen())).not.toContain(HINT);
    expect(toResponse(screen({ hint: false }))).not.toContain(HINT);
  });

  it('is never shown on an end screen, even when hint is set', () => {
    expect(toResponse(screen({ id: 'today', end: true, hint: true }))).toBe('END Sale amount?');
  });

  it('is not added to the too-big fall-back', () => {
    expect(toResponse(screen({ lines: [line(400)], hint: true }))).toBe(
      'END These numbers are too big to show here.'
    );
  });
});
