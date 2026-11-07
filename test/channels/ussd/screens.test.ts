import { describe, it, expect } from 'vitest';
import {
  amountPrompt,
  confirmBigScreen,
  confirmScreen,
  customerPrompt,
  itemPrompt,
  mainMenu,
  owesScreen,
  payWhoList,
  signupCurrency,
  signupName,
  undoConfirmScreen,
  type OwesRow
} from '../../../src/channels/ussd/screens.js';
import { toResponse, type Screen } from '../../../src/channels/ussd/screen.js';
import { HINT, NOTICE } from '../../../src/channels/ussd/text.js';
import { ussdProblems } from '../../../src/channels/limits.js';
import type { Currency } from '../../../src/core/index.js';

const HINT_LINE = `\n${HINT}`;
const body = (s: Screen): string => toResponse(s).slice(4);
const check = (s: Screen): string => {
  const r = toResponse(s);
  expect(ussdProblems(r)).toEqual([]);
  return r;
};

const SHOP24 = "Nomsa's Corner Tuck Shop";
const NAME20 = 'Longname Customer 01';
const ITEM20 = 'Maize meal 12.5kg x2';
const CURRENCIES: Currency[] = ['ZAR', 'USD', 'KES', 'NGN', 'GHS', 'ZMW', 'BWP'];

describe('sign-up screens', () => {
  it('asks for the shop name', () => {
    expect(check(signupName())).toBe('CON Welcome to the Imali AI ledger. Your shop name?');
  });

  it('shows the notice first', () => {
    expect(check(signupName(NOTICE.shopNameEmpty))).toBe(
      'CON Type your shop name.\nWelcome to the Imali AI ledger. Your shop name?'
    );
  });

  it('lists the seven money choices', () => {
    expect(check(signupCurrency())).toBe(
      [
        'CON Which money do you use?',
        '1 R South Africa',
        '2 $ US dollar',
        '3 KSh Kenya',
        '4 N Nigeria',
        '5 GHS Ghana',
        '6 K Zambia',
        '7 P Botswana'
      ].join('\n')
    );
  });

  it('has the choose notice and stays within 182', () => {
    const r = check(signupCurrency(NOTICE.choose));
    expect(r.startsWith('CON Choose a number from the list.\nWhich money')).toBe(true);
    expect(body(signupCurrency(NOTICE.choose))).toHaveLength(145);
  });

  it('never carries the hint', () => {
    expect(toResponse(signupName())).not.toContain(HINT);
    expect(toResponse(signupCurrency())).not.toContain(HINT);
  });
});

describe('main menu', () => {
  it('matches .kiro/steering/screens.md line by line', () => {
    expect(check(mainMenu({ shopName: 'Demo Spaza', salesToday: 124000, currency: 'ZAR' }))).toBe(
      [
        'CON Demo Spaza',
        'Today: sales R1,240',
        '1 Sale',
        '2 Expense',
        '3 Owes (credit)',
        '4 Paid back',
        '5 Today',
        '6 Who owes',
        '7 Undo last',
        '8 Close day'
      ].join('\n')
    );
  });

  it('shows a notice as the first line', () => {
    const r = check(mainMenu({ shopName: 'Demo Spaza', salesToday: 0, currency: 'KES', notice: NOTICE.notSaved }));
    expect(r.split('\n').slice(0, 3)).toEqual(['CON Not saved.', 'Demo Spaza', 'Today: sales KSh0']);
  });

  it('never carries the hint', () => {
    expect(toResponse(mainMenu({ shopName: 'x', salesToday: 0, currency: 'ZAR' }))).not.toContain(HINT);
    expect(toResponse(mainMenu({ shopName: 'x', salesToday: 0, currency: 'ZAR', notice: NOTICE.choose }))).not.toContain(
      HINT
    );
  });

  it('clips a long shop name to 24 characters and makes it plain', () => {
    const r = toResponse(mainMenu({ shopName: `${SHOP24}XYZ`, salesToday: 0, currency: 'ZAR' }));
    expect(r.split('\n')[0]).toBe(`CON ${SHOP24}`);
    const accented = toResponse(mainMenu({ shopName: 'Caf\u00e9 Zola', salesToday: 0, currency: 'ZAR' }));
    expect(accented.split('\n')[0]).toBe('CON Caf? Zola');
  });

  it('fits with the longest data in every currency, even with the longest notice', () => {
    for (const currency of CURRENCIES) {
      const r = check(
        mainMenu({ shopName: SHOP24, salesToday: 299999997, currency, notice: NOTICE.choose })
      );
      expect(r.startsWith('CON Choose a number from the list.\n')).toBe(true);
    }
  });
});

