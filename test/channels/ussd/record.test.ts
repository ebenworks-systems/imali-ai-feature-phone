import { describe, it, expect, beforeEach } from 'vitest';
import { dial, type Phone } from '../../helpers/phone.js';
import { HINT, NOTICE } from '../../../src/channels/ussd/text.js';
import { MemoryStore } from '../../../src/store/memory/store.js';
import { recordDebt, recordExpense, recordSale, type Record as LedgerRecord, type Shop } from '../../../src/core/index.js';
import { DEMO_PHONE, NOW, seedShop } from '../../helpers/fixtures.js';

let store: MemoryStore;
let shop: Shop;

const amount = (cents: number) => ({ cents, requiresConfirmation: false });
const earlier = { channel: 'sms' as const, originalWords: 'x', now: NOW };

beforeEach(async () => {
  store = new MemoryStore();
  shop = await seedShop(store);
});

const phone = (): Phone => dial({ store, phone: DEMO_PHONE, now: NOW });
const records = (): Promise<LedgerRecord[]> => store.listRecords(shop.id);

/** Press each key in turn and return the last screen. */
async function keys(p: Phone, ...inputs: string[]) {
  let shown = await p.open();
  for (const input of inputs) shown = await p.press(input);
  return shown;
}

describe('sale', () => {
  it('with an item', async () => {
    const p = phone();
    expect((await keys(p, '1')).raw).toBe(`CON Sale amount?\n${HINT}`);
    expect((await p.press('45')).raw).toBe(`CON What was sold? 1 to skip\n${HINT}`);
    expect((await p.press('bread')).raw).toBe(`CON Save sale R45 bread? 1 Yes 2 No\n${HINT}`);
    expect((await p.press('1')).raw).toBe('END Saved: sale R45 bread. Sales today R45.');
    const [record] = await records();
    expect(record).toMatchObject({ kind: 'sale', amount: 4500, item: 'bread', channel: 'ussd' });
  });

  it('without an item', async () => {
    const shown = await keys(phone(), '1', '45', '1', '1');
    expect(shown.raw).toBe('END Saved: sale R45. Sales today R45.');
    const [record] = await records();
    expect(record).toMatchObject({ kind: 'sale', amount: 4500 });
    expect((record as { item?: string }).item).toBeUndefined();
  });

  it('shows the new total with earlier records in the store, not the amount saved', async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(124000) });
    const shown = await keys(phone(), '1', '45', 'bread', '1');
    expect(shown.raw).toBe('END Saved: sale R45 bread. Sales today R1,285.');
  });

  it('keeps cents', async () => {
    const shown = await keys(phone(), '1', '45,50', '1', '1');
    expect(shown.raw).toBe('END Saved: sale R45.50. Sales today R45.50.');
  });

  it('the record keeps the channel ussd and the typed path as its words', async () => {
    await keys(phone(), '1', '45', 'bread', '1');
    const [record] = await records();
    expect(record!.channel).toBe('ussd');
    expect(record!.originalWords).toBe('1*45*bread*1');
    expect(record!.createdAt).toBe(NOW.toISOString());
  });

  it('keeps refused and back inputs in the words, because they are what was typed', async () => {
    await keys(phone(), '1', 'abc', '45', '1', '0', 'milk', '1');
    const [record] = await records();
    expect(record!.originalWords).toBe('1*abc*45*1*0*milk*1');
    expect(record).toMatchObject({ amount: 4500, item: 'milk' });
  });

  it('reads 2 200 as R2,200', async () => {
    const shown = await keys(phone(), '1', '2 200', '1', '1');
    expect(shown.raw).toBe('END Saved: sale R2,200. Sales today R2,200.');
    expect((await records())[0]!.amount).toBe(220000);
  });

  it('2 No saves nothing and shows the main menu with Not saved.', async () => {
    const shown = await keys(phone(), '1', '45', 'bread', '2');
    expect(shown.screen).toBe('main');
    expect(shown.lines[0]).toBe(NOTICE.notSaved);
    expect(await records()).toHaveLength(0);
  });

  it('nothing is saved before the confirm screen', async () => {
    const p = phone();
    await p.open();
    for (const key of ['1', '45', 'bread']) {
      await p.press(key);
      expect(await records()).toHaveLength(0);
    }
  });
});

