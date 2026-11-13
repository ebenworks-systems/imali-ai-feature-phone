import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryPendingStore } from '../../src/channels/sms/pending.js';
import { GeminiReader } from '../../src/ai/reader.js';
import { MemoryStore } from '../../src/store/memory/store.js';
import { InMemoryProcessedTextStore } from '../../src/store/processed.js';
import { createAppFromEnv } from '../../src/server/bootstrap.js';

// No connection is made: the Postgres parts are replaced by fakes that record how they were built.
const pg = vi.hoisted(() => {
  const sql = { fake: 'sql' };
  const store = { fake: 'store' };
  class PostgresPendingStore { constructor(public sql: unknown) {} }
  class PostgresProcessedTextStore { constructor(public sql: unknown) {} }
  class PostgresDemoQuotaStore { constructor(public sql: unknown) {} }
  return {
    sql,
    store,
    PostgresPendingStore,
    PostgresProcessedTextStore,
    PostgresDemoQuotaStore,
    connectPostgres: vi.fn((_url: string) => sql),
    closePostgres: vi.fn(async (_sql: unknown) => {}),
    createPostgresStore: vi.fn((_sql: unknown) => store)
  };
});
vi.mock('../../src/store/postgres/index.js', () => pg);

const KEY = 'test-key-not-real';

