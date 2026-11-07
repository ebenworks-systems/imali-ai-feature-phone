import { describe, it, expect } from 'vitest';
import {
  buildReply,
  isPlainAscii,
  SMS_MAX_LENGTH,
  type ReplyContext
} from '@/channels/sms/replies.ts';
import type { Currency, DayCloseSummary } from '@/core/index.ts';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

type Base = Pick<ReplyContext, 'currency'>;
const ZAR: Base = { currency: 'ZAR' };

/** Every reply in every test goes through here: plain ASCII, at most 160 characters (criteria 42, 50). */
function reply(context: ReplyContext, maxLength?: number): string {
  const text = buildReply(context, maxLength);
  expect(isPlainAscii(text), `not plain ASCII: ${text}`).toBe(true);
  if (maxLength === undefined) {
    expect(text.length, `too long (${text.length}): ${text}`).toBeLessThanOrEqual(SMS_MAX_LENGTH);
  }
  return text;
}

function closeSummary(overrides: Partial<DayCloseSummary> = {}): DayCloseSummary {
  return {
    date: '2025-11-03',
    shopId: 'shop_test',
    sales: { total: 124000, count: 12 },
    expenses: { total: 30000 },
    moneyInHand: 94000,
    newDebts: 7000,
    paymentsReceived: 4000,
    totalOwed: 38000,
    ...overrides
  };
}

// The longest realistic data (the screens rule).
const LONG_NAME = 'Nomvula Dlamini-Khum'; // 20 characters
const LONG_ITEM = 'Full cream long life mil'; // 24 characters
const MAX_CENTS = 99_999_999; // R999,999.99

const CURRENCIES: Currency[] = ['ZAR', 'USD', 'KES', 'NGN', 'GHS', 'ZMW', 'BWP'];

it('uses the test data the screens rule asks for', () => {
  expect(LONG_NAME).toHaveLength(20);
  expect(LONG_ITEM).toHaveLength(24);
  expect(buildReply({ ...ZAR, expense: { amount: MAX_CENTS, todayTotal: MAX_CENTS } })).toContain(
    'R999,999.99'
  );
});

// ----------------------------------------------------------------------------
// Exact wording
// ----------------------------------------------------------------------------

