import { describe, it, expect, beforeEach } from 'vitest';
import { dial, type Phone } from '../../helpers/phone.js';
import { HINT, NOTICE } from '../../../src/channels/ussd/text.js';
import { MemoryStore } from '../../../src/store/memory/store.js';
import {
  recordDebt,
  recordExpense,
  recordPayment,
  recordSale,
  type Currency,
  type Shop
} from '../../../src/core/index.js';
import { DEMO_PHONE, NOW, seedShop } from '../../helpers/fixtures.js';

let store: MemoryStore;
let shop: Shop;

const amount = (cents: number) => ({ cents, requiresConfirmation: false });
const at = (iso: string) => ({ channel: 'sms' as const, originalWords: 'x', now: new Date(iso) });
const earlier = at(NOW.toISOString());

beforeEach(async () => {
  store = new MemoryStore();
  shop = await seedShop(store);
});

const phone = (now = NOW): Phone => dial({ store, phone: DEMO_PHONE, now });
async function keys(p: Phone, ...inputs: string[]) {
  let shown = await p.open();
  for (const input of inputs) shown = await p.press(input);
  return shown;
}

describe('5 Today', () => {
  it('on a quiet day', async () => {
    expect((await keys(phone(), '5')).raw).toBe('END Today\nSales R0 (0)\nSpent R0\nIn hand R0');
  });

  it('with records', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(100000) });
    await recordSale(store, shop, { ...earlier, amount: amount(24000) });
    await recordExpense(store, shop, { ...earlier, amount: amount(30000) });
    expect((await keys(phone(), '5')).raw).toBe('END Today\nSales R1,240 (2)\nSpent R300\nIn hand R940');
  });

  it('counts a payment received in money in hand', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(10000) });
    await recordDebt(store, shop, { ...earlier, amount: amount(5000), customer: 'Tendai' });
    await recordPayment(store, shop, { ...earlier, amount: amount(2000), customer: 'Tendai' });
    expect((await keys(phone(), '5')).raw).toBe('END Today\nSales R100 (1)\nSpent R0\nIn hand R120');
  });

  it('a negative in hand reads -R60, not R-60', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(10000) });
    await recordExpense(store, shop, { ...earlier, amount: amount(16000) });
    const shown = await keys(phone(), '5');
    expect(shown.raw).toBe('END Today\nSales R100 (1)\nSpent R160\nIn hand -R60');
  });

  it('leaves out a record from just before local midnight', async () => {
    // 21:59:59 UTC on 3 Nov is 23:59:59 in Johannesburg; "now" is 00:00:10 on 4 Nov there.
    // (The first seconds of a day are left alone: the core finds the start of a day to the nearest second.)
    await recordSale(store, shop, { ...at('2025-11-03T21:59:59.000Z'), amount: amount(4500) });
    await recordSale(store, shop, { ...at('2025-11-03T22:00:05.000Z'), amount: amount(1000) });
    const now = new Date('2025-11-03T22:00:10.000Z');
    expect((await keys(phone(now), '5')).raw).toBe('END Today\nSales R10 (1)\nSpent R0\nIn hand R10');
    // and a minute earlier it is still the 3rd: only the first sale counts
    const before = new Date('2025-11-03T21:59:59.500Z');
    expect((await keys(phone(before), '5')).raw).toBe('END Today\nSales R45 (1)\nSpent R0\nIn hand R45');
  });

  it('leaves out a reversed sale', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(4500) });
    const p = phone();
    await keys(p, '7', '1');
    expect((await keys(phone(), '5')).raw).toBe('END Today\nSales R0 (0)\nSpent R0\nIn hand R0');
  });

  it('the main screen shows the same sales figure', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(124000) });
    expect((await phone().open()).lines[1]).toBe('Today: sales R1,240');
  });
});