/** A fake fetch that records every call and throws for a URL the test did not expect. */
function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return handler(String(input), init ?? {});
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const sms = (app: { request: (p: string, i?: RequestInit) => Response | Promise<Response> }, fields: Record<string, string>, query = '') =>
  app.request(`/sms${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString()
  });

beforeEach(() => {
  pg.connectPostgres.mockClear();
  pg.closePostgres.mockClear();
  pg.createPostgresStore.mockClear();
});

describe('createAppFromEnv with nothing set', () => {
  it('builds the memory parts, no reader, no sender, no callback key', () => {
    const started = createAppFromEnv({});
    expect(started.parts.store).toBeInstanceOf(MemoryStore);
    expect(started.parts.pending).toBeInstanceOf(InMemoryPendingStore);
    expect(started.parts.processed).toBeInstanceOf(InMemoryProcessedTextStore);
    expect(started.parts.reader).toBeUndefined();
    expect(started.parts.smsSender).toBeUndefined();
    expect(started.parts.callbackKey).toBeUndefined();
    expect(started.summary).toBe('store=memory gemini=off sms=off callback=open salt=default');
    expect(started.warnings).toEqual([]);
    expect(pg.connectPostgres).not.toHaveBeenCalled();
  });

  it('treats blank values as not set', () => {
    const started = createAppFromEnv({ DATABASE_URL: ' ', GEMINI_API_KEY: '', AT_USERNAME: '  ', AT_API_KEY: '', AT_CALLBACK_KEY: ' ' });
    expect(started.summary).toBe('store=memory gemini=off sms=off callback=open salt=default');
  });

  it('answers /health and keeps close() harmless', async () => {
    const started = createAppFromEnv({});
    expect((await started.app.request('/health')).status).toBe(200);
    await expect(started.close()).resolves.toBeUndefined();
  });
});

describe('the Gemini reader', () => {
  it('is built when GEMINI_API_KEY is set', () => {
    const started = createAppFromEnv({ GEMINI_API_KEY: KEY });
    expect(started.parts.reader).toBeInstanceOf(GeminiReader);
    expect(started.summary).toContain('gemini=on');
  });

  it('says gemini=vertex in the start line when GEMINI_VERTEX_PROJECT is also set', () => {
    const started = createAppFromEnv({ GEMINI_API_KEY: KEY, GEMINI_VERTEX_PROJECT: 'proj-1' });
    expect(started.parts.reader).toBeInstanceOf(GeminiReader);
    expect(started.summary).toContain('gemini=vertex');
  });

  it('sends the reader\'s calls to Vertex AI in that project when GEMINI_VERTEX_PROJECT is set', async () => {
    const { fetch, calls } = fakeFetch(() => new Response('{}', { status: 200 }));
    const started = createAppFromEnv({ GEMINI_API_KEY: KEY, GEMINI_VERTEX_PROJECT: 'proj-1' }, { fetch });
    await started.parts.reader!.read('zzzz qqqq');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.startsWith('https://aiplatform.googleapis.com/v1/projects/proj-1/locations/global/')).toBe(true);
  });

  it('is not built when only GEMINI_MODEL is set', async () => {
    const { fetch, calls } = fakeFetch(() => new Response('{}'));
    const started = createAppFromEnv({ GEMINI_MODEL: 'gemini-test-model' }, { fetch });
    expect(started.parts.reader).toBeUndefined();
    expect(started.summary).toContain('gemini=off');
    await started.app.request('/api/phone/demo', { method: 'POST', body: JSON.stringify({ phone: '+27000001234' }) });
    await started.app.request('/api/phone/sms', { method: 'POST', body: JSON.stringify({ phone: '+27000001234', text: 'zzzz qqqq' }) });
    expect(calls).toHaveLength(0);
  });

  it('asks the model named in GEMINI_MODEL, with the key in a header and not in the URL', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
    const started = createAppFromEnv({ GEMINI_API_KEY: KEY, GEMINI_MODEL: 'gemini-test-model' }, { fetch });
    await started.app.request('/api/phone/demo', { method: 'POST', body: JSON.stringify({ phone: '+27000001234' }) });
    const res = await started.app.request('/api/phone/sms', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27000001234', text: 'zzzz qqqq wwww' })
    });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/models/gemini-test-model:generateContent');
    expect(calls[0]!.url).not.toContain(KEY);
    expect(JSON.stringify(calls[0]!.init.headers)).toContain(KEY);
  });

  it('uses the reader\'s own default model when GEMINI_MODEL is not set', async () => {
    const { fetch, calls } = fakeFetch(() => new Response('{}', { status: 200 }));
    const started = createAppFromEnv({ GEMINI_API_KEY: KEY }, { fetch });
    await started.app.request('/api/phone/demo', { method: 'POST', body: JSON.stringify({ phone: '+27000001234' }) });
    await started.app.request('/api/phone/sms', { method: 'POST', body: JSON.stringify({ phone: '+27000001234', text: 'zzzz qqqq wwww' }) });
    expect(calls[0]!.url).toContain('/models/gemini-3.5-flash-lite:generateContent');
  });
});

describe('the Africa\'s Talking sender', () => {
  it('is built when both AT variables are set, and reported as sandbox for AT_USERNAME=sandbox', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(JSON.stringify({ SMSMessageData: { Recipients: [{ statusCode: 101 }] } }), { status: 201 }));
    const started = createAppFromEnv({ AT_USERNAME: 'sandbox', AT_API_KEY: KEY, AT_CALLBACK_KEY: KEY }, { fetch });
    expect(started.parts.smsSender).toBeDefined();
    expect(started.summary).toBe('store=memory gemini=off sms=sandbox callback=key salt=default');

    const res = await sms(started.app, { from: '+254711000000', text: 'hello', id: 'ATXid_1' }, `?k=${KEY}`);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.sandbox.africastalking.com/version1/messaging');
    const form = new URLSearchParams(String(calls[0]!.init.body));
    expect(form.get('from')).toBe('46254');
    expect(form.get('to')).toBe('+254711000000');
    expect(form.get('username')).toBe('sandbox');
    expect((calls[0]!.init.headers as Record<string, string>).apiKey).toBe(KEY);
  });

  it('uses AT_SHORTCODE as the from field', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(JSON.stringify({ SMSMessageData: { Recipients: [] } }), { status: 201 }));
    const started = createAppFromEnv(
      { AT_USERNAME: 'sandbox', AT_API_KEY: KEY, AT_SHORTCODE: '12345', AT_CALLBACK_KEY: KEY },
      { fetch }
    );
    await sms(started.app, { from: '+254711000000', text: 'hello' }, `?k=${KEY}`);
    expect(new URLSearchParams(String(calls[0]!.init.body)).get('from')).toBe('12345');
  });

  it('uses the live host and reports live for another username', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(JSON.stringify({ SMSMessageData: { Recipients: [] } }), { status: 201 }));
    const started = createAppFromEnv({ AT_USERNAME: 'imali', AT_API_KEY: KEY, AT_CALLBACK_KEY: KEY }, { fetch });
    expect(started.summary).toContain('sms=live');
    await sms(started.app, { from: '+254711000000', text: 'hello' }, `?k=${KEY}`);
    expect(calls[0]!.url).toBe('https://api.africastalking.com/version1/messaging');
  });

  it('is not built when only one variable is set, and warns by name without a value', () => {
    const started = createAppFromEnv({ AT_USERNAME: 'secret-name-value' });
    expect(started.parts.smsSender).toBeUndefined();
    expect(started.warnings).toHaveLength(1);
    expect(started.warnings[0]).toContain('AT_API_KEY');
    expect(JSON.stringify(started.warnings)).not.toContain('secret-name-value');
  });
});

describe('the sender without a callback key', () => {
  const env = { AT_USERNAME: 'sandbox', AT_API_KEY: KEY };
  const ussd = (app: { request: (p: string, i?: RequestInit) => Response | Promise<Response> }, query = '') =>
    app.request(`/ussd${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ sessionId: 'S1', serviceCode: '*384*46254#', phoneNumber: '+254711000000', text: '' }).toString()
    });

  it('starts, says callback=missing-key on the start line and warns by name', () => {
    const started = createAppFromEnv(env);
    expect(started.summary).toBe('store=memory gemini=off sms=sandbox callback=missing-key salt=default');
    expect(started.warnings.join(' ')).toContain('AT_CALLBACK_KEY');
    expect(JSON.stringify(started.warnings)).not.toContain(KEY);
  });

  it('answers 503 with a plain sentence on /ussd and /sms, and sends nothing', async () => {
    const { fetch, calls } = fakeFetch(() => new Response('{}', { status: 201 }));
    const started = createAppFromEnv(env, { fetch });
    for (const res of [await sms(started.app, { from: '+254711000000', text: 'hello' }), await ussd(started.app)]) {
      expect(res.status).toBe(503);
      expect(await res.text()).toBe('This service is not set up yet. Please try again later.');
    }
    // A call that guesses a key is not let in either, because there is no key.
    expect((await sms(started.app, { from: '+254711000000', text: 'hello' }, '?k=')).status).toBe(503);
    expect((await sms(started.app, { from: '+254711000000', text: 'hello' }, `?k=${KEY}`)).status).toBe(503);
    expect(calls).toHaveLength(0);
    expect(await started.parts.store.findShopByPhone('+254711000000')).toBeNull();
  });

  it('keeps the browser routes and /health working', async () => {
    const started = createAppFromEnv(env);
    expect((await started.app.request('/health')).status).toBe(200);
    const made = await started.app.request('/api/phone/demo', { method: 'POST', body: JSON.stringify({ phone: '+27000001234' }) });
    expect(made.status).toBe(201);
    const text = await started.app.request('/api/phone/sms', { method: 'POST', body: JSON.stringify({ phone: '+27000001234', text: 'today' }) });
    expect(text.status).toBe(200);
  });

  it('is not triggered when there is no sender (a local run stays open) or when a key is set', async () => {
    expect((await sms(createAppFromEnv({}).app, { from: '+254711000000', text: 'hello' })).status).toBe(200);
    const withKey = createAppFromEnv({ ...env, AT_CALLBACK_KEY: KEY }, { fetch: fakeFetch(() => new Response('{}', { status: 201 })).fetch });
    expect(withKey.summary).toContain('callback=key');
    expect((await sms(withKey.app, { from: '+254711000000', text: 'hello' }, `?k=${KEY}`)).status).toBe(200);
  });
});