describe('buildReply wording', () => {
  describe('sale (criterion 31)', () => {
    it('quantity and item', () => {
      expect(
        reply({
          ...ZAR,
          sale: { amount: 4500, item: 'bread', qty: 3, todayTotal: 128500, todayCount: 4 }
        })
      ).toBe('Saved: sale R45 (3 bread). Sales today R1,285. Reply undo to cancel.');
    });

    it('item without quantity', () => {
      expect(
        reply({ ...ZAR, sale: { amount: 4500, item: 'bread', todayTotal: 128500, todayCount: 4 } })
      ).toBe('Saved: sale R45 (bread). Sales today R1,285. Reply undo to cancel.');
    });

    it('amount only', () => {
      expect(reply({ ...ZAR, sale: { amount: 4500, todayTotal: 4500, todayCount: 1 } })).toBe(
        'Saved: sale R45. Sales today R45. Reply undo to cancel.'
      );
    });

    it('writes cents when there are cents', () => {
      expect(
        reply({ ...ZAR, sale: { amount: 4550, item: 'bread', todayTotal: 124050, todayCount: 3 } })
      ).toBe('Saved: sale R45.50 (bread). Sales today R1,240.50. Reply undo to cancel.');
    });

    it('does not show a quantity when there is no item', () => {
      expect(
        reply({ ...ZAR, sale: { amount: 4500, qty: 3, todayTotal: 4500, todayCount: 1 } })
      ).toBe('Saved: sale R45. Sales today R45. Reply undo to cancel.');
    });

    it('treats an empty item as no item', () => {
      expect(
        reply({ ...ZAR, sale: { amount: 4500, item: '   ', todayTotal: 4500, todayCount: 1 } })
      ).toBe('Saved: sale R45. Sales today R45. Reply undo to cancel.');
    });

    it('uses the shop currency', () => {
      expect(
        buildReply({
          currency: 'KES',
          sale: { amount: 4500, item: 'bread', todayTotal: 4500, todayCount: 1 }
        })
      ).toBe('Saved: sale KSh45 (bread). Sales today KSh45. Reply undo to cancel.');
    });
  });

  describe('expense (criterion 32)', () => {
    it('with item', () => {
      expect(
        reply({ ...ZAR, expense: { amount: 12000, item: 'transport', todayTotal: 30000 } })
      ).toBe('Saved: spent R120 (transport). Spent today R300.');
    });

    it('without item', () => {
      expect(reply({ ...ZAR, expense: { amount: 12000, todayTotal: 30000 } })).toBe(
        'Saved: spent R120. Spent today R300.'
      );
    });
  });

  describe('debt (criterion 33)', () => {
    it('with item', () => {
      expect(
        reply({
          ...ZAR,
          debt: { customer: 'Tendai', amount: 2000, item: 'sugar', customerTotal: 5000 }
        })
      ).toBe('Saved: Tendai owes R20 (sugar). Tendai owes R50 in total.');
    });

    it('without item', () => {
      expect(
        reply({ ...ZAR, debt: { customer: 'Tendai', amount: 2000, customerTotal: 2000 } })
      ).toBe('Saved: Tendai owes R20. Tendai owes R20 in total.');
    });

    it('when the customer still has credit after the new debt', () => {
      expect(
        reply({
          ...ZAR,
          debt: { customer: 'Tendai', amount: 2000, customerTotal: 500, isCredit: true }
        })
      ).toBe('Saved: Tendai owes R20. Tendai has R5 credit.');
    });

    it('when the new debt brings the customer exactly to zero', () => {
      expect(
        reply({
          ...ZAR,
          debt: { customer: 'Tendai', amount: 2000, customerTotal: 0, isCredit: true }
        })
      ).toBe('Saved: Tendai owes R20. Tendai owes nothing.');
    });
  });

  describe('payment (criterion 34)', () => {
    it('customer still owes', () => {
      expect(
        reply({ ...ZAR, payment: { customer: 'Tendai', amount: 1000, isCredit: false, balance: 4000 } })
      ).toBe('Saved: Tendai paid R10. Tendai owes R40 now.');
    });

    it('customer paid too much and now has credit', () => {
      expect(
        reply({ ...ZAR, payment: { customer: 'Tendai', amount: 1000, isCredit: true, balance: 500 } })
      ).toBe('Saved: Tendai paid R10. Tendai has R5 credit now.');
    });

    it('customer has paid everything', () => {
      expect(
        reply({ ...ZAR, payment: { customer: 'Tendai', amount: 1000, isCredit: false, balance: 0 } })
      ).toBe('Saved: Tendai paid R10. Tendai owes nothing now.');
    });
  });

  describe('undo (criteria 35 and 36)', () => {
    it('a sale', () => {
      expect(
        reply({ ...ZAR, undo: { kind: 'sale', amount: 4500, item: 'bread', todayTotal: 124000 } })
      ).toBe('Undone: sale R45 (bread). Sales today R1,240.');
    });

    it('a sale with no item', () => {
      expect(reply({ ...ZAR, undo: { kind: 'sale', amount: 4500, todayTotal: 0 } })).toBe(
        'Undone: sale R45. Sales today R0.'
      );
    });

    it('an expense', () => {
      expect(
        reply({ ...ZAR, undo: { kind: 'expense', amount: 12000, item: 'transport', todayTotal: 0 } })
      ).toBe('Undone: spent R120 (transport). Spent today R0.');
    });

    it('a debt', () => {
      expect(
        reply({
          ...ZAR,
          undo: { kind: 'debt', amount: 2000, item: 'sugar', customer: 'Tendai', customerBalance: 3000 }
        })
      ).toBe('Undone: Tendai owes R20 (sugar). Tendai owes R30 now.');
    });

    it('a payment', () => {
      expect(
        reply({
          ...ZAR,
          undo: { kind: 'payment', amount: 1000, customer: 'Tendai', customerBalance: 5000 }
        })
      ).toBe('Undone: Tendai paid R10. Tendai owes R50 now.');
    });

    it('a payment that left the customer with credit', () => {
      expect(
        reply({
          ...ZAR,
          undo: { kind: 'payment', amount: 1000, customer: 'Tendai', customerBalance: 500, isCredit: true }
        })
      ).toBe('Undone: Tendai paid R10. Tendai has R5 credit now.');
    });

    it('leaves out the figure when the caller has none', () => {
      expect(reply({ ...ZAR, undo: { kind: 'sale', amount: 4500, item: 'bread' } })).toBe(
        'Undone: sale R45 (bread).'
      );
    });

    it('needs the customer for a debt or payment', () => {
      expect(() => buildReply({ ...ZAR, undo: { kind: 'debt', amount: 2000 } })).toThrow(TypeError);
    });

    it('nothing to undo', () => {
      expect(reply({ ...ZAR, nothingToUndo: true })).toBe('Nothing to undo.');
    });
  });

  describe('today (criterion 37)', () => {
    it('shows sales with count, spent and in hand', () => {
      expect(
        reply({ ...ZAR, today: { sales: 124000, salesCount: 12, spent: 30000, inHand: 94000 } })
      ).toBe('Today: sales R1,240 (12), spent R300, in hand R940.');
    });

    it('on a quiet day', () => {
      expect(reply({ ...ZAR, today: { sales: 0, salesCount: 0, spent: 0, inHand: 0 } })).toBe(
        'Today: sales R0 (0), spent R0, in hand R0.'
      );
    });

    it('when more was spent than sold, in hand is below zero', () => {
      expect(
        reply({ ...ZAR, today: { sales: 10000, salesCount: 2, spent: 15000, inHand: -5000 } })
      ).toBe('Today: sales R100 (2), spent R150, in hand -R50.');
    });
  });

  describe('who owes (criterion 38)', () => {
    it('lists customers, largest first, whatever order they come in', () => {
      expect(
        reply({
          ...ZAR,
          whoOwes: {
            page: 1,
            debtors: [
              { name: 'Rudo', owed: 3000 },
              { name: 'Tendai', owed: 5000 },
              { name: 'Sipho', owed: 1000 }
            ]
          }
        })
      ).toBe('Owes: Tendai R50, Rudo R30, Sipho R10.');
    });

    it('breaks a tie by name so the order is always the same', () => {
      const debtors = [
        { name: 'Zodwa', owed: 1000 },
        { name: 'amos', owed: 1000 },
        { name: 'Bheki', owed: 1000 }
      ];
      expect(reply({ ...ZAR, whoOwes: { page: 1, debtors } })).toBe(
        'Owes: amos R10, Bheki R10, Zodwa R10.'
      );
    });

    it('says so when nobody owes', () => {
      expect(reply({ ...ZAR, whoOwes: { page: 1, debtors: [] } })).toBe('Nobody owes you money.');
    });

    it('does not list customers who owe nothing', () => {
      expect(
        reply({
          ...ZAR,
          whoOwes: { page: 1, debtors: [{ name: 'Tendai', owed: 0 }] }
        })
      ).toBe('Nobody owes you money.');
    });

    it('ends with "+N more. Reply owes 2" when not everyone fits, and never cuts a name', () => {
      const debtors = Array.from({ length: 12 }, (_, i) => ({
        name: `Customer number ${i + 1}`,
        owed: (100 - i) * 100
      }));
      const text = reply({ ...ZAR, whoOwes: { page: 1, debtors } });
      const match = /^Owes: (.+), \+(\d+) more\. Reply owes 2$/.exec(text);
      expect(match).not.toBeNull();
      const shown = match![1].split(', ');
      expect(shown[0]).toBe('Customer number 1 R100');
      expect(shown.length + Number(match![2])).toBe(12);
      for (const entry of shown) {
        expect(entry).toMatch(/^Customer number \d+ R\d+$/);
      }
    });

    it('page 2 carries on where page 1 stopped and points to page 3', () => {
      const debtors = Array.from({ length: 30 }, (_, i) => ({
        name: `Customer number ${i + 1}`,
        owed: (100 - i) * 100
      }));
      const page1 = reply({ ...ZAR, whoOwes: { page: 1, debtors } });
      const page2 = reply({ ...ZAR, whoOwes: { page: 2, debtors } });
      const shown1 = /^Owes: (.+), \+\d+ more\./.exec(page1)![1].split(', ').length;
      expect(page2.startsWith(`Owes: Customer number ${shown1 + 1} R`)).toBe(true);
      expect(page2).toMatch(/, \+\d+ more\. Reply owes 3$/);
    });

    it('a page past the end says there are no more names', () => {
      const debtors = [{ name: 'Tendai', owed: 5000 }];
      expect(reply({ ...ZAR, whoOwes: { page: 2, debtors } })).toBe(
        'No more names. Reply owes for the first page.'
      );
    });

    it('treats a bad page number as page 1', () => {
      const debtors = [{ name: 'Tendai', owed: 5000 }];
      for (const page of [0, -3, Number.NaN, 1.9]) {
        expect(reply({ ...ZAR, whoOwes: { page, debtors } })).toBe('Owes: Tendai R50.');
      }
    });
  });

  describe('balance (criterion 39)', () => {
    it('customer owes', () => {
      expect(reply({ ...ZAR, balance: { customer: 'Tendai', owed: 4000, isCredit: false } })).toBe(
        'Tendai owes R40.'
      );
    });

    it('customer has credit', () => {
      expect(reply({ ...ZAR, balance: { customer: 'Tendai', owed: 500, isCredit: true } })).toBe(
        'Tendai has R5 credit.'
      );
    });

    it('customer owes nothing', () => {
      expect(reply({ ...ZAR, balance: { customer: 'Tendai', owed: 0, isCredit: false } })).toBe(
        'Tendai owes nothing.'
      );
    });
  });

  describe('close (criterion 40)', () => {
    it('uses the local day name and date', () => {
      expect(reply({ ...ZAR, close: closeSummary() })).toBe(
        'Close Mon 3 Nov: sales R1,240 (12), spent R300, in hand R940, credit given R70, paid back R40, total owed R380.'
      );
    });

    it.each([
      ['2025-11-03', 'Mon 3 Nov'],
      ['2025-11-04', 'Tue 4 Nov'],
      ['2025-11-05', 'Wed 5 Nov'],
      ['2025-11-06', 'Thu 6 Nov'],
      ['2025-11-07', 'Fri 7 Nov'],
      ['2025-11-08', 'Sat 8 Nov'],
      ['2025-11-09', 'Sun 9 Nov'],
      ['2024-02-29', 'Thu 29 Feb'],
      ['2025-01-01', 'Wed 1 Jan'],
      ['2025-12-31', 'Wed 31 Dec']
    ])('writes %s as %s', (date, label) => {
      expect(reply({ ...ZAR, close: closeSummary({ date }) })).toContain(`Close ${label}: sales`);
    });

    it('rejects a date that is not a real day', () => {
      expect(() => buildReply({ ...ZAR, close: closeSummary({ date: '2025-02-30' }) })).toThrow(
        RangeError
      );
      expect(() => buildReply({ ...ZAR, close: closeSummary({ date: 'Monday' }) })).toThrow(
        RangeError
      );
    });
  });

  describe('help and unknown (criterion 41)', () => {
    const sorry =
      'Sorry, I did not get that. Try: sold 45 bread, spent 20 taxi, Tendai owes 30, today, who owes.';

    it('unknown', () => {
      expect(reply({ ...ZAR, unknown: true })).toBe(sorry);
    });

    it('help', () => {
      expect(reply({ ...ZAR, help: true })).toBe(sorry);
    });
  });
});

