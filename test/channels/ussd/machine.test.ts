import { describe, it, expect } from 'vitest';
import { replay, type Frame, type MenuState } from '../../../src/channels/ussd/machine.js';
import type { MenuPorts, UndoTarget } from '../../../src/channels/ussd/ports.js';
import { NOTICE } from '../../../src/channels/ussd/text.js';
import type { CustomerBalance, Shop } from '../../../src/core/index.js';

const SHOP: Shop = {
  id: 'shop_x',
  name: 'Demo Spaza',
  phone: '+27000001234',
  currency: 'ZAR',
  timeZone: 'Africa/Johannesburg',
  createdAt: '2025-11-03T08:00:00.000Z'
};

interface FakeOptions {
  shop?: Shop | null;
  owes?: CustomerBalance[];
  target?: UndoTarget | null;
}

function fakePorts(o: FakeOptions = {}): MenuPorts & { created: Array<{ name: string; choice: number }> } {
  const created: Array<{ name: string; choice: number }> = [];
  const ports = {
    shop: o.shop === undefined ? SHOP : o.shop,
    created,
    async createShop(name: string, choice: number): Promise<Shop> {
      created.push({ name, choice });
      ports.shop = { ...SHOP, name };
      return ports.shop;
    },
    async owes(): Promise<CustomerBalance[]> {
      return o.owes ?? [];
    },
    async undoTarget(): Promise<UndoTarget | null> {
      return o.target ?? null;
    }
  };
  return ports;
}

const path = (text: string): string[] => (text === '' ? [] : text.split('*'));

async function run(text: string, o: FakeOptions = {}, start: 'signup' | 'main' = 'main'): Promise<MenuState> {
  return replay(path(text), fakePorts(o), start);
}

const ids = (state: MenuState): string[] => state.frames.map((f) => f.id);
const top = (state: MenuState): Frame => state.frames[state.frames.length - 1]!;

describe('main menu and going back', () => {
  it('starts on the main menu with no notice for the empty path', async () => {
    const s = await run('');
    expect(ids(s)).toEqual(['main']);
    expect(s.notice).toBeUndefined();
    expect(s.terminal).toBeUndefined();
  });

  it('a wrong number at the main menu shows the choose notice', async () => {
    for (const bad of ['x', '9', ' ', '10', '1.5', 'abc']) {
      const s = await run(bad);
      expect(ids(s)).toEqual(['main']);
      expect(s.notice).toBe(NOTICE.choose);
    }
  });

  it('the notice depends on the last input only: "x*1" has no notice and is on the sale amount screen', async () => {
    const s = await run('x*1');
    expect(s.notice).toBeUndefined();
    expect(top(s)).toEqual({ id: 'amount', draft: { kind: 'sale' } });
  });

  it('a refused input in the middle is as if it had not been typed', async () => {
    const withMistake = await run('x*1*abc*45');
    const without = await run('1*45');
    expect(withMistake).toEqual(without);
  });

  it('spaces around a choice are ignored', async () => {
    expect(top(await run(' 1 '))).toEqual({ id: 'amount', draft: { kind: 'sale' } });
    expect(top(await run('  2'))).toEqual({ id: 'amount', draft: { kind: 'expense' } });
  });

  it('0 at the main menu stays there with no notice', async () => {
    const s = await run('0');
    expect(ids(s)).toEqual(['main']);
    expect(s.notice).toBeUndefined();
    expect(await run('0*0*0')).toEqual(await run(''));
  });

  it('0 goes back one screen', async () => {
    expect(ids(await run('1*45'))).toEqual(['main', 'amount', 'item']);
    expect(ids(await run('1*45*0'))).toEqual(['main', 'amount']);
    expect(ids(await run('1*45*0*0'))).toEqual(['main']);
  });

  it('0 clears the notice', async () => {
    const s = await run('x*0');
    expect(s.notice).toBeUndefined();
  });

  it('00 goes to the main menu from any screen and drops the half-made entry', async () => {
    for (const text of ['1*00', '1*45*00', '3*Tendai*00', '3*Tendai*20*sugar*00', '1*45*1*00', '00*00']) {
      const s = await run(text);
      expect(ids(s)).toEqual(['main']);
      expect(s.notice).toBeUndefined();
    }
  });

  it('00 then a new entry starts clean', async () => {
    const s = await run('1*45*00*2');
    expect(top(s)).toEqual({ id: 'amount', draft: { kind: 'expense' } });
  });

  it('0 and 00 are read before the screen rules, so an amount, name or item cannot be them', async () => {
    expect(ids(await run('1*0'))).toEqual(['main']);
    expect(ids(await run('3*0'))).toEqual(['main']);
    expect(ids(await run('1*45*0'))).toEqual(['main', 'amount']);
  });

  it('stops at a terminal and ignores the inputs after it', async () => {
    const s = await run('5*1*45*x');
    expect(s.terminal).toEqual({ type: 'today' });
    expect(ids(s)).toEqual(['main']);
    expect(await run('8*0*00*1')).toEqual(await run('8'));
  });
});

