/**
 * The Hono app. `createApp` is pure wiring: it gets its parts as arguments, never reads `process.env`, opens no
 * connection and listens on no port. Tests build it with memory parts and a fixed clock and call `app.request()`.
 */

import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ModelReader } from '../ai/reader.js';
import type { PendingStore } from '../channels/sms/pending.js';
import type { LedgerStore } from '../store/interface.js';
import { withoutShopCreation, withRecordLimit, withShopLimit } from '../store/limit.js';
import { InMemoryProcessedTextStore, type ProcessedTextStore } from '../store/processed.js';
import { InMemoryDemoQuotaStore, type DemoQuotaStore } from '../store/quota.js';
import { keyMatches } from './callbackKey.js';
import type { App, AppContext, AppEnv } from './context.js';
import {
  ADDRESS_RATE_LIMIT,
  AT_ADDRESS_RATE_LIMIT,
  AT_PHONE_RATE_LIMIT,
  DEFAULT_ADDRESS_SALT,
  DEMO_CREATES_PER_HOUR,
  DEMO_WINDOW_MS,
  MAX_BODY_BYTES,
  MAX_DEMO_SHOPS,
  MAX_DEMO_SHOPS_PER_DAY,
  MAX_OTHER_SHOPS,
  MAX_RECORDS_PER_SHOP,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  READER_CALLS_PER_HOUR,
  READER_WINDOW_MS,
  SENTENCES
} from './constants.js';
import { logError, ownerSentence } from './errors.js';
import { clientAddress, isDemoPhone } from './phone.js';
import { createRateLimiter } from './rateLimit.js';
import { withReaderLimit } from './readerLimit.js';
import { isApiPath, refuse } from './respond.js';
import { registerAtRoutes, sendReply } from './routes/at.js';
import { registerBrowserRoutes } from './routes/browser.js';
import type { SmsSender } from './sender.js';

export interface AppDeps {
  store: LedgerStore;
  pending: PendingStore;
  /** Text callbacks already handled. Default: a new in-memory store. */
  processed?: ProcessedTextStore;
  reader?: ModelReader;
  smsSender?: SmsSender;
  /** The demo-shop limits that are kept in the store. Default: a new in-memory store. */
  quota?: DemoQuotaStore;
  /** When set (not blank), `POST /ussd` and `POST /sms` need `?k=<callbackKey>`. */
  callbackKey?: string;
  /**
   * True when the entry point has found the Africa's Talking sender set but no callback key. Then `POST /ussd` and
   * `POST /sms` answer 503 (unless a key is set), because open callbacks could read and write any shop's ledger and
   * make the server send texts from the account. Left false, as in tests and local runs, they stay open.
   */
  refuseCallbacks?: boolean;
  /** The salt the client address is hashed with. Default: the fixed built-in one. */
  addressSalt?: string;
  /** Limits on POST /api/phone/demo. The defaults are in constants.ts; tests shrink them. */
  demoLimits?: { perAddress?: number; windowMs?: number; maxShops?: number; perDay?: number };
  /** Other limits. The defaults are in constants.ts; tests shrink them. */
  limits?: {
    browserPerAddress?: number;
    atPerAddress?: number;
    atPerPhone?: number;
    otherShops?: number;
    readerPerHour?: number;
  };
  /** The clock. `systemClock.now` and `mockClock(d).now` both fit. */
  now?: () => Date;
}

