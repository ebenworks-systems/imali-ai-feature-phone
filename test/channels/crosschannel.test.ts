import { describe, it, expect, beforeEach } from 'vitest';
import { handleText } from '../../src/channels/sms/handler.js';
import { InMemoryPendingStore } from '../../src/channels/sms/pending.js';
import { dial, type Phone } from '../helpers/phone.js';
import { smsProblems } from '../../src/channels/limits.js';
import { MemoryStore } from '../../src/store/memory/store.js';
import { NOW } from '../helpers/fixtures.js';

/**
 * One owner, one ledger, two ways in. Everything the menu saves, the text messages see, and the reverse.
 * The menu is driven the way a phone would (key by key); the texts message by message.
 */

const MENU_PHONE = '+27000001234'; // the form the network sends
const TEXT_PHONE = '+27 00 000 1234'; // the same phone, written with spaces

let store: MemoryStore;
let pending: InMemoryPendingStore;

beforeEach(() => {
  store = new MemoryStore();
  pending = new InMemoryPendingStore({ now: () => NOW });
});

async function text(message: string, from = TEXT_PHONE): Promise<string> {
  const { reply } = await handleText({ phone: from, text: message, now: NOW, store, pending });
  expect(smsProblems(reply)).toEqual([]);
  return reply;
}

const phone = (number = MENU_PHONE): Phone => dial({ store, phone: number, now: NOW });

/** The menu owner signs up in the menu (a South African shop). */
async function signUpInMenu(number = MENU_PHONE, currency = '1'): Promise<void> {
  const p = phone(number);
  await p.open();
  await p.press('Demo Spaza');
  await p.press(currency);
}

async function keys(p: Phone, ...inputs: string[]) {
  let shown = await p.open();
  for (const input of inputs) shown = await p.press(input);
  return shown;
}

describe('one shop for both channels', () => {
  it('a shop made by the menu is found by a text from the same number written with spaces', async () => {
    await signUpInMenu();
    const reply = await text('sold 45 bread');
    expect(reply).toMatch(/^Saved: sale R45/);
    expect(reply).not.toMatch(/Welcome/);
    // and from the other ways of writing it
    expect(await text('sold 5', '+27000001234')).toMatch(/^Saved: sale R5/);
    expect(await text('sold 6', '27000001234')).toMatch(/^Saved: sale R6/);
    expect(await text('sold 7', ' +27-00-000-1234 ')).toMatch(/^Saved: sale R7/);
    const shop = await store.findShopByPhone(MENU_PHONE);
    expect(await store.listRecords(shop!.id)).toHaveLength(4);
  });

  it('a shop made by a text is found by the menu', async () => {
    await text('hi');
    expect(await text("Thandi's Spaza")).toMatch(/is ready/);
    const shop = await store.findShopByPhone(MENU_PHONE);
    expect(shop).not.toBeNull();
    expect(shop!.phone).toBe(MENU_PHONE);
    const main = await phone().open();
    expect(main.screen).toBe('main');
    expect(main.lines[0]).toBe("Thandi's Spaza");
  });

  it('makes one shop whichever channel is first', async () => {
    await signUpInMenu();
    await text('hi'); // not a sign-up: the shop exists
    expect(await text('today')).toMatch(/^Today: sales R0/);
  });

  it('a text from a number with a different last digit is another owner', async () => {
    await signUpInMenu();
    expect(await text('sold 45', '+27 00 000 1235')).toMatch(/Welcome/);
  });
});

describe('a sale by text shows in the menu', () => {
  it('on the main screen and in 5 Today', async () => {
    await signUpInMenu();
    expect(await text('sold bread 45')).toBe('Saved: sale R45 (bread). Sales today R45. Reply undo to cancel.');
    const p = phone();
    const main = await p.open();
    expect(main.lines[1]).toBe('Today: sales R45');
    const today = await p.press('5');
    expect(today.raw).toBe('END Today\nSales R45 (1)\nSpent R0\nIn hand R45');
  });

  it('sold 45 bread, as the owner may type it, shows in the menu Today line', async () => {
    await signUpInMenu();
    expect(await text('sold 45 bread')).toMatch(/^Saved: sale R45 \(bread\)\./);
    expect((await phone().open()).lines[1]).toBe('Today: sales R45');
    expect((await keys(phone(), '5')).lines[1]).toBe('Sales R45 (1)');
  });

  it('adds to what the menu saved before', async () => {
    await signUpInMenu();
    await keys(phone(), '1', '100', '1', '1');
    await text('sold 45 bread');
    expect((await phone().open()).lines[1]).toBe('Today: sales R145');
  });

  it('an expense by text shows in the menu', async () => {
    await signUpInMenu();
    await text('sold 100');
    await text('spent 20 taxi');
    const today = await keys(phone(), '5');
    expect(today.raw).toBe('END Today\nSales R100 (1)\nSpent R20\nIn hand R80');
  });

  it('in the menu in the shop currency', async () => {
    await signUpInMenu(MENU_PHONE, '3'); // Kenya
    expect(await text('sold 45 bread')).toMatch(/^Saved: sale KSh45/);
    expect((await phone().open()).lines[1]).toBe('Today: sales KSh45');
  });
});

