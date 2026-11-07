/**
 * Builds the real parts from environment variables and hands them to `createApp`. This is the only place (with
 * `config.ts` and `main.ts`) that knows what the variables mean, so route tests never depend on the machine.
 *
 * - DATABASE_URL set: Postgres store, pending store and processed-text store. Not set: the memory ones.
 * - GEMINI_API_KEY set: a Gemini reader (model from GEMINI_MODEL when that is set). Not set: no reader.
 * - AT_USERNAME and AT_API_KEY set: an Africa's Talking sender (from AT_SHORTCODE, default 46254; the sandbox host
 *   when AT_USERNAME is `sandbox`). Not set: no sender.
 * - AT_CALLBACK_KEY set: POST /ussd and POST /sms need `?k=<the key>`.
 */

import { GeminiReader, type ModelReader } from '../ai/reader.js';
import { InMemoryPendingStore, type PendingStore } from '../channels/sms/pending.js';
import type { LedgerStore } from '../store/interface.js';
import { MemoryStore } from '../store/memory/store.js';
import {
  closePostgres,
  connectPostgres,
  createPostgresStore,
  PostgresPendingStore,
  PostgresProcessedTextStore
} from '../store/postgres/index.js';
import { InMemoryProcessedTextStore, type ProcessedTextStore } from '../store/processed.js';
import { createApp } from './app.js';
import type { App } from './context.js';
import { readConfig } from './config.js';
import { createAfricasTalkingSender, type SmsSender } from './sender.js';

export interface Parts {
  store: LedgerStore;
  pending: PendingStore;
  processed: ProcessedTextStore;
  reader?: ModelReader;
  smsSender?: SmsSender;
  callbackKey?: string;
}

export interface Started {
  app: App;
  parts: Parts;
  /** One line for the log: which parts are on. It never holds the value of a variable. */
  summary: string;
  warnings: string[];
  /** Ends the database pool (does nothing for the memory store). */
  close(): Promise<void>;
}

export function createAppFromEnv(
  env: Record<string, string | undefined>,
  overrides: { now?: () => Date; fetch?: typeof fetch } = {}
): Started {
  const config = readConfig(env);
  const now = overrides.now;

  let store: LedgerStore;
  let pending: PendingStore;
  let processed: ProcessedTextStore;
  let close: () => Promise<void> = async () => {};

  if (config.databaseUrl) {
    const sql = connectPostgres(config.databaseUrl);
    store = createPostgresStore(sql);
    pending = new PostgresPendingStore(sql, now ? { now } : {});
    processed = new PostgresProcessedTextStore(sql, now ? { now } : {});
    close = () => closePostgres(sql);
  } else {
    store = new MemoryStore();
    pending = new InMemoryPendingStore(now ? { now } : {});
    processed = new InMemoryProcessedTextStore(now ? { now } : {});
  }

  const reader = config.geminiApiKey
    ? new GeminiReader({
        apiKey: config.geminiApiKey,
        ...(config.geminiModel ? { model: config.geminiModel } : {}),
        ...(overrides.fetch ? { fetch: overrides.fetch } : {})
      })
    : undefined;

  const smsSender = config.at
    ? createAfricasTalkingSender({ ...config.at, ...(overrides.fetch ? { fetch: overrides.fetch } : {}) })
    : undefined;

  const parts: Parts = {
    store,
    pending,
    processed,
    ...(reader ? { reader } : {}),
    ...(smsSender ? { smsSender } : {}),
    ...(config.callbackKey ? { callbackKey: config.callbackKey } : {})
  };

  const app = createApp({ ...parts, ...(now ? { now } : {}) });

  const sms = config.at ? (config.at.username === 'sandbox' ? 'sandbox' : 'live') : 'off';
  const summary =
    `store=${config.databaseUrl ? 'postgres' : 'memory'} gemini=${reader ? 'on' : 'off'} ` +
    `sms=${sms} callback=${config.callbackKey ? 'key' : 'open'}`;

  return { app, parts, summary, warnings: config.warnings, close };
}
