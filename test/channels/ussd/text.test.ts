import { describe, it, expect } from 'vitest';
import {
  HINT,
  NOTICE,
  clip,
  dayLabel,
  money,
  plain
} from '../../../src/channels/ussd/text.js';
import { isPlainAscii } from '../../../src/channels/limits.js';

describe('plain', () => {
  it('leaves printable ASCII alone', () => {
    expect(plain("Nomsa's Corner ~{}")).toBe("Nomsa's Corner ~{}");
  });

  it('turns a character outside printable ASCII into ?', () => {
    expect(plain('caf\u00e9')).toBe('caf?');
    expect(plain('it\u2019s')).toBe('it?s');
    expect(plain('a \u2014 b')).toBe('a ? b');
  });

  it('turns an emoji into one ?, not two', () => {
    expect(plain('hi \u{1F600}')).toBe('hi ?');
  });

  it('turns a newline, a tab and DEL into ?', () => {
    expect(plain('a\nb\tc\x7fd')).toBe('a?b?c?d');
  });

  it('always gives plain ASCII', () => {
    expect(isPlainAscii(plain('\u00e9\u4e2d\u{1F600}x'))).toBe(true);
  });
});

describe('clip', () => {
  it('cuts at the maximum', () => {
    expect(clip('abcdefghij', 4)).toBe('abcd');
    expect(clip('abc', 4)).toBe('abc');
    expect(clip('abcd', 4)).toBe('abcd');
  });

  it('makes the text plain before it cuts', () => {
    expect(clip('caf\u00e9 au lait', 5)).toBe('caf? ');
  });

  it('clips a shop name to 24 and a customer name to 20', () => {
    expect(clip('x'.repeat(40), 24)).toHaveLength(24);
    expect(clip('x'.repeat(40), 20)).toHaveLength(20);
  });
});

describe('money', () => {
  it('writes money as the core does', () => {
    expect(money(4500, 'ZAR')).toBe('R45');
    expect(money(4550, 'ZAR')).toBe('R45.50');
    expect(money(124000, 'ZAR')).toBe('R1,240');
    expect(money(4550, 'KES')).toBe('KSh45.50');
  });

  it('writes a negative with the sign first', () => {
    expect(money(-6000, 'ZAR')).toBe('-R60');
    expect(money(-6000, 'GHS')).toBe('-GHS60');
  });
});

describe('dayLabel', () => {
  it('reads a date as weekday, day and month', () => {
    expect(dayLabel('2025-11-03')).toBe('Mon 3 Nov');
    expect(dayLabel('2025-12-31')).toBe('Wed 31 Dec');
    expect(dayLabel('2024-02-29')).toBe('Thu 29 Feb');
    expect(dayLabel('2025-01-05')).toBe('Sun 5 Jan');
  });

  it('gives something plain for text that is not a date', () => {
    expect(dayLabel('not a date')).toBe('not a date');
    expect(isPlainAscii(dayLabel('caf\u00e9'))).toBe(true);
  });
});

describe('HINT and NOTICE', () => {
  it('has the hint from the spec', () => {
    expect(HINT).toBe('0 Back 00 Menu');
    expect(HINT).toHaveLength(14);
  });

  it('has every notice from the design, in plain ASCII', () => {
    expect(NOTICE).toEqual({
      choose: 'Choose a number from the list.',
      amountWords: 'Type the amount in numbers, like 45.',
      amountZero: 'The amount must be more than zero.',
      amountBig: 'That amount is too big.',
      shopNameEmpty: 'Type your shop name.',
      shopNameLong: 'That name is too long. Use 24 letters or less.',
      customerBad: "Type the customer's name, like Tendai.",
      customerLong: 'That name is too long. Use 20 letters or less.',
      itemEmpty: 'Type a short word, or 1 to skip.',
      itemLong: 'That is too long. Use 20 letters or less.',
      asciiOnly: 'Use letters and numbers only.',
      notSaved: 'Not saved.',
      notUndone: 'Not undone.'
    });
    for (const text of Object.values(NOTICE)) expect(isPlainAscii(text)).toBe(true);
  });
});