describe('ADDRESS_SALT', () => {
  it('says salt=default on the start line when it is not set, and salt=set (never the value) when it is', () => {
    expect(createAppFromEnv({}).summary).toContain('salt=default');
    expect(createAppFromEnv({ ADDRESS_SALT: '   ' }).summary).toContain('salt=default');
    const started = createAppFromEnv({ ADDRESS_SALT: 'a-long-random-salt-value' });
    expect(started.summary).toContain('salt=set');
    expect(started.summary).not.toContain('a-long-random-salt-value');
  });

  it('hashes addresses with the salt, so two salts give two different keys', async () => {
    const keysFor = async (env: Record<string, string>) => {
      const started = createAppFromEnv(env);
      await started.app.request('/api/phone/demo', { method: 'POST', headers: { 'x-real-ip': '203.0.113.7' }, body: '{}' });
      return (started.parts.quota as unknown as { keys(): string[] }).keys();
    };
    const [a] = await keysFor({});
    const [b] = await keysFor({ ADDRESS_SALT: 'another-salt' });
    const [c] = await keysFor({});
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(a).toBe(c); // the same fixed salt in every instance, so every instance counts alike
  });
});

describe('the callback key', () => {
  it('closes /ussd and /sms to calls without ?k=<the key>', async () => {
    const started = createAppFromEnv({ AT_CALLBACK_KEY: KEY });
    expect(started.summary).toContain('callback=key');
    expect((await sms(started.app, { from: '+254711000000', text: 'hello' })).status).toBe(403);
    expect((await sms(started.app, { from: '+254711000000', text: 'hello' }, '?k=wrong')).status).toBe(403);
    expect((await sms(started.app, { from: '+254711000000', text: 'hello' }, `?k=${KEY}`)).status).toBe(200);
  });
});

