import { describe, it, expect } from 'vitest';
import {
  badRequestScreen,
  closeScreen,
  nothingToUndoScreen,
  owesNoneScreen,
  saveFailedScreen,
  savedScreen,
  todayScreen,
  tooBigScreen,
  undoneScreen,
  type FigureFacts
} from '../../../src/channels/ussd/results.js';
import { toResponse, type Screen } from '../../../src/channels/ussd/screen.js';
import { HINT } from '../../../src/channels/ussd/text.js';
import { ussdProblems } from '../../../src/channels/limits.js';
import type { Currency, DayCloseSummary, TodaySummary } from '../../../src/core/index.js';

const check = (s: Screen): string => {
  const r = toResponse(s);
  expect(ussdProblems(r)).toEqual([]);
  expect(r).not.toContain(HINT);
  expect(r.startsWith('END ')).toBe(true);
  return r;
};

const sales = (cents: number): FigureFacts => ({ kind: 'salesToday', cents });
const spent = (cents: number): FigureFacts => ({ kind: 'expensesToday', cents });
const bal = (cents: number, wording: 'total' | 'now', customer = 'Tendai'): FigureFacts => ({
  kind: 'balance',
  customer,
  cents,
  wording
});

const CURRENCIES: Currency[] = ['ZAR', 'USD', 'KES', 'NGN', 'GHS', 'ZMW', 'BWP'];

describe('saved', () => {
  it('sale, with and without an item', () => {
    expect(check(savedScreen({ entry: { kind: 'sale', cents: 4500, item: 'bread' }, figure: sales(128500) }, 'ZAR'))).toBe(
      'END Saved: sale R45 bread. Sales today R1,285.'
    );
    expect(check(savedScreen({ entry: { kind: 'sale', cents: 4500 }, figure: sales(4500) }, 'ZAR'))).toBe(
      'END Saved: sale R45. Sales today R45.'
    );
  });

  it('expense', () => {
    expect(check(savedScreen({ entry: { kind: 'expense', cents: 2000, item: 'taxi' }, figure: spent(30000) }, 'ZAR'))).toBe(
      'END Saved: spent R20 taxi. Spent today R300.'
    );
    expect(check(savedScreen({ entry: { kind: 'expense', cents: 2000 }, figure: spent(2000) }, 'ZAR'))).toBe(
      'END Saved: spent R20. Spent today R20.'
    );
  });

  it('owes, with the customer total', () => {
    expect(
      check(
        savedScreen({ entry: { kind: 'debt', cents: 2000, customer: 'Tendai', item: 'sugar' }, figure: bal(5000, 'total') }, 'ZAR')
      )
    ).toBe('END Saved: Tendai owes R20 sugar. Tendai owes R50 in total.');
    expect(
      check(savedScreen({ entry: { kind: 'debt', cents: 2000, customer: 'Tendai' }, figure: bal(2000, 'total') }, 'ZAR'))
    ).toBe('END Saved: Tendai owes R20. Tendai owes R20 in total.');
  });

  it('payment leaving something owed, nothing owed, and credit', () => {
    const entry = { kind: 'payment', cents: 1000, customer: 'Tendai' } as const;
    expect(check(savedScreen({ entry, figure: bal(4000, 'now') }, 'ZAR'))).toBe(
      'END Saved: Tendai paid R10. Tendai owes R40 now.'
    );
    expect(check(savedScreen({ entry, figure: bal(0, 'now') }, 'ZAR'))).toBe(
      'END Saved: Tendai paid R10. Tendai owes nothing now.'
    );
    expect(check(savedScreen({ entry, figure: bal(-500, 'now') }, 'ZAR'))).toBe(
      'END Saved: Tendai paid R10. Tendai has R5 credit now.'
    );
  });

  it('a new debt on a customer who had credit', () => {
    const entry = { kind: 'debt', cents: 300, customer: 'Tendai' } as const;
    expect(check(savedScreen({ entry, figure: bal(-200, 'total') }, 'ZAR'))).toBe(
      'END Saved: Tendai owes R3. Tendai has R2 credit now.'
    );
    expect(check(savedScreen({ entry, figure: bal(0, 'total') }, 'ZAR'))).toBe(
      'END Saved: Tendai owes R3. Tendai owes nothing now.'
    );
  });

  it('uses the shop currency', () => {
    expect(check(savedScreen({ entry: { kind: 'sale', cents: 4550 }, figure: sales(4550) }, 'KES'))).toBe(
      'END Saved: sale KSh45.50. Sales today KSh45.50.'
    );
  });

  it('makes names and items plain ASCII and clips them', () => {
    const r = check(
      savedScreen(
        { entry: { kind: 'debt', cents: 100, customer: 'Ren\u00e9e', item: 'x'.repeat(30) }, figure: bal(100, 'total', 'Ren\u00e9e') },
        'ZAR'
      )
    );
    expect(r).toBe(`END Saved: Ren?e owes R1 ${'x'.repeat(20)}. Ren?e owes R1 in total.`);
  });
});

