/**
 * What the state machine may ask of the ledger, and nothing else.
 *
 * The machine decides which screen comes next from the path alone. The few facts it needs from the records (who
 * owes, which record an undo would reverse) and the one thing it may do (make the shop at sign-up) go through
 * `MenuPorts`, so the machine can be tested with a fake and never touches a store itself.
 */

import {
  activeRecords,
  createShop,
  getWhoOwes,
  type CustomerBalance,
  type Currency,
  type LedgerStore,
  type Shop
} from '../../core/index.js';
import { shopIdFor } from './ids.js';
import type { Kind } from './screen.js';

/** The record `undoLastRecord` would reverse. */
export interface UndoTarget {
  id: string;
  kind: Kind;
  cents: number;
  item?: string;
  customer?: string;
}

export interface MenuPorts {
  /** The owner's shop. Null until sign-up has made it; `createShop` sets it. */
  shop: Shop | null;
  /** Makes the shop for choice 1..7 (the country list). Safe to call again: a second call gives the same shop. */
  createShop(name: string, choice: number): Promise<Shop>;
  /** Customers who owe money, largest first, ties by lower-case name. */
  owes(): Promise<CustomerBalance[]>;
  /** What `undoLastRecord` would reverse now, or null when there is nothing to undo. */
  undoTarget(): Promise<UndoTarget | null>;
}

/** The sign-up list. Choice 2 (US dollar) has no country of its own, so it uses Johannesburg. */
export const COUNTRIES: ReadonlyArray<{ currency: Currency; timeZone: string }> = [
  { currency: 'ZAR', timeZone: 'Africa/Johannesburg' },
  { currency: 'USD', timeZone: 'Africa/Johannesburg' },
  { currency: 'KES', timeZone: 'Africa/Nairobi' },
  { currency: 'NGN', timeZone: 'Africa/Lagos' },
  { currency: 'GHS', timeZone: 'Africa/Accra' },
  { currency: 'ZMW', timeZone: 'Africa/Lusaka' },
  { currency: 'BWP', timeZone: 'Africa/Gaborone' }
];

function hasName(error: unknown, name: string): boolean {
  return error instanceof Error && error.name === name;
}

/** Largest balance first; the same balance sorts by lower-case name, so the order is the same on every request. */
function byAmountThenName(a: CustomerBalance, b: CustomerBalance): number {
  if (a.balance !== b.balance) return b.balance - a.balance;
  const x = a.displayName.toLowerCase();
  const y = b.displayName.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

export function makePorts(a: {
  store: LedgerStore;
  shop: Shop | null;
  sessionId: string;
  phone: string;
  now: Date;
}): MenuPorts {
  const { store, sessionId, phone, now } = a;

  const ports: MenuPorts = {
    shop: a.shop,

    async createShop(name: string, choice: number): Promise<Shop> {
      const country = COUNTRIES[choice - 1];
      if (!country) {
        throw new RangeError('No such country choice');
      }
      const id = shopIdFor(sessionId);
      const shop: Shop = {
        ...createShop({ id, name, phone, currency: country.currency, timeZone: country.timeZone }),
        createdAt: now.toISOString()
      };
      try {
        await store.createShop(shop);
        ports.shop = shop;
        return shop;
      } catch (error) {
        if (!hasName(error, 'ShopAlreadyExistsError')) throw error;
        // A repeat of this request, a copy running at the same time, or another session got there first:
        // carry on with the shop that exists, whichever session made it.
        const existing = (await store.findShopByPhone(phone)) ?? (await store.findShopById(id));
        if (!existing) throw error;
        ports.shop = existing;
        return existing;
      }
    },

    async owes(): Promise<CustomerBalance[]> {
      if (!ports.shop) return [];
      const list = await getWhoOwes(store, ports.shop);
      return [...list].sort(byAmountThenName);
    },

    async undoTarget(): Promise<UndoTarget | null> {
      if (!ports.shop) return null;
      const { active } = activeRecords(await store.listRecords(ports.shop.id));
      const record = active[active.length - 1];
      if (!record || record.kind === 'reversal') return null;
      const target: UndoTarget = { id: record.id, kind: record.kind, cents: record.amount };
      if ('item' in record && record.item) target.item = record.item;
      if (record.kind === 'debt' || record.kind === 'payment') target.customer = record.customerDisplayName;
      return target;
    }
  };
  return ports;
}