describe('refused amounts', () => {
  it('zero, a negative number and words show a plain reason and save nothing', async () => {
    for (const [typed, notice] of [
      ['0.00', NOTICE.amountZero],
      ['-5', NOTICE.amountZero],
      ['abc', NOTICE.amountWords],
      ['45 bread', NOTICE.amountWords],
      ['99999999999999', NOTICE.amountBig]
    ] as const) {
      const shown = await keys(phone(), '1', typed);
      expect(shown.screen).toBe('amount');
      expect(shown.lines[0]).toBe(notice);
      expect(shown.end).toBe(false);
    }
    expect(await records()).toHaveLength(0);
  });

  it('the session carries on after a refusal', async () => {
    const p = phone();
    await keys(p, '1', 'abc');
    expect((await p.press('45')).screen).toBe('item');
  });
});

describe('big amounts', () => {
  it('1,500,000 shows the big-amount confirm and saves only after the second 1', async () => {
    const p = phone();
    await keys(p, '1', '1500000', '1');
    const first = await p.press('1');
    expect(first.raw).toBe(`CON That is a big amount: R1,500,000. 1 Yes, save 2 No\n${HINT}`);
    expect(await records()).toHaveLength(0);
    const second = await p.press('1');
    expect(second.raw).toBe('END Saved: sale R1,500,000. Sales today R1,500,000.');
    const [record] = await records();
    expect(record).toMatchObject({ amount: 150000000, channel: 'ussd', originalWords: '1*1500000*1*1*1' });
  });

  it('2 on the big-amount confirm saves nothing', async () => {
    const shown = await keys(phone(), '1', '1500000', '1', '1', '2');
    expect(shown.screen).toBe('main');
    expect(shown.lines[0]).toBe(NOTICE.notSaved);
    expect(await records()).toHaveLength(0);
  });

  it('exactly 1,000,000 needs only one yes', async () => {
    const shown = await keys(phone(), '1', '1000000', '1', '1');
    expect(shown.end).toBe(true);
    expect(await records()).toHaveLength(1);
  });
});

describe('expense', () => {
  it('with an item', async () => {
    const p = phone();
    expect((await keys(p, '2')).raw).toBe(`CON Amount spent?\n${HINT}`);
    expect((await p.press('20')).raw).toBe(`CON What was it for? 1 to skip\n${HINT}`);
    expect((await p.press('taxi')).raw).toBe(`CON Save expense R20 taxi? 1 Yes 2 No\n${HINT}`);
    expect((await p.press('1')).raw).toBe('END Saved: spent R20 taxi. Spent today R20.');
    expect((await records())[0]).toMatchObject({ kind: 'expense', amount: 2000, item: 'taxi', channel: 'ussd' });
  });

  it('shows the new total spent', async () => {
    await recordExpense(store, shop, { ...earlier, amount: amount(28000) });
    expect((await keys(phone(), '2', '20', 'taxi', '1')).raw).toBe('END Saved: spent R20 taxi. Spent today R300.');
  });

  it('without an item', async () => {
    expect((await keys(phone(), '2', '20', '1', '1')).raw).toBe('END Saved: spent R20. Spent today R20.');
  });
});

describe('owes', () => {
  it('asks the name, the amount and the item, and shows the customer total', async () => {
    await recordDebt(store, shop, { ...earlier, amount: amount(3000), customer: 'Tendai' });
    const p = phone();
    expect((await keys(p, '3')).raw).toBe(`CON Customer name?\n${HINT}`);
    expect((await p.press('Tendai')).raw).toBe(`CON How much does Tendai owe?\n${HINT}`);
    expect((await p.press('20')).raw).toBe(`CON What did Tendai take? 1 to skip\n${HINT}`);
    expect((await p.press('sugar')).raw).toBe(`CON Save Tendai owes R20 sugar? 1 Yes 2 No\n${HINT}`);
    expect((await p.press('1')).raw).toBe('END Saved: Tendai owes R20 sugar. Tendai owes R50 in total.');
    const records_ = await records();
    expect(records_[1]).toMatchObject({
      kind: 'debt',
      customerDisplayName: 'Tendai',
      amount: 2000,
      item: 'sugar',
      channel: 'ussd',
      originalWords: '3*Tendai*20*sugar*1'
    });
  });

  it('matches the customer without regard to case and spaces', async () => {
    await recordDebt(store, shop, { ...earlier, amount: amount(3000), customer: 'Tendai' });
    const shown = await keys(phone(), '3', '  tendai ', '20', '1', '1');
    expect(shown.raw).toBe('END Saved: tendai owes R20. tendai owes R50 in total.');
  });

  it('refuses a name with no letter', async () => {
    const shown = await keys(phone(), '3', '45');
    expect(shown.lines[0]).toBe(NOTICE.customerBad);
    expect(shown.screen).toBe('customer');
  });
});

