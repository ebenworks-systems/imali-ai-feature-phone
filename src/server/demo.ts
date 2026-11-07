/**
 * The invented records of a demo shop. Pure: no I/O, no clock (the time is passed in).
 *
 * "Thandi's Spaza" is an invented shop with invented customers. Records are spread over today and the two days before
 * it in the shop's time zone, in time order, none later than `now`. Earlier days use fixed local clock times; today's
 * records sit at fractions of the time since local midnight, so they fall on today whatever the hour.
 */

import {
  createShop,
  getShopDayBounds,
  getShopLocalDate,
  type Record as LedgerRecord,
  type Shop
} from '../core/index.js';
import {
  createDebtRecord,
  createExpenseRecord,
  createPaymentRecord,
  createReversal,
  createSaleRecord
} from '../core/records/types.js';

export const DEMO_SHOP_NAME = "Thandi's Spaza";
const DEMO_TIME_ZONE = 'Africa/Johannesburg'; // no daylight saving, so a day is 24 hours

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const DAY = 24 * HOUR;

/** The invented shop. `createdAt` is the time of the oldest record. */
export function buildDemoShop(phone: string, now: Date): Shop {
  const shop = createShop({ name: DEMO_SHOP_NAME, phone, currency: 'ZAR', timeZone: DEMO_TIME_ZONE });
  const oldest = buildDemoRecords(shop, now)[0];
  return { ...shop, createdAt: oldest ? oldest.createdAt : now.toISOString() };
}

/** The 17 records, in append order. */
export function buildDemoRecords(shop: Shop, now: Date): LedgerRecord[] {
  const todayStart = getShopDayBounds(shop, getShopLocalDate(shop, now)).start;
  // The start of the two days before today: 24-hour steps back from today's start.
  const startOf = (daysAgo: number): Date => {
    const guess = new Date(todayStart.getTime() - daysAgo * DAY);
    return getShopDayBounds(shop, getShopLocalDate(shop, new Date(guess.getTime() + HOUR))).start;
  };
  const twoDaysAgo = startOf(2);
  const yesterday = startOf(1);
  const at = (dayStart: Date, hour: number, minute: number): Date =>
    new Date(dayStart.getTime() + hour * HOUR + minute * MINUTE);

  // Today: fractions of the time since local midnight, never after `now` and never before midnight.
  const elapsed = Math.max(0, now.getTime() - todayStart.getTime());
  const today = (fraction: number): Date =>
    new Date(Math.min(now.getTime(), Math.max(todayStart.getTime(), Math.floor(todayStart.getTime() + elapsed * fraction))));

  const sale = (when: Date, cents: number, item: string, words: string) =>
    createSaleRecord(shop.id, { amount: cents, item, channel: 'sms', originalWords: words, now: when });
  const expense = (when: Date, cents: number, item: string, words: string) =>
    createExpenseRecord(shop.id, { amount: cents, item, channel: 'sms', originalWords: words, now: when });
  const debt = (when: Date, cents: number, customer: string, item: string, words: string) =>
    createDebtRecord(shop.id, { amount: cents, customer, item, channel: 'sms', originalWords: words, now: when });
  const payment = (when: Date, cents: number, customer: string, words: string) =>
    createPaymentRecord(shop.id, { amount: cents, customer, channel: 'sms', originalWords: words, now: when });

  const slip = sale(at(yesterday, 16, 0), 99900, 'bread', 'sold 999 bread');

  return [
    // Two days ago
    sale(at(twoDaysAgo, 9, 10), 12000, 'bread', 'sold 4 bread 120'),
    sale(at(twoDaysAgo, 11, 30), 8500, 'airtime', 'sold airtime 85'),
    expense(at(twoDaysAgo, 13, 0), 20000, 'stock', 'spent 200 stock'),
    debt(at(twoDaysAgo, 15, 45), 3000, 'Tendai', 'sugar', 'Tendai owes 30 sugar'),
    // Yesterday
    sale(at(yesterday, 8, 20), 9600, 'bread', 'sold 3 bread 96'),
    sale(at(yesterday, 10, 5), 15500, 'drinks', 'sold drinks 155'),
    debt(at(yesterday, 12, 40), 4500, 'Rudo', 'paraffin', 'Rudo owes 45 paraffin'),
    payment(at(yesterday, 14, 15), 1000, 'Tendai', 'Tendai paid 10'),
    slip,
    createReversal(slip, 'sms', 'undo', at(yesterday, 16, 1)),
    expense(at(yesterday, 17, 10), 6000, 'transport', 'spent 60 transport'),
    // Today
    sale(today(0.15), 4500, 'bread', 'sold 3 bread 45'),
    sale(today(0.3), 12000, 'drinks', 'sold drinks 120'),
    expense(today(0.45), 2000, 'transport', 'spent 20 transport'),
    debt(today(0.6), 2500, 'Sipho', 'bread', 'Sipho owes 25 bread'),
    payment(today(0.75), 1500, 'Rudo', 'Rudo paid 15'),
    sale(today(0.9), 3000, 'sweets', 'sold sweets 30')
  ];
}
