import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryProcessedTextStore } from '../../src/store/processed.js';
import { MemoryStore } from '../../src/store/memory/store.js';
import type { LedgerStore } from '../../src/store/interface.js';
import { DEMO_PHONE, makeApp, postForm, postJson } from './helpers.js';

const SECRET_MESSAGE = 'connection to db.internal:5432 failed password authentication';
const GENERIC = 'Sorry, something went wrong. Please try again.';

afterEach(() => vi.restoreAllMocks());

/** A store that works, except that every read of a shop fails with a database-looking error. */
function failingStore(message = SECRET_MESSAGE): LedgerStore {
  const store = new MemoryStore();
  const fail = async () => {
    const error = new Error(message);
    error.name = 'PostgresError';
    throw error;
  };
  vi.spyOn(store, 'findShopByPhone').mockImplementation(fail);
  vi.spyOn(store, 'countShopsWithPhonePrefix').mockImplementation(fail);
  return store;
}

function logged(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call) => String(call[0])).join('\n');
}

/** Everything a caller could read: status line aside, the body and all headers. */
async function everything(res: Response): Promise<string> {
  return `${await res.text()}\n${JSON.stringify([...res.headers])}`;
}

function expectNoLeak(text: string) {
  expect(text).not.toContain('db.internal');
  expect(text).not.toContain('5432');
  expect(text).not.toContain('password');
  expect(text).not.toMatch(/\n\s+at /); // a stack line
  expect(text).not.toMatch(/\.ts:\d+/);
  expect(text).not.toMatch(/node_modules/);
  expect(text).not.toMatch(/select |insert |postgres:\/\//i);
}

describe('a store that throws a database-looking error', () => {
  it('POST /sms: 200 with the plain sentence; the message and the stack are logged, not answered', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app } = makeApp({ store: failingStore() });
    const res = await postForm(app, '/sms', { from: '+254711000034', text: 'sold 3 bread 45' });
    expect(res.status).toBe(200);
    expect(await res.clone().text()).toBe(GENERIC);
    expectNoLeak(await everything(res));
    const line = JSON.parse(logged(log).split('\n')[0]!);
    expect(line).toMatchObject({ level: 'error', route: '/sms', name: 'PostgresError', message: SECRET_MESSAGE });
    expect(line.stack).toContain(SECRET_MESSAGE);
    expect(line.phone).toBe('+254***34');
    expect(logged(log)).not.toContain('+254711000034');
  });

  it('POST /ussd: 200 END with a plain sentence; the message is logged, not answered', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app } = makeApp({ store: failingStore() });
    const res = await postForm(app, '/ussd', { sessionId: 'S1', serviceCode: '*384*46254#', phoneNumber: '+254711000034', text: '' });
    expect(res.status).toBe(200);
    const body = await res.clone().text();
    expect(body).toMatch(/^END Sorry, something went wrong/);
    expectNoLeak(await everything(res));
    expect(logged(log)).toContain(SECRET_MESSAGE);
  });

  it.each([
    ['POST /api/phone/ussd', (app: Parameters<typeof postJson>[0]) => postJson(app, '/api/phone/ussd', { phone: DEMO_PHONE })],
    ['POST /api/phone/sms', (app: Parameters<typeof postJson>[0]) => postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: 'today' })],
    ['POST /api/phone/demo', (app: Parameters<typeof postJson>[0]) => postJson(app, '/api/phone/demo', { phone: DEMO_PHONE })],
    ['GET /api/ledger', (app: { request: (p: string) => Response | Promise<Response> }) => app.request(`/api/ledger?phone=${encodeURIComponent(DEMO_PHONE)}`)],
    ['GET /api/export', (app: { request: (p: string) => Response | Promise<Response> }) => app.request(`/api/export?phone=${encodeURIComponent(DEMO_PHONE)}`)]
  ])('%s: the route answers with a plain sentence and leaks nothing', async (_name, call) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app } = makeApp({ store: failingStore() });
    const res = await call(app as never);
    const text = await everything(res);
    expectNoLeak(text);
    expect(logged(log)).toContain(SECRET_MESSAGE);
    // The ussd and sms routes look the shop up themselves (a number with no shop is refused before the handler runs),
    // so a store that fails on that lookup gives the same plain 500 on every browser route.
    expect(res.status).toBe(500);
    expect(text).toContain(`"error":"${GENERIC}"`);
    const line = JSON.parse(logged(log).split('\n')[0]!);
    expect(line.stack).toContain(SECRET_MESSAGE);
    expect(line.route).toMatch(/^\/api\//);
  });

  it('puts neither the message nor a stack in a header, on any route', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app } = makeApp({ store: failingStore() });
    const responses = [
      await postForm(app, '/sms', { from: '+254711000034', text: 'today' }),
      await postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: 'today' })
    ];
    for (const res of responses) {
      const headers = JSON.stringify([...res.headers]);
      expect(headers).not.toContain('db.internal');
      expect(headers).not.toMatch(/ at /);
    }
  });

  it('keeps a connection string out of the answer even when the error message holds one', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Built in pieces so the scanner for keys in staged files does not take this fake value for a real one.
    const url = ['postgres', '://demo_user:', 'not-a-real-password', '@db.example.invalid/demo_db'].join('');
    const { app } = makeApp({ store: failingStore(`could not connect to ${url}`) });
    const res = await postForm(app, '/sms', { from: '+254711000034', text: 'today' });
    const text = await everything(res);
    expect(text).not.toContain('not-a-real-password');
    expect(text).not.toContain('db.example.invalid');
    expect(text).toContain(GENERIC);
    expect(logged(log)).toContain('db.example.invalid');
  });

  it('answers a thrown non-Error with the plain sentence too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new MemoryStore();
    vi.spyOn(store, 'findShopByPhone').mockRejectedValue('just a string, not an Error');
    const { app } = makeApp({ store });
    const res = await postForm(app, '/sms', { from: '+254711000034', text: 'today' });
    expect(await res.text()).toBe(GENERIC);
  });
});

describe('the sender and the processed-text store', () => {
  it('a sender that throws gives 200 with the reply and one log line, and no answer leaks the message', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sender = { send: vi.fn(async () => { throw new Error(`Africa's Talking refused the text (status 401) ${SECRET_MESSAGE}`); }) };
    const { app } = makeApp({ smsSender: sender });
    const res = await postForm(app, '/sms', { from: '+254711000000', text: 'hello' });
    expect(res.status).toBe(200);
    expectNoLeak(await everything(res));
    expect(log).toHaveBeenCalledTimes(1);
    expect(logged(log)).toContain('status 401');
  });

  it('a processed-text store that fails answers the plain sentence and leaks nothing', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const processed = new InMemoryProcessedTextStore();
    vi.spyOn(processed, 'claim').mockRejectedValue(new Error(SECRET_MESSAGE));
    const { app } = makeApp({ processed });
    const res = await postForm(app, '/sms', { from: '+254711000034', text: 'today', id: 'ATXid_1' });
    expect(res.status).toBe(200);
    expect(await res.clone().text()).toBe(GENERIC);
    expectNoLeak(await everything(res));
    expect(logged(log)).toContain(SECRET_MESSAGE);
  });
});
