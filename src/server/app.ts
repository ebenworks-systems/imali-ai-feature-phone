/**
 * The Hono app. `createApp` is pure wiring: it gets its parts as arguments, never reads `process.env`, opens no
 * connection and listens on no port. Tests build it with memory parts and a fixed clock and call `app.request()`.
 */

import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ModelReader } from '../ai/reader.js';
import type { PendingStore } from '../channels/sms/pending.js';
import type { LedgerStore } from '../store/interface.js';
import { withRecordLimit } from '../store/limit.js';
import { InMemoryProcessedTextStore, type ProcessedTextStore } from '../store/processed.js';
import { keyMatches } from './callbackKey.js';
import type { App, AppContext, AppEnv } from './context.js';
import {
  DEMO_CREATES_PER_HOUR,
  DEMO_WINDOW_MS,
  MAX_BODY_BYTES,
  MAX_DEMO_SHOPS,
  MAX_RECORDS_PER_SHOP,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  SENTENCES
} from './constants.js';
import { logError, ownerSentence } from './errors.js';
import { isDemoPhone } from './phone.js';
import { createRateLimiter } from './rateLimit.js';
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
  /** When set (not blank), `POST /ussd` and `POST /sms` need `?k=<callbackKey>`. */
  callbackKey?: string;
  /** Limits on POST /api/phone/demo. The defaults are in constants.ts; tests shrink them. */
  demoLimits?: { perAddress?: number; windowMs?: number; maxShops?: number };
  /** The clock. `systemClock.now` and `mockClock(d).now` both fit. */
  now?: () => Date;
}

export function createApp(deps: AppDeps): App {
  const now = deps.now ?? (() => new Date());
  const ctx: AppContext = {
    store: withRecordLimit(deps.store, MAX_RECORDS_PER_SHOP),
    pending: deps.pending,
    processed: deps.processed ?? new InMemoryProcessedTextStore({ now }),
    ...(deps.reader ? { reader: deps.reader } : {}),
    ...(deps.smsSender ? { smsSender: deps.smsSender } : {}),
    now,
    limiter: createRateLimiter({ limit: RATE_LIMIT, windowMs: RATE_WINDOW_MS, now }),
    demoLimiter: createRateLimiter({
      limit: deps.demoLimits?.perAddress ?? DEMO_CREATES_PER_HOUR,
      windowMs: deps.demoLimits?.windowMs ?? DEMO_WINDOW_MS,
      now
    }),
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
  }

  // Set before the answer is made, so every /api/* answer carries it, errors and refusals included.
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });

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