// ----------------------------------------------------------------------------
// Trimming (criterion 43)
// ----------------------------------------------------------------------------

describe('trimming when a reply is too long', () => {
  const sale: ReplyContext = {
    ...ZAR,
    sale: { amount: 4500, item: 'bread', qty: 3, todayTotal: 128500, todayCount: 4 }
  };
  const full = 'Saved: sale R45 (3 bread). Sales today R1,285. Reply undo to cancel.';
  const noHint = 'Saved: sale R45 (3 bread). Sales today R1,285.';
  const noItem = 'Saved: sale R45. Sales today R1,285.';

  it('keeps everything when it fits', () => {
    expect(buildReply(sale, full.length)).toBe(full);
  });

  it('drops the hint first', () => {
    expect(buildReply(sale, full.length - 1)).toBe(noHint);
    expect(buildReply(sale, noHint.length)).toBe(noHint);
  });

  it('drops the item, with its quantity, second', () => {
    expect(buildReply(sale, noHint.length - 1)).toBe(noItem);
    expect(buildReply(sale, noItem.length)).toBe(noItem);
  });

  it('at every limit the reply is one of the whole forms, never a cut word or number', () => {
    const forms = new Set([full, noHint, noItem, 'Saved: sale R45.']);
    for (let limit = 1; limit <= 200; limit++) {
      const text = buildReply(sale, limit);
      expect(forms.has(text), `limit ${limit}: ${text}`).toBe(true);
      if (limit >= noItem.length) {
        expect(text.length).toBeLessThanOrEqual(limit);
      }
    }
  });

  it('a very long item is dropped from a real 160 character reply', () => {
    const item = 'word '.repeat(30).trim(); // 149 characters
    const text = reply({
      ...ZAR,
      sale: { amount: 4500, item, todayTotal: 128500, todayCount: 4 }
    });
    expect(text).toBe('Saved: sale R45. Sales today R1,285.');
  });

  it('the hint goes before the item at the real limit', () => {
    // An item that makes the reply exactly 160 characters without the hint, so only the hint is over.
    const fixed = 'Saved: sale R45 (). Sales today R1,285.'.length;
    const item = 'a'.repeat(SMS_MAX_LENGTH - fixed);
    const text = reply({ ...ZAR, sale: { amount: 4500, item, todayTotal: 128500, todayCount: 4 } });
    expect(text).toBe(`Saved: sale R45 (${item}). Sales today R1,285.`);
    expect(text).toHaveLength(SMS_MAX_LENGTH);
  });

  it('drops the item from an expense before anything else', () => {
    const context: ReplyContext = {
      ...ZAR,
      expense: { amount: 12000, item: 'transport', todayTotal: 30000 }
    };
    expect(buildReply(context, 'Saved: spent R120 (transport). Spent today R300.'.length - 1)).toBe(
      'Saved: spent R120. Spent today R300.'
    );
  });

  it('drops the item from a debt before anything else', () => {
    const context: ReplyContext = {
      ...ZAR,
      debt: { customer: 'Tendai', amount: 2000, item: 'sugar', customerTotal: 5000 }
    };
    expect(
      buildReply(context, 'Saved: Tendai owes R20 (sugar). Tendai owes R50 in total.'.length - 1)
    ).toBe('Saved: Tendai owes R20. Tendai owes R50 in total.');
  });

  it('drops the item from an undo before anything else', () => {
    const context: ReplyContext = {
      ...ZAR,
      undo: { kind: 'sale', amount: 4500, item: 'bread', todayTotal: 124000 }
    };
    expect(
      buildReply(context, 'Undone: sale R45 (bread). Sales today R1,240.'.length - 1)
    ).toBe('Undone: sale R45. Sales today R1,240.');
  });

  it('keeps the first sentence whole when nothing else can be done', () => {
    const context: ReplyContext = {
      ...ZAR,
      payment: { customer: 'Tendai', amount: 1000, isCredit: false, balance: 4000 }
    };
    expect(buildReply(context, 10)).toBe('Saved: Tendai paid R10.');
  });
});

