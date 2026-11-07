import { describe, it, expect, beforeEach } from 'vitest';
import { runMenu } from '../../../src/channels/ussd/handler.js';
import type { ScreenId } from '../../../src/channels/ussd/screen.js';
import { HINT, NOTICE } from '../../../src/channels/ussd/text.js';
import { MemoryStore } from '../../../src/store/memory/store.js';
import { assertValidScreen } from '../../helpers/phone.js';
import { recordDebt, recordSale, type Shop } from '../../../src/core/index.js';
import { DEMO_PHONE, NOW, seedShop } from '../../helpers/fixtures.js';

let store: MemoryStore;
let shop: Shop;
let counter = 0;

beforeEach(async () => {
  store = new MemoryStore();
  shop = await seedShop(store);
  const earlier = { channel: 'sms' as const, originalWords: 'x', now: NOW };
  await recordSale(store, shop, { ...earlier, amount: { cents: 4500, requiresConfirmation: false }, item: 'bread' });
  // 12 customers: enough for more than one page of the paid-back list and of the who-owes list.
  for (let i = 1; i <= 12; i += 1) {
    await recordDebt(store, shop, {
      ...earlier,
      amount: { cents: (100 - i) * 100, requiresConfirmation: false },
      customer: `Customer ${String(i).padStart(2, '0')}`
    });
  }
});

/** The screen for a typed path, in a session of its own. */
async function show(text: string, sessionId = `nav_${(counter += 1)}`): Promise<{ response: string; screen: ScreenId }> {
  const result = await runMenu({ sessionId, serviceCode: '*384*1234#', phoneNumber: DEMO_PHONE, text, now: NOW, store });
  assertValidScreen(result.response);
  return result;
}

const records = async (): Promise<number> => (await store.listRecords(shop.id)).length;
const path = (text: string): string[] => (text === '' ? [] : text.split('*'));
const withoutHint = (response: string): string => response.replace(`\n${HINT}`, '');
const bodyOf = (response: string): string => response.slice(4);
const dropChoose = (body: string): string => (body.startsWith(`${NOTICE.choose}\n`) ? body.slice(NOTICE.choose.length + 1) : body);

/** Every screen that continues the session, by the path that reaches it. */
const CON_SCREENS: Array<[ScreenId, string]> = [
  ['main', ''],
  ['amount', '1'],
  ['item', '1*45'],
  ['confirm', '1*45*1'],
  ['confirmBig', '1*1500000*1*1'],
  ['customer', '3'],
  ['amount', '3*Tendai'],
  ['item', '3*Tendai*20'],
  ['confirm', '3*Tendai*20*1'],
  ['payWho', '4'],
  ['amount', '4*1'],
  ['confirm', '4*1*10'],
  ['owesList', '6'],
  ['undoConfirm', '7']
];

describe('0 goes back one screen', () => {
  for (const [id, text] of CON_SCREENS.filter(([, t]) => t !== '')) {
    it(`from ${id} (${text})`, async () => {
      const here = await show(text);
      expect(here.screen).toBe(id);
      const before = path(text).slice(0, -1).join('*');
      const back = await show(`${text}*0`);
      const expected = await show(before);
      expect(back.response).toBe(expected.response);
      expect(back.screen).toBe(expected.screen);
      expect(await records()).toBe(13);
    });
  }

  it('from the main menu it stays there, with no notice', async () => {
    const menu = await show('');
    expect((await show('0')).response).toBe(menu.response);
    expect((await show('0*0*0')).response).toBe(menu.response);
  });

  it('keeps what was typed on the earlier screens', async () => {
    // amount typed, item screen, back to the amount, a new amount
    const s = await show('1*45*0*50*1*1', 'keep_1');
    expect(s.response).toBe('END Saved: sale R50. Sales today R95.');
  });
});

