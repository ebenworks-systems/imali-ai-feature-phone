/**
 * "Start demo shop" and "Start over" (public/ledger.js). The page posts `{}` to /api/phone/demo and takes the number
 * from the 201 answer. The server picks the number (it tries up to 20 free ones), so the page never retries a clash,
 * which used to cost one of the 10 demo calls an hour for each try.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, ROUTES, ledgerUrl } from '../../public/api.js';
import { STORAGE_KEY, initLedger } from '../../public/ledger.js';
import { makeLedgerPage, memoryStorage } from '../helpers/ledgerPage.js';

const START_ERROR = 'Could not start the demo shop. Try again.';
const PHONE = '+27000004321';

const http = (status: number) => new ApiError('http', `The server answered ${status}`, status);

/** Lets the click handler's promises finish. */
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(100);
};

function setUp(options: { post?: (url: string, body: unknown) => Promise<unknown>; stored?: string } = {}) {
  const page = makeLedgerPage();
  vi.stubGlobal('document', page.document);
  const storage = memoryStorage(options.stored ? { [STORAGE_KEY]: options.stored } : {});
  const postJson = vi.fn(options.post ?? (async () => ({ phone: PHONE, shop: { name: 'S', currency: 'ZAR', timeZone: 'UTC' } })));
  // The ledger refresh fails quietly: these tests are about the shop lifecycle, not the drawing.
  const getJson = vi.fn(async () => {
    throw new ApiError('network', 'The request failed');
  });
  const onShop = vi.fn();
  const ledger = initLedger({
    root: page.root as unknown as Document,
    api: { postJson, getJson, getBlob: vi.fn() },
    storage: storage as unknown as Storage,
    onShop
  });
  return { page, storage, postJson, getJson, onShop, ledger };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Start demo shop', () => {
  it('posts {} to the demo route, once, and names no number', async () => {
    const { page, postJson } = setUp();
    page.startButtons[0]!.click();
    await settle();
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(postJson).toHaveBeenCalledWith(ROUTES.demo, {});
  });

  it('takes the number from the 201 answer, keeps it, tells the phone and loads the ledger for it', async () => {
    const { page, storage, getJson, onShop, ledger } = setUp();
    page.startButtons[1]!.click();
    await settle();
    expect(ledger.phone()).toBe(PHONE);
    expect(storage.data.get(STORAGE_KEY)).toBe(PHONE);
    expect(onShop).toHaveBeenCalledTimes(1);
    expect(onShop).toHaveBeenCalledWith(PHONE);
    expect(getJson).toHaveBeenCalledWith(ledgerUrl(PHONE));
    expect(page.node('action-error').hidden).toBe(true);
    expect(page.node('cta-error').hidden).toBe(true);
  });

  it('uses whatever demo number the server gives, with no number of its own to compare', async () => {
    for (const phone of ['+27000000000', '+27000009999', '+27000005555']) {
      const { page, ledger } = setUp({ post: async () => ({ phone }) });
      page.startButtons[0]!.click();
      await settle();
      expect(ledger.phone()).toBe(phone);
    }
  });

  it.each([
    ['429 (too many shops from this address)', http(429)],
    ['503 (the demo is full, or no number is free)', http(503)],
    ['409', http(409)],
    ['500', http(500)],
    ['a network error', new ApiError('network', 'The request failed')],
    ['a timeout', new ApiError('timeout', 'The request took too long')]
  ])('on %s: one call, no retry, the start error, no shop', async (_name, error) => {
    const { page, storage, postJson, onShop, ledger } = setUp({
      post: async () => {
        throw error;
      }
    });
    page.startButtons[0]!.click();
    await settle();
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(ledger.phone()).toBeNull();
    expect(storage.data.has(STORAGE_KEY)).toBe(false);
    expect(onShop).not.toHaveBeenCalled();
    expect(page.node('action-error').textContent).toBe(START_ERROR);
    expect(page.node('action-error').hidden).toBe(false);
    expect(page.node('cta-error').textContent).toBe(START_ERROR);
    expect(page.node('panel-status').textContent).toBe(START_ERROR);
  });

  it.each([
    ['an answer with no number', {}],
    ['an answer that is not an object', 'ok'],
    ['null', null],
    ['a number that is not a demo number', { phone: '+254711000000' }],
    ['a number that is not text', { phone: 27000004321 }]
  ])('treats %s as a failure and keeps no shop', async (_name, answer) => {
    const { page, storage, ledger, onShop } = setUp({ post: async () => answer });
    page.startButtons[0]!.click();
    await settle();
    expect(ledger.phone()).toBeNull();
    expect(storage.data.has(STORAGE_KEY)).toBe(false);
    expect(onShop).not.toHaveBeenCalled();
    expect(page.node('action-error').textContent).toBe(START_ERROR);
  });

  it('is busy while it waits and ignores a second press', async () => {
    let release: (answer: unknown) => void = () => {};
    const { page, postJson, ledger } = setUp({ post: () => new Promise((resolve) => (release = resolve)) });
    page.startButtons[0]!.click();
    await settle();
    expect(page.startButtons[0]!.getAttribute('aria-busy')).toBe('true');
    expect(page.startButtons[0]!.getAttribute('aria-disabled')).toBe('true');
    page.startButtons[0]!.click();
    page.startButtons[1]!.click();
    await settle();
    expect(postJson).toHaveBeenCalledTimes(1);
    release({ phone: PHONE });
    await settle();
    expect(ledger.phone()).toBe(PHONE);
    expect(page.startButtons[0]!.getAttribute('aria-busy')).toBeNull();
  });
});

describe('Start over', () => {
  const OLD = '+27000001111';

  it('posts {} and swaps to the number the server gives', async () => {
    const { page, storage, postJson, onShop, ledger } = setUp({ stored: OLD, post: async () => ({ phone: PHONE }) });
    expect(ledger.phone()).toBe(OLD);
    page.node('over-btn').click();
    await settle();
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(postJson).toHaveBeenCalledWith(ROUTES.demo, {});
    expect(ledger.phone()).toBe(PHONE);
    expect(storage.data.get(STORAGE_KEY)).toBe(PHONE);
    expect(onShop).toHaveBeenCalledWith(PHONE);
  });

  it('on a failure leaves the old shop as it was and says so once', async () => {
    const { page, storage, postJson, onShop, ledger } = setUp({
      stored: OLD,
      post: async () => {
        throw http(429);
      }
    });
    page.node('over-btn').click();
    await settle();
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(ledger.phone()).toBe(OLD);
    expect(storage.data.get(STORAGE_KEY)).toBe(OLD);
    expect(onShop).not.toHaveBeenCalledWith(null);
    expect(page.node('action-error').textContent).toBe(START_ERROR);
  });
});

describe('the page source', () => {
  it('no longer makes a number of its own', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../../public/ledger.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/demoPhone|MAX_TRIES|random/);
    const phone = readFileSync(new URL('../../public/phone.js', import.meta.url), 'utf8');
    expect(phone).not.toMatch(/random:\s*\(\)/);
  });
});