describe('undone', () => {
  it('sale and expense', () => {
    expect(check(undoneScreen({ entry: { kind: 'sale', cents: 4500, item: 'bread' }, figure: sales(124000) }, 'ZAR'))).toBe(
      'END Undone: sale R45 bread. Sales today R1,240.'
    );
    expect(check(undoneScreen({ entry: { kind: 'expense', cents: 2000, item: 'taxi' }, figure: spent(28000) }, 'ZAR'))).toBe(
      'END Undone: spent R20 taxi. Spent today R280.'
    );
  });

  it('owes and payment, with the customer standing now', () => {
    const debt = { kind: 'debt', cents: 2000, customer: 'Tendai', item: 'sugar' } as const;
    const paid = { kind: 'payment', cents: 1000, customer: 'Tendai' } as const;
    expect(check(undoneScreen({ entry: debt, figure: bal(3000, 'now') }, 'ZAR'))).toBe(
      'END Undone: Tendai owes R20 sugar. Tendai owes R30 now.'
    );
    expect(check(undoneScreen({ entry: debt, figure: bal(0, 'now') }, 'ZAR'))).toBe(
      'END Undone: Tendai owes R20 sugar. Tendai owes nothing now.'
    );
    expect(check(undoneScreen({ entry: debt, figure: bal(-500, 'now') }, 'ZAR'))).toBe(
      'END Undone: Tendai owes R20 sugar. Tendai has R5 credit now.'
    );
    expect(check(undoneScreen({ entry: paid, figure: bal(5000, 'now') }, 'ZAR'))).toBe(
      'END Undone: Tendai paid R10. Tendai owes R50 now.'
    );
  });
});

const summary = (over: Partial<DayCloseSummary> = {}): DayCloseSummary => ({
  date: '2025-11-03',
  shopId: 'shop_x',
  sales: { total: 124000, count: 12 },
  expenses: { total: 30000 },
  moneyInHand: 94000,
  newDebts: 7000,
  paymentsReceived: 4000,
  totalOwed: 38000,
  ...over
});

describe('today', () => {
  it('shows sales with the count, spent and in hand, one to a line', () => {
    expect(check(todayScreen(summary(), 'ZAR'))).toBe(
      'END Today\nSales R1,240 (12)\nSpent R300\nIn hand R940'
    );
  });

  it('shows a quiet day', () => {
    const quiet = summary({ sales: { total: 0, count: 0 }, expenses: { total: 0 }, moneyInHand: 0 });
    expect(check(todayScreen(quiet, 'KES'))).toBe('END Today\nSales KSh0 (0)\nSpent KSh0\nIn hand KSh0');
  });

  it('writes a negative in hand with the sign before the symbol, in every currency', () => {
    const s = summary({ sales: { total: 10000, count: 2 }, expenses: { total: 16000 }, moneyInHand: -6000 });
    expect(check(todayScreen(s, 'ZAR'))).toContain('In hand -R60');
    expect(check(todayScreen(s, 'ZAR'))).not.toContain('R-60');
    for (const currency of CURRENCIES) {
      const r = check(todayScreen(s, currency));
      expect(r).toMatch(/In hand -[A-Za-z$]+60$/);
      expect(r).not.toMatch(/[A-Za-z$]-60/);
    }
  });
});

