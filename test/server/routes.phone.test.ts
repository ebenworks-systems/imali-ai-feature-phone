import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureErrors, DEMO_PHONE, makeApp, makeShopApp, postJson, throwingStore } from './helpers.js';

vi.mock('../../src/channels/index.js', () => ({
  handleUssd: vi.fn(),
  handleText: vi.fn()
}));
import { handleText, handleUssd } from '../../src/channels/index.js';

const ussdMock = vi.mocked(handleUssd);
const textMock = vi.mocked(handleText);

beforeEach(() => {
  ussdMock.mockReset();
  textMock.mockReset();
  ussdMock.mockResolvedValue({ response: 'CON Thandi\'s Spaza\nToday: sales R0' });
  textMock.mockResolvedValue({ reply: 'Saved: sale R45.' });
  captureErrors();
});

const NOT_DEMO = 'Use a demo number: +2700000 followed by 4 digits.';

describe('POST /api/phone/ussd', () => {
  it('gives { response, length, limit: 182 } with length counted after the prefix', async () => {
    const { app } = await makeShopApp();
    const res = await postJson(app, '/api/phone/ussd', { phone: DEMO_PHONE, sessionId: 'S1', text: '1' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body).toEqual({ response: "CON Thandi's Spaza\nToday: sales R0", length: "Thandi's Spaza\nToday: sales R0".length, limit: 182 });
  });

  it('counts an END screen after its prefix too', async () => {
    ussdMock.mockResolvedValue({ response: 'END Saved: sale R45 bread. Sales today R1,285.' });
    const { app } = await makeShopApp();
    const body = await (await postJson(app, '/api/phone/ussd', { phone: DEMO_PHONE })).json();
    expect(body.length).toBe('Saved: sale R45 bread. Sales today R1,285.'.length);
  });

  it('calls the handler as POST /ussd does, with the service code *384*46254#', async () => {
    const { app } = await makeShopApp();
    await postJson(app, '/api/phone/ussd', { phone: '+27 00 000 1234', sessionId: 'S1', text: '1*45' });
    expect(ussdMock.mock.calls[0]![0]).toMatchObject({
      sessionId: 'S1',
      serviceCode: '*384*46254#',
      phoneNumber: DEMO_PHONE,
      text: '1*45',
      now: new Date('2026-11-07T10:00:00.000Z')
    });
  });

  it('makes a new random session id for each call without one, and passes a given one on', async () => {
    const { app } = await makeShopApp();
    await postJson(app, '/api/phone/ussd', { phone: DEMO_PHONE });
    await postJson(app, '/api/phone/ussd', { phone: DEMO_PHONE });
    const [a, b] = ussdMock.mock.calls.map((c) => c[0].sessionId);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(b).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
    await postJson(app, '/api/phone/ussd', { phone: DEMO_PHONE, sessionId: 'mine' });
    expect(ussdMock.mock.calls[2]![0].sessionId).toBe('mine');
  });

  it('uses the empty string when text is missing', async () => {
    const { app } = await makeShopApp();
    await postJson(app, '/api/phone/ussd', { phone: DEMO_PHONE });
    expect(ussdMock.mock.calls[0]![0].text).toBe('');
  });

  it.each([
    ['a body that is not JSON', 'not json'],
    ['a JSON array', '[1,2]'],
    ['a JSON number', '42'],
    ['JSON null', 'null'],
    ['an empty body', ''],
    ['a number phone', { phone: 27000001234 }],
    ['a number text', { phone: DEMO_PHONE, text: 1 }],
    ['a number sessionId', { phone: DEMO_PHONE, sessionId: 5 }]
  ])('answers 400 { error } for %s, without touching the store', async (_name, body) => {
    const { app } = makeApp({ store: throwingStore() });
    const res = await postJson(app, '/api/phone/ussd', body as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(typeof json.error).toBe('string');
    expect(Object.keys(json)).toEqual(['error']);
    expect(ussdMock).not.toHaveBeenCalled();
  });

  it.each([
    ['+254711000000', '+254711000000'],
    ['+2700000123', '+2700000123'],
    ['+27 00 001 1234', '+27 00 001 1234'],
    ['a missing phone', undefined],
    ['an empty phone', ''],
    ['letters', 'hello']
  ])('answers 400 with the demo-number sentence for %s, with no store call', async (_name, phone) => {
    const { app } = makeApp({ store: throwingStore() });
    const res = await postJson(app, '/api/phone/ussd', { phone, text: '' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: NOT_DEMO });
    expect(ussdMock).not.toHaveBeenCalled();
  });

  it('accepts +27 00 000 1234', async () => {
    const { app } = await makeShopApp();
    expect((await postJson(app, '/api/phone/ussd', { phone: '+27 00 000 1234' })).status).toBe(200);
  });

  it('answers 400 for an input of 183 characters after the last *, and accepts 182', async () => {
    const { app } = await makeShopApp();
    const long = await postJson(app, '/api/phone/ussd', { phone: DEMO_PHONE, text: `1*${'9'.repeat(183)}` });
    expect(long.status).toBe(400);
    expect(ussdMock).not.toHaveBeenCalled();
    const ok = await postJson(app, '/api/phone/ussd', { phone: DEMO_PHONE, text: `1*${'9'.repeat(182)}` });
    expect(ok.status).toBe(200);
  });
});

describe('POST /api/phone/sms', () => {
  it('gives { reply, length, limit: 160 }', async () => {
    const { app } = await makeShopApp();
    const res = await postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: 'sold 3 bread 45' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: 'Saved: sale R45.', length: 'Saved: sale R45.'.length, limit: 160 });
  });

  it('calls handleText as POST /sms does: phone, text, now, store, pending, reader', async () => {
    const reader = { read: vi.fn(async () => null) };
    const { app, pending } = await makeShopApp({ reader });
    await postJson(app, '/api/phone/sms', { phone: '+27 00 000 1234', text: 'today' });
    const arg = textMock.mock.calls[0]![0];
    expect(arg).toMatchObject({ phone: DEMO_PHONE, text: 'today', now: new Date('2026-11-07T10:00:00.000Z') });
    expect(arg.pending).toBe(pending);
    // The reader is wrapped in the ceiling on model calls, so it is not the same object, but it asks the same reader.
    await arg.reader!.read('some words');
    expect(reader.read).toHaveBeenCalledWith('some words');
  });

  it('never sends a text message, even when a sender is set', async () => {
    const sender = { send: vi.fn(async () => {}) };
    const { app } = await makeShopApp({ smsSender: sender });
    await postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: 'today' });
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('answers 400 for text of 481 characters, and accepts 480', async () => {
    const { app } = await makeShopApp();
    const long = await postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: 'a'.repeat(481) });
    expect(long.status).toBe(400);
    expect(textMock).not.toHaveBeenCalled();
    const ok = await postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: 'a'.repeat(480) });
    expect(ok.status).toBe(200);
  });

  it.each([
    ['a body that is not JSON', 'oops'],
    ['a JSON array', '[]'],
    ['a missing text', { phone: DEMO_PHONE }],
    ['a number text', { phone: DEMO_PHONE, text: 5 }],
    ['a number phone', { phone: 5, text: 'today' }]
  ])('answers 400 { error } for %s', async (_name, body) => {
    const { app } = makeApp({ store: throwingStore() });
    const res = await postJson(app, '/api/phone/sms', body as never);
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe('string');
    expect(textMock).not.toHaveBeenCalled();
  });

  it.each(['+254711000000', '+2700000123', '+27 00 001 1234', undefined])(
    'answers 400 with the demo-number sentence for the phone %j, with no store call',
    async (phone) => {
      const { app } = makeApp({ store: throwingStore() });
      const res = await postJson(app, '/api/phone/sms', { phone, text: 'today' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: NOT_DEMO });
      expect(textMock).not.toHaveBeenCalled();
    }
  );

  it('answers an empty text (the handler decides what it means)', async () => {
    const { app } = await makeShopApp();
    expect((await postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: '' })).status).toBe(200);
  });
});
