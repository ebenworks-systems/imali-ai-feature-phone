/**
 * The side panel's view of a shop: today's figures, who owes and the last records.
 * Every money value is `{ cents, text }`: an integer and the same amount written for the shop's currency in ASCII.
 */

import {
  activeRecords,
  formatCents,
  getShopLocalDate,
  getTodaySummary,
  getWhoOwes,
  type Channel,
  type Currency,
  type LedgerStore,
  type RecordKind,
  type Shop
} from '../core/index.js';

export interface MoneyView {
  cents: number;
  text: string;
}

export interface RecordView {
  id: string;
  kind: RecordKind;
  amount: MoneyView;
  item?: string;
  customer?: string;
  channel: Channel;
  originalWords: string;
  createdAt: string;
  /** A reversal points at this record. */
  reversed: boolean;
  /** For a reversal: the record it cancels. */
  reversesRecordId?: string;
}

export interface LedgerView {
  shop: { name: string; phone: string; currency: Currency; timeZone: string };
  today: {
    /** The shop's local date, YYYY-MM-DD. */
    date: string;
    sales: { total: MoneyView; count: number };
    expenses: MoneyView;
    moneyInHand: MoneyView;
    newDebts: MoneyView;
    paymentsReceived: MoneyView;
    totalOwed: MoneyView;
  };
  /** The first 20 customers who owe, largest first, and how many more there are. */
  owes: { customers: Array<{ name: string; owed: MoneyView }>; more: number };
  /** The last 20 records, newest first. */
  records: RecordView[];
}

export const OWES_SHOWN = 20;
export const RECORDS_SHOWN = 20;

export async function buildLedgerView(store: LedgerStore, shop: Shop, now: Date): Promise<LedgerView> {
  const money = (cents: number): MoneyView => ({ cents, text: formatCents(cents, shop.currency) });

  const [summary, owing, all] = await Promise.all([
    getTodaySummary(store, shop, now),
    getWhoOwes(store, shop),
    store.listRecords(shop.id)
  ]);
  const { reversedIds } = activeRecords(all);

  const records: RecordView[] = all
    .slice(-RECORDS_SHOWN)
    .reverse()
    .map((record) => {
      const view: RecordView = {
        id: record.id,
        kind: record.kind,
        amount: money(record.amount),
        channel: record.channel,
        originalWords: record.originalWords,
        createdAt: record.createdAt,
        reversed: reversedIds.has(record.id)
      };
      if (record.kind === 'reversal') {
        view.reversesRecordId = record.reversesRecordId;
      } else {
        if (record.item) view.item = record.item;
        if (record.kind === 'debt' || record.kind === 'payment') view.customer = record.customerDisplayName;
      }
      return view;
    });

  return {
    shop: { name: shop.name, phone: shop.phone, currency: shop.currency, timeZone: shop.timeZone },
    today: {
      date: getShopLocalDate(shop, now),
      sales: { total: money(summary.sales.total), count: summary.sales.count },
      expenses: money(summary.expenses.total),
      moneyInHand: money(summary.moneyInHand),
      newDebts: money(summary.newDebts),
      paymentsReceived: money(summary.paymentsReceived),
      totalOwed: money(summary.totalOwed)
    },
    owes: {
      customers: owing.slice(0, OWES_SHOWN).map((c) => ({ name: c.displayName, owed: money(c.balance) })),
      more: Math.max(0, owing.length - OWES_SHOWN)
    },
    records
  };
}