describe('sign-up', () => {
  const signup = (text: string) => run(text, { shop: null }, 'signup');

  it('starts on the shop-name screen', async () => {
    const s = await signup('');
    expect(ids(s)).toEqual(['signupName']);
    expect(s.notice).toBeUndefined();
  });

  it('a good name goes to the currency choice', async () => {
    const s = await signup('Nomsa  Spaza');
    expect(s.frames).toEqual([{ id: 'signupName' }, { id: 'signupCurrency', name: 'Nomsa Spaza' }]);
  });

  it('a refused name stays with the plain reason', async () => {
    const s = await signup('a'.repeat(25));
    expect(ids(s)).toEqual(['signupName']);
    expect(s.notice).toBe(NOTICE.shopNameLong);
    expect((await signup('   ')).notice).toBe(NOTICE.shopNameEmpty);
  });

  it('a wrong number on the currency choice shows the choose notice', async () => {
    for (const bad of ['0x', '8', 'x', '']) {
      const s = await signup(`Name*${bad}`);
      expect(ids(s)).toEqual(['signupName', 'signupCurrency']);
      expect(s.notice).toBe(NOTICE.choose);
    }
  });

  it('a currency choice makes the shop through the ports and leaves the stack at [main]', async () => {
    const ports = fakePorts({ shop: null });
    const s = await replay(path('Name*3'), ports, 'signup');
    expect(s.frames).toEqual([{ id: 'main' }]);
    expect(s.notice).toBeUndefined();
    expect(ports.created).toEqual([{ name: 'Name', choice: 3 }]);
  });

  it('each of the seven choices is passed on', async () => {
    for (let n = 1; n <= 7; n += 1) {
      const ports = fakePorts({ shop: null });
      await replay(path(`Name*${n}`), ports, 'signup');
      expect(ports.created).toEqual([{ name: 'Name', choice: n }]);
    }
  });

  it('inputs after the sign-up go to the main menu', async () => {
    const s = await replay(path('Name*1*1'), fakePorts({ shop: null }), 'signup');
    expect(top(s)).toEqual({ id: 'amount', draft: { kind: 'sale' } });
    expect(ids(s)).toEqual(['main', 'amount']);
  });

  it('00 at sign-up returns to the name screen, and so does 0 from the currency choice', async () => {
    expect(ids(await signup('Name*00'))).toEqual(['signupName']);
    expect(ids(await signup('Name*0'))).toEqual(['signupName']);
    expect(ids(await signup('0'))).toEqual(['signupName']);
    expect(ids(await signup('00'))).toEqual(['signupName']);
  });

  it('after the sign-up, 00 goes to the main menu', async () => {
    const s = await replay(path('Name*1*1*45*00'), fakePorts({ shop: null }), 'signup');
    expect(ids(s)).toEqual(['main']);
  });

  it('a shop made earlier in this session is read the same way (the ports give it back)', async () => {
    const s = await replay(path('Name*1*1'), fakePorts({ shop: SHOP }), 'signup');
    expect(ids(s)).toEqual(['main', 'amount']);
  });

  it('a name typed again after going back replaces the earlier one', async () => {
    const s = await signup('One*0*Two');
    expect(s.frames).toEqual([{ id: 'signupName' }, { id: 'signupCurrency', name: 'Two' }]);
  });
});

