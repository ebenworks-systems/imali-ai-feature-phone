import { describe, it, expect } from 'vitest';
import {
  MAX_CUSTOMER_NAME,
  MAX_ITEM,
  MAX_SHOP_NAME,
  readAmount,
  readCustomerName,
  readItem,
  readShopName
} from '../../../src/channels/ussd/input.js';
import { NOTICE } from '../../../src/channels/ussd/text.js';

function cents(raw: string, currency: 'ZAR' | 'KES' = 'ZAR'): number | string {
  const r = readAmount(raw, currency);
  return r.ok ? r.cents : r.notice;
}

describe('readAmount', () => {
  for (const [currency, prefix] of [
    ['ZAR', 'R'],
    ['KES', 'KSh']
  ] as const) {
    describe(currency, () => {
      it('reads whole and decimal amounts', () => {
        expect(cents('45', currency)).toBe(4500);
        expect(cents(`${prefix}45`, currency)).toBe(4500);
        expect(cents('45.50', currency)).toBe(4550);
        expect(cents('45,50', currency)).toBe(4550);
        expect(cents('45.5', currency)).toBe(4550);
      });

      it('reads a thousands separator', () => {
        expect(cents('1,200', currency)).toBe(120000);
        expect(cents('1 200', currency)).toBe(120000);
        expect(cents(`${prefix}1 200.50`, currency)).toBe(120050);
      });

      it('takes the larger reading of an ambiguous amount, the thousands one', () => {
        expect(cents('2 200', currency)).toBe(220000);
        expect(cents('2,200', currency)).toBe(220000);
        expect(cents('12 200', currency)).toBe(1220000);
      });

      it('ignores spaces around the amount', () => {
        expect(cents('  45  ', currency)).toBe(4500);
        expect(cents(' 2 200 ', currency)).toBe(220000);
      });

      it('refuses zero and negative amounts as not more than zero', () => {
        expect(cents('0', currency)).toBe(NOTICE.amountZero);
        expect(cents('0.00', currency)).toBe(NOTICE.amountZero);
        expect(cents('-5', currency)).toBe(NOTICE.amountZero);
        expect(cents(`-${prefix}5`, currency)).toBe(NOTICE.amountZero);
      });

      it('refuses words and an empty input as not numbers', () => {
        expect(cents('abc', currency)).toBe(NOTICE.amountWords);
        expect(cents('45 bread', currency)).toBe(NOTICE.amountWords);
        expect(cents('', currency)).toBe(NOTICE.amountWords);
        expect(cents('   ', currency)).toBe(NOTICE.amountWords);
        expect(cents('.', currency)).toBe(NOTICE.amountWords);
      });

      it('refuses an amount too big to store', () => {
        expect(cents('99999999999999', currency)).toBe(NOTICE.amountBig);
        expect(cents('1'.repeat(30), currency)).toBe(NOTICE.amountBig);
        expect(cents('99 999 999 999 999', currency)).toBe(NOTICE.amountBig);
      });
    });
  }

  it('refuses the other currency symbol', () => {
    expect(cents('KSh45', 'ZAR')).toBe(NOTICE.amountWords);
    expect(cents('R45', 'KES')).toBe(NOTICE.amountWords);
  });

  it('marks an amount above 1,000,000.00 as big, and nothing at or below it', () => {
    expect(readAmount('1000000', 'ZAR')).toEqual({ ok: true, cents: 100_000_000, big: false });
    expect(readAmount('1000001', 'ZAR')).toEqual({ ok: true, cents: 100_000_100, big: true });
    expect(readAmount('1500000', 'ZAR')).toEqual({ ok: true, cents: 150_000_000, big: true });
    expect(readAmount('45', 'ZAR')).toEqual({ ok: true, cents: 4500, big: false });
  });

  it('accepts the largest amount that is a safe whole number of cents', () => {
    const r = readAmount('90071992547409.91', 'ZAR');
    expect(r).toEqual({ ok: true, cents: 9007199254740991, big: true });
    expect(readAmount('90071992547409.92', 'ZAR')).toEqual({ ok: false, notice: NOTICE.amountBig });
  });

  it('refuses an ambiguous amount that is too large for the ledger', () => {
    expect(readAmount(`${'9'.repeat(20)} 200`, 'ZAR')).toEqual({ ok: false, notice: NOTICE.amountBig });
  });
});

