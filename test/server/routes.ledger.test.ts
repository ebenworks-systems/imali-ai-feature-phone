import { describe, expect, it } from 'vitest';
import { DEMO_PHONE, makeApp, postJson, throwingStore } from './helpers.js';

const url = (phone: string) => `/api/ledger?phone=${encodeURIComponent(phone)}`;

async function seeded() {
  const built = makeApp();
  const res = await postJson(built.app, '/api/phone/demo', { phone: DEMO_PHONE });
  expect(res.status).toBe(201);
  return built;
}

describe('GET /api/ledger', () => {
  it('gives the shop, today, who owes and the last records, with { cents, text } money', async () => {
    const { app } = await seeded();
    const res = await app.request(url(DEMO_PHONE));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(['owes', 'records', 'shop', 'today']);
    expect(body.shop).toEqual({ name: "Thandi's Spaza", phone: DEMO_PHONE, currency: 'ZAR', timeZone: 'Africa/Johannesburg' });
    expect(body.today.date).toBe('2026-11-07');
    expect(body.today.sales).toEqual({ total: { cents: 19500, text: 'R195' }, count: 3 });
    expect(body.today.expenses).toEqual({ cents: 2000, text: 'R20' });
    expect(body.today.totalOwed).toEqual({ cents: 7500, text: 'R75' });
    expect(body.owes.more).toBe(0);
    expect(body.owes.customers.map((c: { name: string }) => c.name)).toEqual(['Rudo', 'Sipho', 'Tendai']);
    expect(body.records).toHaveLength(17);
    expect(body.records[0].originalWords).toBe('sold sweets 30');
    expect(body.records.filter((r: { reversed: boolean }) => r.reversed)).toHaveLength(1);
  });

  it('writes every money value as an object with an integer cents and an ASCII text', async () => {
    const { app } = await seeded();
    const body = await (await app.request(url(DEMO_PHONE))).json();
    const moneys: Array<{ cents: number; text: string }> = [];
    const walk = (v: unknown): void => {
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if ('cents' in o && 'text' in o) moneys.push(o as never);
        Object.values(o).forEach(walk);
      }
    };
    walk(body);
    expect(moneys.length).toBeGreaterThan(20);
    for (const m of moneys) {
      expect(Number.isInteger(m.cents)).toBe(true);
      expect(m.text).toMatch(/^-?R[0-9,]+(\.\d\d)?$/);
    }
  });

  it('finds the shop when the + of the phone arrives as a space', async () => {
    const { app } = await seeded();
    const res = await app.request('/api/ledger?phone=+27000001234');
    expect(res.status).toBe(200);
  });

  it('answers 404 { error } when no shop has the number', async () => {
    const { app } = makeApp();
    const res = await app.request(url('+27000009999'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'No demo shop for this number. Start a demo first.' });
  });

  it('answers 400 for a number that is not a demo number, without reading the store', async () => {
    const { app } = makeApp({ store: throwingStore() });
    const res = await app.request(url('+254711000000'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Use a demo number: +2700000 followed by 4 digits.' });
  });

  it('answers 400 for a missing phone, without reading the store', async () => {
    const { app } = makeApp({ store: throwingStore() });
    const res = await app.request('/api/ledger');
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe('string');
  });

  it('counts toward the 60 requests a minute of the phone', async () => {
    const { app } = makeApp();
    let last = await app.request(url('+27000009999'));
    for (let i = 0; i < 60; i += 1) last = await app.request(url('+27000009999'));
    expect(last.status).toBe(429);
    expect(last.headers.get('retry-after')).toMatch(/^\d+$/);
  });
});
