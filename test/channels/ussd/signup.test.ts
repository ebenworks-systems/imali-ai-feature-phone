import { describe, it, expect } from 'vitest';
import { handleUssd } from '../../../src/channels/ussd/handler.js';
import { shopIdFor } from '../../../src/channels/ussd/ids.js';
import { COUNTRIES } from '../../../src/channels/ussd/ports.js';
import { MemoryStore } from '../../../src/store/memory/store.js';
import { dial } from '../../helpers/phone.js';
import { DEMO_PHONE, NOW, seedShop } from '../../helpers/fixtures.js';

const WELCOME = 'CON Welcome to the Imali AI ledger. Your shop name?';
const SYMBOLS = ['R', '$', 'KSh', 'N', 'GHS', 'K', 'P'];

describe('sign-up sessions', () => {
  it('a new number sees the welcome screen', async () => {
    const phone = dial({ store: new MemoryStore(), phone: DEMO_PHONE, now: NOW });
    const shown = await phone.open();
    expect(shown.raw).toBe(WELCOME);
    expect(shown.screen).toBe('signupName');
  });

  it('a name is followed by the money choice', async () => {
    const phone = dial({ store: new MemoryStore(), phone: DEMO_PHONE, now: NOW });
    await phone.open();
    const shown = await phone.press("Nomsa's  Corner");
    expect(shown.screen).toBe('signupCurrency');
    expect(shown.lines).toEqual([
      'Which money do you use?',
      '1 R South Africa',
      '2 $ US dollar',
      '3 KSh Kenya',
      '4 N Nigeria',
      '5 GHS Ghana',
      '6 K Zambia',
      '7 P Botswana'
    ]);
  });

  it('a name of 25 characters is refused with the plain reason and the session stays open', async () => {
    const store = new MemoryStore();
    const phone = dial({ store, phone: DEMO_PHONE, now: NOW });
    await phone.open();
    const shown = await phone.press('a'.repeat(25));
    expect(shown.raw).toBe(`CON That name is too long. Use 24 letters or less.\n${WELCOME.slice(4)}`);
    expect(await store.findShopByPhone(DEMO_PHONE)).toBeNull();
    // a good name afterwards carries on
    const next = await phone.press('a'.repeat(24));
    expect(next.screen).toBe('signupCurrency');
  });

  it('a name of exactly 24 characters is accepted', async () => {
    const phone = dial({ store: new MemoryStore(), phone: DEMO_PHONE, now: NOW });
    await phone.open();
    expect((await phone.press("Nomsa's Corner Tuck Shop")).screen).toBe('signupCurrency');
  });

  it('refuses an empty name and a name with a character that cannot be shown', async () => {
    const phone = dial({ store: new MemoryStore(), phone: DEMO_PHONE, now: NOW });
    await phone.open();
    expect((await phone.press('  ')).lines[0]).toBe('Type your shop name.');
    expect((await phone.press('Caf\u00e9')).lines[0]).toBe('Use letters and numbers only.');
  });

  it('a wrong number on the money choice shows the same screen with the choose notice', async () => {
    const store = new MemoryStore();
    const phone = dial({ store, phone: DEMO_PHONE, now: NOW });
    await phone.open();
    await phone.press('Demo');
    const shown = await phone.press('9');
    expect(shown.screen).toBe('signupCurrency');
    expect(shown.lines[0]).toBe('Choose a number from the list.');
    expect(await store.findShopByPhone(DEMO_PHONE)).toBeNull();
  });

  for (let n = 1; n <= 7; n += 1) {
    const country = COUNTRIES[n - 1]!;
    it(`choice ${n} makes a ${country.currency} shop in ${country.timeZone}`, async () => {
      const store = new MemoryStore();
      const phone = dial({ store, phone: '+27 00 000 1234', now: NOW });
      await phone.open();
      await phone.press('Demo Spaza');
      const menu = await phone.press(String(n));
      const shop = await store.findShopByPhone('+27000001234');
      expect(shop).toMatchObject({
        id: shopIdFor(phone.sessionId),
        name: 'Demo Spaza',
        phone: '+27000001234',
        currency: country.currency,
        timeZone: country.timeZone
      });
      // the main menu follows, with the new currency's symbol in the Today line
      expect(menu.screen).toBe('main');
      expect(menu.lines.slice(0, 2)).toEqual(['Demo Spaza', `Today: sales ${SYMBOLS[n - 1]}0`]);
    });
  }

  it('Kenya shows Today: sales KSh0', async () => {
    const phone = dial({ store: new MemoryStore(), phone: DEMO_PHONE, now: NOW });
    await phone.open();
    await phone.press('Duka Moja');
    expect((await phone.press('3')).lines[1]).toBe('Today: sales KSh0');
  });

  it('the next request in the same session (Name*1*1) reads the sign-up inputs and opens the sale amount screen', async () => {
    const store = new MemoryStore();
    const phone = dial({ store, phone: DEMO_PHONE, now: NOW });
    await phone.open();
    await phone.press('Demo Spaza');
    await phone.press('1');
    const amount = await phone.press('1');
    expect(phone.text).toBe('Demo Spaza*1*1');
    expect(amount.screen).toBe('amount');
    expect(amount.lines[0]).toBe('Sale amount?');
  });

  it('the first call after the shop exists, with the same session, goes through the whole sign-up path again', async () => {
    const store = new MemoryStore();
    const phone = dial({ store, phone: DEMO_PHONE, now: NOW });
    await phone.open();
    await phone.press('Demo Spaza');
    await phone.press('2');
    // an owner can finish a whole sale in the same session
    await phone.press('1');
    await phone.press('45');
    await phone.press('1');
    const saved = await phone.press('1');
    expect(saved.raw).toBe('END Saved: sale $45. Sales today $45.');
  });

  it('a later session for the same phone goes straight to the main menu', async () => {
    const store = new MemoryStore();
    const first = dial({ store, phone: DEMO_PHONE, now: NOW });
    await first.open();
    await first.press('Demo Spaza');
    await first.press('1');
    const second = dial({ store, phone: DEMO_PHONE, now: NOW });
    const shown = await second.open();
    expect(shown.screen).toBe('main');
    expect(shown.lines[0]).toBe('Demo Spaza');
  });

  it('the request Name*1 sent twice makes one shop', async () => {
    const store = new MemoryStore();
    const phone = dial({ store, phone: DEMO_PHONE, now: NOW });
    await phone.open();
    await phone.press('Demo Spaza');
    const first = await phone.press('1');
    const again = await phone.resend();
    expect(again.raw).toBe(first.raw);
    expect(again.screen).toBe('main');
  });

  it('the request Name*1 sent together makes one shop', async () => {
    const store = new MemoryStore();
    const request = {
      sessionId: 'ATUid_race',
      serviceCode: '*384*1234#',
      phoneNumber: DEMO_PHONE,
      text: 'Demo Spaza*1',
      now: NOW,
      store
    };
    const [a, b, c] = await Promise.all([handleUssd(request), handleUssd(request), handleUssd(request)]);
    expect(a.response.startsWith('CON Demo Spaza\nToday: sales R0')).toBe(true);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect((await store.findShopByPhone(DEMO_PHONE))?.id).toBe(shopIdFor('ATUid_race'));
  });

  it('two sessions for the same new number, sent together, make one shop', async () => {
    const store = new MemoryStore();
    const make = (sessionId: string, name: string) =>
      handleUssd({
        sessionId,
        serviceCode: '*384*1234#',
        phoneNumber: DEMO_PHONE,
        text: `${name}*1`,
        now: NOW,
        store
      });
    const [a, b] = await Promise.all([make('S_A', 'First Shop'), make('S_B', 'Second Shop')]);
    const shop = await store.findShopByPhone(DEMO_PHONE);
    // both owners land on the one shop that exists
    expect(a.response.startsWith(`CON ${shop!.name}\n`)).toBe(true);
    expect(b.response.startsWith(`CON ${shop!.name}\n`)).toBe(true);
  });

  it('another session that made the shop first is used', async () => {
    const store = new MemoryStore();
    await seedShop(store, { id: shopIdFor('OTHER'), name: 'First Shop', currency: 'KES' });
    const phone = dial({ store, phone: DEMO_PHONE, now: NOW });
    // A request that starts like a sign-up goes to the main menu of the shop that exists.
    const first = await phone.open();
    expect(first.screen).toBe('main');
    const typed = await phone.press('Second Name');
    expect(typed.screen).toBe('main');
    expect(typed.lines[0]).toBe('Choose a number from the list.');
    expect(typed.lines[1]).toBe('First Shop');
    expect(typed.lines[2]).toBe('Today: sales KSh0');
  });

  it('00 and 0 during sign-up go to the shop-name screen, never to a menu', async () => {
    const store = new MemoryStore();
    const phone = dial({ store, phone: DEMO_PHONE, now: NOW });
    await phone.open();
    expect((await phone.press('0')).raw).toBe(WELCOME);
    expect((await phone.press('00')).raw).toBe(WELCOME);
    await phone.press('Demo Spaza');
    expect((await phone.press('0')).screen).toBe('signupName');
    await phone.press('Demo Spaza');
    expect((await phone.press('00')).screen).toBe('signupName');
    expect(await store.findShopByPhone(DEMO_PHONE)).toBeNull();
  });

  it('after the sign-up, 00 goes to the main menu', async () => {
    const phone = dial({ store: new MemoryStore(), phone: DEMO_PHONE, now: NOW });
    await phone.open();
    await phone.press('Demo Spaza');
    await phone.press('1');
    await phone.press('1');
    expect((await phone.press('00')).screen).toBe('main');
  });

  it('sign-up screens carry no hint line', async () => {
    const phone = dial({ store: new MemoryStore(), phone: DEMO_PHONE, now: NOW });
    expect((await phone.open()).raw).not.toContain('0 Back');
    expect((await phone.press('Demo Spaza')).raw).not.toContain('0 Back');
    expect((await phone.press('x')).raw).not.toContain('0 Back');
  });

  it('works with the longest data: a 24-character name in every currency', async () => {
    for (let n = 1; n <= 7; n += 1) {
      const store = new MemoryStore();
      const phone = dial({ store, phone: DEMO_PHONE, now: NOW });
      await phone.open();
      await phone.press("Nomsa's Corner Tuck Shop");
      const menu = await phone.press(String(n));
      expect(menu.lines[0]).toBe("Nomsa's Corner Tuck Shop");
    }
  });
});
