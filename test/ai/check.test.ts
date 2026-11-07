import { describe, it, expect } from 'vitest';
import { amountOccurs, checkProposal, wordOccurrence } from '@/ai/check.ts';
import type { Proposal } from '@/ai/reader.ts';
import type { Intent } from '@/channels/sms/reader.ts';
import type { Currency } from '@/core/index.ts';

const UNKNOWN: Intent = { kind: 'unknown' };

function check(proposal: Proposal | null | undefined, text: string, currency: Currency = 'ZAR'): Intent {
  return checkProposal(proposal, text, currency);
}

/** A proposal the way a model would send it. `as Proposal` lets tests build ones that no honest model sends. */
function proposal(p: Record<string, unknown>): Proposal {
  return p as unknown as Proposal;
}

describe('checkProposal: honest proposals are accepted', () => {
  it('accepts a sale whose amount is in the message', () => {
    const p = proposal({ intent: { kind: 'sale', cents: 4500, item: 'bread' }, amountSubstring: '45' });
    expect(check(p, 'got 45 for bread from a lady')).toEqual({ kind: 'sale', cents: 4500, item: 'bread' });
  });

  it('accepts an expense', () => {
    const p = proposal({ intent: { kind: 'expense', cents: 12000 }, amountSubstring: '120' });
    expect(check(p, 'taxi cost me 120 today')).toEqual({ kind: 'expense', cents: 12000 });
  });

  it('accepts a debt and a payment with the customer written as the owner typed it', () => {
    const debt = proposal({
      intent: { kind: 'debt', customer: 'Tendai', cents: 2000, item: 'sugar' },
      amountSubstring: '20',
      customerSubstring: 'Tendai'
    });
    expect(check(debt, 'tendai took sugar 20 not paid')).toEqual({
      kind: 'debt',
      customer: 'tendai',
      cents: 2000,
      item: 'sugar'
    });

    const payment = proposal({
      intent: { kind: 'payment', customer: 'Mai Rudo', cents: 1000 },
      amountSubstring: '10',
      customerSubstring: 'Mai Rudo'
    });
    expect(check(payment, 'Mai Rudo gave me 10 back')).toEqual({
      kind: 'payment',
      customer: 'Mai Rudo',
      cents: 1000
    });
  });

  it('ignores case when it looks for the substrings', () => {
    const p = proposal({
      intent: { kind: 'payment', customer: 'TENDAI', cents: 1000 },
      amountSubstring: 'r10',
      customerSubstring: 'TENDAI'
    });
    // "r10" is found ignoring case, but parseAmount only knows the capital R, so this is still refused.
    expect(check(p, 'tendai gave r10')).toEqual(UNKNOWN);

    const ok = proposal({
      intent: { kind: 'payment', customer: 'TENDAI', cents: 1000 },
      amountSubstring: 'R10',
      customerSubstring: 'TENDAI'
    });
    expect(check(ok, 'tendai gave R10')).toEqual({ kind: 'payment', customer: 'tendai', cents: 1000 });
  });

  it('reads the amount the way parseAmount does: R prefix, decimals, decimal comma, thousands', () => {
    const cases: Array<[string, string, number]> = [
      ['R45', 'got R45 from a lady', 4500],
      ['45.50', 'got 45.50 from a lady', 4550],
      ['45,50', 'got 45,50 from a lady', 4550],
      ['1,200', 'got 1,200 from a lady', 120000],
      ['1 200', 'got 1 200 from a lady', 120000],
      ['R1 200.50', 'got R1 200.50 from a lady', 120050]
    ];
    for (const [substring, text, cents] of cases) {
      const p = proposal({ intent: { kind: 'sale', cents }, amountSubstring: substring });
      expect(check(p, text), text).toEqual({ kind: 'sale', cents });
    }
  });

  it('uses the shop currency to read the amount', () => {
    const p = proposal({ intent: { kind: 'sale', cents: 4500 }, amountSubstring: 'KSh45' });
    expect(check(p, 'got KSh45 from a lady', 'KES')).toEqual({ kind: 'sale', cents: 4500 });
    // The same words in a rand shop are not an amount.
    expect(check(p, 'got KSh45 from a lady', 'ZAR')).toEqual(UNKNOWN);
  });
});