describe('sale and expense', () => {
  it('a sale with no item saves at step 4', async () => {
    const s = await run('1*45*1*1');
    expect(s.terminal).toEqual({ type: 'save', draft: { kind: 'sale', cents: 4500 }, step: 4 });
  });

  it('a sale with an item saves the item', async () => {
    const s = await run('1*45*bread*1');
    expect(s.terminal).toEqual({ type: 'save', draft: { kind: 'sale', cents: 4500, item: 'bread' }, step: 4 });
  });

  it('an expense saves the same way', async () => {
    const s = await run('2*20*taxi*1');
    expect(s.terminal).toEqual({ type: 'save', draft: { kind: 'expense', cents: 2000, item: 'taxi' }, step: 4 });
  });

  it('nothing is saved before the confirm screen', async () => {
    for (const text of ['1', '1*45', '1*45*1', '1*45*bread']) {
      const s = await run(text);
      expect(s.terminal).toBeUndefined();
    }
    expect(top(await run('1*45*1'))).toEqual({ id: 'confirm', draft: { kind: 'sale', cents: 4500 } });
  });

  it('a refused amount stays with the plain reason, and a good one after it continues', async () => {
    const zero = await run('1*0.00');
    expect(top(zero)).toEqual({ id: 'amount', draft: { kind: 'sale' } });
    expect(zero.notice).toBe(NOTICE.amountZero);
    expect((await run('1*-5')).notice).toBe(NOTICE.amountZero);
    expect((await run('1*abc')).notice).toBe(NOTICE.amountWords);
    expect((await run('1*99999999999999')).notice).toBe(NOTICE.amountBig);
    const later = await run('1*0.00*abc*45');
    expect(later.notice).toBeUndefined();
    expect(top(later).id).toBe('item');
  });

  it('reads 2 200 as R2,200', async () => {
    const s = await run('1*2 200*1*1');
    expect(s.terminal).toMatchObject({ type: 'save', draft: { cents: 220000 } });
  });

  it('an item screen refuses an item over 20 characters and accepts 1 as skip', async () => {
    const s = await run(`1*45*${'x'.repeat(21)}`);
    expect(top(s).id).toBe('item');
    expect(s.notice).toBe(NOTICE.itemLong);
    expect(top(await run('1*45*1')).id).toBe('confirm');
  });

  it('a big amount goes to the second confirm and saves only after the second yes', async () => {
    const first = await run('1*1500000*1*1');
    expect(first.terminal).toBeUndefined();
    expect(top(first)).toEqual({ id: 'confirmBig', draft: { kind: 'sale', cents: 150000000 } });
    const second = await run('1*1500000*1*1*1');
    expect(second.terminal).toEqual({
      type: 'save',
      draft: { kind: 'sale', cents: 150000000, bigOk: true },
      step: 5
    });
  });

  it('exactly 1,000,000 needs one yes; 1,000,001 needs two', async () => {
    expect((await run('1*1000000*1*1')).terminal?.type).toBe('save');
    expect(top(await run('1*1000001*1*1')).id).toBe('confirmBig');
  });

  it('2 No on a confirm screen shows the main menu with Not saved.', async () => {
    const s = await run('1*45*1*2');
    expect(ids(s)).toEqual(['main']);
    expect(s.notice).toBe(NOTICE.notSaved);
    expect(s.terminal).toBeUndefined();
  });

  it('2 No on the big-amount confirm also saves nothing', async () => {
    const s = await run('1*1500000*1*1*2');
    expect(ids(s)).toEqual(['main']);
    expect(s.notice).toBe(NOTICE.notSaved);
  });

  it('the Not saved notice goes with the next input', async () => {
    const s = await run('1*45*1*2*1');
    expect(s.notice).toBeUndefined();
    expect(top(s).id).toBe('amount');
  });

  it('a wrong number on a confirm screen stays with the choose notice', async () => {
    const s = await run('1*45*1*3');
    expect(top(s).id).toBe('confirm');
    expect(s.notice).toBe(NOTICE.choose);
    const big = await run('1*1500000*1*1*3');
    expect(top(big).id).toBe('confirmBig');
    expect(big.notice).toBe(NOTICE.choose);
  });

  it('0 from the confirm screen reaches the item screen with the amount kept', async () => {
    const s = await run('1*45*bread*0');
    expect(top(s)).toEqual({ id: 'item', draft: { kind: 'sale', cents: 4500 } });
    const again = await run('1*45*bread*0*milk*1');
    expect(again.terminal).toEqual({
      type: 'save',
      draft: { kind: 'sale', cents: 4500, item: 'milk' },
      step: 6
    });
  });

  it('0 from the big-amount confirm reaches the confirm screen', async () => {
    expect(top(await run('1*1500000*1*1*0')).id).toBe('confirm');
  });

  it('0 from the item screen lets the owner change the amount', async () => {
    const s = await run('1*45*0*50*1*1');
    expect(s.terminal).toMatchObject({ type: 'save', draft: { cents: 5000 }, step: 6 });
  });
});

