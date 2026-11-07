import { describe, it, expect } from 'vitest';
import { PAY_WHO_MAX_ROWS, owesBudget, paginate, payWhoBudget } from '../../../src/channels/ussd/pages.js';
import { LABEL, NOTICE } from '../../../src/channels/ussd/text.js';

describe('paginate', () => {
  it('gives no pages for no rows', () => {
    expect(paginate([], 100, 7)).toEqual([]);
  });

  it('fills a page greedily, counting each row as its length plus a newline', () => {
    // 10+1 + 10+1 + 10+1 = 33 fits in 33, a fourth does not
    expect(paginate([10, 10, 10, 10], 33, 7)).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 4 }
    ]);
    expect(paginate([10, 10, 10, 10], 32, 7)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 }
    ]);
  });

  it('holds at most maxRows rows', () => {
    expect(paginate([1, 1, 1, 1, 1], 1000, 2)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 4, end: 5 }
    ]);
  });

  it('gives a row longer than the budget its own page', () => {
    expect(paginate([10, 500, 10], 50, 7)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 }
    ]);
    expect(paginate([500], 50, 7)).toEqual([{ start: 0, end: 1 }]);
  });

  it('puts every row on exactly one page, in order', () => {
    const lengths = [5, 30, 12, 40, 3, 22, 9, 17, 8, 36, 2];
    const pages = paginate(lengths, 60, 4);
    expect(pages[0]!.start).toBe(0);
    expect(pages.at(-1)!.end).toBe(lengths.length);
    pages.forEach((p, i) => {
      expect(p.end).toBeGreaterThan(p.start);
      if (i > 0) expect(p.start).toBe(pages[i - 1]!.end);
    });
  });

  it('always makes progress, even for a maxRows below 1', () => {
    expect(paginate([1, 1], 100, 0)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 }
    ]);
  });

  it('is the same every time', () => {
    expect(paginate([5, 6, 7, 8], 20, 3)).toEqual(paginate([5, 6, 7, 8], 20, 3));
  });
});

describe('budgets', () => {
  it('pay-who budget is 117 and is built from the same text as the screen', () => {
    expect(payWhoBudget()).toBe(117);
    expect(payWhoBudget()).toBe(
      182 - (NOTICE.choose.length + 1) - (LABEL.whoPaidBack.length + 1) - (LABEL.otherName.length + 1) - LABEL.more.length
    );
    // the pieces the design names
    expect(NOTICE.choose.length + 1).toBe(31);
    expect(LABEL.whoPaidBack.length + 1).toBe(15);
    expect(LABEL.otherName.length + 1).toBe(13);
    expect(LABEL.more.length).toBe(6);
  });

  it('owes budget is the limit less the notice, the header line and 9 More', () => {
    expect(owesBudget(20)).toBe(182 - 31 - 21 - 6);
    expect(owesBudget(35)).toBe(182 - 31 - 36 - 6);
  });

  it('owes budget is never negative', () => {
    expect(owesBudget(1000)).toBe(0);
  });

  it('holds three paid-back rows of the longest data and not four', () => {
    // "7 " + 20-character name + " " + "GHS999,999.99"
    const longest = 2 + 20 + 1 + 'GHS999,999.99'.length;
    expect(longest).toBe(36);
    const pages = paginate(Array(10).fill(longest), payWhoBudget(), PAY_WHO_MAX_ROWS);
    expect(pages[0]).toEqual({ start: 0, end: 3 });
  });

  it('holds at most 7 paid-back rows whatever the length', () => {
    const pages = paginate(Array(20).fill(5), payWhoBudget(), PAY_WHO_MAX_ROWS);
    expect(pages[0]).toEqual({ start: 0, end: 7 });
    expect(PAY_WHO_MAX_ROWS).toBe(7);
  });

  it('holds three who-owes rows of the longest data', () => {
    // "<20-character name> GHS999,999.99" is 34; with the longest header
    const header = 'Owed to you: GHS9,999,999.99'.length;
    const pages = paginate(Array(10).fill(34), owesBudget(header), Number.POSITIVE_INFINITY);
    expect(pages[0]!.end - pages[0]!.start).toBe(3);
  });
});