describe('prompts for typed answers', () => {
  it('asks for each amount', () => {
    expect(check(amountPrompt({ kind: 'sale' }))).toBe(`CON Sale amount?${HINT_LINE}`);
    expect(check(amountPrompt({ kind: 'expense' }))).toBe(`CON Amount spent?${HINT_LINE}`);
    expect(check(amountPrompt({ kind: 'debt', customer: 'Tendai' }))).toBe(`CON How much does Tendai owe?${HINT_LINE}`);
    expect(check(amountPrompt({ kind: 'payment', customer: 'Tendai' }))).toBe(
      `CON How much did Tendai pay?${HINT_LINE}`
    );
  });

  it('asks for the customer name', () => {
    expect(check(customerPrompt())).toBe(`CON Customer name?${HINT_LINE}`);
  });

  it('asks for the item, with 1 to skip', () => {
    expect(check(itemPrompt({ kind: 'sale' }))).toBe(`CON What was sold? 1 to skip${HINT_LINE}`);
    expect(check(itemPrompt({ kind: 'expense' }))).toBe(`CON What was it for? 1 to skip${HINT_LINE}`);
    expect(check(itemPrompt({ kind: 'debt', customer: 'Tendai' }))).toBe(
      `CON What did Tendai take? 1 to skip${HINT_LINE}`
    );
  });

  it('puts the notice first, before the question and the hint', () => {
    expect(check(amountPrompt({ kind: 'sale', notice: NOTICE.amountZero }))).toBe(
      `CON The amount must be more than zero.\nSale amount?${HINT_LINE}`
    );
    expect(check(customerPrompt(NOTICE.customerBad))).toBe(
      `CON Type the customer's name, like Tendai.\nCustomer name?${HINT_LINE}`
    );
    expect(check(itemPrompt({ kind: 'sale', notice: NOTICE.itemLong }))).toBe(
      `CON That is too long. Use 20 letters or less.\nWhat was sold? 1 to skip${HINT_LINE}`
    );
  });

  it('clips a long customer name to 20 characters', () => {
    expect(body(amountPrompt({ kind: 'debt', customer: `${NAME20}ZZZ` }))).toContain(`does ${NAME20} owe?`);
  });

  it('carries the hint when it fits, with the longest names and notices', () => {
    const screens = [
      amountPrompt({ kind: 'debt', customer: NAME20, notice: NOTICE.amountWords }),
      itemPrompt({ kind: 'debt', customer: NAME20, notice: NOTICE.asciiOnly }),
      customerPrompt(NOTICE.customerLong)
    ];
    for (const s of screens) expect(check(s).endsWith(HINT_LINE)).toBe(true);
  });
});