describe('checkProposal: proposals that lie are refused', () => {
  it('refuses an amount the owner never typed', () => {
    const p = proposal({ intent: { kind: 'sale', cents: 9900 }, amountSubstring: '99' });
    expect(check(p, 'got 45 for bread')).toEqual(UNKNOWN);
  });

  it('refuses a substring that is only part of a longer number the owner typed', () => {
    const p = proposal({ intent: { kind: 'sale', cents: 4500 }, amountSubstring: '45' });
    expect(check(p, 'got 450 for bread')).toEqual(UNKNOWN);
    expect(check(p, 'got 4,5 for bread')).toEqual(UNKNOWN);
    expect(check(p, 'got 145 for bread')).toEqual(UNKNOWN);
    expect(check(p, 'got 45.5 for bread')).toEqual(UNKNOWN);
  });

  it('refuses the last group of a number split by a thousands separator', () => {
    const p = proposal({ intent: { kind: 'sale', cents: 20000 }, amountSubstring: '200' });
    expect(check(p, 'got 2 200 for bread')).toEqual(UNKNOWN);
    expect(check(p, 'got 2,200 for bread')).toEqual(UNKNOWN);
    const front = proposal({ intent: { kind: 'sale', cents: 200 }, amountSubstring: '2' });
    expect(check(front, 'got 2 200 for bread')).toEqual(UNKNOWN);
  });

  it('finds the amount when the same digits also appear inside a longer number elsewhere', () => {
    const p = proposal({ intent: { kind: 'sale', cents: 4500 }, amountSubstring: '45' });
    expect(check(p, 'order 450 paid 45')).toEqual({ kind: 'sale', cents: 4500 });
  });

  it('refuses an amount that the owner typed but that does not mean the cents claimed (45 is R45, 4500 cents)', () => {
    // The owner typed 45. That is R45 = 4500 cents.
    const right = proposal({ intent: { kind: 'sale', cents: 4500 }, amountSubstring: '45' });
    expect(check(right, 'sold bread for 45')).toEqual({ kind: 'sale', cents: 4500 });

    // 45 read as 45 cents: the reverse lie.
    const cents = proposal({ intent: { kind: 'sale', cents: 45 }, amountSubstring: '45' });
    expect(check(cents, 'sold bread for 45')).toEqual(UNKNOWN);

    // 45 read as 450000 cents (R4,500): too many zeros.
    const zeros = proposal({ intent: { kind: 'sale', cents: 450000 }, amountSubstring: '45' });
    expect(check(zeros, 'sold bread for 45')).toEqual(UNKNOWN);

    // 4500 cents claimed for a substring that really means R4,500.
    const big = proposal({ intent: { kind: 'sale', cents: 4500 }, amountSubstring: '4500' });
    expect(check(big, 'sold bread for 4500')).toEqual(UNKNOWN);
  });

  it('refuses when the claimed cents are not a whole safe number', () => {
    for (const cents of [45.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60, '4500', null, undefined]) {
      const p = proposal({ intent: { kind: 'sale', cents }, amountSubstring: '45' });
      expect(check(p, 'sold bread for 45'), String(cents)).toEqual(UNKNOWN);
    }
  });

  it('refuses an amount substring that is empty or only spaces', () => {
    for (const amountSubstring of ['', '   ']) {
      const p = proposal({ intent: { kind: 'sale', cents: 4500 }, amountSubstring });
      expect(check(p, 'sold bread for 45')).toEqual(UNKNOWN);
    }
    const missing = proposal({ intent: { kind: 'sale', cents: 4500 } });
    expect(check(missing, 'sold bread for 45')).toEqual(UNKNOWN);
  });

  it('refuses an amount substring that is not an amount', () => {
    const p = proposal({ intent: { kind: 'sale', cents: 4500 }, amountSubstring: 'bread' });
    expect(check(p, 'sold bread for 45')).toEqual(UNKNOWN);
  });

  it('refuses an amount that could honestly mean two things, instead of guessing', () => {
    const p = proposal({ intent: { kind: 'sale', cents: 20000 }, amountSubstring: '2 200' });
    expect(check(p, 'got 2 200 for bread')).toEqual(UNKNOWN);
    const q = proposal({ intent: { kind: 'sale', cents: 220000 }, amountSubstring: '2 200' });
    expect(check(q, 'got 2 200 for bread')).toEqual(UNKNOWN);
  });

  it('refuses a customer name that is not in the message', () => {
    const p = proposal({
      intent: { kind: 'debt', customer: 'Rudo', cents: 2000 },
      amountSubstring: '20',
      customerSubstring: 'Rudo'
    });
    expect(check(p, 'tendai took sugar 20 not paid')).toEqual(UNKNOWN);
  });

  it('refuses a customer name that is only part of a word the owner typed', () => {
    const p = proposal({
      intent: { kind: 'debt', customer: 'Ten', cents: 2000 },
      amountSubstring: '20',
      customerSubstring: 'Ten'
    });
    expect(check(p, 'tendai took sugar 20 not paid')).toEqual(UNKNOWN);
  });

  it('refuses when the intent names a different person from the substring that was checked', () => {
    const p = proposal({
      intent: { kind: 'debt', customer: 'Rudo', cents: 2000 },
      amountSubstring: '20',
      customerSubstring: 'tendai'
    });
    expect(check(p, 'tendai took sugar 20 not paid')).toEqual(UNKNOWN);
  });

  it('refuses a customer that is only a number or symbols', () => {
    const p = proposal({
      intent: { kind: 'debt', customer: '20', cents: 2000 },
      amountSubstring: '20',
      customerSubstring: '20'
    });
    expect(check(p, 'took sugar 20 not paid')).toEqual(UNKNOWN);
  });

  it('requires a customer for a debt and for a payment', () => {
    const debt = proposal({ intent: { kind: 'debt', customer: '', cents: 2000 }, amountSubstring: '20' });
    expect(check(debt, 'someone took sugar 20 not paid')).toEqual(UNKNOWN);
    const payment = proposal({
      intent: { kind: 'payment', customer: 'Tendai', cents: 2000 },
      amountSubstring: '20'
    });
    expect(check(payment, 'tendai paid 20')).toEqual(UNKNOWN);
    const blank = proposal({
      intent: { kind: 'payment', customer: 'Tendai', cents: 2000 },
      amountSubstring: '20',
      customerSubstring: '  '
    });
    expect(check(blank, 'tendai paid 20')).toEqual(UNKNOWN);
  });

  it('refuses a customer for a sale and for an expense', () => {
    const viaSubstring = proposal({
      intent: { kind: 'sale', cents: 4500 },
      amountSubstring: '45',
      customerSubstring: 'Tendai'
    });
    expect(check(viaSubstring, 'tendai bought bread 45')).toEqual(UNKNOWN);

    const viaIntent = proposal({
      intent: { kind: 'expense', cents: 4500, customer: 'Tendai' },
      amountSubstring: '45'
    });
    expect(check(viaIntent, 'tendai bought bread 45')).toEqual(UNKNOWN);
  });

  it('refuses a kind outside sale, expense, debt and payment', () => {
    for (const kind of ['undo', 'today', 'close', 'whoOwes', 'balance', 'help', 'unknown', 'ambiguous', 'reversal', 'transfer', '']) {
      const p = proposal({ intent: { kind, cents: 4500 }, amountSubstring: '45' });
      expect(check(p, 'sold bread for 45'), kind).toEqual(UNKNOWN);
    }
  });

  it('refuses nothing-shaped input without throwing', () => {
    expect(check(null, 'sold bread for 45')).toEqual(UNKNOWN);
    expect(check(undefined, 'sold bread for 45')).toEqual(UNKNOWN);
    expect(check(proposal({}), 'sold bread for 45')).toEqual(UNKNOWN);
    expect(check(proposal({ intent: null, amountSubstring: '45' }), 'sold bread for 45')).toEqual(UNKNOWN);
    expect(check(proposal({ intent: 'sale', amountSubstring: '45' }), 'sold bread for 45')).toEqual(UNKNOWN);
    expect(check(proposal({ intent: { kind: 'sale', cents: 4500 }, amountSubstring: 45 }), 'sold bread for 45')).toEqual(UNKNOWN);
    expect(
      check(proposal({ intent: { kind: 'sale', cents: 4500 }, amountSubstring: '45' }), undefined as unknown as string)
    ).toEqual(UNKNOWN);
  });
});