describe('00 goes to the main menu and saves nothing', () => {
  const menu = async () => (await show('')).response;

  for (const [id, text] of CON_SCREENS.filter(([, t]) => t !== '')) {
    it(`from ${id} (${text})`, async () => {
      const response = await show(`${text}*00`);
      expect(response.response).toBe(await menu());
      expect(response.screen).toBe('main');
      expect(await records()).toBe(13);
    });
  }

  it('drops a half-made entry: a new sale starts clean', async () => {
    const s = await show('3*Tendai*20*00*1*45*1*1', 'clean_1');
    expect(s.response).toBe('END Saved: sale R45. Sales today R90.');
    const debts = (await store.listRecords(shop.id)).filter((r) => r.kind === 'debt');
    expect(debts).toHaveLength(12);
  });

  it('on the last who-owes screen, which ends the session, it is ignored', async () => {
    const owesEnd = await show('6*9');
    expect(owesEnd.response.startsWith('END ')).toBe(true);
    expect((await show('6*9*00')).response).toBe(owesEnd.response);
  });
});

describe('a wrong number on a choice screen', () => {
  const CHOICE_SCREENS: Array<[ScreenId, string]> = [
    ['main', ''],
    ['payWho', '4'],
    ['confirm', '1*45*1'],
    ['confirmBig', '1*1500000*1*1'],
    ['owesList', '6'],
    ['undoConfirm', '7']
  ];

  for (const [id, text] of CHOICE_SCREENS) {
    it(`on ${id} shows the same screen with the choose notice first, and stays CON`, async () => {
      const plainScreen = await show(text);
      const wrongKeys = id === 'payWho' ? ['0x', 'x', ' '] : id === 'main' ? ['9', 'x', ' '] : ['5', 'x', ' '];
      for (const wrong of wrongKeys) {
        const typed = await show(text === '' ? wrong : `${text}*${wrong}`);
        expect(typed.screen).toBe(id);
        expect(typed.response.startsWith(`CON ${NOTICE.choose}\n`)).toBe(true);
        // the screen is the same, apart from the hint, which may have no room beside the notice
        expect(withoutHint(dropChoose(bodyOf(typed.response)))).toBe(withoutHint(bodyOf(plainScreen.response)));
      }
    });
  }

  it('on the money choice at sign-up', async () => {
    const fresh = await runMenu({
      sessionId: 'signup_nav',
      serviceCode: '*384*1234#',
      phoneNumber: '+27000005555',
      text: 'Demo*9',
      now: NOW,
      store
    });
    expect(fresh.screen).toBe('signupCurrency');
    expect(fresh.response.startsWith(`CON ${NOTICE.choose}\nWhich money do you use?`)).toBe(true);
  });

  it('7 on the undo confirm is not a yes, and nothing is undone', async () => {
    expect((await show('7*7')).screen).toBe('undoConfirm');
    expect(await records()).toBe(13);
  });
});

describe('refused typed input', () => {
  it('a refused amount shows its reason and the same screen', async () => {
    const plainScreen = await show('1');
    for (const [typed, notice] of [
      ['abc', NOTICE.amountWords],
      ['0.00', NOTICE.amountZero],
      ['-5', NOTICE.amountZero],
      ['99999999999999', NOTICE.amountBig]
    ] as const) {
      const r = await show(`1*${typed}`);
      expect(r.screen).toBe('amount');
      expect(r.response).toBe(`CON ${notice}\n${plainScreen.response.slice(4)}`);
    }
  });

  it('the same path with a good amount after the refused one continues', async () => {
    expect((await show('1*abc*45')).response).toBe((await show('1*45')).response);
    expect((await show('1*abc*0.00*45*bread*1', 'again_1')).response).toBe('END Saved: sale R45 bread. Sales today R90.');
  });

  it('a refused customer name and item show their reasons', async () => {
    expect((await show('3*45')).response.startsWith(`CON ${NOTICE.customerBad}\nCustomer name?`)).toBe(true);
    expect((await show(`3*Tendai*20*${'x'.repeat(21)}`)).response.startsWith(`CON ${NOTICE.itemLong}\n`)).toBe(true);
  });

  it('only the last input decides the notice', async () => {
    const r = await show('1*abc*45');
    expect(r.response.startsWith('CON ')).toBe(true);
    expect(r.response).not.toContain(NOTICE.amountWords);
    expect(r.screen).toBe('item');
  });
});