describe('paid-back list', () => {
  const rows: OwesRow[] = [
    { name: 'Tendai', owed: 5000 },
    { name: 'Rudo', owed: 3000 }
  ];

  it('numbers the customers and ends with Other name', () => {
    expect(check(payWhoList({ rows, hasMore: false, currency: 'ZAR' }))).toBe(
      `CON Who paid back?\n1 Tendai R50\n2 Rudo R30\n8 Other name${HINT_LINE}`
    );
  });

  it('adds 9 More when more customers follow', () => {
    expect(check(payWhoList({ rows, hasMore: true, currency: 'ZAR' }))).toBe(
      `CON Who paid back?\n1 Tendai R50\n2 Rudo R30\n8 Other name\n9 More${HINT_LINE}`
    );
  });

  it('shows the notice first', () => {
    const r = check(payWhoList({ rows, hasMore: false, currency: 'ZAR', notice: NOTICE.choose }));
    expect(r.startsWith('CON Choose a number from the list.\nWho paid back?')).toBe(true);
  });

  describe('the hint, both ways, with the longest data', () => {
    const longRows: OwesRow[] = [1, 2, 3].map((n) => ({ name: `Longname Customer 0${n}`, owed: 99999999 }));
    const worst = (notice?: string) => payWhoList({ rows: longRows, hasMore: true, currency: 'GHS', notice });

    it('is on the list when there is no notice', () => {
      const r = check(worst());
      expect(r.endsWith(HINT_LINE)).toBe(true);
      expect(body(worst())).toHaveLength(145 + 15);
    });

    it('is left out when the longest notice is showing, and nothing else is dropped', () => {
      const withNotice = toResponse(worst(NOTICE.choose));
      expect(ussdProblems(withNotice)).toEqual([]);
      expect(withNotice).not.toContain(HINT);
      expect(withNotice).toBe(toResponse({ ...worst(NOTICE.choose), hint: false }));
      expect(withNotice.split('\n')).toEqual([
        'CON Choose a number from the list.',
        'Who paid back?',
        '1 Longname Customer 01 GHS999,999.99',
        '2 Longname Customer 02 GHS999,999.99',
        '3 Longname Customer 03 GHS999,999.99',
        '8 Other name',
        '9 More'
      ]);
      expect(withNotice.length - 4).toBe(176);
    });
  });
});

describe('who-owes screens', () => {
  const rows: OwesRow[] = [
    { name: 'Tendai', owed: 5000 },
    { name: 'Rudo', owed: 3000 }
  ];

  it('is a CON screen with 9 More and the hint when more customers follow', () => {
    const s = owesScreen({ totalOwed: 38000, rows, hasMore: true, currency: 'ZAR' });
    expect(s.id).toBe('owesList');
    expect(s.end).toBe(false);
    expect(check(s)).toBe(`CON Owed to you: R380\nTendai R50\nRudo R30\n9 More${HINT_LINE}`);
  });

  it('is an END screen without 9 More and without the hint on the last screen', () => {
    const s = owesScreen({ totalOwed: 38000, rows, hasMore: false, currency: 'ZAR' });
    expect(s.id).toBe('owesEnd');
    expect(s.end).toBe(true);
    expect(check(s)).toBe('END Owed to you: R380\nTendai R50\nRudo R30');
  });

  it('shows a notice first', () => {
    const s = owesScreen({ totalOwed: 38000, rows, hasMore: true, currency: 'ZAR', notice: NOTICE.choose });
    expect(check(s).startsWith('CON Choose a number from the list.\nOwed to you: R380')).toBe(true);
  });

  it('fits with the longest data and leaves the hint out when it does not fit', () => {
    const longRows: OwesRow[] = [1, 2, 3].map((n) => ({ name: `Longname Customer 0${n}`, owed: 99999999 }));
    const s = owesScreen({ totalOwed: 999999970, rows: longRows, hasMore: true, currency: 'GHS', notice: NOTICE.choose });
    const r = check(s);
    expect(r).not.toContain(HINT);
    expect(r.split('\n')).toHaveLength(6);
  });
});

