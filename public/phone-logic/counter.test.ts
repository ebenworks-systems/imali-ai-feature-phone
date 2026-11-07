import { describe, expect, it } from 'vitest';
import { NEAR_PERCENT, counterInfo } from '../../../public/phone-logic.js';

describe('counterInfo', () => {
  it.each([
    ['menu', 143, 182, 'ok', 'This screen: 143 of 182 characters'],
    ['menu', 163, 182, 'ok', 'This screen: 163 of 182 characters'],
    ['menu', 164, 182, 'near', 'This screen: 164 of 182 characters - near the limit'],
    ['menu', 182, 182, 'near', 'This screen: 182 of 182 characters - near the limit'],
    ['menu', 183, 182, 'over', 'This screen: 183 of 182 characters - over the limit'],
    ['text', 98, 160, 'ok', 'Reply: 98 of 160 characters'],
    ['text', 143, 160, 'ok', 'Reply: 143 of 160 characters'],
    ['text', 144, 160, 'near', 'Reply: 144 of 160 characters - near the limit'],
    ['text', 160, 160, 'near', 'Reply: 160 of 160 characters - near the limit'],
    ['text', 161, 160, 'over', 'Reply: 161 of 160 characters - over the limit'],
  ] as const)('%s %i of %i is %s', (kind, chars, limit, level, text) => {
    expect(counterInfo(kind, chars, limit)).toEqual({ text, level });
  });

  it('says "over the limit" instead of "near the limit", never both', () => {
    const over = counterInfo('menu', 500, 182);
    expect(over?.text).toContain('over the limit');
    expect(over?.text).not.toContain('near');
  });

  it('shows a short screen with no warning', () => {
    expect(counterInfo('menu', 0, 182)).toEqual({ text: 'This screen: 0 of 182 characters', level: 'ok' });
    expect(counterInfo('menu', 1, 182)?.level).toBe('ok');
  });

  it('uses integer maths at the 90 percent line for every limit', () => {
    expect(NEAR_PERCENT).toBe(90);
    for (const limit of [160, 182]) {
      for (let chars = 0; chars <= limit; chars += 1) {
        const near = chars * 100 >= limit * 90;
        expect(counterInfo('menu', chars, limit)?.level).toBe(near ? 'near' : 'ok');
      }
    }
  });

  it('stays exact for very large numbers', () => {
    const big = Number.MAX_SAFE_INTEGER;
    expect(counterInfo('menu', big, big)?.level).toBe('near');
    expect(counterInfo('menu', big, big - 1)?.level).toBe('over');
  });

  it('gives null when the numbers are missing or not safe integers', () => {
    expect(counterInfo('menu', null as unknown as number, 182)).toBeNull();
    expect(counterInfo('menu', 10, null as unknown as number)).toBeNull();
    expect(counterInfo('menu', 1.5, 182)).toBeNull();
    expect(counterInfo('menu', -1, 182)).toBeNull();
    expect(counterInfo('menu', Number.NaN, 182)).toBeNull();
  });

  it('does not call a zero limit near when nothing was sent', () => {
    expect(counterInfo('menu', 0, 0)?.level).toBe('ok');
    expect(counterInfo('menu', 1, 0)?.level).toBe('over');
  });

  it('uses only plain ASCII', () => {
    for (const info of [counterInfo('menu', 176, 182), counterInfo('text', 170, 160)]) {
      expect(info?.text).toMatch(/^[\x20-\x7E]+$/);
    }
  });
});
