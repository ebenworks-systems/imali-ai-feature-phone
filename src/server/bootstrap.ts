/**
 * Builds the real parts from environment variables and hands them to `createApp`. This is the only place (with
 * `config.ts` and `main.ts`) that knows what the variables mean, so route tests never depend on the machine.
 *
 * - DATABASE_URL set: Postgres store, pending store and processed-text store. Not set: the memory ones.
 * - GEMINI_API_KEY set: a Gemini reader (model from GEMINI_MODEL, Vertex AI project from GEMINI_VERTEX_PROJECT, when set).
 *   Not set: no reader.
 * - AT_USERNAME and AT_API_KEY set: an Africa's Talking sender (from AT_SHORTCODE, default 46254; the sandbox host
 *   when AT_USERNAME is `sandbox`). Not set: no sender.
 * - AT_CALLBACK_KEY set: POST /ussd and POST /sms need `?k=<the key>`.
 * - AT_USERNAME and AT_API_KEY set but AT_CALLBACK_KEY not: POST /ussd and POST /sms answer 503 (the start line says
 *   `callback=missing-key`); the server still starts and the browser routes work. No sender: they stay open.
 * - ADDRESS_SALT set: the salt client addresses are hashed with before the demo limits are kept. Not set: a fixed
 *   built-in salt (the start line says `salt=default`), the same in every instance. The built-in salt is public, so on
 *   Vercel (VERCEL set) a missing ADDRESS_SALT also gives a start-up warning; a local run has none.
 */

import { GeminiReader, type ModelReader } from '../ai/reader.js';
import { InMemoryPendingStore, type PendingStore } from '../channels/sms/pending.js';
import type { LedgerStore } from '../store/interface.js';
import { MemoryStore } from '../store/memory/store.js';
import {
  closePostgres,
  connectPostgres,
  createPostgresStore,
  PostgresDemoQuotaStore,
  PostgresPendingStore,
  PostgresProcessedTextStore
} from '../store/postgres/index.js';
import { InMemoryProcessedTextStore, type ProcessedTextStore } from '../store/processed.js';
import { InMemoryDemoQuotaStore, type DemoQuotaStore } from '../store/quota.js';
import { createApp } from './app.js';
import type { App } from './context.js';
import { readConfig } from './config.js';
import { createAfricasTalkingSender, type SmsSender } from './sender.js';

export interface Parts {
  store: LedgerStore;
  pending: PendingStore;
  processed: ProcessedTextStore;
  quota: DemoQuotaStore;
  reader?: ModelReader;
  smsSender?: SmsSender;
  callbackKey?: string;
  refuseCallbacks?: boolean;
  addressSalt?: string;
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
  let quota: DemoQuotaStore;
  let close: () => Promise<void> = async () => {};

  if (config.databaseUrl) {
    const sql = connectPostgres(config.databaseUrl);
    store = createPostgresStore(sql);
    pending = new PostgresPendingStore(sql, now ? { now } : {});
    processed = new PostgresProcessedTextStore(sql, now ? { now } : {});
    quota = new PostgresDemoQuotaStore(sql, now ? { now } : {});
    close = () => closePostgres(sql);
  } else {
    store = new MemoryStore();
    pending = new InMemoryPendingStore(now ? { now } : {});
    processed = new InMemoryProcessedTextStore(now ? { now } : {});
    quota = new InMemoryDemoQuotaStore(now ? { now } : {});
  }

  const reader = config.geminiApiKey
    ? new GeminiReader({
        apiKey: config.geminiApiKey,
        ...(config.geminiModel ? { model: config.geminiModel } : {}),
        ...(config.geminiVertexProject ? { vertexProject: config.geminiVertexProject } : {}),
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
    quota,
    ...(reader ? { reader } : {}),
    ...(smsSender ? { smsSender } : {}),
    ...(config.callbackKey ? { callbackKey: config.callbackKey } : {}),
    ...(config.callbacksMissingKey ? { refuseCallbacks: true } : {}),
    ...(config.addressSalt ? { addressSalt: config.addressSalt } : {})
  };

  const app = createApp({ ...parts, ...(now ? { now } : {}) });

  const sms = config.at ? (config.at.username === 'sandbox' ? 'sandbox' : 'live') : 'off';
  const summary =
    `store=${config.databaseUrl ? 'postgres' : 'memory'} gemini=${reader ? (config.geminiVertexProject ? 'vertex' : 'on') : 'off'} ` +
    `sms=${sms} callback=${config.callbackKey ? 'key' : config.callbacksMissingKey ? 'missing-key' : 'open'} ` +
    `salt=${config.addressSalt ? 'set' : 'default'}`;

  return { app, parts, summary, warnings: config.warnings, close };
}
