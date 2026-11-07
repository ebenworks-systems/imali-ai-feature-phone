import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatCents } from '@/core/money/format.ts';
import type { Currency } from '@/core/money/currency.ts';
import {
  CURRENCY_SYMBOLS,
  currencyLabel,
  demoPhone,
  displayPhone,
  exportFileName,
  formatClock,
  formatMoney,
  formatRecordTime,
  isDemoPhone,
  readLedger,
  recordRows,
  sortOwes,
  splitOwes,
} from '../../public/ledger-logic.js';

const CURRENCIES = ['ZAR', 'USD', 'KES', 'NGN', 'GHS', 'ZMW', 'BWP'] as const;

describe('formatMoney', () => {
  it('shows no decimals at zero cents and two decimals otherwise', () => {
    expect(formatMoney(0, 'ZAR')).toBe('R0');
    expect(formatMoney(4500, 'ZAR')).toBe('R45');
    expect(formatMoney(4550, 'ZAR')).toBe('R45.50');
    expect(formatMoney(5, 'ZAR')).toBe('R0.05');
    expect(formatMoney(124000, 'ZAR')).toBe('R1,240');
    expect(formatMoney(99999999, 'ZAR')).toBe('R999,999.99');
    expect(formatMoney(100000000, 'ZAR')).toBe('R1,000,000');
  });

  it('uses the seven plain ASCII symbols', () => {
    expect(formatMoney(4500, 'USD')).toBe('$45');
    expect(formatMoney(4500, 'KES')).toBe('KSh45');
    expect(formatMoney(4500, 'NGN')).toBe('N45');
    expect(formatMoney(4500, 'GHS')).toBe('GHS45');
    expect(formatMoney(4500, 'ZMW')).toBe('K45');
    expect(formatMoney(4500, 'BWP')).toBe('P45');
    expect(Object.keys(CURRENCY_SYMBOLS)).toHaveLength(7);
  });

  it('puts the minus before the symbol, as src/core/money/format.ts does', () => {
    expect(formatMoney(-4550, 'ZAR')).toBe('-R45.50');
    expect(formatMoney(-100000, 'KES')).toBe('-KSh1,000');
    expect(formatMoney(-6000, 'ZAR')).toBe('-R60');
  });

  it('writes a negative as -<symbol><amount> for every currency, and zero with no sign', () => {
    for (const currency of CURRENCIES) {
      const symbol = CURRENCY_SYMBOLS[currency];
      expect(formatMoney(-6000, currency)).toBe(`-${symbol}60`);
      expect(formatMoney(-120050, currency)).toBe(`-${symbol}1,200.50`);
      expect(formatMoney(0, currency)).toBe(`${symbol}0`);
      expect(formatMoney(-0, currency)).toBe(`${symbol}0`);
    }
  });

  it('refuses a cents value that is not a safe integer', () => {
    expect(() => formatMoney(45.5, 'ZAR')).toThrow(RangeError);
    expect(() => formatMoney(Number.NaN, 'ZAR')).toThrow(RangeError);
    expect(() => formatMoney(Number.MAX_SAFE_INTEGER + 1, 'ZAR')).toThrow(RangeError);
  });

  it('matches src/core/money/format.ts for every currency and for random safe cents', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CURRENCIES),
        fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
        (currency, cents) => {
          expect(formatMoney(cents, currency)).toBe(formatCents(cents, currency as Currency));
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('matches the server on the edge values for every currency', () => {
    for (const currency of CURRENCIES) {
      for (const cents of [0, 1, 9, 10, 99, 100, 101, 99999, 100000, 100001, 99999999, 100000000, 123456789012]) {
        expect(formatMoney(cents, currency)).toBe(formatCents(cents, currency as Currency));
      }
    }
  });

  it('labels the currency', () => {
    expect(currencyLabel('ZAR')).toBe('Currency ZAR (R)');
    expect(currencyLabel('GHS')).toBe('Currency GHS (GHS)');
  });
});

describe('formatClock', () => {
  it('shows the 24 hour time in the shop time zone', () => {
    expect(formatClock(Date.parse('2026-11-07T12:05:00Z'), 'Africa/Johannesburg')).toBe('14:05');
    expect(formatClock(Date.parse('2026-11-07T12:05:00Z'), 'Africa/Nairobi')).toBe('15:05');
    expect(formatClock(Date.parse('2026-11-07T12:05:00Z'), 'Africa/Lagos')).toBe('13:05');
  });

  it('shows midnight as 00:00, never 24:00', () => {
    expect(formatClock(Date.parse('2026-11-06T22:00:00Z'))).toBe('00:00');
    expect(formatClock(Date.parse('2026-11-06T22:09:00Z'))).toBe('00:09');
  });

  it('defaults to Africa/Johannesburg and survives a bad zone name', () => {
    const at = Date.parse('2026-11-07T12:05:00Z');
    expect(formatClock(at)).toBe('14:05');
    expect(formatClock(at, 'Not/AZone')).toBe('14:05');
  });

  it('gives an empty text for a time that is not a number', () => {
    expect(formatClock(Number.NaN)).toBe('');
  });
});

describe('formatRecordTime', () => {
  const now = Date.parse('2026-11-07T10:00:00Z'); // 12:00 on 7 Nov in Johannesburg

  it('shows only the time for a record made on the shop day', () => {
    expect(formatRecordTime('2026-11-07T12:05:00Z', 'Africa/Johannesburg', Date.parse('2026-11-07T14:00:00Z'))).toBe('14:05');
  });

  it('treats the record just after local midnight as today', () => {
    expect(formatRecordTime('2026-11-06T22:00:00Z', 'Africa/Johannesburg', now)).toBe('00:00');
  });

  it('treats the record just before local midnight as the earlier day', () => {
    expect(formatRecordTime('2026-11-06T21:59:59Z', 'Africa/Johannesburg', now)).toBe('6 Nov 23:59');
  });

  it('shows the date before the time for an earlier day', () => {
    expect(formatRecordTime('2026-11-03T12:05:00Z', 'Africa/Johannesburg', now)).toBe('3 Nov 14:05');
  });

  it('prints September as Sep and uses the whole month table', () => {
    expect(formatRecordTime('2026-09-05T08:00:00Z', 'Africa/Johannesburg', now)).toBe('5 Sep 10:00');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    months.forEach((name, index) => {
      const month = String(index + 1).padStart(2, '0');
      expect(formatRecordTime(`2025-${month}-15T08:00:00Z`, 'Africa/Johannesburg', now)).toBe(`15 ${name} 10:00`);
    });
  });

  it('uses the shop zone to decide what today is', () => {
    // 23:30Z on 7 Nov is already 8 Nov in Johannesburg, so a record made then is not on 7 Nov.
    expect(formatRecordTime('2026-11-07T23:30:00Z', 'Africa/Johannesburg', now)).toBe('8 Nov 01:30');
    expect(formatRecordTime('2026-11-07T23:30:00Z', 'UTC', now)).toBe('23:30');
  });

  it('gives an empty text for a bad date', () => {
    expect(formatRecordTime('yesterday', 'Africa/Johannesburg', now)).toBe('');
  });
});

function sampleAnswer() {
  return {
    shop: { name: 'Mama Thandi Corner Shop', currency: 'ZAR', timeZone: 'Africa/Johannesburg' },
    today: { sales: 124000, salesCount: 12, spent: 30000, inHand: 94000 },
    whoOwes: [
      { name: 'Tendai', owed: 5000 },
      { name: 'Lerato', owed: 2000 },
    ],
    records: [
      {
        id: 'r1',
        kind: 'sale',
        amount: 4500,
        createdAt: '2026-11-07T12:05:00.000Z',
        channel: 'ussd',
        item: 'bread',
      },
      {
        id: 'r2',
        kind: 'debt',
        amount: 2000,
        createdAt: '2026-11-07T12:07:00.000Z',
        channel: 'sms',
        item: 'sugar',
        customerDisplayName: 'Tendai',
      },
    ],
  };
}

describe('readLedger', () => {
  it('accepts a full answer and normalises it', () => {
    const result = readLedger(sampleAnswer());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger.shop).toEqual({ name: 'Mama Thandi Corner Shop', currency: 'ZAR', timeZone: 'Africa/Johannesburg' });
    expect(result.ledger.today.inHand).toBe(94000);
    expect(result.ledger.records[1]).toMatchObject({ customerDisplayName: 'Tendai', item: 'sugar', reversesRecordId: '' });
    expect(result.ledger.records[0].customerDisplayName).toBe('');
  });

  it('accepts a missing time zone and uses Africa/Johannesburg', () => {
    const answer = sampleAnswer();
    delete (answer.shop as { timeZone?: string }).timeZone;
    const result = readLedger(answer);
    expect(result.ok && result.ledger.shop.timeZone).toBe('Africa/Johannesburg');
  });

  it('falls back to the default zone for a zone name the browser does not know', () => {
    const answer = sampleAnswer();
    answer.shop.timeZone = 'Mars/Olympus';
    const result = readLedger(answer);
    expect(result.ok && result.ledger.shop.timeZone).toBe('Africa/Johannesburg');
  });

  it('accepts negative in-hand money and empty lists', () => {
    const answer = sampleAnswer();
    answer.today.inHand = -1500;
    answer.whoOwes = [];
    answer.records = [];
    expect(readLedger(answer).ok).toBe(true);
  });

  it('accepts numeric ids and null optional fields', () => {
    const answer = sampleAnswer() as any;
    answer.records[0].id = 7;
    answer.records[0].item = null;
    answer.records[1].reversesRecordId = null;
    const result = readLedger(answer);
    expect(result.ok && result.ledger.records[0].id).toBe('7');
  });

  it('rejects a float cent value anywhere', () => {
    for (const edit of [
      (a: any) => (a.today.sales = 45.5),
      (a: any) => (a.today.salesCount = 1.5),
      (a: any) => (a.whoOwes[0].owed = 10.25),
      (a: any) => (a.records[0].amount = 4500.5),
      (a: any) => (a.today.spent = Number.MAX_SAFE_INTEGER + 2),
      (a: any) => (a.today.inHand = '940'),
    ]) {
      const answer = sampleAnswer();
      edit(answer);
      expect(readLedger(answer).ok).toBe(false);
    }
  });

  it('rejects an unknown currency', () => {
    const answer = sampleAnswer();
    answer.shop.currency = 'EUR';
    expect(readLedger(answer).ok).toBe(false);
  });

  it('rejects a missing or wrong list', () => {
    for (const key of ['whoOwes', 'records'] as const) {
      const missing = sampleAnswer() as any;
      delete missing[key];
      expect(readLedger(missing).ok).toBe(false);
      const notList = sampleAnswer() as any;
      notList[key] = {};
      expect(readLedger(notList).ok).toBe(false);
    }
  });

  it('rejects a record with an unknown kind or channel, or a bad date', () => {
    const kind = sampleAnswer() as any;
    kind.records[0].kind = 'refund';
    expect(readLedger(kind).ok).toBe(false);
    const channel = sampleAnswer() as any;
    channel.records[0].channel = 'whatsapp';
    expect(readLedger(channel).ok).toBe(false);
    const date = sampleAnswer() as any;
    date.records[0].createdAt = 'not a date';
    expect(readLedger(date).ok).toBe(false);
  });

  it('rejects a missing part and values that are not objects', () => {
    for (const key of ['shop', 'today'] as const) {
      const answer = sampleAnswer() as any;
      delete answer[key];
      expect(readLedger(answer).ok).toBe(false);
    }
    for (const bad of [null, undefined, 'x', 5, [], true]) {
      expect(readLedger(bad).ok).toBe(false);
    }
  });

  it('rejects an owes entry without a name and a time zone that is not text', () => {
    const owes = sampleAnswer() as any;
    owes.whoOwes[0].name = 5;
    expect(readLedger(owes).ok).toBe(false);
    const zone = sampleAnswer() as any;
    zone.shop.timeZone = 2;
    expect(readLedger(zone).ok).toBe(false);
  });
});

