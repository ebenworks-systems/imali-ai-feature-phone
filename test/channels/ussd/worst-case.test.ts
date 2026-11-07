import { describe, it, expect } from 'vitest';
import {
  ALL_CURRENCIES,
  WORST_CUSTOMERS,
  WORST_ITEM,
  WORST_PHONE,
  MENU_SESSIONS,
  TEXT_SESSIONS,
  WORST_SESSIONS,
  WORST_SHOP_NAME,
  runWorstSession,
  runWorstTextSession,
  seedShopOnly,
  seedWorstCase,
  type ShownScreen
} from '../../../src/channels/ussd/worst-case.js';
import { runMenu } from '../../../src/channels/ussd/handler.js';
import { SCREEN_IDS, toResponse, type Screen } from '../../../src/channels/ussd/screen.js';
import { closeScreen, savedScreen, todayScreen } from '../../../src/channels/ussd/results.js';
import { confirmBigScreen, confirmScreen, mainMenu, signupCurrency } from '../../../src/channels/ussd/screens.js';
import { HINT, NOTICE } from '../../../src/channels/ussd/text.js';
import { MemoryStore } from '../../../src/store/memory/store.js';
import { getTodaySummary, recordDebt, recordSale } from '../../../src/core/index.js';
import { assertValidScreen } from '../../helpers/phone.js';
import { smsProblems } from '../../../src/channels/limits.js';
import { NOW } from '../../helpers/fixtures.js';

const results = new Map<string, ShownScreen[]>();

async function run(name: string, currency: (typeof ALL_CURRENCIES)[number]): Promise<ShownScreen[]> {
  const key = `${currency}/${name}`;
  let shown = results.get(key);
  if (!shown) {
    const session = MENU_SESSIONS.find((s) => s.name === name);
    if (!session) throw new Error(`No session called ${name}`);
    shown = await runWorstSession(session, currency, NOW);
    results.set(key, shown);
  }
  return shown;
}

describe('the worst-case data', () => {
  it('has the longest names, items and amounts the design describes', () => {
    expect(WORST_SHOP_NAME).toHaveLength(24);
    expect(WORST_ITEM).toHaveLength(20);
    expect(WORST_CUSTOMERS).toHaveLength(10);
    for (const name of WORST_CUSTOMERS) expect(name).toHaveLength(20);
    expect(new Set(WORST_CUSTOMERS).size).toBe(10);
  });

  it('uses only invented names and the fiction phone range', () => {
    expect(WORST_PHONE.startsWith('+27000')).toBe(true);
  });

  it('makes figures of 15 characters in GHS, and no more', async () => {
    const store = new MemoryStore();
    const shop = await seedWorstCase(store, 'GHS', NOW);
    const today = await getTodaySummary(store, shop, NOW);
    expect(today.sales.total).toBe(299999997); // GHS2,999,999.97
    expect(today.sales.count).toBe(3);
    for (const cents of [today.moneyInHand, today.newDebts, today.paymentsReceived, today.totalOwed]) {
      expect(cents).toBeGreaterThanOrEqual(100_000_000);
      expect(cents).toBeLessThan(1_000_000_000);
    }
    expect(today.totalOwed).toBeLessThan(1_000_000_000); // the ten customers owe less than 10,000,000 in all
  });

  it('the shop is made in the shop only mode with no records', async () => {
    const store = new MemoryStore();
    const shop = await seedShopOnly(store, 'KES', NOW);
    expect(await store.listRecords(shop.id)).toEqual([]);
    expect(shop.currency).toBe('KES');
    expect(shop.createdAt).toBe(NOW.toISOString());
  });
});