// ----------------------------------------------------------------------------
// Longest realistic data
// ----------------------------------------------------------------------------

/** One reply of every kind with a 20-character name, a 24-character item and R999,999.99 in every figure. */
function worstCaseContexts(currency: Currency): Array<[string, ReplyContext]> {
  return [
    [
      'sale',
      {
        currency,
        sale: { amount: MAX_CENTS, item: LONG_ITEM, qty: 999, todayTotal: MAX_CENTS, todayCount: 99999 }
      }
    ],
    ['expense', { currency, expense: { amount: MAX_CENTS, item: LONG_ITEM, todayTotal: MAX_CENTS } }],
    [
      'debt',
      { currency, debt: { customer: LONG_NAME, amount: MAX_CENTS, item: LONG_ITEM, customerTotal: MAX_CENTS } }
    ],
    [
      'payment',
      { currency, payment: { customer: LONG_NAME, amount: MAX_CENTS, isCredit: true, balance: MAX_CENTS } }
    ],
    [
      'payment owes',
      { currency, payment: { customer: LONG_NAME, amount: MAX_CENTS, isCredit: false, balance: MAX_CENTS } }
    ],
    [
      'undo sale',
      { currency, undo: { kind: 'sale', amount: MAX_CENTS, item: LONG_ITEM, todayTotal: MAX_CENTS, todayCount: 99999 } }
    ],
    [
      'undo expense',
      { currency, undo: { kind: 'expense', amount: MAX_CENTS, item: LONG_ITEM, todayTotal: MAX_CENTS } }
    ],
    [
      'undo debt',
      {
        currency,
        undo: { kind: 'debt', amount: MAX_CENTS, item: LONG_ITEM, customer: LONG_NAME, customerBalance: MAX_CENTS }
      }
    ],
    [
      'undo payment',
      {
        currency,
        undo: {
          kind: 'payment',
          amount: MAX_CENTS,
          customer: LONG_NAME,
          customerBalance: MAX_CENTS,
          isCredit: true
        }
      }
    ],
    ['nothing to undo', { currency, nothingToUndo: true }],
    ['today', { currency, today: { sales: MAX_CENTS, salesCount: 99999, spent: MAX_CENTS, inHand: MAX_CENTS } }],
    ['balance', { currency, balance: { customer: LONG_NAME, owed: MAX_CENTS, isCredit: true } }],
    [
      'close',
      {
        currency,
        close: closeSummary({
          date: '2025-11-26', // Wed 26 Nov: the longest day label
          sales: { total: MAX_CENTS, count: 99999 },
          expenses: { total: MAX_CENTS },
          moneyInHand: MAX_CENTS,
          newDebts: MAX_CENTS,
          paymentsReceived: MAX_CENTS,
          totalOwed: MAX_CENTS
        })
      }
    ],
    ['help', { currency, help: true }],
    ['unknown', { currency, unknown: true }]
  ];
}