describe('sortOwes and splitOwes', () => {
  const list = [
    { name: 'Zodwa', owed: 1000 },
    { name: 'tendai', owed: 5000 },
    { name: 'Anele', owed: 1000 },
    { name: 'Lerato', owed: 9000 },
  ];

  it('puts the largest amount first and breaks ties by name', () => {
    expect(sortOwes(list).map((entry) => entry.name)).toEqual(['Lerato', 'tendai', 'Anele', 'Zodwa']);
  });

  it('breaks ties by name without regard to case', () => {
    const sorted = sortOwes([
      { name: 'bongani', owed: 100 },
      { name: 'Anele', owed: 100 },
    ]);
    expect(sorted.map((entry) => entry.name)).toEqual(['Anele', 'bongani']);
  });

  it('returns a new array and leaves the input alone', () => {
    const before = JSON.stringify(list);
    const sorted = sortOwes(list);
    expect(sorted).not.toBe(list);
    expect(JSON.stringify(list)).toBe(before);
  });

  it('shows six and hides the rest', () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ name: `P${i}`, owed: 100 * (9 - i) }));
    const { shown, hidden } = splitOwes(nine, 6);
    expect(shown).toHaveLength(6);
    expect(hidden.map((entry) => entry.name)).toEqual(['P6', 'P7', 'P8']);
  });

  it('shows everything when there are six or fewer', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, owed: 100 }));
    expect(splitOwes(six, 6)).toEqual({ shown: six, hidden: [] });
    expect(splitOwes([], 6)).toEqual({ shown: [], hidden: [] });
  });

  it('defaults to six', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ name: `P${i}`, owed: 100 }));
    expect(splitOwes(seven).hidden).toHaveLength(1);
  });
});

