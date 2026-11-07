import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryProcessedTextStore } from '../../src/store/processed.js';
import { SENTENCES } from '../../src/server/constants.js';
import { captureErrors, makeApp, makeShopApp, postForm, throwingStore } from './helpers.js';

vi.mock('../../src/channels/index.js', () => ({
  handleUssd: vi.fn(),
  handleText: vi.fn()
}));
import { handleText, handleUssd } from '../../src/channels/index.js';

const ussdFields = { sessionId: 'ATUid_1', serviceCode: '*384*46254#', phoneNumber: '+254711000034', text: '1*45' };
const ussdMock = vi.mocked(handleUssd);
const textMock = vi.mocked(handleText);

let errors: ReturnType<typeof captureErrors>;

beforeEach(() => {
  ussdMock.mockReset();
  textMock.mockReset();
  ussdMock.mockResolvedValue({ response: 'CON Next screen' });
  textMock.mockResolvedValue({ reply: 'Saved: sale R45.' });
  errors = captureErrors();
});

// Under vitest 4 the console.error spy made in beforeEach kept the calls of the tests before it: give the real one back each time.
afterEach(() => vi.restoreAllMocks());

describe('POST /ussd', () => {
  it('passes sessionId, serviceCode, the normalised phone, text, now and the store to handleUssd', async () => {
    const { app, store } = makeApp();
    const res = await postForm(app, '/ussd', { ...ussdFields, phoneNumber: '+254 711 000 034' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe('CON Next screen');
    expect(ussdMock).toHaveBeenCalledTimes(1);
    const arg = ussdMock.mock.calls[0]![0];
    expect(arg).toMatchObject({
      sessionId: 'ATUid_1',
      serviceCode: '*384*46254#',
      phoneNumber: '+254711000034',
      text: '1*45',
      now: new Date('2026-11-07T10:00:00.000Z')
    });
    // The store is the app's store (wrapped by the record cap), so it must answer like the one given.
    await store.createShop({
      id: 's', name: 'S', phone: '+27000009999', currency: 'ZAR', timeZone: 'UTC', createdAt: '2026-11-07T10:00:00.000Z'
    });
    expect((await arg.store.findShopByPhone('+27000009999'))?.id).toBe('s');
  });

  it('answers with END screens as they are', async () => {
    ussdMock.mockResolvedValue({ response: 'END Saved: sale R45 bread. Sales today R1,285.' });
    const { app } = makeApp();
    expect(await (await postForm(app, '/ussd', ussdFields)).text()).toBe('END Saved: sale R45 bread. Sales today R1,285.');
  });

  it('treats a missing text as the empty string (the first dial)', async () => {
    const { app } = makeApp();
    const { text: _ignored, ...withoutText } = ussdFields;
    expect((await postForm(app, '/ussd', withoutText)).status).toBe(200);
    expect(ussdMock.mock.calls[0]![0].text).toBe('');
  });

  it.each(['sessionId', 'serviceCode', 'phoneNumber'] as const)('answers 400 with a plain sentence when %s is missing', async (name) => {
    const { app } = makeApp({ store: throwingStore() });
    const res = await postForm(app, '/ussd', { ...ussdFields, [name]: undefined });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe(`Missing field: ${name}.`);
    expect(ussdMock).not.toHaveBeenCalled();
  });

  it('answers 400 when the phone number is not shaped like a phone number', async () => {
    const { app } = makeApp({ store: throwingStore() });
    for (const bad of ['abc', '12', '+', '1234567890123456']) {
      const res = await postForm(app, '/ussd', { ...ussdFields, phoneNumber: bad });
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('That phone number does not look right.');
    }
    expect(ussdMock).not.toHaveBeenCalled();
  });

  it('answers 400 for a JSON body, which a phone cannot send', async () => {
    const { app } = makeApp();
    const res = await app.request('/ussd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ussdFields)
    });
    expect(res.status).toBe(400);
    expect(ussdMock).not.toHaveBeenCalled();
  });

  it('accepts a phone number that is not a demo number (+254711000000)', async () => {
    const { app } = makeApp();
    const res = await postForm(app, '/ussd', { ...ussdFields, phoneNumber: '+254711000000' });
    expect(res.status).toBe(200);
    expect(ussdMock.mock.calls[0]![0].phoneNumber).toBe('+254711000000');
  });

  it('does not limit the rate of Africa\'s Talking calls', async () => {
    const { app } = makeApp();
    for (let i = 0; i < 70; i += 1) expect((await postForm(app, '/ussd', ussdFields)).status).toBe(200);
  });

  it('answers 200 END with a sentence for an input of 183 characters after the last *, without calling the handler', async () => {
    const { app } = makeApp();
    const res = await postForm(app, '/ussd', { ...ussdFields, text: `1*${'9'.repeat(183)}` });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('END That entry is too long. Please dial again.');
    expect(ussdMock).not.toHaveBeenCalled();
  });

  it('lets an input of exactly 182 characters through', async () => {
    const { app } = makeApp();
    const res = await postForm(app, '/ussd', { ...ussdFields, text: `1*${'9'.repeat(182)}` });
    expect(await res.text()).toBe('CON Next screen');
    expect(ussdMock).toHaveBeenCalledTimes(1);
  });

  it('lets a long text made of short inputs through', async () => {
    const { app } = makeApp();
    const text = Array.from({ length: 120 }, () => '1').join('*');
    expect(text.length).toBeGreaterThan(182);
    const res = await postForm(app, '/ussd', { ...ussdFields, text });
    expect(await res.text()).toBe('CON Next screen');
  });

  it.each(['Hello', '', 'CONNECT', 'end of the road', 'CON'])(
    'turns the response %j (no CON or END prefix) into the generic END sentence and logs it',
    async (response) => {
      ussdMock.mockResolvedValue({ response });
      const { app } = makeApp();
      const res = await postForm(app, '/ussd', ussdFields);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('END Sorry, something went wrong. Please try again.');
      expect(errors).toHaveBeenCalledTimes(1);
      const line = JSON.parse(String(errors.mock.calls[0]![0]));
      expect(line.route).toBe('/ussd');
      expect(line.phone).toBe('+254***34');
    }
  );

  it('answers END with the generic sentence and logs name, message, stack and a masked phone when the handler throws', async () => {
    ussdMock.mockRejectedValue(new Error('connection to db.internal:5432 failed'));
    const { app } = makeApp();
    const res = await postForm(app, '/ussd', ussdFields);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe('END Sorry, something went wrong. Please try again.');
    expect(body).not.toContain('db.internal');
    const line = JSON.parse(String(errors.mock.calls[0]![0]));
    expect(line).toMatchObject({ route: '/ussd', name: 'Error', message: 'connection to db.internal:5432 failed' });
    expect(line.stack).toContain('db.internal');
  });
});

describe('POST /sms', () => {
  const smsFields = { from: '+254711000034', to: '46254', text: 'sold 3 bread 45', date: '2026-11-07 12:00:00', id: 'ATXid_1' };

  it('passes phone, text, now, the store, the pending store and the reader to handleText', async () => {
    const reader = { read: vi.fn(async () => null) };
    const { app, pending } = makeApp({ reader });
    const res = await postForm(app, '/sms', { ...smsFields, from: '+254 711 000 034' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe('Saved: sale R45.');
    const arg = textMock.mock.calls[0]![0];
    expect(arg).toMatchObject({ phone: '+254711000034', text: 'sold 3 bread 45', now: new Date('2026-11-07T10:00:00.000Z') });
    expect(arg.pending).toBe(pending);
    // The reader is wrapped in the ceiling on model calls, so it is not the same object, but it asks the same reader.
    await arg.reader!.read('some words');
    expect(reader.read).toHaveBeenCalledWith('some words');
    expect(typeof arg.store.findShopByPhone).toBe('function');
  });

  it('passes no reader when none was given', async () => {
    const { app } = makeApp();
    await postForm(app, '/sms', smsFields);
    expect(textMock.mock.calls[0]![0].reader).toBeUndefined();
  });

  it('works without to, date and id', async () => {
    const { app } = makeApp();
    const res = await postForm(app, '/sms', { from: '+254711000034', text: 'today' });
    expect(res.status).toBe(200);
  });

  it('answers 400 when from or text is missing, without calling the handler', async () => {
    const { app } = makeApp({ store: throwingStore() });
    const noFrom = await postForm(app, '/sms', { text: 'today' });
    expect(noFrom.status).toBe(400);
    expect(await noFrom.text()).toBe('Missing field: from.');
    const noText = await postForm(app, '/sms', { from: '+254711000034' });
    expect(noText.status).toBe(400);
    expect(await noText.text()).toBe('Missing field: text.');
    const badFrom = await postForm(app, '/sms', { from: 'hello', text: 'today' });
    expect(badFrom.status).toBe(400);
    expect(textMock).not.toHaveBeenCalled();
  });

  it('accepts an empty text (the handler decides what it means)', async () => {
    const { app } = makeApp();
    expect((await postForm(app, '/sms', { from: '+254711000034', text: '' })).status).toBe(200);
    expect(textMock).toHaveBeenCalledTimes(1);
  });

  it('replies "too long" for text of 481 characters, sends that reply, and does not call the handler', async () => {
    const sender = { send: vi.fn(async () => {}) };
    const { app } = makeApp({ smsSender: sender });
    const res = await postForm(app, '/sms', { ...smsFields, from: '+254711000000', text: 'a'.repeat(481) });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('That message is too long. Please send a shorter one.');
    expect(textMock).not.toHaveBeenCalled();
    expect(sender.send).toHaveBeenCalledWith('+254711000000', 'That message is too long. Please send a shorter one.');
  });

  it('lets text of exactly 480 characters through', async () => {
    const { app } = makeApp();
    await postForm(app, '/sms', { ...smsFields, text: 'a'.repeat(480) });
    expect(textMock).toHaveBeenCalledTimes(1);
  });

  describe('the text sender', () => {
    it('sends the reply to from, once, and waits for it', async () => {
      let finished = false;
      const sender = {
        send: vi.fn(async () => {
          await new Promise((r) => setTimeout(r, 15));
          finished = true;
        })
      };
      const { app } = makeApp({ smsSender: sender });
      const res = await postForm(app, '/sms', { ...smsFields, from: '+254711000000' });
      expect(finished).toBe(true);
      expect(await res.text()).toBe('Saved: sale R45.');
      expect(sender.send).toHaveBeenCalledTimes(1);
      expect(sender.send).toHaveBeenCalledWith('+254711000000', 'Saved: sale R45.');
    });

    it('sends nothing to a demo number that has a shop', async () => {
      const sender = { send: vi.fn(async () => {}) };
      const { app } = await makeShopApp({ smsSender: sender });
      const res = await postForm(app, '/sms', { ...smsFields, from: '+27000001234' });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('Saved: sale R45.'); // +27000001234 is a demo number with a shop
      expect(textMock).toHaveBeenCalledTimes(1);
      expect(sender.send).not.toHaveBeenCalled();
    });

    it('sends to a number that is not a demo number', async () => {
      const sender = { send: vi.fn(async () => {}) };
      const { app } = makeApp({ smsSender: sender });
      await postForm(app, '/sms', { ...smsFields, from: '+254711000000' });
      expect(sender.send).toHaveBeenCalledWith('+254711000000', 'Saved: sale R45.');
    });

    it('still answers 200 with the reply when the sender throws, and logs one line', async () => {
      const sender = { send: vi.fn(async () => { throw new Error("Africa's Talking refused the text (status 401)"); }) };
      const { app } = makeApp({ smsSender: sender });
      const res = await postForm(app, '/sms', { ...smsFields, from: '+254711000000' });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('Saved: sale R45.');
      expect(errors).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(errors.mock.calls[0]![0])).message).toContain('401');
    });

    it('does nothing with no sender', async () => {
      const { app } = makeApp();
      const res = await postForm(app, '/sms', { ...smsFields, from: '+254711000000' });
      expect(res.status).toBe(200);
      expect(errors).not.toHaveBeenCalled();
    });

    it('answers and sends the plain sentence when the handler throws', async () => {
      textMock.mockRejectedValue(new Error('connection to db.internal:5432 failed'));
      const sender = { send: vi.fn(async () => {}) };
      const { app } = makeApp({ smsSender: sender });
      const res = await postForm(app, '/sms', { ...smsFields, from: '+254711000000', id: undefined });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(SENTENCES.generic);
      expect(sender.send).toHaveBeenCalledWith('+254711000000', SENTENCES.generic);
      expect(JSON.parse(String(errors.mock.calls[0]![0])).message).toContain('db.internal');
    });
  });

  describe('repeated callbacks (the same message id)', () => {
    const sendFake = () => ({ send: vi.fn(async () => {}) });
    const ntu = '+254711000000'; // not a demo number, so replies are sent

    it('calls the handler once, sends once, and answers the repeat with the first reply', async () => {
      const sender = sendFake();
      const { app } = makeApp({ smsSender: sender });
      const first = await postForm(app, '/sms', { ...smsFields, from: ntu });
      textMock.mockResolvedValue({ reply: 'A different reply this time' });
      const second = await postForm(app, '/sms', { ...smsFields, from: ntu });
      expect(await first.text()).toBe('Saved: sale R45.');
      expect(await second.text()).toBe('Saved: sale R45.');
      expect(second.status).toBe(200);
      expect(textMock).toHaveBeenCalledTimes(1);
      expect(sender.send).toHaveBeenCalledTimes(1);
    });

    it('runs again for a different id', async () => {
      const { app } = makeApp();
      await postForm(app, '/sms', { ...smsFields, id: 'ATXid_1' });
      await postForm(app, '/sms', { ...smsFields, id: 'ATXid_2' });
      expect(textMock).toHaveBeenCalledTimes(2);
    });

    it('runs again for the same id from another number', async () => {
      const { app } = makeApp();
      await postForm(app, '/sms', { ...smsFields, from: '+254711000034' });
      await postForm(app, '/sms', { ...smsFields, from: '+254711000056' });
      expect(textMock).toHaveBeenCalledTimes(2);
    });

    it('treats the same number written two ways as one', async () => {
      const { app } = makeApp();
      await postForm(app, '/sms', { ...smsFields, from: '+254711000034' });
      await postForm(app, '/sms', { ...smsFields, from: '+254 711 000 034' });
      expect(textMock).toHaveBeenCalledTimes(1);
    });

    it('calls the handler once when two posts start together', async () => {
      let release: (v: { reply: string }) => void = () => {};
      textMock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
      const { app } = makeApp();
      const a = postForm(app, '/sms', smsFields);
      const b = postForm(app, '/sms', smsFields);
      await new Promise((r) => setTimeout(r, 20));
      release({ reply: 'Saved once.' });
      const bodies = await Promise.all([a, b].map(async (p) => (await p).text()));
      expect(textMock).toHaveBeenCalledTimes(1);
      expect(bodies.sort()).toEqual(['Got your message. Working on it.', 'Saved once.']);
    });

    it('answers the "working" sentence, with no handler call and no send, while the first call is still running', async () => {
      let release: (v: { reply: string }) => void = () => {};
      textMock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
      const sender = sendFake();
      const { app } = makeApp({ smsSender: sender });
      const first = postForm(app, '/sms', { ...smsFields, from: ntu });
      await new Promise((r) => setTimeout(r, 20));
      const second = await postForm(app, '/sms', { ...smsFields, from: ntu });
      expect(second.status).toBe(200);
      expect(await second.text()).toBe('Got your message. Working on it.');
      expect(textMock).toHaveBeenCalledTimes(1);
      expect(sender.send).not.toHaveBeenCalled();
      release({ reply: 'Done.' });
      expect(await (await first).text()).toBe('Done.');
      expect(sender.send).toHaveBeenCalledTimes(1);
      const third = await postForm(app, '/sms', { ...smsFields, from: ntu });
      expect(await third.text()).toBe('Done.');
    });

    it('stores the error sentence when the handler throws, and never runs the handler twice', async () => {
      textMock.mockRejectedValue(new Error('something broke after the record was saved'));
      const sender = sendFake();
      const { app } = makeApp({ smsSender: sender });
      const first = await postForm(app, '/sms', { ...smsFields, from: ntu });
      expect(await first.text()).toBe(SENTENCES.generic);
      textMock.mockResolvedValue({ reply: 'Saved a second time' });
      const second = await postForm(app, '/sms', { ...smsFields, from: ntu });
      expect(await second.text()).toBe(SENTENCES.generic);
      expect(textMock).toHaveBeenCalledTimes(1);
      expect(sender.send).toHaveBeenCalledTimes(1);
    });

    it('still answers and sends the reply when finish fails, logs it, and keeps the claim', async () => {
      const processed = new InMemoryProcessedTextStore();
      vi.spyOn(processed, 'finish').mockRejectedValue(new Error('finish failed'));
      const sender = sendFake();
      const { app } = makeApp({ processed, smsSender: sender });
      const res = await postForm(app, '/sms', { ...smsFields, from: ntu });
      expect(await res.text()).toBe('Saved: sale R45.');
      expect(sender.send).toHaveBeenCalledTimes(1);
      expect(errors).toHaveBeenCalledTimes(1);
      const repeat = await postForm(app, '/sms', { ...smsFields, from: ntu });
      expect(await repeat.text()).toBe('Got your message. Working on it.');
      expect(textMock).toHaveBeenCalledTimes(1);
    });

    it('stores the reply before it sends, so a failing sender does not let a repeat run again', async () => {
      const order: string[] = [];
      const processed = new InMemoryProcessedTextStore();
      const finish = processed.finish.bind(processed);
      vi.spyOn(processed, 'finish').mockImplementation(async (...args) => {
        order.push('finish');
        return finish(...args);
      });
      const sender = { send: vi.fn(async () => { order.push('send'); throw new Error('sender down'); }) };
      const { app } = makeApp({ processed, smsSender: sender });
      await postForm(app, '/sms', { ...smsFields, from: ntu });
      expect(order).toEqual(['finish', 'send']);
      const repeat = await postForm(app, '/sms', { ...smsFields, from: ntu });
      expect(await repeat.text()).toBe('Saved: sale R45.');
      expect(textMock).toHaveBeenCalledTimes(1);
      expect(sender.send).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['no id', undefined],
      ['an id of 101 characters', 'a'.repeat(101)],
      ['an id with a space', 'AT Xid 1'],
      ['an empty id', ''],
      ['an id with a slash', 'AT/Xid']
    ])('handles %s without a claim: two posts call the handler twice', async (_name, id) => {
      const { app } = makeApp();
      await postForm(app, '/sms', { ...smsFields, id });
      await postForm(app, '/sms', { ...smsFields, id });
      expect(textMock).toHaveBeenCalledTimes(2);
    });

    it('claims an id of exactly 100 characters', async () => {
      const { app } = makeApp();
      const id = 'a'.repeat(100);
      await postForm(app, '/sms', { ...smsFields, id });
      await postForm(app, '/sms', { ...smsFields, id });
      expect(textMock).toHaveBeenCalledTimes(1);
    });

    it('makes no claim for a text of 481 characters', async () => {
      const processed = new InMemoryProcessedTextStore();
      const claim = vi.spyOn(processed, 'claim');
      const { app } = makeApp({ processed });
      await postForm(app, '/sms', { ...smsFields, text: 'a'.repeat(481) });
      expect(claim).not.toHaveBeenCalled();
    });

    it('makes no claim for POST /api/phone/sms', async () => {
      const processed = new InMemoryProcessedTextStore();
      const claim = vi.spyOn(processed, 'claim');
      const { app } = await makeShopApp({ processed });
      const body = JSON.stringify({ phone: '+27000001234', text: 'today', id: 'ATXid_1' });
      await app.request('/api/phone/sms', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
      await app.request('/api/phone/sms', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
      expect(claim).not.toHaveBeenCalled();
      expect(textMock).toHaveBeenCalledTimes(2);
    });

    it('gives a store failure in claim the plain error answer and sends it', async () => {
      const processed = new InMemoryProcessedTextStore();
      vi.spyOn(processed, 'claim').mockRejectedValue(new Error('claim failed'));
      const sender = sendFake();
      const { app } = makeApp({ processed, smsSender: sender });
      const res = await postForm(app, '/sms', { ...smsFields, from: ntu });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(SENTENCES.generic);
      expect(sender.send).toHaveBeenCalledWith(ntu, SENTENCES.generic);
      expect(textMock).not.toHaveBeenCalled();
    });
  });
});