describe('longest realistic data', () => {
  it.each(CURRENCIES)('every reply kind fits in 160 plain ASCII characters in %s', (currency) => {
    for (const [name, context] of worstCaseContexts(currency)) {
      const text = buildReply(context);
      expect(text.length, `${name}: ${text}`).toBeLessThanOrEqual(160);
      expect(isPlainAscii(text), `${name}: ${text}`).toBe(true);
    }
  });

  it('shows the worst-case ZAR replies in full where they fit', () => {
    const byName = new Map(worstCaseContexts('ZAR'));
    expect(buildReply(byName.get('sale')!)).toBe(
      `Saved: sale R999,999.99 (999 ${LONG_ITEM}). Sales today R999,999.99. Reply undo to cancel.`
    );
    expect(buildReply(byName.get('debt')!)).toBe(
      `Saved: ${LONG_NAME} owes R999,999.99 (${LONG_ITEM}). ${LONG_NAME} owes R999,999.99 in total.`
    );
    expect(buildReply(byName.get('payment')!)).toBe(
      `Saved: ${LONG_NAME} paid R999,999.99. ${LONG_NAME} has R999,999.99 credit now.`
    );
    expect(buildReply(byName.get('close')!)).toBe(
      'Close Wed 26 Nov: sales R999,999.99 (99999), spent R999,999.99, in hand R999,999.99, ' +
        'credit given R999,999.99, paid back R999,999.99, total owed R999,999.99.'
    );
  });

  it('the close reply for a currency with a long sign drops the count, then the day movements, but stays whole', () => {
    const byName = new Map(worstCaseContexts('KES'));
    const text = buildReply(byName.get('close')!);
    expect(text.length).toBeLessThanOrEqual(160);
    expect(text).toMatch(/^Close Wed 26 Nov: sales KSh999,999\.99,/);
    expect(text).toMatch(/total owed KSh999,999\.99\.$/);
  });

  it('a 24-character item is kept whenever the reply still fits', () => {
    for (const currency of CURRENCIES) {
      const text = buildReply({
        currency,
        sale: { amount: MAX_CENTS, item: LONG_ITEM, qty: 999, todayTotal: MAX_CENTS, todayCount: 99999 }
      });
      expect(text).toContain(LONG_ITEM);
    }
  });

  describe('who owes with long names and R999,999.99', () => {
    const debtors = Array.from({ length: 11 }, (_, i) => ({
      name: `${LONG_NAME.slice(0, 18)}${String(i).padStart(2, '0')}`, // 20 characters, all different
      owed: MAX_CENTS - i
    }));

    it.each(CURRENCIES)('every page fits in 160 plain ASCII characters in %s', (currency) => {
      let page = 1;
      const seen: string[] = [];
      for (;;) {
        const text = reply({ currency, whoOwes: { page, debtors } });
        expect(text.length).toBeLessThanOrEqual(160);
        const body = /^Owes: (.+?)(?:\.|, \+(\d+) more\. Reply owes (\d+))$/.exec(text);
        expect(body, text).not.toBeNull();
        const entries = body![1].split(', ');
        for (const entry of entries) {
          // A whole name, then a whole amount. Nothing is cut.
          expect(entry).toMatch(new RegExp(`^${LONG_NAME.slice(0, 18)}\\d\\d \\S+\\d\\.\\d\\d$`));
          seen.push(entry.split(' ')[0] + ' ' + entry.split(' ')[1]);
        }
        if (body![2] === undefined) {
          break;
        }
        expect(Number(body![3])).toBe(page + 1);
        expect(Number(body![2])).toBe(debtors.length - seen.length);
        page++;
        expect(page).toBeLessThan(20);
      }
      // Every customer shown once, largest first.
      expect(seen).toHaveLength(debtors.length);
      expect(seen.map((s) => s.slice(0, 20))).toEqual(debtors.map((d) => d.name));
      // One page past the end.
      expect(reply({ currency, whoOwes: { page: page + 1, debtors } })).toBe(
        'No more names. Reply owes for the first page.'
      );
    });

    it('page 1 for ZAR shows 3 names and "+8 more. Reply owes 2"', () => {
      const text = buildReply({ ...ZAR, whoOwes: { page: 1, debtors } });
      expect(text).toBe(
        'Owes: Nomvula Dlamini-Kh00 R999,999.99, Nomvula Dlamini-Kh01 R999,999.98, ' +
          'Nomvula Dlamini-Kh02 R999,999.97, +8 more. Reply owes 2'
      );
      expect(text.length).toBeLessThanOrEqual(160);
    });
  });
});

