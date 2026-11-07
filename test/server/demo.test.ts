import { describe, expect, it } from 'vitest';
import {
  activeRecords,
  getShopLocalDate,
  getTodaySummary,
  getWhoOwes,
  type Record as LedgerRecord
} from '../../src/core/index.js';
import { DEMO_SHOP_NAME, buildDemoRecords, buildDemoShop } from '../../src/server/demo.js';
import { MemoryStore } from '../../src/store/memory/store.js';

const PHONE = '+27000001234';
// 2026-11-07 in Johannesburg (UTC+2, no daylight saving).
const local = (hhmm: string) => new Date(`2026-11-07T${hhmm}:00+02:00`);

describe('buildDemoShop', () => {
  it('is the invented shop: ZAR, Johannesburg, the number given, a name of at most 24 characters', () => {
    const shop = buildDemoShop(PHONE, local('12:00'));
    expect(shop).toMatchObject({ name: "Thandi's Spaza", phone: PHONE, currency: 'ZAR', timeZone: 'Africa/Johannesburg' });
    expect(DEMO_SHOP_NAME.length).toBeLessThanOrEqual(24);
  });

  it('is created at the time of the oldest record', () => {
    const now = local('12:00');
    const shop = buildDemoShop(PHONE, now);
    const records = buildDemoRecords(shop, now);
    expect(shop.createdAt).toBe(records[0]!.createdAt);
  });
});

describe('buildDemoRecords', () => {
  const now = local('12:00');
  const shop = buildDemoShop(PHONE, now);
  const records = buildDemoRecords(shop, now);

  it('makes 17 records for the shop, with unique ids', () => {
    expect(records).toHaveLength(17);
    expect(new Set(records.map((r) => r.id)).size).toBe(17);
    expect(records.every((r) => r.shopId === shop.id)).toBe(true);
  });

  it('keeps time order and puts none after now', () => {
    const times = records.map((r) => Date.parse(r.createdAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(Math.max(...times)).toBeLessThanOrEqual(now.getTime());
  });

  it.each(['00:05', '12:00', '23:59'])('puts today\'s six records on today\'s local date when it is %s', (hhmm) => {
    const at = local(hhmm);
    const s = buildDemoShop(PHONE, at);
    const rs = buildDemoRecords(s, at);
    const today = getShopLocalDate(s, at);
    expect(today).toBe('2026-11-07');
    const dates = rs.map((r) => getShopLocalDate(s, new Date(r.createdAt)));
    expect(dates.slice(0, 4)).toEqual(Array(4).fill('2026-11-05'));
    expect(dates.slice(4, 11)).toEqual(Array(7).fill('2026-11-06'));
    expect(dates.slice(11)).toEqual(Array(6).fill(today));
    const times = rs.map((r) => Date.parse(r.createdAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(Math.max(...times)).toBeLessThanOrEqual(at.getTime());
  });

  it('puts the earlier records at the local clock times of the table', () => {
    const hhmm = (r: LedgerRecord) =>
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false }).format(
        new Date(r.createdAt)
      );
    expect(records.slice(0, 11).map(hhmm)).toEqual([
      '09:10', '11:30', '13:00', '15:45', '08:20', '10:05', '12:40', '14:15', '16:00', '16:01', '17:10'
    ]);
  });

  it('has the kinds, amounts and words of the table', () => {
    const summary = records.map((r) => [r.kind, r.amount, r.originalWords]);
    expect(summary).toEqual([
      ['sale', 12000, 'sold 4 bread 120'],
      ['sale', 8500, 'sold airtime 85'],
      ['expense', 20000, 'spent 200 stock'],
      ['debt', 3000, 'Tendai owes 30 sugar'],
      ['sale', 9600, 'sold 3 bread 96'],
      ['sale', 15500, 'sold drinks 155'],
      ['debt', 4500, 'Rudo owes 45 paraffin'],
      ['payment', 1000, 'Tendai paid 10'],
      ['sale', 99900, 'sold 999 bread'],
      ['reversal', 0, 'undo'],
      ['expense', 6000, 'spent 60 transport'],
      ['sale', 4500, 'sold 3 bread 45'],
      ['sale', 12000, 'sold drinks 120'],
      ['expense', 2000, 'spent 20 transport'],
      ['debt', 2500, 'Sipho owes 25 bread'],
      ['payment', 1500, 'Rudo paid 15'],
      ['sale', 3000, 'sold sweets 30']
    ]);
  });

  it('has one reversal, pointing at the R999 slip', () => {
    const reversal = records.find((r) => r.kind === 'reversal')!;
    const slip = records.find((r) => r.amount === 99900)!;
    expect(reversal).toMatchObject({ reversesRecordId: slip.id });
    expect(activeRecords(records).active.some((r) => r.id === slip.id)).toBe(false);
  });

  it('leaves Tendai owing R20, Rudo R30, Sipho R25 and today\'s sales R195 (3 sales) after the reversal', async () => {
    const store = new MemoryStore();
    await store.createShop(shop);
    for (const r of records) await store.appendRecord(r);
    const owes = await getWhoOwes(store, shop);
    expect(Object.fromEntries(owes.map((c) => [c.displayName, c.balance]))).toEqual({ Tendai: 2000, Rudo: 3000, Sipho: 2500 });
    const today = await getTodaySummary(store, shop, now);
    expect(today.sales).toEqual({ total: 19500, count: 3 });
  });

  it('uses only invented names, an invented shop, and no real-looking number', () => {
    const text = JSON.stringify([shop, records]);
    expect(text).toContain('Thandi');
    expect(text).not.toMatch(/\+27[1-9]\d{8}/);
    expect(shop.phone).toMatch(/^\+2700000\d{4}$/);
  });

  it('uses the sms channel and plain ASCII words', () => {
    expect(records.every((r) => r.channel === 'sms')).toBe(true);
    expect(records.every((r) => /^[\x20-\x7e]+$/.test(r.originalWords))).toBe(true);
  });
});
