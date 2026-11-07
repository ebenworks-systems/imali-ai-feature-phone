import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const root = new URL('../../', import.meta.url);
const config = JSON.parse(readFileSync(new URL('vercel.json', root), 'utf8')) as {
  outputDirectory?: string;
  framework?: unknown;
  rewrites?: Array<{ source: string; destination: string }>;
};

describe('vercel.json', () => {
  it('has the four rewrites to the function', () => {
    const rewrites = config.rewrites ?? [];
    const bySource = Object.fromEntries(rewrites.map((r) => [r.source, r.destination]));
    expect(bySource).toEqual({
      '/ussd': '/api',
      '/sms': '/api',
      '/health': '/api',
      '/api/:path*': '/api'
    });
  });

  it('serves public/ as static files', () => {
    expect(config.outputDirectory).toBe('public');
  });

  it('sends no rewrite to a file outside api/', () => {
    for (const { destination } of config.rewrites ?? []) {
      expect(destination === '/api' || destination.startsWith('/api/')).toBe(true);
    }
    expect(existsSync(new URL('api/index.ts', root))).toBe(true);
  });
});

describe('api/index.ts', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('exports GET and POST that serve the app, and logs the start line once without a value', async () => {
    for (const name of ['DATABASE_URL', 'GEMINI_API_KEY', 'AT_USERNAME', 'AT_API_KEY', 'AT_CALLBACK_KEY']) vi.stubEnv(name, '');
    vi.stubEnv('VERCEL', '1');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const entry = await import('../../api/index.js');

    expect(typeof entry.GET).toBe('function');
    expect(typeof entry.POST).toBe('function');
    const health = await entry.GET(new Request('https://example.test/health'));
    expect(await health.json()).toEqual({ ok: true });
    const ussd = await entry.POST(
      new Request('https://example.test/ussd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ sessionId: 'S1', serviceCode: '*384*46254#', phoneNumber: '+254711000000', text: '' }).toString()
      })
    );
    expect((await ussd.text()).startsWith('CON ')).toBe(true);

    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).toContain('store=memory');
    expect(warn.mock.calls.map((c) => String(c[0])).join(' ')).toMatch(/records are not kept between calls/);
  });

  it('prints the ADDRESS_SALT warning on the start line when VERCEL is set and ADDRESS_SALT is not', async () => {
    for (const name of ['DATABASE_URL', 'GEMINI_API_KEY', 'AT_USERNAME', 'AT_API_KEY', 'AT_CALLBACK_KEY', 'ADDRESS_SALT']) {
      vi.stubEnv(name, '');
    }
    vi.stubEnv('VERCEL', '1');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await import('../../api/index.js');
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain(
      'Warning: ADDRESS_SALT is not set, so stored address hashes use the public default salt'
    );
  });

  it('prints no ADDRESS_SALT warning when it is set', async () => {
    for (const name of ['DATABASE_URL', 'GEMINI_API_KEY', 'AT_USERNAME', 'AT_API_KEY', 'AT_CALLBACK_KEY']) vi.stubEnv(name, '');
    vi.stubEnv('ADDRESS_SALT', 'value-salt-3z6g');
    vi.stubEnv('VERCEL', '1');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await import('../../api/index.js');
    expect(warn.mock.calls.map((c) => String(c[0])).join(' ')).not.toContain('ADDRESS_SALT');
  });
});