describe('recordRows', () => {
  const now = Date.parse('2026-11-07T14:00:00Z');
  const zone = 'Africa/Johannesburg';

  const rec = (over: Record<string, unknown>) => ({
    id: 'x',
    kind: 'sale',
    amount: 4500,
    createdAt: '2026-11-07T12:05:00.000Z',
    channel: 'ussd',
    item: '',
    customerDisplayName: '',
    reversesRecordId: '',
    ...over,
  });

  it('uses the owner words for kinds and channels', () => {
    const rows = recordRows(
      [
        rec({ id: 'a', kind: 'sale', channel: 'ussd', createdAt: '2026-11-07T10:01:00Z' }),
        rec({ id: 'b', kind: 'expense', channel: 'sms', createdAt: '2026-11-07T10:02:00Z' }),
        rec({ id: 'c', kind: 'debt', channel: 'web', createdAt: '2026-11-07T10:03:00Z' }),
        rec({ id: 'd', kind: 'payment', channel: 'sms', createdAt: '2026-11-07T10:04:00Z' }),
      ],
      'ZAR',
      zone,
      now,
    );
    expect(rows.map((row) => [row.kindWord, row.channelWord])).toEqual([
      ['Paid', 'Text'],
      ['Owes', 'Web'],
      ['Spent', 'Text'],
      ['Sale', 'Menu'],
    ]);
  });

  it('puts the newest first', () => {
    const rows = recordRows(
      [
        rec({ id: 'old', createdAt: '2026-11-07T08:00:00Z' }),
        rec({ id: 'new', createdAt: '2026-11-07T12:00:00Z' }),
        rec({ id: 'mid', createdAt: '2026-11-07T10:00:00Z' }),
      ],
      'ZAR',
      zone,
      now,
    );
    expect(rows.map((row) => row.id)).toEqual(['new', 'mid', 'old']);
  });

  it('shows amount, detail and time', () => {
    const [row] = recordRows(
      [rec({ kind: 'debt', amount: 2050, customerDisplayName: 'Tendai', item: 'sugar', channel: 'sms' })],
      'ZAR',
      zone,
      now,
    );
    expect(row).toMatchObject({
      kindWord: 'Owes',
      amountText: 'R20.50',
      detail: 'Tendai - sugar',
      channelWord: 'Text',
      timeText: '14:05',
      undone: false,
      isReversal: false,
      cancelsText: '',
    });
  });

  it('uses whichever of customer and item exists, or nothing', () => {
    const rows = recordRows(
      [
        rec({ id: '1', item: 'bread', createdAt: '2026-11-07T10:01:00Z' }),
        rec({ id: '2', customerDisplayName: 'Tendai', createdAt: '2026-11-07T10:02:00Z' }),
        rec({ id: '3', createdAt: '2026-11-07T10:03:00Z' }),
      ],
      'ZAR',
      zone,
      now,
    );
    expect(rows.map((row) => row.detail)).toEqual(['', 'Tendai', 'bread']);
  });

  it('marks a record undone when a reversal points at it, and describes the reversal', () => {
    const rows = recordRows(
      [
        rec({ id: 'r1', kind: 'sale', amount: 4500, item: 'bread', createdAt: '2026-11-07T12:05:00Z' }),
        rec({ id: 'r2', kind: 'reversal', amount: 4500, reversesRecordId: 'r1', createdAt: '2026-11-07T12:06:00Z' }),
        rec({ id: 'r3', kind: 'sale', amount: 1000, createdAt: '2026-11-07T12:07:00Z' }),
      ],
      'ZAR',
      zone,
      now,
    );
    expect(rows.map((row) => row.id)).toEqual(['r3', 'r2', 'r1']);
    expect(rows[2]).toMatchObject({ id: 'r1', undone: true });
    expect(rows[0].undone).toBe(false);
    expect(rows[1]).toMatchObject({
      kindWord: 'Undo',
      isReversal: true,
      amountText: '',
      undone: false,
      cancelsText: 'cancels Sale R45 bread',
    });
  });

  it('says "an earlier record" when the reversal target is outside the list', () => {
    const [row] = recordRows([rec({ id: 'r9', kind: 'reversal', reversesRecordId: 'gone' })], 'ZAR', zone, now);
    expect(row.cancelsText).toBe('cancels an earlier record');
    expect(row.amountText).toBe('');
  });

  it('sorts an Undo before the record it cancels when both have the same time', () => {
    const rows = recordRows(
      [
        rec({ id: 'r1', createdAt: '2026-11-07T12:05:00Z' }),
        rec({ id: 'r2', kind: 'reversal', reversesRecordId: 'r1', createdAt: '2026-11-07T12:05:00Z' }),
      ],
      'ZAR',
      zone,
      now,
    );
    expect(rows.map((row) => row.id)).toEqual(['r2', 'r1']);
  });

  it('shows the date for a record from an earlier day', () => {
    const [row] = recordRows([rec({ createdAt: '2026-11-03T12:05:00Z' })], 'ZAR', zone, now);
    expect(row.timeText).toBe('3 Nov 14:05');
  });

  it('passes a 24-character shop name and a 20-character customer name through unchanged', () => {
    const customer = 'Nomvula Mkhwanazi-Du'; // 20 characters
    expect(customer).toHaveLength(20);
    const [row] = recordRows(
      [rec({ kind: 'debt', amount: 99999999, customerDisplayName: customer, item: 'maize meal 12.5kg' })],
      'ZAR',
      zone,
      now,
    );
    expect(row.detail).toBe(`${customer} - maize meal 12.5kg`);
    expect(row.amountText).toBe('R999,999.99');

    const shopName = 'Thandi and Son Tuck Shop'; // 24 characters
    expect(shopName).toHaveLength(24);
    const answer = sampleAnswer();
    answer.shop.name = shopName;
    const result = readLedger(answer);
    expect(result.ok && result.ledger.shop.name).toBe(shopName);
  });

  it('does not change the records it is given', () => {
    const records = [rec({ id: 'b', createdAt: '2026-11-07T12:00:00Z' }), rec({ id: 'a', createdAt: '2026-11-07T08:00:00Z' })];
    const before = JSON.stringify(records);
    recordRows(records, 'ZAR', zone, now);
    expect(JSON.stringify(records)).toBe(before);
  });
});

