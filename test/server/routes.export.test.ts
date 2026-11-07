import { describe, expect, it } from 'vitest';
import { DEMO_PHONE, makeApp, postJson, throwingStore } from './helpers.js';

const url = (phone: string) => `/api/export?phone=${encodeURIComponent(phone)}`;

describe('GET /api/export', () => {
  async function seeded() {
    const built = makeApp();
    await postJson(built.app, '/api/phone/demo', { phone: DEMO_PHONE });
    return built;
  }

  it('gives the export format with the shop, every record and the clock as exportedAt', async () => {
    const { app } = await seeded();
    const res = await app.request(url(DEMO_PHONE));
    expect(res.status).toBe(200);
    const body = JSON.parse(await res.text());
    expect(body.format).toBe('imali-ai-ledger-export');
    expect(body.version).toBe(1);
    expect(body.exportedAt).toBe('2026-11-07T10:00:00.000Z');
    expect(body.shop).toMatchObject({ name: "Thandi's Spaza", phone: DEMO_PHONE, currency: 'ZAR' });
    expect(body.records).toHaveLength(17);
    expect(body.records.filter((r: { kind: string }) => r.kind === 'reversal')).toHaveLength(1);
  });

  it('sends the three headers exactly', async () => {
    const { app } = await seeded();
    const res = await app.request(url(DEMO_PHONE));
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="imali-ledger-27000001234-2026-11-07.json"');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('uses the UTC date in the file name, not the shop\'s local date', async () => {
    const { app, clock } = await seeded();
    clock.set('2026-11-07T23:30:00.000Z'); // 01:30 on 8 November in Johannesburg
    const res = await app.request(url(DEMO_PHONE));
    expect(res.headers.get('content-disposition')).toContain('-2026-11-07.json');
  });

  it('indents the body (pretty-printed JSON)', async () => {
    const { app } = await seeded();
    const text = await (await app.request(url(DEMO_PHONE))).text();
    expect(text).toContain('\n  "format": "imali-ai-ledger-export"');
    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
  });

  it('leaves the order of records in the store unchanged', async () => {
    const { app, store } = await seeded();
    const shop = (await store.findShopByPhone(DEMO_PHONE))!;
    const before = (await store.listRecords(shop.id)).map((r) => r.id);
    await app.request(url(DEMO_PHONE));
    expect((await store.listRecords(shop.id)).map((r) => r.id)).toEqual(before);
  });

  it('answers 404 { error } when no shop has the number', async () => {
    const { app } = makeApp();
    const res = await app.request(url('+27000009999'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'No demo shop for this number. Start a demo first.' });
  });

  it('answers 400 for a number that is not a demo number, without reading the store', async () => {
    const { app } = makeApp({ store: throwingStore() });
    expect((await app.request(url('+254711000000'))).status).toBe(400);
    expect((await app.request('/api/export')).status).toBe(400);
  });
});