export function createApp(deps: AppDeps): App {
  const now = deps.now ?? (() => new Date());
  const minute = { windowMs: RATE_WINDOW_MS, now };
  const store = withShopLimit(
    withRecordLimit(deps.store, MAX_RECORDS_PER_SHOP),
    deps.limits?.otherShops ?? MAX_OTHER_SHOPS
  );
  const ctx: AppContext = {
    store,
    browserStore: withoutShopCreation(store),
    pending: deps.pending,
    processed: deps.processed ?? new InMemoryProcessedTextStore({ now }),
    ...(deps.reader
      ? {
          reader: withReaderLimit(deps.reader, {
            limit: deps.limits?.readerPerHour ?? READER_CALLS_PER_HOUR,
            windowMs: READER_WINDOW_MS,
            now
          })
        }
      : {}),
    ...(deps.smsSender ? { smsSender: deps.smsSender } : {}),
    now,
    limiter: createRateLimiter({ limit: RATE_LIMIT, ...minute }),
    addressLimiter: createRateLimiter({ limit: deps.limits?.browserPerAddress ?? ADDRESS_RATE_LIMIT, ...minute }),
    atAddressLimiter: createRateLimiter({ limit: deps.limits?.atPerAddress ?? AT_ADDRESS_RATE_LIMIT, ...minute }),
    atPhoneLimiter: createRateLimiter({ limit: deps.limits?.atPerPhone ?? AT_PHONE_RATE_LIMIT, ...minute }),
    quota: deps.quota ?? new InMemoryDemoQuotaStore({ now }),
    demoPerAddress: deps.demoLimits?.perAddress ?? DEMO_CREATES_PER_HOUR,
    demoWindowMs: deps.demoLimits?.windowMs ?? DEMO_WINDOW_MS,
    maxDemoShopsPerDay: deps.demoLimits?.perDay ?? MAX_DEMO_SHOPS_PER_DAY,
    addressSalt: deps.addressSalt?.trim() || DEFAULT_ADDRESS_SALT,
    maxDemoShops: deps.demoLimits?.maxShops ?? MAX_DEMO_SHOPS
  };

  const app: App = new Hono<AppEnv>();

  // The callback key comes first: a caller without it never makes the app read a body or touch a store.
  const key = deps.callbackKey?.trim();
  if (key) {
    const guard: MiddlewareHandler<AppEnv> = async (c, next) => {
      if (!keyMatches(c.req.query('k'), key)) return refuse(c, 403, SENTENCES.forbidden);
      return next();
    };
    app.use('/ussd', guard);
    app.use('/sms', guard);
  } else if (deps.refuseCallbacks) {
    // The sender is set but there is no key to check: nobody gets in, and nothing is read or written.
    const closed: MiddlewareHandler<AppEnv> = async (c) => refuse(c, 503, SENTENCES.callbacksOff);
    app.use('/ussd', closed);
    app.use('/sms', closed);
  }

  // Then the address limit, before any body is read. The limit per phone number is in the routes, once the number is known.
  const tooMany = (c: Context<AppEnv>, retryAfterSeconds: number): Response =>
    refuse(c, 429, SENTENCES.rate, { 'Retry-After': String(retryAfterSeconds) });
  const limitAddress =
    (limiter: AppContext['atAddressLimiter']): MiddlewareHandler<AppEnv> =>
    async (c, next) => {
      const verdict = limiter.check(clientAddress(c.req.raw.headers));
      if (!verdict.allowed) return tooMany(c, verdict.retryAfterSeconds);
      return next();
    };
  app.use('/ussd', limitAddress(ctx.atAddressLimiter));
  app.use('/sms', limitAddress(ctx.atAddressLimiter));

  // Set before the answer is made, so every /api/* answer carries it, errors and refusals included.
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });

  // Every browser route also counts against the client address, besides the limit per phone number.
  const browserAddress = limitAddress(ctx.addressLimiter);
  app.use('/api/phone/*', browserAddress);
  app.use('/api/ledger', browserAddress);
  app.use('/api/export', browserAddress);

  app.use('*', bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => refuse(c as Context<AppEnv>, 413, SENTENCES.tooBig) }));

  registerAtRoutes(app, ctx);
  registerBrowserRoutes(app, ctx);

  app.get('/health', (c) => c.json({ ok: true }));

  app.notFound((c) => refuse(c, 404, SENTENCES.notFound));

  app.onError(async (error, c) => {
    const phone = c.get('phone');
    logError(c.req.path, error, phone);
    const sentence = ownerSentence(error);
    if (c.req.path === '/ussd') return c.text(`END ${sentence}`, 200);
    if (c.req.path === '/sms') {
      // Africa's Talking does not show the callback body to the owner, so the sentence is sent as a text too.
      if (phone && !isDemoPhone(phone)) await sendReply(ctx, phone, sentence);
      return c.text(sentence, 200);
    }
    return isApiPath(c.req.path) ? c.json({ error: sentence }, 500) : c.text(sentence, 500);
  });

  return app;
}