describe('6 Who owes', () => {
  it('with nobody', async () => {
    expect((await keys(phone(), '6')).raw).toBe('END Nobody owes you money.');
  });

  it('with one page, largest first, ending the session', async () => {
    await recordDebt(store, shop, { ...earlier, amount: amount(3000), customer: 'Rudo' });
    await recordDebt(store, shop, { ...earlier, amount: amount(5000), customer: 'Tendai' });
    const shown = await keys(phone(), '6');
    expect(shown.raw).toBe('END Owed to you: R80\nTendai R50\nRudo R30');
    expect(shown.end).toBe(true);
  });

  it('leaves out customers who paid in full or hold credit', async () => {
    await recordDebt(store, shop, { ...earlier, amount: amount(3000), customer: 'Rudo' });
    await recordPayment(store, shop, { ...earlier, amount: amount(3000), customer: 'Rudo' });
    await recordPayment(store, shop, { ...earlier, amount: amount(500), customer: 'Zodwa' });
    expect((await keys(phone(), '6')).raw).toBe('END Nobody owes you money.');
  });

  describe('with three pages (GHS, 20-character names)', () => {
    beforeEach(async () => {
      store = new MemoryStore();
      shop = await seedShop(store, { currency: 'GHS' });
      for (let i = 1; i <= 7; i += 1) {
        await recordDebt(store, shop, {
          ...earlier,
          amount: amount(99999999 - i),
          customer: `Longname Customer 0${i}`
        });
      }
    });

    it('6, 6*9 and 6*9*9 show page 1, page 2 and the last page', async () => {
      const p = phone();
      const one = await keys(p, '6');
      expect(one.screen).toBe('owesList');
      expect(one.end).toBe(false);
      expect(one.lines[0]).toBe('Owed to you: GHS6,999,999.65');
      expect(one.lines.slice(1, 4)).toEqual([
        'Longname Customer 01 GHS999,999.98',
        'Longname Customer 02 GHS999,999.97',
        'Longname Customer 03 GHS999,999.96'
      ]);
      expect(one.lines[4]).toBe('9 More');

      const two = await p.press('9');
      expect(two.screen).toBe('owesList');
      expect(two.end).toBe(false);
      expect(two.lines.slice(1, 4)).toEqual([
        'Longname Customer 04 GHS999,999.95',
        'Longname Customer 05 GHS999,999.94',
        'Longname Customer 06 GHS999,999.93'
      ]);
      expect(two.lines[4]).toBe('9 More');

      const three = await p.press('9');
      expect(three.screen).toBe('owesEnd');
      expect(three.end).toBe(true);
      expect(three.lines.slice(1)).toEqual(['Longname Customer 07 GHS999,999.92']);
      expect(three.raw).not.toContain('9 More');
    });

    it('shows the same total on every page', async () => {
      const p = phone();
      const one = await keys(p, '6');
      const two = await p.press('9');
      const three = await p.press('9');
      expect(two.lines[0]).toBe(one.lines[0]);
      expect(three.lines[0]).toBe(one.lines[0]);
      expect(one.lines[0]).toBe('Owed to you: GHS6,999,999.65');
    });

    it('the pages do not move when a notice shows', async () => {
      const p = phone();
      await keys(p, '6');
      const withNotice = await p.press('x');
      expect(withNotice.lines[0]).toBe(NOTICE.choose);
      expect(withNotice.lines.slice(2, 5)).toEqual([
        'Longname Customer 01 GHS999,999.98',
        'Longname Customer 02 GHS999,999.97',
        'Longname Customer 03 GHS999,999.96'
      ]);
    });

    it('0 goes back a page', async () => {
      const p = phone();
      await keys(p, '6', '9');
      const back = await p.press('0');
      expect(back.lines[1]).toBe('Longname Customer 01 GHS999,999.98');
    });

    it('the CON list screens carry the hint when it fits, and the last one does not', async () => {
      const p = phone();
      const one = await keys(p, '6');
      // with the longest data the first page leaves no room for the hint
      expect(one.raw.length - 4).toBeLessThanOrEqual(182);
      const last = await keys(phone(), '6', '9', '9');
      expect(last.raw).not.toContain(HINT);
    });
  });
});

