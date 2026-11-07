import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNodeApp } from '../../src/server/node.js';

let dir: string;
let secret: string;
let app: ReturnType<typeof createNodeApp>['app'];

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'imali-public-'));
  secret = path.join(path.dirname(dir), `${path.basename(dir)}-secret.txt`);
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Phone</title>');
  writeFileSync(path.join(dir, 'style.css'), 'body { margin: 0 }');
  writeFileSync(path.join(dir, 'app.js'), 'export const x = 1;');
  // A file with the name of an API route: the route must win.
  writeFileSync(path.join(dir, 'health'), 'this is a file, not the health route');
  mkdirSync(path.join(dir, 'api'));
  writeFileSync(path.join(dir, 'api', 'ledger'), 'file under api');
  writeFileSync(secret, 'outside the public folder');
  app = createNodeApp({}, { publicDir: dir }).app;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(secret, { force: true });
});

describe('createNodeApp', () => {
  it('serves index.html for /', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<title>Phone</title>');
  });

  it('serves index.html for /index.html', async () => {
    expect((await app.request('/index.html')).status).toBe(200);
  });

  it('serves a file with its type', async () => {
    const css = await app.request('/style.css');
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');
    expect(await css.text()).toBe('body { margin: 0 }');
    const js = await app.request('/app.js');
    expect(js.headers.get('content-type')).toMatch(/javascript/);
  });

  it('lets an API route win over a file of the same name', async () => {
    const health = await app.request('/health');
    expect(await health.json()).toEqual({ ok: true });
    const ledger = await app.request('/api/ledger?phone=%2B27000009999');
    expect(ledger.status).toBe(404);
    expect(await ledger.json()).toEqual({ error: 'No demo shop for this number. Start a demo first.' });
  });

  it('answers 404 "Not found." for an unknown GET', async () => {
    const res = await app.request('/no-such-file.txt');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not found.');
  });

  it('answers 404 JSON for an unknown path under /api/', async () => {
    const res = await app.request('/api/no-such-route');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found.' });
  });

  it('does not serve files outside the public folder', async () => {
    for (const p of ['/../x', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%2e%2e%2f%2e%2e%2fetc/passwd', '/a/../../b']) {
      const res = await app.request(p);
      expect(res.status, p).toBe(404);
    }
  });

  it('serves static files only for GET: a POST to a file path is not served', async () => {
    const res = await app.request('/style.css', { method: 'POST', body: 'x' });
    expect(res.status).toBe(404);
  });

  it('keeps the POST routes working', async () => {
    const res = await app.request('/sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ from: '+254711000000', text: 'hello' }).toString()
    });
    expect(res.status).toBe(200);
    expect((await res.text()).length).toBeGreaterThan(0);
  });
});