describe('readShopName', () => {
  it('trims and collapses inner spaces', () => {
    expect(readShopName("  Nomsa's   Corner  ")).toEqual({ ok: true, value: "Nomsa's Corner" });
  });

  it('accepts 24 characters and refuses 25', () => {
    expect(MAX_SHOP_NAME).toBe(24);
    expect(readShopName('a'.repeat(24))).toEqual({ ok: true, value: 'a'.repeat(24) });
    expect(readShopName('a'.repeat(25))).toEqual({ ok: false, notice: NOTICE.shopNameLong });
  });

  it('refuses an empty name and a name of spaces', () => {
    expect(readShopName('')).toEqual({ ok: false, notice: NOTICE.shopNameEmpty });
    expect(readShopName('    ')).toEqual({ ok: false, notice: NOTICE.shopNameEmpty });
  });

  it('refuses a character outside printable ASCII', () => {
    expect(readShopName('Caf\u00e9')).toEqual({ ok: false, notice: NOTICE.asciiOnly });
  });
});

describe('readCustomerName', () => {
  it('trims and collapses inner spaces', () => {
    expect(readCustomerName('  Mama   Thandi ')).toEqual({ ok: true, value: 'Mama Thandi' });
  });

  it('accepts 20 characters and refuses 21', () => {
    expect(MAX_CUSTOMER_NAME).toBe(20);
    expect(readCustomerName('a'.repeat(20)).ok).toBe(true);
    expect(readCustomerName('a'.repeat(21))).toEqual({ ok: false, notice: NOTICE.customerLong });
  });

  it('needs at least one letter', () => {
    expect(readCustomerName('45')).toEqual({ ok: false, notice: NOTICE.customerBad });
    expect(readCustomerName('1 2 3')).toEqual({ ok: false, notice: NOTICE.customerBad });
    expect(readCustomerName('')).toEqual({ ok: false, notice: NOTICE.customerBad });
    expect(readCustomerName('Room 5').ok).toBe(true);
  });

  it('refuses \u00e9 and other characters outside printable ASCII', () => {
    expect(readCustomerName('Ren\u00e9')).toEqual({ ok: false, notice: NOTICE.asciiOnly });
    expect(readCustomerName('Tendai \u{1F600}')).toEqual({ ok: false, notice: NOTICE.asciiOnly });
  });
});

describe('readItem', () => {
  it('trims and collapses inner spaces', () => {
    expect(readItem('  maize   meal ')).toEqual({ ok: true, value: 'maize meal' });
  });

  it('accepts 20 characters and refuses 21', () => {
    expect(MAX_ITEM).toBe(20);
    expect(readItem('a'.repeat(20)).ok).toBe(true);
    expect(readItem('a'.repeat(21))).toEqual({ ok: false, notice: NOTICE.itemLong });
  });

  it('accepts an item with no letter, like a size', () => {
    expect(readItem('2kg')).toEqual({ ok: true, value: '2kg' });
    expect(readItem('500')).toEqual({ ok: true, value: '500' });
  });

  it('refuses an empty item and non-ASCII text', () => {
    expect(readItem('')).toEqual({ ok: false, notice: NOTICE.itemEmpty });
    expect(readItem('   ')).toEqual({ ok: false, notice: NOTICE.itemEmpty });
    expect(readItem('caf\u00e9')).toEqual({ ok: false, notice: NOTICE.asciiOnly });
  });
});