describe('7 Undo last', () => {
  it('undoes a sale and shows the record and the new figure', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(120000) });
    await recordSale(store, shop, { ...earlier, amount: amount(4500), item: 'bread' });
    const p = phone();
    expect((await keys(p, '7')).raw).toBe(`CON Undo sale R45 bread? 1 Yes 2 No\n${HINT}`);
    expect((await p.press('1')).raw).toBe('END Undone: sale R45 bread. Sales today R1,200.');
    const all = await store.listRecords(shop.id);
    expect(all).toHaveLength(3);
    expect(all[2]).toMatchObject({ kind: 'reversal', channel: 'ussd', originalWords: '7*1' });
  });

  it('undoes an expense', async () => {
    await recordExpense(store, shop, { ...earlier, amount: amount(28000) });
    await recordExpense(store, shop, { ...earlier, amount: amount(2000), item: 'taxi' });
    const p = phone();
    expect((await keys(p, '7')).raw).toBe(`CON Undo spent R20 taxi? 1 Yes 2 No\n${HINT}`);
    expect((await p.press('1')).raw).toBe('END Undone: spent R20 taxi. Spent today R280.');
  });

  it('undoes an owes entry', async () => {
    await recordDebt(store, shop, { ...earlier, amount: amount(3000), customer: 'Tendai' });
    await recordDebt(store, shop, { ...earlier, amount: amount(2000), customer: 'Tendai', item: 'sugar' });
    const p = phone();
    expect((await keys(p, '7')).raw).toBe(`CON Undo Tendai owes R20 sugar? 1 Yes 2 No\n${HINT}`);
    expect((await p.press('1')).raw).toBe('END Undone: Tendai owes R20 sugar. Tendai owes R30 now.');
  });

  it('undoes a payment', async () => {
    await recordDebt(store, shop, { ...earlier, amount: amount(6000), customer: 'Tendai' });
    await recordPayment(store, shop, { ...earlier, amount: amount(1000), customer: 'Tendai' });
    const p = phone();
    expect((await keys(p, '7')).raw).toBe(`CON Undo Tendai paid R10? 1 Yes 2 No\n${HINT}`);
    expect((await p.press('1')).raw).toBe('END Undone: Tendai paid R10. Tendai owes R60 now.');
  });

  it('says what has no credit or owes nothing after the undo', async () => {
    await recordDebt(store, shop, { ...earlier, amount: amount(2000), customer: 'Tendai' });
    expect((await keys(phone(), '7', '1')).raw).toBe('END Undone: Tendai owes R20. Tendai owes nothing now.');
  });

  it('says there is nothing to undo', async () => {
    expect((await keys(phone(), '7')).raw).toBe('END Nothing to undo.');
  });

  it('says there is nothing to undo once everything is undone, and never undoes a reversal', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(4500) });
    await keys(phone(), '7', '1');
    expect((await keys(phone(), '7')).raw).toBe('END Nothing to undo.');
    expect((await store.listRecords(shop.id)).filter((r) => r.kind === 'reversal')).toHaveLength(1);
  });

  it('7*2 shows the main menu with Not undone. and undoes nothing', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(4500) });
    const shown = await keys(phone(), '7', '2');
    expect(shown.screen).toBe('main');
    expect(shown.lines[0]).toBe(NOTICE.notUndone);
    expect(await store.listRecords(shop.id)).toHaveLength(1);
  });

  it('undoes the record from another channel', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(4500), item: 'bread' });
    expect((await keys(phone(), '7', '1')).raw).toBe('END Undone: sale R45 bread. Sales today R0.');
  });

  it('names the record that was really undone, which is the record shown in the confirm screen', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(1000), item: 'older' });
    await recordSale(store, shop, { ...earlier, amount: amount(2000), item: 'newer' });
    const p = phone();
    const confirm = await keys(p, '7');
    expect(confirm.lines[0]).toBe('Undo sale R20 newer? 1 Yes 2 No');
    const done = await p.press('1');
    expect(done.raw).toBe('END Undone: sale R20 newer. Sales today R10.');
  });

  it('if another channel adds a record between the preview and the yes, the Undone screen names the record really undone', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(1000), item: 'older' });
    const p = phone();
    const confirm = await keys(p, '7');
    expect(confirm.lines[0]).toBe('Undo sale R10 older? 1 Yes 2 No');
    await recordSale(store, shop, { ...earlier, amount: amount(2000), item: 'newer' });
    const done = await p.press('1');
    expect(done.raw).toBe('END Undone: sale R20 newer. Sales today R10.');
  });
});