describe('confirm screens', () => {
  const confirm = (entry: Parameters<typeof confirmScreen>[0]['entry']) =>
    check(confirmScreen({ entry, currency: 'ZAR' }));

  it('repeats the amount and the item', () => {
    expect(confirm({ kind: 'sale', cents: 4500, item: 'bread' })).toBe(`CON Save sale R45 bread? 1 Yes 2 No${HINT_LINE}`);
    expect(confirm({ kind: 'sale', cents: 4500 })).toBe(`CON Save sale R45? 1 Yes 2 No${HINT_LINE}`);
    expect(confirm({ kind: 'expense', cents: 2000, item: 'taxi' })).toBe(
      `CON Save expense R20 taxi? 1 Yes 2 No${HINT_LINE}`
    );
    expect(confirm({ kind: 'debt', cents: 2000, customer: 'Tendai', item: 'sugar' })).toBe(
      `CON Save Tendai owes R20 sugar? 1 Yes 2 No${HINT_LINE}`
    );
    expect(confirm({ kind: 'debt', cents: 2000, customer: 'Tendai' })).toBe(
      `CON Save Tendai owes R20? 1 Yes 2 No${HINT_LINE}`
    );
    expect(confirm({ kind: 'payment', cents: 1000, customer: 'Tendai' })).toBe(
      `CON Save Tendai paid R10? 1 Yes 2 No${HINT_LINE}`
    );
  });

  it('writes cents when there are some', () => {
    expect(confirm({ kind: 'sale', cents: 4550 })).toContain('Save sale R45.50?');
  });

  it('shows the big-amount confirm', () => {
    expect(check(confirmBigScreen({ cents: 150000000, currency: 'ZAR' }))).toBe(
      `CON That is a big amount: R1,500,000. 1 Yes, save 2 No${HINT_LINE}`
    );
  });

  it('shows the undo confirm for each kind', () => {
    const undo = (entry: Parameters<typeof undoConfirmScreen>[0]['entry']) =>
      check(undoConfirmScreen({ entry, currency: 'ZAR' }));
    expect(undo({ kind: 'sale', cents: 4500, item: 'bread' })).toBe(`CON Undo sale R45 bread? 1 Yes 2 No${HINT_LINE}`);
    expect(undo({ kind: 'expense', cents: 2000, item: 'taxi' })).toBe(`CON Undo spent R20 taxi? 1 Yes 2 No${HINT_LINE}`);
    expect(undo({ kind: 'debt', cents: 2000, customer: 'Tendai', item: 'sugar' })).toBe(
      `CON Undo Tendai owes R20 sugar? 1 Yes 2 No${HINT_LINE}`
    );
    expect(undo({ kind: 'payment', cents: 1000, customer: 'Tendai' })).toBe(
      `CON Undo Tendai paid R10? 1 Yes 2 No${HINT_LINE}`
    );
  });

  it('shows a notice first and keeps the hint when it fits', () => {
    const r = check(
      confirmScreen({ entry: { kind: 'sale', cents: 4500 }, currency: 'ZAR', notice: NOTICE.choose })
    );
    expect(r).toBe(`CON Choose a number from the list.\nSave sale R45? 1 Yes 2 No${HINT_LINE}`);
  });

  it('fits with the longest data in every currency and keeps the hint', () => {
    for (const currency of CURRENCIES) {
      const entry = { kind: 'debt', cents: 99999999, customer: NAME20, item: ITEM20 } as const;
      for (const s of [
        confirmScreen({ entry, currency, notice: NOTICE.choose }),
        confirmBigScreen({ cents: 9007199254740991, currency, notice: NOTICE.choose }),
        undoConfirmScreen({ entry, currency, notice: NOTICE.choose })
      ]) {
        const r = check(s);
        expect(r.endsWith(HINT_LINE)).toBe(true);
      }
    }
  });

  it('keeps the confirm of the largest safe amount within 182, with the hint only if it fits', () => {
    const entry = { kind: 'debt', cents: 9007199254740991, customer: NAME20, item: ITEM20 } as const;
    const r = check(confirmScreen({ entry, currency: 'GHS', notice: NOTICE.choose }));
    expect(r.length - 4).toBeLessThanOrEqual(182);
  });

  it('makes names and items plain ASCII and clips them', () => {
    const r = toResponse(
      confirmScreen({ entry: { kind: 'debt', cents: 100, customer: 'Ren\u00e9e', item: `${ITEM20}ZZZZ` }, currency: 'ZAR' })
    );
    expect(r).toContain('Save Ren?e owes R1 Maize meal 12.5kg x2?');
  });
});