describe('every session, in every currency', () => {
  for (const currency of ALL_CURRENCIES) {
    it(`${currency}: every screen is CON/END, plain ASCII and at most 182 characters`, async () => {
      for (const session of MENU_SESSIONS) {
        const shown = await run(session.name, currency);
        expect(shown.length).toBeGreaterThan(0);
        for (const screen of shown) {
          expect(() => assertValidScreen(screen.response), `${currency} ${session.name} ${JSON.stringify(screen.text)}`).not.toThrow();
        }
      }
    });
  }

  it('the sessions together show every screen id', async () => {
    const seen = new Set<string>();
    for (const currency of ALL_CURRENCIES) {
      for (const session of MENU_SESSIONS) {
        for (const screen of await run(session.name, currency)) seen.add(screen.screen);
      }
    }
    expect([...SCREEN_IDS].filter((id) => !seen.has(id))).toEqual([]);
    expect([...seen].filter((id) => !(SCREEN_IDS as readonly string[]).includes(id))).toEqual([]);
  });

  it('has a name for every session, and the names are different', () => {
    const names = WORST_SESSIONS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect(MENU_SESSIONS.length + TEXT_SESSIONS.length).toBe(WORST_SESSIONS.length);
  });

  it('the special sessions reach the screens they are for', async () => {
    expect((await run('bad request', 'GHS')).at(-1)!.screen).toBe('badRequest');
    expect((await run('save failed', 'GHS')).at(-1)!.response).toBe('END Sorry, that was not saved. Please try again.');
    const huge = (await run('too big', 'GHS')).at(-1)!;
    expect(huge.screen).toBe('tooBig');
    expect(huge.response).toBe('END These numbers are too big to show here.');
  });

  it('every sign-up session makes the shop in the chosen currency', async () => {
    for (const currency of ALL_CURRENCIES) {
      const shown = await run('sign-up', currency);
      const menu = shown[2]!;
      expect(menu.screen).toBe('main');
      expect(menu.response.split('\n')[0]).toBe(`CON ${WORST_SHOP_NAME}`);
    }
  });

  it('the who-owes and paid-back lists have several pages with the worst data', async () => {
    const owes = await run('who owes, all pages', 'GHS');
    expect(owes.map((s) => s.screen)).toEqual(['main', 'owesList', 'owesList', 'owesList', 'owesEnd']);
    const pay = await run('paid back from the last page', 'GHS');
    expect(pay.filter((s) => s.screen === 'payWho')).toHaveLength(4);
  });
});

describe('the lengths in the design table (GHS, the widest symbol)', () => {
  // [R999,999.99-sized, 15-character figure, 24-character figure]
  const SIZES = [99_999_999, 999_999_999, 9_007_199_254_740_991];
  const NAME = WORST_CUSTOMERS[0]!;
  const bodyLength = (screen: Screen): number => toResponse({ ...screen, hint: false }).length - 4;
  const entry = (cents: number) => ({ kind: 'debt', cents, customer: NAME, item: WORST_ITEM }) as const;
  const summary = (c: number) => ({
    date: '2025-12-31',
    shopId: 's',
    sales: { total: c, count: 12 },
    expenses: { total: c },
    moneyInHand: c,
    newDebts: c,
    paymentsReceived: c,
    totalOwed: c
  });

  it('main menu with the longest notice: 170, 172, 181', () => {
    expect(
      SIZES.map((c) => bodyLength(mainMenu({ shopName: WORST_SHOP_NAME, salesToday: c, currency: 'GHS', notice: NOTICE.choose })))
    ).toEqual([170, 172, 181]);
  });

  it('confirm, debt with item: 77, 79, 88', () => {
    expect(SIZES.map((c) => bodyLength(confirmScreen({ entry: entry(c), currency: 'GHS' })))).toEqual([77, 79, 88]);
  });

  it('big-amount confirm: 53, 55, 64', () => {
    expect(SIZES.map((c) => bodyLength(confirmBigScreen({ cents: c, currency: 'GHS' })))).toEqual([53, 55, 64]);
  });

  it('saved, debt with item (the longest ending screen): 118, 122, 140', () => {
    expect(
      SIZES.map((c) =>
        bodyLength(savedScreen({ entry: entry(c), figure: { kind: 'balance', customer: NAME, cents: c, wording: 'total' } }, 'GHS'))
      )
    ).toEqual([118, 122, 140]);
  });

  it('today: 72, 78, 105', () => {
    expect(SIZES.map((c) => bodyLength(todayScreen(summary(c), 'GHS')))).toEqual([72, 78, 105]);
  });

  it('close: 159, 171, and too long for the largest (it falls back to the too-big screen)', () => {
    const lengths = SIZES.map((c) => toResponse(closeScreen(summary(c), 'GHS')));
    expect(lengths[0]!.length - 4).toBe(159);
    expect(lengths[1]!.length - 4).toBe(171);
    expect(lengths[2]).toBe('END These numbers are too big to show here.');
  });

  it('currency choice with a notice: 145', () => {
    expect(bodyLength(signupCurrency(NOTICE.choose))).toBe(145);
  });

  it('the screens with the hint are 15 characters longer when it fits', () => {
    const screen = confirmScreen({ entry: entry(99_999_999), currency: 'GHS' });
    expect(toResponse(screen).length - toResponse({ ...screen, hint: false }).length).toBe(15);
    expect(toResponse(screen).endsWith(`\n${HINT}`)).toBe(true);
  });

  it('the main-menu worst case is the longest screen the owner answers, within 182 for every size', () => {
    for (const c of SIZES) {
      expect(toResponse(mainMenu({ shopName: WORST_SHOP_NAME, salesToday: c, currency: 'GHS', notice: NOTICE.choose })).length - 4)
        .toBeLessThanOrEqual(182);
    }
  });
});