describe('8 Close day', () => {
  it('on a quiet day', async () => {
    expect((await keys(phone(), '8')).raw).toBe(
      'END Close Mon 3 Nov\nSales R0 (0)\nSpent R0\nIn hand R0\nCredit given R0\nPaid back R0\nTotal owed R0'
    );
  });

  it('with a day of records', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(100000) });
    await recordSale(store, shop, { ...earlier, amount: amount(24000) });
    await recordExpense(store, shop, { ...earlier, amount: amount(30000) });
    await recordDebt(store, shop, { ...earlier, amount: amount(7000), customer: 'Tendai' });
    await recordDebt(store, shop, { ...at('2025-11-02T10:00:00.000Z'), amount: amount(35000), customer: 'Rudo' });
    await recordPayment(store, shop, { ...earlier, amount: amount(4000), customer: 'Tendai' });
    expect((await keys(phone(), '8')).raw).toBe(
      [
        'END Close Mon 3 Nov',
        'Sales R1,240 (2)',
        'Spent R300',
        'In hand R980',
        'Credit given R70',
        'Paid back R40',
        'Total owed R380'
      ].join('\n')
    );
  });

  it('in a shop whose time zone is not Johannesburg', async () => {
    const lagos = new MemoryStore();
    const lagosShop = await seedShop(lagos, { currency: 'NGN', timeZone: 'Africa/Lagos', phone: '+27000007777' });
    // 22:30 UTC on 3 Nov is 23:30 in Lagos (still the 3rd) and 00:30 on the 4th in Johannesburg.
    const now = new Date('2025-11-03T22:30:00.000Z');
    await recordSale(lagos, lagosShop, { ...at('2025-11-03T21:30:00.000Z'), amount: amount(500000) });
    const shown = await keys(dial({ store: lagos, phone: '+27000007777', now }), '8');
    expect(shown.raw).toBe(
      'END Close Mon 3 Nov\nSales N5,000 (1)\nSpent N0\nIn hand N5,000\nCredit given N0\nPaid back N0\nTotal owed N0'
    );
    // the same moment in Johannesburg is already the next day, and the sale is not today's
    const jozi = new MemoryStore();
    const joziShop = await seedShop(jozi, { phone: '+27000008888' });
    await recordSale(jozi, joziShop, { ...at('2025-11-03T21:30:00.000Z'), amount: amount(500000) });
    const other = await keys(dial({ store: jozi, phone: '+27000008888', now }), '8');
    expect(other.lines[0]).toBe('Close Tue 4 Nov');
    expect(other.lines[1]).toBe('Sales R0 (0)');
  });

  it('shows a negative in hand as -R60', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(10000) });
    await recordExpense(store, shop, { ...earlier, amount: amount(16000) });
    expect((await keys(phone(), '8')).raw).toContain('In hand -R60');
  });

  it('works in every currency', async () => {
    const currencies: Array<[Currency, string]> = [
      ['ZAR', 'R'],
      ['USD', '$'],
      ['KES', 'KSh'],
      ['NGN', 'N'],
      ['GHS', 'GHS'],
      ['ZMW', 'K'],
      ['BWP', 'P']
    ];
    for (const [currency, symbol] of currencies) {
      const s = new MemoryStore();
      const sh = await seedShop(s, { currency });
      await recordSale(s, sh, { ...earlier, amount: amount(4500) });
      const shown = await keys(dial({ store: s, phone: DEMO_PHONE, now: NOW }), '8');
      expect(shown.lines[1]).toBe(`Sales ${symbol}45 (1)`);
    }
  });
});