describe('a sale saved in the menu shows in the text reply', () => {
  it('in the reply to today, and on the next main screen', async () => {
    await signUpInMenu();
    const saved = await keys(phone(), '1', '45', 'bread', '1');
    expect(saved.raw).toBe('END Saved: sale R45 bread. Sales today R45.');
    expect(await text('today')).toBe('Today: sales R45 (1), spent R0, in hand R45.');
    expect((await phone().open()).lines[1]).toBe('Today: sales R45');
  });

  it('a sale by text and one in the menu add up in both', async () => {
    await signUpInMenu();
    await text('sold 45 bread');
    const saved = await keys(phone(), '1', '100', '1', '1');
    expect(saved.raw).toBe('END Saved: sale R100. Sales today R145.');
    expect(await text('today')).toBe('Today: sales R145 (2), spent R0, in hand R145.');
    // the next sale by text sees the menu's sale too
    expect(await text('sold 5')).toMatch(/^Saved: sale R5\. Sales today R150\./);
  });

  it('marks each record with the channel it came from', async () => {
    await signUpInMenu();
    await text('sold 45 bread');
    await keys(phone(), '1', '100', '1', '1');
    const shop = (await store.findShopByPhone(MENU_PHONE))!;
    const records = await store.listRecords(shop.id);
    expect(records.map((r) => r.channel)).toEqual(['sms', 'ussd']);
  });
});

describe('undo across the channels', () => {
  it('undo by text reverses the menu last sale', async () => {
    await signUpInMenu();
    await keys(phone(), '1', '45', 'bread', '1');
    expect(await text('undo')).toMatch(/^Undone: sale R45 \(bread\)\. Sales today R0\./);
    expect((await phone().open()).lines[1]).toBe('Today: sales R0');
    expect((await keys(phone(), '7')).raw).toBe('END Nothing to undo.');
  });

  it('undo in the menu reverses a sale made by text', async () => {
    await signUpInMenu();
    await text('sold bread 45');
    const p = phone();
    const confirm = await keys(p, '7');
    expect(confirm.lines[0]).toBe('Undo sale R45 bread? 1 Yes 2 No');
    expect((await p.press('1')).raw).toBe('END Undone: sale R45 bread. Sales today R0.');
    expect(await text('today')).toBe('Today: sales R0 (0), spent R0, in hand R0.');
  });

  it('a record is reversed once, whichever channel asks', async () => {
    await signUpInMenu();
    await text('sold bread 45');
    await keys(phone(), '7', '1');
    expect(await text('undo')).toMatch(/nothing/i);
    const shop = (await store.findShopByPhone(MENU_PHONE))!;
    expect((await store.listRecords(shop.id)).filter((r) => r.kind === 'reversal')).toHaveLength(1);
  });

  it('undo goes through the records of both channels in order', async () => {
    await signUpInMenu();
    await text('sold 10');
    await keys(phone('+27000001234'), '1', '20', '1', '1');
    await text('sold 30');
    await text('undo'); // the 30
    expect((await keys(phone(), '7', '1')).raw).toBe('END Undone: sale R20. Sales today R10.'); // the menu's 20
    expect(await text('undo')).toMatch(/^Undone: sale R10/); // the 10
  });
});

describe('customers across the channels', () => {
  it('a customer who owes via text is in the menu paid-back list and in who owes', async () => {
    await signUpInMenu();
    await text('Tendai owes 50 sugar');
    await text('Rudo owes 30');
    const p = phone();
    const list = await keys(p, '4');
    expect(list.lines).toEqual(['Who paid back?', '1 Tendai R50', '2 Rudo R30', '8 Other name', '0 Back 00 Menu']);
    expect((await keys(phone(), '6')).raw).toBe('END Owed to you: R80\nTendai R50\nRudo R30');
  });

  it('a payment from the menu shows in the text reply to who owes', async () => {
    await signUpInMenu();
    await text('Tendai owes 50 sugar');
    const paid = await keys(phone(), '4', '1', '10', '1');
    expect(paid.raw).toBe('END Saved: Tendai paid R10. Tendai owes R40 now.');
    expect(await text('who owes')).toMatch(/Tendai R40/);
  });

  it('a debt made in the menu is in the reply to who owes by text', async () => {
    await signUpInMenu();
    await keys(phone(), '3', 'Tendai', '20', 'sugar', '1');
    expect(await text('who owes')).toMatch(/Tendai R20/);
    expect(await text('Tendai owes 5')).toMatch(/Tendai owes R25 in total|R25/);
  });

  it('matches a customer name across channels without regard to case', async () => {
    await signUpInMenu();
    await text('Tendai owes 50');
    const saved = await keys(phone(), '3', 'tendai', '20', '1', '1');
    expect(saved.raw).toContain('owes R70 in total');
    expect((await keys(phone(), '6')).raw).toMatch(/^END Owed to you: R70\nTendai R70$/);
  });

  it('close day agrees between the channels', async () => {
    await signUpInMenu();
    await text('sold 100');
    await keys(phone(), '2', '20', '1', '1');
    await text('Tendai owes 30');
    const close = await keys(phone(), '8');
    expect(close.lines).toEqual([
      'Close Mon 3 Nov',
      'Sales R100 (1)',
      'Spent R20',
      'In hand R80',
      'Credit given R30',
      'Paid back R0',
      'Total owed R30'
    ]);
    expect(await text('close')).toMatch(/sales R100 \(1\), spent R20, in hand R80/);
  });
});

describe('a negative figure reads the same on both channels', () => {
  it('-R60 in the menu and -R60 in the text reply', async () => {
    await signUpInMenu();
    await text('sold 100');
    await text('spent 160 stock');
    expect((await keys(phone(), '5')).raw).toContain('In hand -R60');
    expect(await text('today')).toBe('Today: sales R100 (1), spent R160, in hand -R60.');
  });
});