describe('the hint, both ways, with the worst-case data', () => {
  it('is on a paid-back list with no notice and left out when the longest notice shows', async () => {
    const shown = await run('wrong number at the paid-back list', 'GHS');
    const list = shown.find((s) => s.text === '4')!;
    const refused = shown.find((s) => s.text === '4*x')!;
    expect(list.response.endsWith(`\n${HINT}`)).toBe(true);
    expect(refused.response).not.toContain(HINT);
    expect(refused.response.startsWith(`CON ${NOTICE.choose}\n`)).toBe(true);
    // nothing else was dropped to make room: the same rows, notice aside and hint aside
    expect(refused.response.slice(4 + NOTICE.choose.length + 1)).toBe(list.response.slice(4).replace(`\n${HINT}`, ''));
  });

  it('is on a confirm screen even with the longest names', async () => {
    const shown = await run('owes', 'GHS');
    const confirm = shown.find((s) => s.screen === 'confirm')!;
    expect(confirm.response.endsWith(`\n${HINT}`)).toBe(true);
  });

  it('is on no ending screen', async () => {
    for (const session of MENU_SESSIONS) {
      for (const screen of await run(session.name, 'GHS')) {
        if (screen.response.startsWith('END ')) expect(screen.response).not.toContain('0 Back');
      }
    }
  });
});