describe('close', () => {
  it('shows the day, sales, spent, in hand, credit given, paid back and total owed', () => {
    expect(check(closeScreen(summary(), 'ZAR'))).toBe(
      [
        'END Close Mon 3 Nov',
        'Sales R1,240 (12)',
        'Spent R300',
        'In hand R940',
        'Credit given R70',
        'Paid back R40',
        'Total owed R380'
      ].join('\n')
    );
  });

  it('writes a negative in hand as -R60', () => {
    const r = check(closeScreen(summary({ moneyInHand: -6000 }), 'ZAR'));
    expect(r).toContain('In hand -R60');
    expect(r).not.toContain('R-60');
  });

  it('is 182 or fewer with the longest realistic data, in every currency', () => {
    for (const currency of CURRENCIES) {
      const big = 99999999;
      const r = check(
        closeScreen(
          summary({
            date: '2025-12-31',
            sales: { total: big, count: 12 },
            expenses: { total: big },
            moneyInHand: big,
            newDebts: big,
            paymentsReceived: big,
            totalOwed: big
          }),
          currency
        )
      );
      expect(r.length - 4).toBeLessThanOrEqual(182);
      expect(r).toContain('Close Wed 31 Dec');
    }
  });

  it('is 160 or fewer with R999,999.99 in every figure', () => {
    const big = 99999999;
    const r = check(
      closeScreen(
        summary({
          date: '2025-12-31',
          sales: { total: big, count: 12 },
          expenses: { total: big },
          moneyInHand: big,
          newDebts: big,
          paymentsReceived: big,
          totalOwed: big
        }),
        'ZAR'
      )
    );
    expect(r.length - 4).toBeLessThanOrEqual(160);
  });

  /** The close screen with every figure the same size (digits in cents), GHS being the widest symbol. */
  const sized = (digits: number, count: number) => {
    const n = Number('9'.repeat(digits));
    return closeScreen(
      summary({
        sales: { total: n, count },
        expenses: { total: n },
        moneyInHand: n,
        newDebts: n,
        paymentsReceived: n,
        totalOwed: n
      }),
      'GHS'
    );
  };
  const len = (lines: string[]): number => lines.join('\n').length;

  it('drops the date line first when the whole summary is too long', () => {
    let found = false;
    for (let digits = 8; digits <= 16 && !found; digits += 1) {
      const s = sized(digits, 12);
      if (len(s.lines) > 182 && len(s.shrink![0]!) <= 182) {
        found = true;
        const r = toResponse(s);
        expect(r).toBe(`END ${s.shrink![0]!.join('\n')}`);
        expect(r).not.toContain('Close ');
        expect(r).toContain('Sales GHS');
        expect(r).toContain('(12)');
        expect(ussdProblems(r)).toEqual([]);
      }
    }
    expect(found).toBe(true);
  });

  it('drops the counts in brackets after the date line when that is still too long', () => {
    let found = false;
    for (let digits = 8; digits <= 16 && !found; digits += 1) {
      const s = sized(digits, 123456);
      if (len(s.shrink![0]!) > 182 && len(s.shrink![1]!) <= 182) {
        found = true;
        const r = toResponse(s);
        expect(r).toBe(`END ${s.shrink![1]!.join('\n')}`);
        expect(r).not.toContain('(');
        expect(r).not.toContain('Close ');
        expect(ussdProblems(r)).toEqual([]);
      }
    }
    expect(found).toBe(true);
  });

  it('falls back to the too-big screen with 24-character figures', () => {
    const huge = 9007199254740991;
    const r = toResponse(
      closeScreen(
        summary({ sales: { total: huge, count: 1 }, expenses: { total: huge }, moneyInHand: huge, newDebts: huge, paymentsReceived: huge, totalOwed: huge }),
        'GHS'
      )
    );
    expect(r).toBe('END These numbers are too big to show here.');
  });
});

describe('the plain endings', () => {
  it('has the fixed texts', () => {
    expect(check(owesNoneScreen())).toBe('END Nobody owes you money.');
    expect(check(nothingToUndoScreen())).toBe('END Nothing to undo.');
    expect(check(saveFailedScreen())).toBe('END Sorry, that was not saved. Please try again.');
    expect(check(badRequestScreen())).toBe('END Sorry, something went wrong. Please dial again.');
    expect(check(tooBigScreen())).toBe('END These numbers are too big to show here.');
  });

  it('has the ids the screen check looks for', () => {
    expect(owesNoneScreen().id).toBe('owesNone');
    expect(nothingToUndoScreen().id).toBe('nothingToUndo');
    expect(saveFailedScreen().id).toBe('saveFailed');
    expect(badRequestScreen().id).toBe('badRequest');
    expect(tooBigScreen().id).toBe('tooBig');
  });
});

describe('the longest saved screen', () => {
  it('fits for every currency with 20-character names and items and 999,999.99', () => {
    for (const currency of CURRENCIES) {
      const entry = { kind: 'debt', cents: 99999999, customer: 'Longname Customer 01', item: 'Maize meal 12.5kg x2' } as const;
      const r = check(savedScreen({ entry, figure: bal(999999970, 'total', entry.customer) }, currency));
      expect(r.length - 4).toBeLessThanOrEqual(182);
    }
  });

  it('still fits for the largest safe amount', () => {
    const entry = { kind: 'debt', cents: 9007199254740991, customer: 'Longname Customer 01', item: 'Maize meal 12.5kg x2' } as const;
    const r = check(savedScreen({ entry, figure: bal(9007199254740991, 'total', entry.customer) }, 'GHS'));
    expect(r.length - 4).toBeLessThanOrEqual(182);
  });
});

// Keep the type used: TodaySummary is what todayScreen accepts.
const _typeCheck: TodaySummary = summary();
void _typeCheck;