describe('paid back', () => {
  beforeEach(async () => {
    await recordDebt(store, shop, { ...earlier, amount: amount(5000), customer: 'Tendai' });
    await recordDebt(store, shop, { ...earlier, amount: amount(3000), customer: 'Rudo' });
  });

  it('from the list', async () => {
    const p = phone();
    expect((await keys(p, '4')).raw).toBe(`CON Who paid back?\n1 Tendai R50\n2 Rudo R30\n8 Other name\n${HINT}`);
    expect((await p.press('1')).raw).toBe(`CON How much did Tendai pay?\n${HINT}`);
    expect((await p.press('10')).raw).toBe(`CON Save Tendai paid R10? 1 Yes 2 No\n${HINT}`);
    expect((await p.press('1')).raw).toBe('END Saved: Tendai paid R10. Tendai owes R40 now.');
    expect((await records())[2]).toMatchObject({
      kind: 'payment',
      customerDisplayName: 'Tendai',
      amount: 1000,
      channel: 'ussd',
      originalWords: '4*1*10*1'
    });
  });

  it('with Other name', async () => {
    const p = phone();
    await keys(p, '4', '8');
    expect((await p.press('Zodwa')).raw).toBe(`CON How much did Zodwa pay?\n${HINT}`);
    await p.press('10');
    expect((await p.press('1')).raw).toBe('END Saved: Zodwa paid R10. Zodwa has R10 credit now.');
  });

  it('a payment that leaves nothing owed', async () => {
    expect((await keys(phone(), '4', '2', '30', '1')).raw).toBe('END Saved: Rudo paid R30. Rudo owes nothing now.');
  });

  it('a payment that leaves credit', async () => {
    expect((await keys(phone(), '4', '2', '35', '1')).raw).toBe('END Saved: Rudo paid R35. Rudo has R5 credit now.');
  });

  it('when nobody owes, goes straight to the name prompt', async () => {
    const lonely = new MemoryStore();
    await seedShop(lonely);
    const shown = await keys(dial({ store: lonely, phone: DEMO_PHONE, now: NOW }), '4');
    expect(shown.raw).toBe(`CON Customer name?\n${HINT}`);
  });

  it('2 No saves nothing', async () => {
    const shown = await keys(phone(), '4', '1', '10', '2');
    expect(shown.lines[0]).toBe(NOTICE.notSaved);
    expect(await records()).toHaveLength(2);
  });

  describe('with so many customers that the list has a second page', () => {
    beforeEach(async () => {
      for (let i = 1; i <= 9; i += 1) {
        await recordDebt(store, shop, {
          ...earlier,
          amount: amount((1000 - i) * 100),
          customer: `Longname Customer 0${i}`
        });
      }
    });

    it('9 More shows the next page and a row there picks that customer', async () => {
      const p = phone();
      const first = await keys(p, '4');
      expect(first.lines).toContain('9 More');
      expect(first.lines).not.toContain('2 Rudo R30');
      const second = await p.press('9');
      expect(second.screen).toBe('payWho');
      expect(second.lines[0]).toBe('Who paid back?');
      // the first row of page 2 is the next customer in the order
      const row = second.lines[1]!;
      const customer = row.replace(/^1 /, '').replace(/ R[\d,.]+$/, '');
      const amountScreen = await p.press('1');
      expect(amountScreen.lines[0]).toBe(`How much did ${customer} pay?`);
      await p.press('10');
      expect((await p.press('1')).raw).toContain(`Saved: ${customer} paid R10.`);
    });

    it('a row from page 2 saves for the right customer', async () => {
      const p = phone();
      await keys(p, '4', '9');
      await p.press('1');
      await p.press('1');
      await p.press('1');
      const all = await records();
      const payment = all[all.length - 1] as LedgerRecord & { customerDisplayName: string };
      expect(payment.kind).toBe('payment');
      expect(payment.originalWords).toBe('4*9*1*1*1');
      expect(['Rudo', 'Tendai'].includes(payment.customerDisplayName)).toBe(false);
    });
  });
});

describe('the hint on the confirm screens', () => {
  it('ends the confirm screen of each kind, and the END Saved screen has none', async () => {
    await recordDebt(store, shop, { ...earlier, amount: amount(5000), customer: 'Tendai' });
    const flows: string[][] = [
      ['1', '45', 'bread'],
      ['2', '20', 'taxi'],
      ['3', 'Tendai', '20', 'sugar'],
      ['4', '1', '10']
    ];
    for (const flow of flows) {
      const p = phone();
      const confirm = await keys(p, ...flow);
      expect(confirm.screen).toBe('confirm');
      expect(confirm.raw.endsWith(`\n${HINT}`)).toBe(true);
      const saved = await p.press('1');
      expect(saved.raw.startsWith('END Saved: ')).toBe(true);
      expect(saved.raw).not.toContain('0 Back');
    }
  });
});