describe('DATABASE_URL', () => {
  it('builds the Postgres parts, and close() ends the pool', async () => {
    const started = createAppFromEnv({ DATABASE_URL: 'database-url-not-real' });
    expect(pg.connectPostgres).toHaveBeenCalledWith('database-url-not-real');
    expect(pg.createPostgresStore).toHaveBeenCalledWith(pg.sql);
    expect(started.parts.store).toBe(pg.store);
    expect(started.parts.pending).toBeInstanceOf(pg.PostgresPendingStore);
    expect((started.parts.pending as unknown as { sql: unknown }).sql).toBe(pg.sql);
    expect(started.parts.processed).toBeInstanceOf(pg.PostgresProcessedTextStore);
    expect(started.parts.quota).toBeInstanceOf(pg.PostgresDemoQuotaStore);
    expect((started.parts.quota as unknown as { sql: unknown }).sql).toBe(pg.sql);
    expect(started.summary).toContain('store=postgres');
    expect(pg.closePostgres).not.toHaveBeenCalled();
    await started.close();
    expect(pg.closePostgres).toHaveBeenCalledWith(pg.sql);
  });
});

describe('VERCEL', () => {
  it('adds the memory-store warning when DATABASE_URL is not set', () => {
    const started = createAppFromEnv({ VERCEL: '1' });
    expect(started.warnings.join(' ')).toMatch(/records are not kept between calls/);
  });

  it('adds no such warning when DATABASE_URL is set', () => {
    expect(createAppFromEnv({ VERCEL: '1', DATABASE_URL: 'x', ADDRESS_SALT: 'x' }).warnings).toEqual([]);
  });

  it('warns that the public default salt is used when ADDRESS_SALT is not set, and still starts', async () => {
    const started = createAppFromEnv({ VERCEL: '1', DATABASE_URL: 'x' });
    expect(started.warnings).toEqual(['ADDRESS_SALT is not set, so stored address hashes use the public default salt']);
    expect(started.summary).toContain('salt=default');
    expect((await started.app.request('/health')).status).toBe(200);
  });

  it('has no such warning when ADDRESS_SALT is set, and none on a local run', () => {
    const set = createAppFromEnv({ VERCEL: '1', DATABASE_URL: 'x', ADDRESS_SALT: 'a-long-random-salt' });
    expect(set.warnings).toEqual([]);
    expect(set.summary).toContain('salt=set');
    expect(createAppFromEnv({}).warnings).toEqual([]);
    expect(createAppFromEnv({ ADDRESS_SALT: '' }).warnings).toEqual([]);
  });
});

describe('secrets', () => {
  it('never put the value of a variable in the summary or the warnings', () => {
    const env = {
      DATABASE_URL: 'value-database-9f2a',
      GEMINI_API_KEY: 'value-gemini-8e1b',
      GEMINI_MODEL: 'value-model-7d0c',
      AT_USERNAME: 'value-user-6c9d',
      AT_API_KEY: 'value-atkey-5b8e',
      AT_SHORTCODE: '98765',
      AT_CALLBACK_KEY: 'value-callback-4a7f',
      ADDRESS_SALT: 'value-salt-3z6g',
      VERCEL: '1'
    };
    const started = createAppFromEnv(env);
    const text = `${started.summary} ${started.warnings.join(' ')}`;
    for (const value of Object.values(env)) expect(text).not.toContain(value);
    const onlyOne = createAppFromEnv({ ...env, AT_API_KEY: '' });
    expect(`${onlyOne.summary} ${onlyOne.warnings.join(' ')}`).not.toContain('value-user-6c9d');
  });
});