describe('checkProposal: the item', () => {
  it('keeps an item the owner typed, in the owner lower-case style', () => {
    const p = proposal({ intent: { kind: 'sale', cents: 4500, item: 'Bread' }, amountSubstring: '45' });
    expect(check(p, 'Sold BREAD for 45')).toEqual({ kind: 'sale', cents: 4500, item: 'bread' });
  });

  it('leaves off an item the model made up, and still accepts the rest', () => {
    const p = proposal({ intent: { kind: 'sale', cents: 4500, item: 'airtime' }, amountSubstring: '45' });
    expect(check(p, 'sold bread for 45')).toEqual({ kind: 'sale', cents: 4500 });
  });

  it('leaves off an item that is only part of a word', () => {
    const p = proposal({ intent: { kind: 'sale', cents: 4500, item: 'bread' }, amountSubstring: '45' });
    expect(check(p, 'sold breadcrumbs for 45')).toEqual({ kind: 'sale', cents: 4500 });
  });

  it('drops a quantity: it is not stored and the model cannot be checked on it', () => {
    const p = proposal({ intent: { kind: 'sale', cents: 4500, quantity: 3 }, amountSubstring: '45' });
    expect(check(p, 'sold bread for 45')).toEqual({ kind: 'sale', cents: 4500 });
  });
});

// A synchronous loop cannot be stopped by a test timeout, so these tests also prove the guards directly:
// each call must return at once. The 2-second limit makes a slow regression fail instead of hang.
describe('empty needles are safe', () => {
  it('amountOccurs returns false at once for an empty needle', { timeout: 2000 }, () => {
    expect(amountOccurs('sold bread for 45', '')).toBe(false);
    expect(amountOccurs('', '')).toBe(false);
  });

  it('wordOccurrence returns null at once for an empty needle', { timeout: 2000 }, () => {
    expect(wordOccurrence('tendai took sugar', '')).toBeNull();
    expect(wordOccurrence('', '')).toBeNull();
  });

  it('still finds real needles', { timeout: 2000 }, () => {
    expect(amountOccurs('sold bread for 45', '45')).toBe(true);
    expect(wordOccurrence('Tendai took sugar', 'tendai')).toBe('Tendai');
  });

  it('checkProposal refuses an empty customer for debt and payment', { timeout: 2000 }, () => {
    for (const kind of ['debt', 'payment'] as const) {
      for (const customerSubstring of ['', '  ']) {
        const p = proposal({ intent: { kind, customer: '', cents: 2000 }, amountSubstring: '20', customerSubstring });
        expect(check(p, 'took sugar 20 not paid'), kind).toEqual(UNKNOWN);
      }
    }
  });
});
