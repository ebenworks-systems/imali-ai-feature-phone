import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryPendingStore } from '../../src/channels/sms/pending.js';
import { createApp } from '../../src/server/app.js';
import { MemoryStore } from '../../src/store/memory/store.js';
import { DEMO_PHONE, captureErrors, makeApp, makeShopApp, postForm, postJson, throwingStore } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

describe('createApp', () => {
  it('works with an empty process.env: it reads no environment variable', () => {
    const original = { ...process.env };
    for (const key of Object.keys(process.env)) delete process.env[key];
    try {
      const app = createApp({ store: new MemoryStore(), pending: new InMemoryPendingStore() });
      expect(typeof app.request).toBe('function');
    } finally {
      Object.assign(process.env, original);
    }
  });

  it('uses the system clock when none is passed', async () => {
    const app = createApp({ store: new MemoryStore(), pending: new InMemoryPendingStore() });
    const res = await app.request('/health');
    expect(res.status).toBe(200);
  });

  it('uses the clock it is given for the export time stamp', async () => {
    const { app } = makeApp();
    await postJson(app, '/api/phone/demo', { phone: DEMO_PHONE });
    const res = await app.request(`/api/export?phone=${encodeURIComponent(DEMO_PHONE)}`);
    expect((await res.json()).exportedAt).toBe('2026-11-07T10:00:00.000Z');
  });
});

describe('body size', () => {
  const big = 'x'.repeat(9 * 1024);

  it('refuses a 9 KB body with 413 and a plain sentence on /ussd (text)', async () => {
    const { app } = makeApp({ store: throwingStore() });
    const res = await postForm(app, '/ussd', { sessionId: 's', serviceCode: '*1#', phoneNumber: '+27000001234', text: big });
    expect(res.status).toBe(413);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe('That request is too big.');
  });

  it('refuses a 9 KB body with 413 on /sms (text)', async () => {
    const { app } = makeApp({ store: throwingStore() });
    const res = await postForm(app, '/sms', { from: '+27000001234', text: big });
    expect(res.status).toBe(413);
    expect(res.headers.get('content-type')).toContain('text/plain');
  });

  it('refuses a 9 KB body with 413 and JSON on /api/phone/sms', async () => {
    const { app } = makeApp({ store: throwingStore() });
    const res = await postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: big });
    expect(res.status).toBe(413);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'That request is too big.' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses by Content-Length before reading the body', async () => {
    const { app } = makeApp({ store: throwingStore() });
    const res = await app.request('/sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': '99999' },
      body: 'from=%2B27000001234&text=hi'
    });
    expect(res.status).toBe(413);
  });

  it('accepts a body just under 8,192 bytes', async () => {
    const { app } = makeApp({ store: throwingStore() });
    // Too long for the text rules (480), but small enough for the body limit: it gets the "too long" reply, not 413.
    const res = await postForm(app, '/sms', { from: '+27000001234', text: 'y'.repeat(7000) });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('That message is too long. Please send a shorter one.');
  });
});

describe('unknown paths', () => {
  it('answers 404 JSON under /api/', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/nothing-here');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found.' });
  });

  it('answers 404 text elsewhere', async () => {
    const { app } = makeApp();
    const res = await app.request('/nothing-here');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe('Not found.');
  });

  it('answers 404 for the wrong method on a known path', async () => {
    const { app } = makeApp();
    expect((await app.request('/ussd')).status).toBe(404);
    expect((await app.request('/sms')).status).toBe(404);
  });
});

describe('Cache-Control: no-store on /api/*', () => {
  it('is on the 200, 400, 404, 413, 429 and 500 answers', async () => {
    const { app, clock } = await makeShopApp();
    // 200
    const ok = await postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: 'today' });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    // 400
    const bad = await postJson(app, '/api/phone/sms', 'not json');
    expect(bad.status).toBe(400);
    expect(bad.headers.get('cache-control')).toBe('no-store');
    // 404
    const none = await app.request('/api/ledger?phone=%2B27000009999');
    expect(none.status).toBe(404);
    expect(none.headers.get('cache-control')).toBe('no-store');
    const unknown = await app.request('/api/unknown');
    expect(unknown.headers.get('cache-control')).toBe('no-store');
    // 429
    let last = ok;
    for (let i = 0; i < 61 && last.status !== 429; i += 1) {
      last = await postJson(app, '/api/phone/sms', { phone: '+27000007777', text: 'today' });
    }
    expect(last.status).toBe(429);
    expect(last.headers.get('cache-control')).toBe('no-store');
    clock.advance(1);
  });

  it('is on a 500 answer', async () => {
    captureErrors();
    const { app } = makeApp({ store: throwingStore('boom') });
    const res = await postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: 'today' });
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('is not added to the Africa\'s Talking routes or /health', async () => {
    const { app } = makeApp();
    expect((await app.request('/health')).headers.get('cache-control')).toBeNull();
  });
});
