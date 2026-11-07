/** Shared helpers for the route tests: a movable clock, an app built from memory parts, request builders. */

import { vi } from 'vitest';
import { InMemoryPendingStore } from '../../src/channels/sms/pending.js';
import { createApp, type AppDeps } from '../../src/server/app.js';
import type { LedgerStore } from '../../src/store/interface.js';
import { MemoryStore } from '../../src/store/memory/store.js';
import { InMemoryProcessedTextStore } from '../../src/store/processed.js';

/** 12:00 in Johannesburg. */
export const START = '2026-11-07T10:00:00.000Z';
export const DEMO_PHONE = '+27000001234';
export const OTHER_DEMO_PHONE = '+27000005678';

export function makeClock(start = START) {
  const clock = { ms: Date.parse(start) };
  return {
    now: () => new Date(clock.ms),
    set(iso: string) {
      clock.ms = Date.parse(iso);
    },
    advance(ms: number) {
      clock.ms += ms;
    }
  };
}

export function makeApp(over: Partial<AppDeps> = {}) {
  const clock = makeClock();
  const store = (over.store ?? new MemoryStore()) as LedgerStore;
  const pending = over.pending ?? new InMemoryPendingStore({ now: clock.now });
  const processed = over.processed ?? new InMemoryProcessedTextStore({ now: clock.now });
  const app = createApp({ store, pending, processed, now: clock.now, ...over });
  return { app, clock, store, pending, processed };
}

export function formBody(fields: Record<string, string | undefined>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) body.set(k, v);
  return body;
}

export function postForm(
  app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> },
  path: string,
  fields: Record<string, string | undefined>,
  headers: Record<string, string> = {}
) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: formBody(fields).toString()
  });
}

export function postJson(
  app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> },
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

/** A store whose every method throws, so a test can prove a route never touched it. */
export function throwingStore(message = 'the store must not be used here'): LedgerStore {
  const boom = () => {
    throw new Error(message);
  };
  return {
    createShop: boom,
    findShopById: boom,
    findShopByPhone: boom,
    appendRecord: boom,
    findRecordById: boom,
    findReversalOf: boom,
    listRecords: boom,
    countShopsWithPhonePrefix: boom
  } as unknown as LedgerStore;
}

/** Silences console.error for a test and lets it read the lines. */
export function captureErrors() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}
