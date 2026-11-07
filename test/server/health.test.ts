import { describe, expect, it } from 'vitest';
import { makeApp, throwingStore } from './helpers.js';

describe('GET /health', () => {
  it('answers 200 {"ok":true} without reading the store', async () => {
    const { app } = makeApp({ store: throwingStore() });
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('works without any key, any phone and any header', async () => {
    const { app } = makeApp({ callbackKey: 'a-key' });
    expect((await app.request('/health')).status).toBe(200);
  });
});