describe('names stored earlier (possibly by text message)', () => {
  it('are shown with ? for every character outside printable ASCII, and clipped', async () => {
    const store = new MemoryStore();
    const shop = await seedShopOnly(store, 'ZAR', NOW);
    // a name this long and with an accent could only have come from a text message
    const stored = { ...shop, name: 'Caf\u00e9 Zola' };
    store.clear();
    await store.createShop(stored);
    await recordDebt(store, stored, {
      amount: { cents: 5000, requiresConfirmation: false },
      customer: `Ren\u00e9e ${'x'.repeat(30)}`,
      item: 'caf\u00e9 au lait \u{1F600} and more words',
      channel: 'sms',
      originalWords: 'x',
      now: NOW
    });
    const ask = async (text: string) =>
      (await runMenu({ sessionId: 'S1', serviceCode: 'x', phoneNumber: WORST_PHONE, text, now: NOW, store })).response;

    const menu = await ask('');
    expect(menu.split('\n')[0]).toBe('CON Caf? Zola');
    const owes = await ask('6');
    expect(owes.split('\n')[1]).toBe('Ren?e xxxxxxxxxxxxxx R50');
    expect(owes.split('\n')[1]!.split(' R50')[0]).toHaveLength(20);
    const undo = await ask('7');
    expect(undo).toBe(`CON Undo Ren?e xxxxxxxxxxxxxx owes R50 caf? au lait ? and m? 1 Yes 2 No\n${HINT}`);
    assertValidScreen(menu);
    assertValidScreen(owes);
    assertValidScreen(undo);
  });

  it('a stored sale item is clipped to 20 characters on the undo screen', async () => {
    const store = new MemoryStore();
    const shop = await seedShopOnly(store, 'ZAR', NOW);
    await recordSale(store, shop, {
      amount: { cents: 4500, requiresConfirmation: false },
      item: 'a very long item name indeed',
      channel: 'sms',
      originalWords: 'x',
      now: NOW
    });
    const { response } = await runMenu({ sessionId: 'S1', serviceCode: 'x', phoneNumber: WORST_PHONE, text: '7', now: NOW, store });
    expect(response).toBe(`CON Undo sale R45 a very long item nam? 1 Yes 2 No\n${HINT}`);
  });
});

describe('the text-message conversations, in every currency', () => {
  it('has the conversations the task lists', () => {
    const names = TEXT_SESSIONS.map((s) => s.name).join(' | ');
    for (const word of ['sold', 'spent', 'owes', 'paid', 'undo', 'today', 'who owes', 'close', 'help', 'unknown', 'two amounts', '1,000,000']) {
      expect(names, word).toContain(word);
    }
    expect(TEXT_SESSIONS.some((s) => (s.inputs as string[]).includes('sold 2 200'))).toBe(true);
  });

  for (const currency of ALL_CURRENCIES) {
    it(`${currency}: every reply is plain ASCII and at most 160 characters`, async () => {
      for (const session of TEXT_SESSIONS) {
        const shown = await runWorstTextSession(session, currency, NOW);
        expect(shown.length).toBeGreaterThan(0);
        for (const { message, reply } of shown) {
          expect(smsProblems(reply), `${currency} ${session.name} ${JSON.stringify(message)} -> ${reply}`).toEqual([]);
          expect(reply.length).toBeGreaterThan(0);
        }
      }
    });
  }

  it('reaches the replies it is for', async () => {
    const run = async (name: string, currency: (typeof ALL_CURRENCIES)[number] = 'GHS') =>
      runWorstTextSession(TEXT_SESSIONS.find((s) => s.name === name)!, currency, NOW);
    expect((await run('text: sold'))[0]!.reply).toMatch(/^Saved: sale GHS999,999\.99/);
    expect((await run('text: who owes with pages'))[0]!.reply).toMatch(/\+\d+ more\. Reply owes 2$/);
    expect((await run('text: two amounts, first'))[0]!.reply).toMatch(/^Did you mean 1\)/);
    expect((await run('text: over 1,000,000, yes'))[0]!.reply).toMatch(/^Reply yes to save sale GHS1,500,000/);
    expect((await run('text: unknown'))[0]!.reply).toMatch(/^Sorry, I did not get that\./);
    expect((await run('text: sign-up'))[0]!.reply).toMatch(/Welcome/);
    expect((await run('text: nobody owes'))[0]!.reply).toMatch(/nobody/i);
  });

  it('a negative in hand reads -R60 in a text reply, in every currency', async () => {
    // The worst-case day makes money; spend more than there is to see the sign.
    for (const currency of ALL_CURRENCIES) {
      const session = {
        name: 'negative',
        channel: 'text' as const,
        bare: true,
        inputs: ['sold 100', 'spent 160 stock', 'today']
      };
      const shown = await runWorstTextSession(session, currency, NOW);
      expect(shown[2]!.reply).toMatch(/in hand -[A-Za-z$]+60\.$/);
      expect(shown[2]!.reply).not.toMatch(/[A-Za-z$]-60/);
    }
  });
});
