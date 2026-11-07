import { describe, expect, it } from 'vitest';
import {
  AMOUNT_MUST_BE_MORE_THAN_ZERO,
  AMOUNT_TOO_BIG,
  ASK_SHOP_NAME_AGAIN,
  NOT_SAVED,
  SHOP_NAME_MAX,
  TRY_AGAIN,
  WELCOME,
  askConfirmLargeAmount,
  askWhichAmount,
  cleanShopName,
  shopReady
} from '@/channels/sms/prompts.ts';
import type { Currency } from '@/core/index.ts';
import { expectSmsReply } from '../../helpers/reply.ts';

const CURRENCIES: Currency[] = ['ZAR', 'USD', 'KES', 'NGN', 'GHS', 'ZMW', 'BWP'];
const LONG_NAME = 'Nomvula Dlamini-Khum'; // 20 characters
const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER; // the largest amount that can ever be asked about

describe('fixed wording', () => {
  it('is plain ASCII within 160 characters', () => {
    for (const text of [
      WELCOME,
      ASK_SHOP_NAME_AGAIN,
      AMOUNT_MUST_BE_MORE_THAN_ZERO,
      AMOUNT_TOO_BIG,
      NOT_SAVED,
      TRY_AGAIN
    ]) {
      expectSmsReply(text);
    }
  });

  it('uses the welcome the spec gives (requirement 44) and writes Imali AI, not Imali', () => {
    expect(WELCOME).toBe('Welcome to the Imali AI shop ledger. Reply with your shop name to start.');
  });

  it('says the shop is ready in the words of requirement 45', () => {
    expect(shopReady("Thandi's Spaza")).toBe("Thandi's Spaza is ready. Try: sold 45 bread.");
  });
});

describe('cleanShopName', () => {
  it('keeps a plain name', () => {
    expect(cleanShopName("Thandi's Spaza")).toBe("Thandi's Spaza");
  });

  it('trims spaces and collapses inner ones', () => {
    expect(cleanShopName('   Thandi   Spaza  ')).toBe('Thandi Spaza');
  });

  it('cuts a long name to 24 characters and does not leave a space at the end', () => {
    expect(SHOP_NAME_MAX).toBe(24);
    expect(cleanShopName('Thandi Mokoena Family Spaza And Tuckshop')).toBe('Thandi Mokoena Family Sp');
    expect(cleanShopName('Thandi Mokoena Family Spaza And Tuckshop')).toHaveLength(24);
    // The 24th character here is a space: it must not stay at the end.
    expect(cleanShopName('Mokoena Family Grocerys Store')).toBe('Mokoena Family Grocerys');
  });

  it('turns curly quotes and long dashes into plain ones, and drops accents', () => {
    expect(cleanShopName('Thandi\u2019s Spaza')).toBe("Thandi's Spaza");
    expect(cleanShopName('Caf\u00e9 \u2014 Bar')).toBe('Cafe - Bar');
  });

  it('gives null when nothing usable is left', () => {
    expect(cleanShopName('')).toBeNull();
    expect(cleanShopName('   ')).toBeNull();
    expect(cleanShopName('???')).toBeNull();
    expect(cleanShopName('\ud83c\udf5e\ud83c\udf5e')).toBeNull();
  });

  it('always gives plain ASCII', () => {
    const name = cleanShopName('Sipho\u2019s \u0160hop \u2603 24/7');
    expect(name).not.toBeNull();
    expectSmsReply(shopReady(name!));
  });
});

describe('askWhichAmount (requirement 27)', () => {
  it('asks in the words of the spec', () => {
    expect(
      askWhichAmount([{ cents: 20000, quantity: 2 }, { cents: 220000 }], 'ZAR')
    ).toBe('Did you mean 1) R200 for 2 or 2) R2,200? Reply 1 or 2.');
  });

  it('leaves out "for N" when there is no quantity', () => {
    expect(askWhichAmount([{ cents: 20000 }, { cents: 220000 }], 'ZAR')).toBe(
      'Did you mean 1) R200 or 2) R2,200? Reply 1 or 2.'
    );
  });

  it('uses the shop currency', () => {
    expect(askWhichAmount([{ cents: 20000, quantity: 2 }, { cents: 220000 }], 'KES')).toBe(
      'Did you mean 1) KSh200 for 2 or 2) KSh2,200? Reply 1 or 2.'
    );
  });

  it('fits one text with the longest data, in every currency', () => {
    for (const currency of CURRENCIES) {
      const huge = askWhichAmount(
        [{ cents: MAX_SAFE_CENTS - 1, quantity: Number.MAX_SAFE_INTEGER }, { cents: MAX_SAFE_CENTS }],
        currency
      );
      expectSmsReply(huge);
      expect(huge).toContain('Reply 1 or 2.');
      expect(huge).toContain('1)');
      expect(huge).toContain('2)');
    }
  });
});

describe('askConfirmLargeAmount (requirement 30)', () => {
  it('asks in the words of the spec', () => {
    expect(askConfirmLargeAmount({ kind: 'sale', cents: 150000000 }, 'ZAR')).toBe(
      'Reply yes to save sale R1,500,000.'
    );
  });

  it('names what will be saved for each kind', () => {
    expect(askConfirmLargeAmount({ kind: 'expense', cents: 150000000 }, 'ZAR')).toBe(
      'Reply yes to save spent R1,500,000.'
    );
    expect(askConfirmLargeAmount({ kind: 'debt', cents: 150000000, customer: 'Tendai' }, 'ZAR')).toBe(
      'Reply yes to save Tendai owes R1,500,000.'
    );
    expect(askConfirmLargeAmount({ kind: 'payment', cents: 150000000, customer: 'Tendai' }, 'ZAR')).toBe(
      'Reply yes to save Tendai paid R1,500,000.'
    );
  });

  it('fits one text with the longest data, in every currency and for every kind', () => {
    for (const currency of CURRENCIES) {
      for (const thing of [
        { kind: 'sale', cents: MAX_SAFE_CENTS },
        { kind: 'expense', cents: MAX_SAFE_CENTS },
        { kind: 'debt', cents: MAX_SAFE_CENTS, customer: LONG_NAME },
        { kind: 'payment', cents: MAX_SAFE_CENTS, customer: LONG_NAME }
      ] as const) {
        const text = expectSmsReply(askConfirmLargeAmount(thing, currency));
        expect(text.startsWith('Reply yes to save ')).toBe(true);
      }
    }
  });

  it('drops the name, not the question, when the name is absurdly long', () => {
    const text = expectSmsReply(
      askConfirmLargeAmount({ kind: 'debt', cents: 150000000, customer: 'x'.repeat(200) }, 'ZAR')
    );
    expect(text).toBe('Reply yes to save R1,500,000.');
  });

  it('writes a customer name as plain ASCII', () => {
    const text = expectSmsReply(
      askConfirmLargeAmount({ kind: 'debt', cents: 150000000, customer: 'Tenda\u00ef \u2603' }, 'ZAR')
    );
    expect(text).toBe('Reply yes to save Tendai ? owes R1,500,000.');
  });
});
