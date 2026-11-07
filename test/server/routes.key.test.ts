import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryProcessedTextStore } from '../../src/store/processed.js';
import { captureErrors, makeApp, makeShopApp, postForm, postJson, throwingStore } from './helpers.js';

vi.mock('../../src/channels/index.js', () => ({
  handleUssd: vi.fn(async () => ({ response: 'CON Hello' })),
  handleText: vi.fn(async () => ({ reply: 'Hello' }))
}));
import { handleText, handleUssd } from '../../src/channels/index.js';

const KEY = 'test-callback-key-not-real';
const ussd = { sessionId: 'S1', serviceCode: '*384*46254#', phoneNumber: '+254711000034', text: '' };
const sms = { from: '+254711000034', text: 'today', id: 'ATXid_1' };

beforeEach(() => {
  vi.mocked(handleUssd).mockClear();
  vi.mocked(handleText).mockClear();
  captureErrors();
});

/** An app whose store, processed-text store and sender all fail the test if they are touched. */
function lockedApp(callbackKey?: string) {
  const sender = { send: vi.fn(async () => {}) };
  const processed = new InMemoryProcessedTextStore();
  const claim = vi.spyOn(processed, 'claim');
  const built = makeApp({ store: throwingStore(), processed, smsSender: sender, ...(callbackKey ? { callbackKey } : {}) });
  return { ...built, sender, claim };
}

describe('with AT_CALLBACK_KEY set', () => {
  it('lets POST /ussd and POST /sms through with the right k', async () => {
    const { app } = lockedApp(KEY);
    const u = await postForm(app, `/ussd?k=${KEY}`, ussd);
    expect(u.status).toBe(200);
    expect(await u.text()).toBe('CON Hello');
    const s = await postForm(app, `/sms?k=${KEY}`, sms);
    expect(s.status).toBe(200);
    expect(await s.text()).toBe('Hello');
    expect(handleUssd).toHaveBeenCalledTimes(1);
    expect(handleText).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no k', ''],
    ['an empty k', '?k='],
    ['a wrong k', '?k=wrong'],
    ['a key of another length', `?k=${KEY}-and-more`],
    ['a key that is a prefix', `?k=${KEY.slice(0, -1)}`],
    ['the key in another case', `?k=${KEY.toUpperCase()}`],
    ['another parameter name', `?key=${KEY}`]
  ])('answers 403 with a plain sentence for %s, on both routes, and touches nothing', async (_name, query) => {
    const { app, sender, claim } = lockedApp(KEY);
    for (const [path, fields] of [['/ussd', ussd], ['/sms', sms]] as const) {
      const res = await postForm(app, `${path}${query}`, fields);
      expect(res.status).toBe(403);
      expect(res.headers.get('content-type')).toContain('text/plain');
      const body = await res.text();
      expect(body).toBe('Not allowed. Check the key in the callback address.');
      expect(body).not.toContain(KEY);
    }
    expect(handleUssd).not.toHaveBeenCalled();
    expect(handleText).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('uses the first k when it is repeated', async () => {
    const { app } = lockedApp(KEY);
    expect((await postForm(app, `/sms?k=wrong&k=${KEY}`, sms)).status).toBe(403);
    expect((await postForm(app, `/sms?k=${KEY}&k=wrong`, sms)).status).toBe(200);
  });

  it('answers 403 before the body is read: a 9 KB body without the key gets 403, not 413', async () => {
    const { app } = lockedApp(KEY);
    const res = await postForm(app, '/sms', { from: '+254711000034', text: 'x'.repeat(9000) });
    expect(res.status).toBe(403);
    const withKey = await postForm(app, `/sms?k=${KEY}`, { from: '+254711000034', text: 'x'.repeat(9000) });
    expect(withKey.status).toBe(413);
  });

  it('does not put the key in a response header', async () => {
    const { app } = lockedApp(KEY);
    const res = await postForm(app, '/ussd?k=wrong', ussd);
    expect(JSON.stringify([...res.headers])).not.toContain(KEY);
  });

  it('never asks for the key on /health or on the browser routes', async () => {
    const { app } = await makeShopApp({ callbackKey: KEY });
    expect((await app.request('/health')).status).toBe(200);
    const phone = await postJson(app, '/api/phone/sms', { phone: '+27000001234', text: 'today' });
    expect(phone.status).toBe(200);
    expect((await app.request('/api/ledger?phone=%2B27000009999')).status).toBe(404);
    expect((await postJson(app, '/api/phone/ussd', { phone: '+27000001234' })).status).toBe(200);
    expect((await postJson(app, '/api/phone/demo', { phone: '+27000004321' })).status).toBe(201);
  });

  it('counts a key of only spaces as not set', async () => {
    const { app } = makeApp({ callbackKey: '   ' });
    expect((await postForm(app, '/sms', sms)).status).toBe(200);
    expect((await postForm(app, '/ussd', ussd)).status).toBe(200);
  });
});

describe('with no AT_CALLBACK_KEY', () => {
  it('answers both routes without k, and ignores a k that is given', async () => {
    const { app } = makeApp();
    expect((await postForm(app, '/ussd', ussd)).status).toBe(200);
    expect((await postForm(app, '/sms', sms)).status).toBe(200);
    expect((await postForm(app, '/sms?k=anything', sms)).status).toBe(200);
  });
});
