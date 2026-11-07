import { describe, it, expect, beforeEach } from 'vitest';
import { handleUssd } from '../../../src/channels/ussd/handler.js';
import { recordIdFor } from '../../../src/channels/ussd/ids.js';
import { dial, type Phone } from '../../helpers/phone.js';
import { MemoryStore } from '../../../src/store/memory/store.js';
import { createSaleRecord, recordDebt, recordSale, type Shop } from '../../../src/core/index.js';
import { DEMO_PHONE, NOW, seedShop } from '../../helpers/fixtures.js';

let store: MemoryStore;
let shop: Shop;

const amount = (cents: number) => ({ cents, requiresConfirmation: false });
const earlier = { channel: 'sms' as const, originalWords: 'x', now: NOW };

beforeEach(async () => {
  store = new MemoryStore();
  shop = await seedShop(store);
  await recordDebt(store, shop, { ...earlier, amount: amount(5000), customer: 'Tendai' });
});

const count = async (): Promise<number> => (await store.listRecords(shop.id)).length;
const phone = (sessionId?: string): Phone => dial({ store, phone: DEMO_PHONE, now: NOW, sessionId });

async function keys(p: Phone, ...inputs: string[]) {
  let shown = await p.open();
  for (const input of inputs) shown = await p.press(input);
  return shown;
}

/** The request the network sends for a path. */
const request = (text: string, sessionId: string) => ({
  sessionId,
  serviceCode: '*384*1234#',
  phoneNumber: DEMO_PHONE,
  text,
  now: NOW,
  store
});

const KINDS: Array<[string, string[], string]> = [
  ['sale', ['1', '45', 'bread', '1'], 'END Saved: sale R45 bread. Sales today R45.'],
  ['expense', ['2', '20', 'taxi', '1'], 'END Saved: spent R20 taxi. Spent today R20.'],
  ['owes', ['3', 'Tendai', '20', 'sugar', '1'], 'END Saved: Tendai owes R20 sugar. Tendai owes R70 in total.'],
  ['paid back', ['4', '1', '10', '1'], 'END Saved: Tendai paid R10. Tendai owes R40 now.']
];

describe('a repeated saving request', () => {
  for (const [kind, flow, expected] of KINDS) {
    it(`${kind}: resend() returns the same Saved screen and the store holds one record`, async () => {
      const p = phone();
      const saved = await keys(p, ...flow);
      expect(saved.raw).toBe(expected);
      expect(await count()).toBe(2);
      const again = await p.resend();
      expect(again.raw).toBe(expected);
      const third = await p.resend();
      expect(third.raw).toBe(expected);
      expect(await count()).toBe(2);
    });

    it(`${kind}: two identical requests at the same time leave one record`, async () => {
      const text = flow.join('*');
      const [a, b, c] = await Promise.all([
        handleUssd(request(text, 'S_DOUBLE')),
        handleUssd(request(text, 'S_DOUBLE')),
        handleUssd(request(text, 'S_DOUBLE'))
      ]);
      expect(a.response).toBe(expected);
      expect(b.response).toBe(expected);
      expect(c.response).toBe(expected);
      expect(await count()).toBe(2);
    });
  }

  it('the big-amount path: resend() after the second 1 returns the same screen and holds one record', async () => {
    const p = phone();
    const saved = await keys(p, '1', '1500000', '1', '1', '1');
    expect(saved.raw).toBe('END Saved: sale R1,500,000. Sales today R1,500,000.');
    const again = await p.resend();
    expect(again.raw).toBe(saved.raw);
    expect(await count()).toBe(2);
  });

  it('the big-amount path: two at the same time leave one record', async () => {
    const text = '1*1500000*1*1*1';
    const [a, b] = await Promise.all([handleUssd(request(text, 'S_BIG')), handleUssd(request(text, 'S_BIG'))]);
    expect(a.response).toBe(b.response);
    expect(a.response.startsWith('END Saved: sale R1,500,000.')).toBe(true);
    expect(await count()).toBe(2);
  });

  it('a repeat of the first confirming 1 on a big amount does not save, because that screen asks again', async () => {
    const p = phone();
    const asked = await keys(p, '1', '1500000', '1', '1');
    expect(asked.screen).toBe('confirmBig');
    expect((await p.resend()).screen).toBe('confirmBig');
    expect(await count()).toBe(1);
  });

  it('the id is the same on a repeat: rec_ussd_<sessionId>_<step>', async () => {
    const p = phone('S_ID');
    await keys(p, '1', '45', '1', '1');
    await p.resend();
    expect(await store.findRecordById(recordIdFor('S_ID', 4))).toMatchObject({ kind: 'sale', amount: 4500 });
    expect((await store.listRecords(shop.id)).map((r) => r.id).filter((id) => id.startsWith('rec_ussd_'))).toEqual([
      'rec_ussd_S_ID_4'
    ]);
  });

  it('the figure on a repeat is read when the repeat arrives, and the record is still saved once', async () => {
    const p = phone();
    const first = await keys(p, '1', '45', '1', '1');
    expect(first.raw).toBe('END Saved: sale R45. Sales today R45.');
    await recordSale(store, shop, { ...earlier, amount: amount(1000) });
    const again = await p.resend();
    expect(again.raw).toBe('END Saved: sale R45. Sales today R55.');
    expect(await count()).toBe(3);
  });

  it('two different sessions with the same keys make two records', async () => {
    const a = await keys(phone('S_ONE'), '1', '45', '1', '1');
    const b = await keys(phone('S_TWO'), '1', '45', '1', '1');
    expect(a.raw).toBe('END Saved: sale R45. Sales today R45.');
    expect(b.raw).toBe('END Saved: sale R45. Sales today R90.');
    expect(await count()).toBe(3);
  });

  it('a reused sessionId with a different path (a different step) makes a second record', async () => {
    await keys(phone('S_SAME'), '1', '45', '1', '1');
    const other = await handleUssd(request('1*45*bread*1', 'S_SAME')); // also step 4
    expect(other.response).toBe('END Sorry, that was not saved. Please try again.'); // same id, different record
    const longer = await handleUssd(request('1*abc*45*1*1', 'S_SAME')); // step 5
    expect(longer.response).toBe('END Saved: sale R45. Sales today R90.');
    expect(await count()).toBe(3);
  });

  it('a record that holds the id but has another amount gives the save-failed screen and adds nothing', async () => {
    await store.appendRecord(
      createSaleRecord(shop.id, { id: recordIdFor('S_CLASH', 4), amount: 9900, channel: 'ussd', originalWords: 'x', now: NOW })
    );
    const before = await count();
    const shown = await keys(phone('S_CLASH'), '1', '45', '1', '1');
    expect(shown.raw).toBe('END Sorry, that was not saved. Please try again.');
    expect(shown.screen).toBe('saveFailed');
    expect(await count()).toBe(before);
  });

  it('keeps nothing in memory: a repeat on a brand-new store object with the same records gives the same screen', async () => {
    const p = phone('S_STATELESS');
    const saved = await keys(p, '1', '45', '1', '1');
    const clone = new MemoryStore();
    for (const s of [shop]) await clone.createShop(s);
    for (const r of await store.listRecords(shop.id)) await clone.appendRecord(r);
    const again = await handleUssd({ ...request('1*45*1*1', 'S_STATELESS'), store: clone });
    expect(again.response).toBe(saved.raw);
    expect((await clone.listRecords(shop.id)).length).toBe(await count());
  });
});