describe('owes', () => {
  it('asks for the name, the amount and the item, then confirms', async () => {
    expect(top(await run('3'))).toEqual({ id: 'customer', draft: { kind: 'debt' } });
    expect(top(await run('3*Tendai'))).toEqual({ id: 'amount', draft: { kind: 'debt', customer: 'Tendai' } });
    expect(top(await run('3*Tendai*20'))).toEqual({
      id: 'item',
      draft: { kind: 'debt', customer: 'Tendai', cents: 2000 }
    });
    expect(top(await run('3*Tendai*20*sugar'))).toEqual({
      id: 'confirm',
      draft: { kind: 'debt', customer: 'Tendai', cents: 2000, item: 'sugar' }
    });
    expect((await run('3*Tendai*20*sugar*1')).terminal).toEqual({
      type: 'save',
      draft: { kind: 'debt', customer: 'Tendai', cents: 2000, item: 'sugar' },
      step: 5
    });
  });

  it('trims and collapses the name', async () => {
    expect(top(await run('3*  mama   thandi '))).toEqual({
      id: 'amount',
      draft: { kind: 'debt', customer: 'mama thandi' }
    });
  });

  it('refuses a name with no letter, a long name and a non-ASCII name', async () => {
    const digits = await run('3*45');
    expect(top(digits).id).toBe('customer');
    expect(digits.notice).toBe(NOTICE.customerBad);
    expect((await run(`3*${'a'.repeat(21)}`)).notice).toBe(NOTICE.customerLong);
    expect((await run('3*Ren\u00e9')).notice).toBe(NOTICE.asciiOnly);
    expect((await run('3*')).notice).toBe(NOTICE.customerBad);
  });

  it('0 goes back to the name with the earlier answers in place', async () => {
    expect(top(await run('3*Tendai*20*0'))).toEqual({ id: 'amount', draft: { kind: 'debt', customer: 'Tendai' } });
    expect(top(await run('3*Tendai*20*0*0'))).toEqual({ id: 'customer', draft: { kind: 'debt' } });
  });
});