describe('spaces and empty inputs', () => {
  it('spaces around a choice are ignored', async () => {
    expect((await show(' 1 ')).response).toBe((await show('1')).response);
    expect((await show('1* 45 ')).response).toBe((await show('1*45')).response);
    expect((await show('1*45*1* 2 ')).response).toBe((await show('1*45*1*2')).response);
    expect((await show(' 0 ')).response).toBe((await show('')).response);
    expect((await show('1* 0 ')).response).toBe((await show('')).response);
    expect((await show('1* 00 ')).response).toBe((await show('')).response);
  });

  it('an empty input on a choice screen is a wrong number', async () => {
    for (const text of ['1*45*1*', '4*', '7*', '6*']) {
      const r = await show(text);
      expect(r.response.startsWith(`CON ${NOTICE.choose}\n`)).toBe(true);
    }
    expect((await show('x*')).response.startsWith(`CON ${NOTICE.choose}\n`)).toBe(true);
  });

  it('an empty input on a typed screen is refused with a plain reason', async () => {
    expect((await show('1*')).response.startsWith(`CON ${NOTICE.amountWords}\n`)).toBe(true);
    expect((await show('3*')).response.startsWith(`CON ${NOTICE.customerBad}\n`)).toBe(true);
    expect((await show('1*45*')).response.startsWith(`CON ${NOTICE.itemEmpty}\n`)).toBe(true);
  });
});

describe('text after an ending screen is ignored', () => {
  it('after today, close, who owes and nothing to undo', async () => {
    for (const text of ['5', '8', '6*9']) {
      expect((await show(`${text}*1*2*3`)).response).toBe((await show(text)).response);
      expect((await show(`${text}*0`)).response).toBe((await show(text)).response);
      expect((await show(`${text}*00`)).response).toBe((await show(text)).response);
    }
  });

  it('after a saved record, and it does not save twice', async () => {
    const first = await show('1*45*1*1', 'ended_1');
    expect(first.response.startsWith('END Saved: sale R45')).toBe(true);
    expect(await records()).toBe(14);
    const more = await show('1*45*1*1*1*45*1*1', 'ended_1');
    expect(more.response).toBe(first.response);
    expect(await records()).toBe(14);
  });
});

describe('the hint line', () => {
  const WITH_HINT: ScreenId[] = ['amount', 'item', 'customer', 'payWho', 'confirm', 'confirmBig', 'owesList', 'undoConfirm'];

  for (const [id, text] of CON_SCREENS) {
    it(`${WITH_HINT.includes(id) ? 'ends' : 'does not end'} ${id} (${text || 'first call'})`, async () => {
      const r = await show(text);
      expect(r.response.endsWith(`\n${HINT}`)).toBe(WITH_HINT.includes(id));
    });
  }

  it('is on no END screen', async () => {
    for (const text of ['5', '8', '6*9', '1*45*1*1']) {
      const r = await show(text, `hint_${text}`);
      expect(r.response.startsWith('END ')).toBe(true);
      expect(r.response).not.toContain('0 Back');
    }
  });

  it('is on no sign-up screen', async () => {
    for (const text of ['', 'Demo', 'Demo*9']) {
      const r = await runMenu({ sessionId: 'hint_signup', serviceCode: 'x', phoneNumber: '+27000005555', text, now: NOW, store });
      expect(r.response).not.toContain('0 Back');
    }
  });

  it('after 0 or 00, the screen reached has it only if it is one of those screens', async () => {
    expect((await show('1*45*0')).response.endsWith(`\n${HINT}`)).toBe(true); // amount
    expect((await show('1*0')).response).not.toContain(HINT); // main
    expect((await show('1*45*00')).response).not.toContain(HINT); // main
    expect((await show('4*9*0')).response.endsWith(`\n${HINT}`)).toBe(true); // paid-back list, page 1
  });

  it('is on a screen with a notice when it fits, and on the screen without one', async () => {
    const withNotice = await show('1*abc');
    expect(withNotice.response).toBe(`CON ${NOTICE.amountWords}\nSale amount?\n${HINT}`);
  });
});