// ----------------------------------------------------------------------------
// Plain ASCII (criterion 42)
// ----------------------------------------------------------------------------

describe('plain ASCII', () => {
  it('isPlainAscii accepts printable ASCII and nothing else', () => {
    expect(isPlainAscii('Saved: sale R45 (3 bread).')).toBe(true);
    expect(isPlainAscii('')).toBe(true);
    expect(isPlainAscii('caf\u00e9')).toBe(false);
    expect(isPlainAscii('it\u2019s')).toBe(false);
    expect(isPlainAscii('a\u2014b')).toBe(false);
    expect(isPlainAscii('line\nbreak')).toBe(false);
    expect(isPlainAscii('\u{1F35E}')).toBe(false);
  });

  it('turns curly quotes and long dashes in an item into plain ones', () => {
    expect(
      reply({
        ...ZAR,
        sale: { amount: 4500, item: '\u201cbrown\u201d bread \u2014 it\u2019s fresh', todayTotal: 4500, todayCount: 1 }
      })
    ).toBe('Saved: sale R45 ("brown" bread - it\'s fresh). Sales today R45. Reply undo to cancel.');
  });

  it('drops accents from a customer name', () => {
    expect(
      reply({ ...ZAR, balance: { customer: 'Th\u00e1ndi Mu\u00f1oz', owed: 4000, isCredit: false } })
    ).toBe('Thandi Munoz owes R40.');
  });

  it('turns an emoji into a question mark and keeps the rest', () => {
    expect(
      reply({
        ...ZAR,
        expense: { amount: 2000, item: 'bread \u{1F35E}\u{1F35E}', todayTotal: 2000 }
      })
    ).toBe('Saved: spent R20 (bread ?). Spent today R20.');
  });

  it('collapses new lines and extra spaces in names', () => {
    expect(
      reply({ ...ZAR, balance: { customer: '  Tendai \n\t  Moyo ', owed: 4000, isCredit: false } })
    ).toBe('Tendai Moyo owes R40.');
  });

  it('uses a plain word when a name has nothing left', () => {
    expect(reply({ ...ZAR, balance: { customer: '   ', owed: 4000, isCredit: false } })).toBe(
      'Customer owes R40.'
    );
  });

  it('measures the length after the text was made plain', () => {
    // The ellipsis becomes three characters, so it has to be counted as three.
    const item = 'a'.repeat(120) + '\u2026';
    const text = reply({ ...ZAR, sale: { amount: 4500, item, todayTotal: 4500, todayCount: 1 } });
    expect(text.length).toBeLessThanOrEqual(160);
    expect(isPlainAscii(text)).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// Words on screen
// ----------------------------------------------------------------------------

describe('no jargon', () => {
  const ALLOWED = /has R[\d,.]+ credit|credit given/g; // "has R5 credit" (spec), "credit given" (criterion 40)

  it('never says transaction, balance, debit or credit as an accounting word', () => {
    const texts: string[] = [];
    for (const currency of CURRENCIES) {
      for (const [, context] of worstCaseContexts(currency)) {
        texts.push(buildReply(context));
      }
    }
    texts.push(
      buildReply({ ...ZAR, whoOwes: { page: 1, debtors: [{ name: 'Tendai', owed: 5000 }] } }),
      buildReply({ ...ZAR, balance: { customer: 'Tendai', owed: 500, isCredit: true } }),
      buildReply({ ...ZAR, payment: { customer: 'Tendai', amount: 1, isCredit: true, balance: 500 } })
    );
    for (const text of texts) {
      const cleaned = text.replace(/has \S+ credit/g, '').replace(ALLOWED, '');
      expect(cleaned, text).not.toMatch(/transaction|balance|debit|credit/i);
    }
  });
});

// ----------------------------------------------------------------------------
// Bad input
// ----------------------------------------------------------------------------

describe('bad input', () => {
  it('needs exactly one thing to reply about', () => {
    expect(() => buildReply({ ...ZAR })).toThrow(TypeError);
    expect(() => buildReply({ ...ZAR, help: true, unknown: true })).toThrow(TypeError);
    expect(() => buildReply({ ...ZAR, nothingToUndo: false })).toThrow(TypeError);
  });

  it('refuses money that is not whole cents', () => {
    const sale = (amount: number): ReplyContext => ({
      ...ZAR,
      sale: { amount, todayTotal: 0, todayCount: 0 }
    });
    expect(() => buildReply(sale(45.5))).toThrow(RangeError);
    expect(() => buildReply(sale(Number.NaN))).toThrow(RangeError);
    expect(() => buildReply(sale(Number.POSITIVE_INFINITY))).toThrow(RangeError);
    expect(() => buildReply(sale(2 ** 60))).toThrow(RangeError);
  });

  it('refuses a negative amount or customer figure', () => {
    expect(() =>
      buildReply({ ...ZAR, sale: { amount: -100, todayTotal: 0, todayCount: 0 } })
    ).toThrow(RangeError);
    expect(() =>
      buildReply({ ...ZAR, balance: { customer: 'Tendai', owed: -100, isCredit: false } })
    ).toThrow(RangeError);
    expect(() =>
      buildReply({ ...ZAR, whoOwes: { page: 1, debtors: [{ name: 'Tendai', owed: -1 }] } })
    ).toThrow(RangeError);
  });

  it('refuses a count that is not a whole number', () => {
    expect(() =>
      buildReply({ ...ZAR, today: { sales: 0, salesCount: 1.5, spent: 0, inHand: 0 } })
    ).toThrow(RangeError);
  });
});