describe('paid back', () => {
  // Short names (A, B, C ...) so that seven rows fit on a page.
  const owes = (n: number): CustomerBalance[] =>
    Array.from({ length: n }, (_, i) => ({ displayName: String.fromCharCode(65 + i), balance: 10000 - i * 100 }));

  it('with nobody owing goes straight to the name prompt', async () => {
    expect(top(await run('4'))).toEqual({ id: 'customer', draft: { kind: 'payment' } });
  });

  it('with customers shows the list on page 1', async () => {
    expect(top(await run('4', { owes: owes(3) }))).toEqual({ id: 'payWho', page: 1 });
  });

  it('a row number picks that customer, then asks the amount, then confirms (no item)', async () => {
    const o = { owes: owes(3) };
    expect(top(await run('4*2', o))).toEqual({ id: 'amount', draft: { kind: 'payment', customer: 'B' } });
    expect(top(await run('4*2*10', o))).toEqual({
      id: 'confirm',
      draft: { kind: 'payment', customer: 'B', cents: 1000 }
    });
    expect((await run('4*2*10*1', o)).terminal).toEqual({
      type: 'save',
      draft: { kind: 'payment', customer: 'B', cents: 1000 },
      step: 4
    });
  });

  it('8 Other name asks for the name by typing', async () => {
    const o = { owes: owes(3) };
    expect(top(await run('4*8', o))).toEqual({ id: 'customer', draft: { kind: 'payment' } });
    expect(top(await run('4*8*Zodwa', o))).toEqual({ id: 'amount', draft: { kind: 'payment', customer: 'Zodwa' } });
  });

  it('a number past the rows on the page is refused', async () => {
    const o = { owes: owes(3) };
    for (const bad of ['4', '5', '7', '0x', 'x', '']) {
      const s = await run(`4*${bad}`, o);
      expect(top(s)).toEqual({ id: 'payWho', page: 1 });
      expect(s.notice).toBe(NOTICE.choose);
    }
  });

  it('9 on the only page is refused', async () => {
    const s = await run('4*9', { owes: owes(2) });
    expect(top(s)).toEqual({ id: 'payWho', page: 1 });
    expect(s.notice).toBe(NOTICE.choose);
  });

  describe('with so many customers that the list has pages', () => {
    // Short names keep seven rows on a page (the limit), so 20 customers make 3 pages: 7, 7, 6.
    const many = owes(20);

    it('shows 7 rows on a page and 9 More takes the owner to page 2', async () => {
      const s = await run('4*9', { owes: many });
      expect(top(s)).toEqual({ id: 'payWho', page: 2 });
    });

    it('row numbers pick the right customer on page 1 and page 2', async () => {
      const o = { owes: many };
      expect(top(await run('4*1', o))).toMatchObject({ draft: { customer: 'A' } });
      expect(top(await run('4*7', o))).toMatchObject({ draft: { customer: 'G' } });
      expect(top(await run('4*9*1', o))).toMatchObject({ draft: { customer: 'H' } });
      expect(top(await run('4*9*7', o))).toMatchObject({ draft: { customer: 'N' } });
      expect(top(await run('4*9*9*6', o))).toMatchObject({ draft: { customer: 'T' } });
    });

    it('8 and 9 are never customers', async () => {
      const o = { owes: many };
      expect(top(await run('4*8', o)).id).toBe('customer');
      expect(top(await run('4*9*8', o)).id).toBe('customer');
      expect(top(await run('4*9', o)).id).toBe('payWho');
    });

    it('9 on the last page is refused', async () => {
      const s = await run('4*9*9*9', { owes: many });
      expect(top(s)).toEqual({ id: 'payWho', page: 3 });
      expect(s.notice).toBe(NOTICE.choose);
    });

    it('a number past the rows on the last page is refused', async () => {
      const s = await run('4*9*9*7', { owes: many });
      expect(top(s)).toEqual({ id: 'payWho', page: 3 });
      expect(s.notice).toBe(NOTICE.choose);
    });

    it('0 from page 2 reaches page 1, and a notice does not move the pages', async () => {
      const o = { owes: many };
      expect(top(await run('4*9*0', o))).toEqual({ id: 'payWho', page: 1 });
      expect(top(await run('4*9*x*1', o))).toMatchObject({ draft: { customer: 'H' } });
    });
  });

  it('puts three rows on a page with the longest data', async () => {
    const longest = Array.from({ length: 5 }, (_, i) => ({
      displayName: `Longname Customer 0${i + 1}`,
      balance: 99999999 - i
    }));
    const shop: Shop = { ...SHOP, currency: 'GHS' };
    expect(top(await run('4*3', { owes: longest, shop }))).toMatchObject({ draft: { customer: 'Longname Customer 03' } });
    expect(top(await run('4*4', { owes: longest, shop })).id).toBe('payWho');
    expect(top(await run('4*9*1', { owes: longest, shop }))).toMatchObject({
      draft: { customer: 'Longname Customer 04' }
    });
  });
});

