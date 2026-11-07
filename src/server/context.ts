import type { Hono } from 'hono';
import type { ModelReader } from '../ai/reader.js';
import type { PendingStore } from '../channels/sms/pending.js';
import type { LedgerStore } from '../store/interface.js';
import type { DemoQuotaStore } from '../store/quota.js';
import type { ProcessedTextStore } from '../store/processed.js';
import type { RateLimiter } from './rateLimit.js';
import type { SmsSender } from './sender.js';

/** What a route may keep for the error handler: the phone number of the call, so a log line can carry it masked. */
export type AppEnv = { Variables: { phone?: string } };
export type App = Hono<AppEnv>;

/** The parts the routes use. Built once by `createApp`. */
export interface AppContext {
  /** The store, already wrapped with the record cap and the cap on shops that are not demo shops. */
  store: LedgerStore;
  /** The same store, but it cannot make shops. The browser phone's ussd and sms routes use it. */
  browserStore: LedgerStore;
  pending: PendingStore;
  processed: ProcessedTextStore;
  reader?: ModelReader;
  smsSender?: SmsSender;
  now: () => Date;
  /** 60 requests a minute per phone number, for the browser routes. Per instance. */
  limiter: RateLimiter;
  /** 120 requests a minute per client address, for every browser route. Per instance. */
  addressLimiter: RateLimiter;
  /** /ussd and /sms: requests a minute per client address and per phone number. Per instance. */
  atAddressLimiter: RateLimiter;
  atPhoneLimiter: RateLimiter;
  /** Calls per client address per hour to POST /api/phone/demo, and demo shops per day: kept in the store. */
  quota: DemoQuotaStore;
  demoPerAddress: number;
  demoWindowMs: number;
  maxDemoShopsPerDay: number;
  /** The salt the client address is hashed with before it reaches the quota store. */
  addressSalt: string;
  /** Demo shops in all. */
  maxDemoShops: number;
}
