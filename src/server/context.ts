import type { Hono } from 'hono';
import type { ModelReader } from '../ai/reader.js';
import type { PendingStore } from '../channels/sms/pending.js';
import type { LedgerStore } from '../store/interface.js';
import type { ProcessedTextStore } from '../store/processed.js';
import type { RateLimiter } from './rateLimit.js';
import type { SmsSender } from './sender.js';

/** What a route may keep for the error handler: the phone number of the call, so a log line can carry it masked. */
export type AppEnv = { Variables: { phone?: string } };
export type App = Hono<AppEnv>;

/** The parts the routes use. Built once by `createApp`. */
export interface AppContext {
  /** The store, already wrapped with the record cap. */
  store: LedgerStore;
  pending: PendingStore;
  processed: ProcessedTextStore;
  reader?: ModelReader;
  smsSender?: SmsSender;
  now: () => Date;
  /** 60 requests a minute per phone number, for the browser routes. */
  limiter: RateLimiter;
  /** 10 calls an hour per client address, for POST /api/phone/demo. */
  demoLimiter: RateLimiter;
  /** Demo shops in all. */
  maxDemoShops: number;
}