describe('demo numbers and export file name', () => {
  it('builds demo numbers in the fiction range', () => {
    expect(demoPhone(0)).toBe('+27000000000');
    expect(demoPhone(7)).toBe('+27000000007');
    expect(demoPhone(1234)).toBe('+27000001234');
    expect(demoPhone(9999)).toBe('+27000009999');
  });

  it('refuses numbers outside 0 to 9999', () => {
    expect(() => demoPhone(-1)).toThrow(RangeError);
    expect(() => demoPhone(10000)).toThrow(RangeError);
    expect(() => demoPhone(1.5)).toThrow(RangeError);
    expect(() => demoPhone(Number.NaN)).toThrow(RangeError);
  });

  it('recognises only demo numbers', () => {
    expect(isDemoPhone('+27000001234')).toBe(true);
    expect(isDemoPhone(demoPhone(0))).toBe(true);
    expect(isDemoPhone(demoPhone(9999))).toBe(true);
    for (const bad of ['', '27000001234', '+27000001234 ', '+2700000123', '+270000012345', '+27821234567', '+27 00 000 1234', 'null', null, undefined, 5]) {
      expect(isDemoPhone(bad)).toBe(false);
    }
  });

  it('writes a demo number as +27 00 000 xxxx', () => {
    expect(displayPhone('+27000001234')).toBe('+27 00 000 1234');
    expect(displayPhone('+27000000000')).toBe('+27 00 000 0000');
    expect(displayPhone('+27821234567')).toBe('+27821234567');
    expect(displayPhone(null)).toBe('');
  });

  it('names the export file with the UTC date', () => {
    expect(exportFileName(Date.parse('2026-11-07T12:05:00Z'))).toBe('imali-ai-export-2026-11-07.json');
    expect(exportFileName(Date.parse('2026-01-02T23:59:59Z'))).toBe('imali-ai-export-2026-01-02.json');
    expect(exportFileName(Date.parse('2026-12-31T00:00:00Z'))).toBe('imali-ai-export-2026-12-31.json');
    expect(() => exportFileName(Number.NaN)).toThrow(RangeError);
  });
});