describe('lookups and undo', () => {
  const owes = (n: number): CustomerBalance[] =>
    Array.from({ length: n }, (_, i) => ({ displayName: `Customer ${String.fromCharCode(65 + i)}`, balance: 10000 - i }));
  const target: UndoTarget = { id: 'rec_1', kind: 'sale', cents: 4500, item: 'bread' };

  it('5 is the today terminal and 8 is the close terminal', async () => {
    expect((await run('5')).terminal).toEqual({ type: 'today' });
    expect((await run('8')).terminal).toEqual({ type: 'close' });
  });

  it('6 with nobody owing ends with owesNone', async () => {
    expect((await run('6')).terminal).toEqual({ type: 'owesNone' });
  });

  it('6 with one page ends with owesEnd on page 1', async () => {
    expect((await run('6', { owes: owes(2) })).terminal).toEqual({ type: 'owesEnd', page: 1 });
  });

  it('6 with three pages gives owesList 1, owesList 2, then owesEnd 3', async () => {
    // Rows of 34 characters (20-character names, GHS) hold 3 to a page: 7 rows make 3 pages.
    const rows: CustomerBalance[] = Array.from({ length: 7 }, (_, i) => ({
      displayName: `Longname Customer 0${i + 1}`,
      balance: 99999999 - i
    }));
    const o = { owes: rows, shop: { ...SHOP, currency: 'GHS' as const } };
    expect(top(await run('6', o))).toEqual({ id: 'owesList', page: 1 });
    expect(top(await run('6*9', o))).toEqual({ id: 'owesList', page: 2 });
    const end = await run('6*9*9', o);
    expect(end.terminal).toEqual({ type: 'owesEnd', page: 3 });
    expect(ids(end)).toEqual(['main', 'owesList', 'owesList']);
  });

  it('a wrong number on a who-owes page is refused with the choose notice', async () => {
    const rows: CustomerBalance[] = Array.from({ length: 7 }, (_, i) => ({
      displayName: `Longname Customer 0${i + 1}`,
      balance: 99999999 - i
    }));
    const o = { owes: rows, shop: { ...SHOP, currency: 'GHS' as const } };
    const s = await run('6*1', o);
    expect(top(s)).toEqual({ id: 'owesList', page: 1 });
    expect(s.notice).toBe(NOTICE.choose);
  });

  it('0 from a who-owes page goes back a page, then to the main menu', async () => {
    const rows: CustomerBalance[] = Array.from({ length: 7 }, (_, i) => ({
      displayName: `Longname Customer 0${i + 1}`,
      balance: 99999999 - i
    }));
    const o = { owes: rows, shop: { ...SHOP, currency: 'GHS' as const } };
    expect(top(await run('6*9*0', o))).toEqual({ id: 'owesList', page: 1 });
    expect(ids(await run('6*9*0*0', o))).toEqual(['main']);
  });

  it('7 with nothing to undo is the nothingToUndo terminal', async () => {
    expect((await run('7')).terminal).toEqual({ type: 'nothingToUndo' });
  });

  it('7 with a target shows the undo confirm; 7*1 undoes at step 2', async () => {
    const o = { target };
    expect(top(await run('7', o))).toEqual({ id: 'undoConfirm' });
    expect((await run('7*1', o)).terminal).toEqual({ type: 'undo', step: 2 });
  });

  it('7*2 shows the main menu with Not undone.', async () => {
    const s = await run('7*2', { target });
    expect(ids(s)).toEqual(['main']);
    expect(s.notice).toBe(NOTICE.notUndone);
    expect(s.terminal).toBeUndefined();
  });

  it('a wrong number on the undo confirm is refused with the choose notice', async () => {
    const s = await run('7*3', { target });
    expect(top(s)).toEqual({ id: 'undoConfirm' });
    expect(s.notice).toBe(NOTICE.choose);
  });

  it('0 from the undo confirm reaches the main menu', async () => {
    expect(ids(await run('7*0', { target }))).toEqual(['main']);
  });
});