describe('a repeated undo request', () => {
  beforeEach(async () => {
    await recordSale(store, shop, { ...earlier, amount: amount(1000), item: 'older' });
    await recordSale(store, shop, { ...earlier, amount: amount(2000), item: 'newer' });
  });

  const reversals = async () => (await store.listRecords(shop.id)).filter((r) => r.kind === 'reversal');

  it('resend() returns the same Undone screen and adds one reversal', async () => {
    const p = phone();
    const done = await keys(p, '7', '1');
    expect(done.raw).toBe('END Undone: sale R20 newer. Sales today R10.');
    expect((await p.resend()).raw).toBe(done.raw);
    expect((await p.resend()).raw).toBe(done.raw);
    expect(await reversals()).toHaveLength(1);
  });

  it('a repeat does not reverse the older record', async () => {
    const p = phone();
    await keys(p, '7', '1');
    await p.resend();
    const all = await store.listRecords(shop.id);
    const older = all.find((r) => r.kind === 'sale' && r.item === 'older')!;
    expect(await store.findReversalOf(older.id)).toBeNull();
  });

  it('two at the same time add one reversal, with two records in the store', async () => {
    const [a, b, c] = await Promise.all([
      handleUssd(request('7*1', 'S_UNDO')),
      handleUssd(request('7*1', 'S_UNDO')),
      handleUssd(request('7*1', 'S_UNDO'))
    ]);
    expect(a.response).toBe('END Undone: sale R20 newer. Sales today R10.');
    expect(b.response).toBe(a.response);
    expect(c.response).toBe(a.response);
    expect(await reversals()).toHaveLength(1);
  });

  it('two at the same time with one record add one reversal and never say there was nothing to undo', async () => {
    const lone = new MemoryStore();
    const loneShop = await seedShop(lone, { phone: '+27000002222' });
    await recordSale(lone, loneShop, { ...earlier, amount: amount(1000) });
    const req = { ...request('7*1', 'S_LONE'), store: lone, phoneNumber: '+27000002222' };
    const [a, b] = await Promise.all([handleUssd(req), handleUssd(req)]);
    expect(a.response).toBe('END Undone: sale R10. Sales today R0.');
    expect(b.response).toBe(a.response);
    expect((await lone.listRecords(loneShop.id)).filter((r) => r.kind === 'reversal')).toHaveLength(1);
  });

  it('two different sessions undo two records', async () => {
    await keys(phone('S_U1'), '7', '1');
    const second = await keys(phone('S_U2'), '7', '1');
    expect(second.raw).toBe('END Undone: sale R10 older. Sales today R0.');
    expect(await reversals()).toHaveLength(2);
  });

  it('a third session finds nothing left to undo, apart from the debt that was there first', async () => {
    await keys(phone('S_U1'), '7', '1');
    await keys(phone('S_U2'), '7', '1');
    const third = await keys(phone('S_U3'), '7', '1');
    expect(third.raw).toBe('END Undone: Tendai owes R50. Tendai owes nothing now.');
    const fourth = await keys(phone('S_U4'), '7');
    expect(fourth.raw).toBe('END Nothing to undo.');
  });

  it('a repeated undo after another channel added a record does not undo the new record', async () => {
    const p = phone();
    const done = await keys(p, '7', '1');
    await recordSale(store, shop, { ...earlier, amount: amount(500), item: 'newest' });
    const again = await p.resend();
    expect(again.raw.startsWith('END Undone: sale R20 newer.')).toBe(true);
    expect(again.raw).not.toBe(done.raw); // the figure moved with the new sale
    expect(await reversals()).toHaveLength(1);
    const newest = (await store.listRecords(shop.id)).find((r) => r.kind === 'sale' && r.item === 'newest')!;
    expect(await store.findReversalOf(newest.id)).toBeNull();
  });
});
