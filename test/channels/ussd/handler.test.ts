import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleUssd, runMenu, type HandleUssdParams } from '../../../src/channels/ussd/handler.js';
import { MemoryStore } from '../../../src/store/memory/store.js';
import { recordSale, type LedgerStore } from '../../../src/core/index.js';
import { DEMO_PHONE, NOW, seedShop } from '../../helpers/fixtures.js';

const BAD = 'END Sorry, something went wrong. Please dial again.';

/** A store that counts every call and can be told to fail. */
function stubStore(inner: LedgerStore = new MemoryStore(), failWith?: Error) {
  const calls: string[] = [];
  const store = new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        calls.push(String(prop));
        if (failWith) return Promise.reject(failWith);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    }
  }) as LedgerStore;
  return { store, calls };
}

const params = (store: LedgerStore, over: Partial<HandleUssdParams> = {}): HandleUssdParams => ({
  sessionId: 'ATUid_1',
  serviceCode: '*384*1234#',
  phoneNumber: DEMO_PHONE,
  text: '',
  now: NOW,
  store,
  ...over
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleUssd', () => {
  it('returns { response } starting CON for the main menu of an existing shop', async () => {
    const store = new MemoryStore();
    await seedShop(store);
    const result = await handleUssd(params(store));
    expect(Object.keys(result)).toEqual(['response']);
    expect(result.response.startsWith('CON Demo Spaza\nToday: sales R0\n1 Sale')).toBe(true);
  });

  it('welcomes a new number', async () => {
    const result = await handleUssd(params(new MemoryStore()));
    expect(result.response).toBe('CON Welcome to the Imali AI ledger. Your shop name?');
  });

  it('finds the shop by the normalised number, whatever spaces the network used', async () => {
    const store = new MemoryStore();
    await seedShop(store);
    for (const phoneNumber of ['+27000001234', '+27 00 000 1234', '27000001234']) {
      const { response } = await handleUssd(params(store, { phoneNumber }));
      expect(response.startsWith('CON Demo Spaza')).toBe(true);
    }
  });

  it('gives the same response for the same arguments', async () => {
    const store = new MemoryStore();
    await seedShop(store);
    const a = await handleUssd(params(store, { text: '1*45*bread' }));
    const b = await handleUssd(params(store, { text: '1*45*bread' }));
    expect(a).toEqual(b);
  });

  it('serviceCode makes no difference', async () => {
    const store = new MemoryStore();
    await seedShop(store);
    const a = await handleUssd(params(store, { serviceCode: '*384*1234#', text: '5' }));
    const b = await handleUssd(params(store, { serviceCode: '*123#', text: '5' }));
    const c = await handleUssd(params(store, { serviceCode: '', text: '5' }));
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('now decides today figures', async () => {
    const store = new MemoryStore();
    const shop = await seedShop(store);
    await recordSale(store, shop, {
      amount: { cents: 4500, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'sold 45',
      now: NOW
    });
    const sameDay = await handleUssd(params(store, { now: new Date('2025-11-03T21:00:00.000Z') }));
    expect(sameDay.response).toContain('Today: sales R45');
    // 22:30 UTC is 00:30 the next day in Johannesburg: a new day.
    const nextDay = await handleUssd(params(store, { now: new Date('2025-11-03T22:30:00.000Z') }));
    expect(nextDay.response).toContain('Today: sales R0');
    const dayBefore = await handleUssd(params(store, { now: new Date('2025-11-02T10:00:00.000Z') }));
    expect(dayBefore.response).toContain('Today: sales R0');
  });

  it('does not read the clock for its figures', async () => {
    const store = new MemoryStore();
    await seedShop(store);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    try {
      const { response } = await handleUssd(params(store, { text: '8' }));
      expect(response).toContain('Close Mon 3 Nov');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('bad requests', () => {
  const cases: Array<[string, Partial<HandleUssdParams>]> = [
    ['an empty sessionId', { sessionId: '' }],
    ['a sessionId with a space', { sessionId: 'a b' }],
    ['a sessionId with a star', { sessionId: 'a*b' }],
    ['a sessionId of 101 characters', { sessionId: 'a'.repeat(101) }],
    ['a phone number that cannot be normalised', { phoneNumber: 'abc' }],
    ['an empty phone number', { phoneNumber: '' }],
    ['a text of 501 characters', { text: '1'.repeat(501) }],
    ['31 inputs', { text: Array(31).fill('1').join('*') }]
  ];

  for (const [name, over] of cases) {
    it(`answers ${name} with the plain failure and never touches the store`, async () => {
      const { store, calls } = stubStore();
      const { response, screen } = await runMenu(params(store, over));
      expect(response).toBe(BAD);
      expect(screen).toBe('badRequest');
      expect(calls).toEqual([]);
    });
  }
});

describe('a store that throws', () => {
  it('gives the plain failure instead of throwing, and logs only the name and message', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = new Error('connection refused');
    failing.name = 'ConnectionError';
    const { store } = stubStore(new MemoryStore(), failing);
    const { response, screen } = await runMenu(
      params(store, { phoneNumber: '+27 00 000 1234', text: '3*Tendai*20*sugar' })
    );
    expect(response).toBe(BAD);
    expect(screen).toBe('badRequest');
    expect(log).toHaveBeenCalledTimes(1);
    const logged = log.mock.calls.flat().join(' ');
    expect(logged).toContain('ConnectionError');
    expect(logged).toContain('connection refused');
    expect(logged).not.toContain('27000001234');
    expect(logged).not.toContain('27 00 000 1234');
    expect(logged).not.toContain('Tendai');
    expect(logged).not.toContain('sugar');
    expect(logged).not.toContain('3*Tendai');
  });

  it('gives the plain failure when something that is not an Error is thrown', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new MemoryStore();
    store.findShopByPhone = () => Promise.reject('plain string');
    const { response } = await handleUssd(params(store));
    expect(response).toBe(BAD);
  });

  it('gives the plain failure when the failure comes late, at the saving step', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new MemoryStore();
    await seedShop(store);
    store.appendRecord = () => Promise.reject(new Error('disk full'));
    const { response } = await handleUssd(params(store, { text: '1*45*1*1' }));
    expect(response).toBe(BAD);
  });
});

describe('runMenu', () => {
  it('says which screen was shown', async () => {
    const store = new MemoryStore();
    await seedShop(store);
    expect((await runMenu(params(store))).screen).toBe('main');
    expect((await runMenu(params(store, { text: '1' }))).screen).toBe('amount');
    expect((await runMenu(params(store, { text: '1*45' }))).screen).toBe('item');
    expect((await runMenu(params(store, { text: '1*45*1' }))).screen).toBe('confirm');
    expect((await runMenu(params(store, { text: '1*45*1*1' }))).screen).toBe('saved');
    expect((await runMenu(params(store, { text: '5' }))).screen).toBe('today');
    expect((await runMenu(params(store, { text: '6' }))).screen).toBe('owesNone');
  });

  it('reports tooBig when a total is no longer a safe whole number', async () => {
    const store = new MemoryStore();
    const shop = await seedShop(store, { currency: 'GHS' });
    for (let i = 0; i < 2; i += 1) {
      await recordSale(store, shop, {
        amount: { cents: Number.MAX_SAFE_INTEGER, requiresConfirmation: false },
        channel: 'sms',
        originalWords: 'x',
        now: NOW
      });
    }
    for (const text of ['', '5', '8']) {
      const { response, screen } = await runMenu(params(store, { text }));
      expect(response).toBe('END These numbers are too big to show here.');
      expect(screen).toBe('tooBig');
    }
  });

  it('still shows a figure that is large but safe', async () => {
    const store = new MemoryStore();
    const shop = await seedShop(store, { currency: 'GHS' });
    await recordSale(store, shop, {
      amount: { cents: Number.MAX_SAFE_INTEGER, requiresConfirmation: false },
      channel: 'sms',
      originalWords: 'x',
      now: NOW
    });
    const { response, screen } = await runMenu(params(store, { text: '8' }));
    expect(screen).toBe('close');
    expect(response).toContain('GHS90,071,992,547,409.91');
  });
});
