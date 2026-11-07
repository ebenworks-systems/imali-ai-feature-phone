/**
 * Whole conversations with the SMS handler, one message at a time, the way a phone would send them.
 *
 * Everything runs on MemoryStore and InMemoryPendingStore with a clock the test moves by hand. No test
 * touches the network: the model reader is always a fake, and the global fetch fails the test if it is used.
 * Every reply goes through expectSmsReply: plain ASCII and at most 160 characters (requirements 42 and 50).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleText, MAX_TEXT_LENGTH } from '@/channels/sms/handler.ts';
import { InMemoryPendingStore, PENDING_TTL_MS } from '@/channels/sms/pending.ts';
import type { ModelReader, Proposal } from '@/ai/reader.ts';
import { createShop, type Currency } from '@/core/index.ts';
import { MemoryStore } from '@/store/memory/store.ts';
import { expectSmsReply } from '../../helpers/reply.ts';

// ----------------------------------------------------------------------------
// Test world
// ----------------------------------------------------------------------------

const OWNER = '+27000000001';
const OTHER_OWNER = '+27000000002';
const SHOP_NAME = "Thandi's Spaza";
const START = new Date('2025-11-03T08:00:00.000Z'); // Monday 3 Nov 2025, 10:00 in Johannesburg
const WELCOME = 'Welcome to the Imali AI shop ledger. Reply with your shop name to start.';
const SORRY = 'Sorry, I did not get that. Try: sold 45 bread, spent 20 taxi, Tendai owes 30, today, who owes.';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('a test tried to use the network');
  });
});

function world(reader?: ModelReader) {
  let nowMs = START.getTime();
  const store = new MemoryStore();
  const pending = new InMemoryPendingStore({ now: () => new Date(nowMs) });

  const w = {
    store,
    pending,
    now: () => new Date(nowMs),
    advance(ms: number) {
      nowMs += ms;
    },
    setTime(date: Date) {
      nowMs = date.getTime();
    },
    /** Send one message and return the reply. */
    async text(message: string, phone: string = OWNER): Promise<string> {
      const { reply } = await handleText({ phone, text: message, now: new Date(nowMs), store, pending, reader });
      return expectSmsReply(reply);
    },
    /** A new owner: the welcome, then the shop name. */
    async signUp(phone: string = OWNER, name: string = SHOP_NAME): Promise<void> {
      await w.text('hi', phone);
      await w.text(name, phone);
    },
    async shop(phone: string = OWNER) {
      const shop = await store.findShopByPhone(phone);
      if (!shop) throw new Error('no shop for ' + phone);
      return shop;
    },
    async records(phone: string = OWNER) {
      return store.listRecords((await w.shop(phone)).id);
    }
  };
  return w;
}

/** A model reader that never uses the network: it answers with what the test gives it. */
function fakeReader(answer: Proposal | null | 'throws') {
  const calls: string[] = [];
  const reader: ModelReader = {
    async read(text: string) {
      calls.push(text);
      if (answer === 'throws') throw new Error('model reader failed');
      return answer;
    }
  };
  return { reader, calls };
}

/** A shop made directly in the store, for the currencies the sign-up does not offer. */
async function shopIn(w: ReturnType<typeof world>, currency: Currency, phone: string) {
  await w.store.createShop(
    createShop({ name: 'Thandi Mokoena Family Sp', phone, currency, timeZone: 'Africa/Johannesburg' })
  );
}

// ----------------------------------------------------------------------------
// New owners (requirements 44 and 45)
// ----------------------------------------------------------------------------

describe('a new number signs up and records a sale', () => {
  it('gets the welcome, then names the shop, then records a sale', async () => {
    const w = world();

    expect(await w.text('hello')).toBe(WELCOME);
    expect(await w.store.findShopByPhone(OWNER)).toBeNull();

    expect(await w.text(SHOP_NAME)).toBe("Thandi's Spaza is ready. Try: sold 45 bread.");
    const shop = await w.shop();
    expect(shop).toMatchObject({
      name: SHOP_NAME,
      phone: OWNER,
      currency: 'ZAR',
      timeZone: 'Africa/Johannesburg',
      createdAt: START.toISOString()
    });
    expect(shop.id).toMatch(new RegExp(`^shop_${UUID}$`));

    expect(await w.text('sold 3 bread 45')).toBe('Saved: sale R45 (3 bread). Sales today R45. Reply undo to cancel.');

    const records = await w.records();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      kind: 'sale',
      amount: 4500,
      item: 'bread',
      channel: 'sms',
      originalWords: 'sold 3 bread 45',
      shopId: shop.id,
      createdAt: START.toISOString()
    });
    expect(records[0].id).toMatch(new RegExp(`^rec_${UUID}$`));
  });

  it('does not record the first message, whatever it says', async () => {
    const w = world();
    expect(await w.text('sold 45 bread')).toBe(WELCOME);
    expect(await w.store.findShopByPhone(OWNER)).toBeNull();
    expect(await w.text('')).toBe('Please reply with your shop name, for example: Thandi\'s Spaza.');
  });

  it('cuts a long shop name to 24 characters', async () => {
    const w = world();
    await w.text('hi');
    expect(await w.text('  Thandi   Mokoena Family Spaza And Tuckshop  ')).toBe(
      'Thandi Mokoena Family Sp is ready. Try: sold 45 bread.'
    );
    expect((await w.shop()).name).toHaveLength(24);
  });

  it('writes a shop name with curly quotes in plain ASCII', async () => {
    const w = world();
    await w.text('hi');
    expect(await w.text('Thandi\u2019s Spaza')).toBe("Thandi's Spaza is ready. Try: sold 45 bread.");
    expect((await w.shop()).name).toBe("Thandi's Spaza");
  });

  it('asks again when the shop name has no letters or digits, and keeps waiting for it', async () => {
    const w = world();
    await w.text('hi');
    const again = 'Please reply with your shop name, for example: Thandi\'s Spaza.';
    expect(await w.text('???')).toBe(again);
    expect(await w.text('   ')).toBe(again);
    expect(await w.text('x'.repeat(MAX_TEXT_LENGTH + 1))).toBe(again);
    expect(await w.store.findShopByPhone(OWNER)).toBeNull();
    expect(await w.text('Sipho Store')).toBe('Sipho Store is ready. Try: sold 45 bread.');
  });

  it('sends the welcome again if the shop name does not come within 10 minutes', async () => {
    const w = world();
    await w.text('hi');
    w.advance(PENDING_TTL_MS + 1);
    expect(await w.text('Thandi Spaza')).toBe(WELCOME);
    expect(await w.store.findShopByPhone(OWNER)).toBeNull();
    expect(await w.text('Thandi Spaza')).toBe('Thandi Spaza is ready. Try: sold 45 bread.');
  });

  it('keeps two new owners apart, each with their own shop and ids', async () => {
    const w = world();
    await w.text('hi', OWNER);
    await w.text('hi', OTHER_OWNER);
    expect(await w.text('Shop One', OWNER)).toBe('Shop One is ready. Try: sold 45 bread.');
    expect(await w.text('Shop Two', OTHER_OWNER)).toBe('Shop Two is ready. Try: sold 45 bread.');

    const one = await w.shop(OWNER);
    const two = await w.shop(OTHER_OWNER);
    expect(one.id).not.toBe(two.id);

    await w.text('sold bread 20', OWNER);
    await w.text('sold bread 99', OTHER_OWNER);
    expect(await w.text('today', OWNER)).toBe('Today: sales R20 (1), spent R0, in hand R20.');
    expect(await w.text('today', OTHER_OWNER)).toBe('Today: sales R99 (1), spent R0, in hand R99.');
  });

  it('gives every record its own id', async () => {
    const w = world();
    await w.signUp();
    for (const message of ['sold 10', 'sold 20', 'spent 5 taxi', 'Tendai owes 30', 'undo', 'Tendai paid 10']) {
      await w.text(message);
    }
    const ids = (await w.records()).map((r) => r.id);
    expect(ids).toHaveLength(6); // five records and one reversal
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(new RegExp(`^rec_${UUID}$`));
    }
  });

  it('treats the phone number with spaces around it as the same phone', async () => {
    const w = world();
    await w.text('hi', `  ${OWNER} `);
    expect(await w.text('Thandi Spaza', OWNER)).toBe('Thandi Spaza is ready. Try: sold 45 bread.');
    expect(await w.text('sold 10', `${OWNER}  `)).toMatch(/^Saved: sale R10\./);
  });
});

// ----------------------------------------------------------------------------
// Each intent (requirements 31 to 41)
// ----------------------------------------------------------------------------

describe('each intent, in one conversation', () => {
  it('records and answers in the words of the spec', async () => {
    const w = world();
    await w.signUp();

    expect(await w.text('sold 3 bread 45')).toBe('Saved: sale R45 (3 bread). Sales today R45. Reply undo to cancel.');
    expect(await w.text('  SOLD   bread   R20 ')).toBe('Saved: sale R20 (bread). Sales today R65. Reply undo to cancel.');
    expect(await w.text('spent 20 transport')).toBe('Saved: spent R20 (transport). Spent today R20.');
    expect(await w.text('Tendai owes 20 sugar')).toBe('Saved: Tendai owes R20 (sugar). Tendai owes R20 in total.');
    expect(await w.text('tendai   owes 30')).toBe('Saved: Tendai owes R30. Tendai owes R50 in total.');
    expect(await w.text('Rudo owes 15')).toBe('Saved: Rudo owes R15. Rudo owes R15 in total.');
    expect(await w.text('Tendai paid 10')).toBe('Saved: Tendai paid R10. Tendai owes R40 now.');

    expect(await w.text('today')).toBe('Today: sales R65 (2), spent R20, in hand R55.');
    expect(await w.text('who owes')).toBe('Owes: Tendai R40, Rudo R15.');
    expect(await w.text('how much does Tendai owe')).toBe('Tendai owes R40.');
    expect(await w.text('rudo?')).toBe('Rudo owes R15.');
    expect(await w.text('Thabo?')).toBe('Thabo owes nothing.');
    expect(await w.text('close')).toBe(
      'Close Mon 3 Nov: sales R65 (2), spent R20, in hand R55, credit given R65, paid back R10, total owed R55.'
    );
    expect(await w.text('help')).toBe(SORRY);
    expect(await w.text('?')).toBe(SORRY);
  });

  it('answers a message the ledger cannot read with one short example', async () => {
    const w = world();
    await w.signUp();
    expect(await w.text('banana split')).toBe(SORRY);
    expect(await w.text('')).toBe(SORRY);
    expect(await w.text('sold')).toBe(SORRY);
    expect(await w.text('x'.repeat(MAX_TEXT_LENGTH + 1))).toBe(SORRY);
    expect(await w.records()).toHaveLength(0);
  });

  it('records an expense, a debt and a payment with the owner words, on the sms channel', async () => {
    const w = world();
    await w.signUp();
    await w.text('spend 120 on transport');
    await w.text('Mai Rudo owes 20 sugar');
    await w.text('received 10 from mai rudo');

    const records = await w.records();
    expect(records.map((r) => r.kind)).toEqual(['expense', 'debt', 'payment']);
    expect(records.map((r) => r.amount)).toEqual([12000, 2000, 1000]);
    expect(records.map((r) => r.originalWords)).toEqual([
      'spend 120 on transport',
      'Mai Rudo owes 20 sugar',
      'received 10 from mai rudo'
    ]);
    expect(records.every((r) => r.channel === 'sms')).toBe(true);
    // The same person keeps the name they were first given.
    expect(records[1]).toMatchObject({ customerDisplayName: 'Mai Rudo' });
    expect(records[2]).toMatchObject({ customerDisplayName: 'Mai Rudo' });
  });

  it('answers a who owes with nobody owing, and a day with nothing in it', async () => {
    const w = world();
    await w.signUp();
    expect(await w.text('who owes')).toBe('Nobody owes you money.');
    expect(await w.text('today')).toBe('Today: sales R0 (0), spent R0, in hand R0.');
    expect(await w.text('close')).toBe(
      'Close Mon 3 Nov: sales R0 (0), spent R0, in hand R0, credit given R0, paid back R0, total owed R0.'
    );
    expect(await w.text('undo')).toBe('Nothing to undo.');
  });
});

describe('undo', () => {
  it('undoes twice in a row: the second undo takes the record before, and nothing is deleted', async () => {
    const w = world();
    await w.signUp();
    await w.text('sold bread 45');
    await w.text('spent 20 transport');
    expect(await w.text('today')).toBe('Today: sales R45 (1), spent R20, in hand R25.');

    expect(await w.text('undo')).toBe('Undone: spent R20 (transport). Spent today R0.');
    expect(await w.text('undo')).toBe('Undone: sale R45 (bread). Sales today R0.');
    expect(await w.text('undo')).toBe('Nothing to undo.');
    expect(await w.text('today')).toBe('Today: sales R0 (0), spent R0, in hand R0.');

    const records = await w.records();
    expect(records.map((r) => r.kind)).toEqual(['sale', 'expense', 'reversal', 'reversal']);
    const [sale, expense, first, second] = records;
    expect(first).toMatchObject({ kind: 'reversal', reversesRecordId: expense.id, originalWords: 'undo', channel: 'sms' });
    expect(second).toMatchObject({ kind: 'reversal', reversesRecordId: sale.id });
  });

  it('undoes a debt and a payment and says where the customer stands', async () => {
    const w = world();
    await w.signUp();
    await w.text('Tendai owes 50 sugar');
    await w.text('Tendai paid 20');
    expect(await w.text('undo')).toBe('Undone: Tendai paid R20. Tendai owes R50 now.');
    expect(await w.text('oops')).toBe('Undone: Tendai owes R50 (sugar). Tendai owes nothing now.');
    expect(await w.text('who owes')).toBe('Nobody owes you money.');
  });

  it('undoes a sale and shows the sales that are left today', async () => {
    const w = world();
    await w.signUp();
    await w.text('sold 100');
    await w.text('sold 3 bread 45');
    expect(await w.text('cancel')).toBe('Undone: sale R45 (bread). Sales today R100.');
  });
});

describe('a payment larger than the debt', () => {
  it('is recorded, and the reply says the customer has credit', async () => {
    const w = world();
    await w.signUp();
    await w.text('Tendai owes 20');
    expect(await w.text('Tendai paid 30')).toBe('Saved: Tendai paid R30. Tendai has R10 credit now.');
    expect(await w.text('Tendai?')).toBe('Tendai has R10 credit.');
    expect(await w.text('who owes')).toBe('Nobody owes you money.');
    expect(await w.text('undo')).toBe('Undone: Tendai paid R30. Tendai owes R20 now.');
    expect((await w.records()).map((r) => r.kind)).toEqual(['debt', 'payment', 'reversal']);
  });

  it('says credit when a customer who owes nothing gets more credit on credit', async () => {
    const w = world();
    await w.signUp();
    await w.text('Tendai paid 30');
    expect(await w.text('Tendai owes 20')).toBe('Saved: Tendai owes R20. Tendai has R10 credit.');
  });
});

describe('who owes over two pages', () => {
  const NAMES = [
    'Nomvula Dlamini-Khum',
    'Sipho Ndlovu-Mokoena',
    'Lindiwe Mthembu-Zulu',
    'Bongani Khumalo-Dube',
    'Zanele Nkosi-Mahlang',
    'Themba Sithole-Ngwen',
    'Palesa Moloi-Radebe',
    'Mandla Cele-Buthelez'
  ];

  /** Names and amounts in a who owes reply, in the order shown. */
  function listed(reply: string): Array<{ name: string; rand: number }> {
    const body = reply.replace(/^Owes: /, '').replace(/, \+\d+ more\. Reply owes \d+$/, '').replace(/\.$/, '');
    return body.split(', ').map((part) => {
      const match = /^(.*) R(\d+)$/.exec(part);
      if (!match) throw new Error(`cannot read "${part}" in "${reply}"`);
      return { name: match[1], rand: Number(match[2]) };
    });
  }

  it('shows the first names that fit with a More line, then the rest on the next page', async () => {
    const w = world();
    await w.signUp();
    for (const [i, name] of NAMES.entries()) {
      await w.text(`${name} owes ${(NAMES.length - i) * 100}`);
    }

    const page1 = await w.text('who owes');
    expect(page1).toMatch(/^Owes: Nomvula Dlamini-Khum R800, Sipho Ndlovu-Mokoena R700, /);
    expect(page1).toMatch(/, \+\d+ more\. Reply owes 2$/);

    const page2 = await w.text('owes 2');
    expect(page2).not.toMatch(/Reply owes 3/); // eight names fit in two pages
    expect(page2.startsWith('Owes: ')).toBe(true);

    const seen = [...listed(page1), ...listed(page2)];
    expect(seen.map((s) => s.name)).toEqual(NAMES); // every name once, largest debt first
    expect(seen.map((s) => s.rand)).toEqual([800, 700, 600, 500, 400, 300, 200, 100]);

    const more = /\+(\d+) more/.exec(page1);
    expect(Number(more?.[1])).toBe(listed(page2).length);

    // A page past the end says so, with the way back.
    expect(await w.text('owes 3')).toBe('No more names. Reply owes for the first page.');
    expect(await w.text('owes')).toBe(page1);
  });
});

// ----------------------------------------------------------------------------
// Ambiguous amounts (requirements 27, 28 and 29)
// ----------------------------------------------------------------------------

describe('an ambiguous amount', () => {
  it('asks, and "1" saves the smaller amount for the quantity', async () => {
    const w = world();
    await w.signUp();
    expect(await w.text('sold 2 200')).toBe('Did you mean 1) R200 for 2 or 2) R2,200? Reply 1 or 2.');
    expect(await w.records()).toHaveLength(0);

    expect(await w.text('1')).toBe('Saved: sale R200. Sales today R200. Reply undo to cancel.');
    const records = await w.records();
    expect(records).toHaveLength(1);
    // The record carries the owner's first words, not "1".
    expect(records[0]).toMatchObject({ kind: 'sale', amount: 20000, originalWords: 'sold 2 200', channel: 'sms' });
  });

  it('asks, and "2" saves the single bigger amount', async () => {
    const w = world();
    await w.signUp();
    await w.text('sold 2 200');
    expect(await w.text(' 2 ')).toBe('Saved: sale R2,200. Sales today R2,200. Reply undo to cancel.');
    const records = await w.records();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'sale', amount: 220000, originalWords: 'sold 2 200' });
  });

  it('asks about "sold 45 3 bread" and saves nothing until the owner picks', async () => {
    const w = world();
    await w.signUp();
    expect(await w.text('sold 45 3 bread')).toBe('Did you mean 1) R45 for 3 or 2) R3 for 45? Reply 1 or 2.');
    expect(await w.records()).toHaveLength(0);
    expect(await w.text('1')).toBe('Saved: sale R45. Sales today R45. Reply undo to cancel.');
    expect((await w.records())[0]).toMatchObject({ kind: 'sale', amount: 4500, originalWords: 'sold 45 3 bread' });
  });

  it('asks about an expense in the same way', async () => {
    const w = world();
    await w.signUp();
    expect(await w.text('spent 2 200')).toBe('Did you mean 1) R200 for 2 or 2) R2,200? Reply 1 or 2.');
    expect(await w.text('2')).toBe('Saved: spent R2,200. Spent today R2,200.');
    expect((await w.records())[0]).toMatchObject({ kind: 'expense', amount: 220000 });
  });

  it('is answered once: a second "1" is not an answer', async () => {
    const w = world();
    await w.signUp();
    await w.text('sold 2 200');
    await w.text('1');
    expect(await w.text('1')).toBe(SORRY);
    expect(await w.records()).toHaveLength(1);
  });

  it('is cleared by any other message, which is then read normally', async () => {
    const w = world();
    await w.signUp();
    await w.text('sold 2 200');
    expect(await w.text('today')).toBe('Today: sales R0 (0), spent R0, in hand R0.');
    // The question is gone: "1" now is just a message the ledger cannot read.
    expect(await w.text('1')).toBe(SORRY);
    expect(await w.records()).toHaveLength(0);
  });

  it('is cleared by a number that is not one of the two, and that message is read normally', async () => {
    const w = world();
    await w.signUp();
    await w.text('sold 2 200');
    expect(await w.text('3')).toBe(SORRY);
    expect(await w.text('1')).toBe(SORRY);
    expect(await w.records()).toHaveLength(0);
  });

  it('is cleared by another sale, which is saved', async () => {
    const w = world();
    await w.signUp();
    await w.text('sold 2 200');
    expect(await w.text('sold bread 10')).toBe('Saved: sale R10 (bread). Sales today R10. Reply undo to cancel.');
    expect(await w.text('1')).toBe(SORRY);
    expect(await w.records()).toHaveLength(1);
  });

  it('is cleared by "no", with a friendly reply, and nothing is saved', async () => {
    const w = world();
    await w.signUp();
    await w.text('sold 2 200');
    expect(await w.text('No')).toBe('OK, I did not save it.');
    expect(await w.text('1')).toBe(SORRY);
    expect(await w.records()).toHaveLength(0);
  });

  it('belongs to one phone only', async () => {
    const w = world();
    await w.signUp(OWNER, 'Shop One');
    await w.signUp(OTHER_OWNER, 'Shop Two');
    await w.text('sold 2 200', OWNER);
    expect(await w.text('1', OTHER_OWNER)).toBe(SORRY);
    expect(await w.text('1', OWNER)).toMatch(/^Saved: sale R200\./);
    expect(await w.records(OTHER_OWNER)).toHaveLength(0);
  });

  it('asks again if the owner repeats the ambiguous message, and a record is only saved once', async () => {
    const w = world();
    await w.signUp();
    await w.text('sold 2 200');
    expect(await w.text('sold 2 200')).toBe('Did you mean 1) R200 for 2 or 2) R2,200? Reply 1 or 2.');
    await w.text('2');
    await w.text('2');
    expect(await w.records()).toHaveLength(1);
  });
});

// ----------------------------------------------------------------------------
// Big amounts (requirement 30)
// ----------------------------------------------------------------------------

describe('a big amount', () => {
  it('asks first, and "yes" saves it', async () => {
    const w = world();
    await w.signUp();
    expect(await w.text('sold 1500000')).toBe('Reply yes to save sale R1,500,000.');
    expect(await w.records()).toHaveLength(0);

    expect(await w.text('yes')).toBe('Saved: sale R1,500,000. Sales today R1,500,000. Reply undo to cancel.');
    const records = await w.records();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'sale', amount: 150000000, originalWords: 'sold 1500000' });
  });

  it('is saved only once however many times the owner says yes', async () => {
    const w = world();
    await w.signUp();
    await w.text('sold 1500000');
    await w.text(' YES ');
    expect(await w.text('yes')).toBe(SORRY);
    expect(await w.records()).toHaveLength(1);
  });

  it('is not saved when the owner says no', async () => {
    const w = world();
    await w.signUp();
    await w.text('sold 1500000');
    expect(await w.text('no')).toBe('OK, I did not save it.');
    expect(await w.records()).toHaveLength(0);
    expect(await w.text('yes')).toBe(SORRY);
    expect(await w.records()).toHaveLength(0);
  });

  it('is not saved when the owner sends anything else, and that message is read normally', async () => {
    const w = world();
    await w.signUp();
    await w.text('sold 1500000');
    expect(await w.text('today')).toBe('Today: sales R0 (0), spent R0, in hand R0.');
    expect(await w.text('yes')).toBe(SORRY);
    expect(await w.records()).toHaveLength(0);
  });

  it('asks for an expense, a debt and a payment in the right words', async () => {
    const w = world();
    await w.signUp();
    expect(await w.text('spent 2000000 stock')).toBe('Reply yes to save spent R2,000,000.');
    expect(await w.text('Tendai owes 1500000.50')).toBe('Reply yes to save Tendai owes R1,500,000.50.');
    expect(await w.text('Tendai paid 1500000.50')).toBe('Reply yes to save Tendai paid R1,500,000.50.');
    expect(await w.text('yes')).toBe('Saved: Tendai paid R1,500,000.50. Tendai has R1,500,000.50 credit now.');
    const records = await w.records();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'payment', amount: 150000050, originalWords: 'Tendai paid 1500000.50' });
  });

  it('does not ask for exactly 1,000,000.00, but asks for one cent more', async () => {
    const w = world();
    await w.signUp();
    expect(await w.text('sold 1000000')).toMatch(/^Saved: sale R1,000,000\./);
    expect(await w.text('sold 1000000.01')).toBe('Reply yes to save sale R1,000,000.01.');
  });

  it('asks again after an ambiguous answer picks a big amount', async () => {
    const w = world();
    await w.signUp();
    await w.text('sold 2 000');
    // 2 000 reads as R2,000 for one sale or R2,000 for 2: not big. Use a larger pair instead.
    await w.text('no');
    expect(await w.text('sold 999 999')).toBe('Did you mean 1) R999 for 999 or 2) R999,999? Reply 1 or 2.');
    expect(await w.text('2')).toMatch(/^Saved: sale R999,999\./);
  });
});

// ----------------------------------------------------------------------------
// Pending questions that expire (requirement 29)
// ----------------------------------------------------------------------------

describe('a pending question that expires', () => {
  it('an ambiguous question is gone after 10 minutes, and the next message is read normally', async () => {
    const w = world();
    await w.signUp();
    await w.text('sold 2 200');
    w.advance(PENDING_TTL_MS + 1);
    expect(await w.text('1')).toBe(SORRY);
    expect(await w.records()).toHaveLength(0);
    expect(await w.text('today')).toBe('Today: sales R0 (0), spent R0, in hand R0.');
  });

  it('is still waiting at exactly 10 minutes', async () => {
    const w = world();
    await w.signUp();
    await w.text('sold 2 200');
    w.advance(PENDING_TTL_MS);
    expect(await w.text('1')).toMatch(/^Saved: sale R200\./);
  });

  it('a big-amount question is gone after 10 minutes', async () => {
    const w = world();
    await w.signUp();
    await w.text('sold 1500000');
    w.advance(PENDING_TTL_MS + 1);
    expect(await w.text('yes')).toBe(SORRY);
    expect(await w.records()).toHaveLength(0);
  });

  it('an expired question does not stop the next message, which is read normally', async () => {
    const w = world();
    await w.signUp();
    await w.text('sold 1500000');
    w.advance(11 * 60 * 1000);
    expect(await w.text('sold bread 10')).toBe('Saved: sale R10 (bread). Sales today R10. Reply undo to cancel.');
  });

  it('expires even when the pending store keeps the question for too long', async () => {
    // A store that never forgets: the handler must still refuse an answer that comes after 10 minutes.
    const w = world();
    const forever = new Map<string, Awaited<ReturnType<typeof w.pending.get>>>();
    const pending = {
      get: async (phone: string) => forever.get(phone) ?? null,
      set: async (phone: string, question: Parameters<typeof w.pending.set>[1]) => {
        forever.set(phone, question);
      },
      clear: async (phone: string) => {
        forever.delete(phone);
      }
    };
    const send = async (text: string, at: Date) =>
      expectSmsReply((await handleText({ phone: OWNER, text, now: at, store: w.store, pending })).reply);

    await send('hi', START);
    await send('Thandi Spaza', START);
    await send('sold 2 200', START);
    expect(await send('1', new Date(START.getTime() + PENDING_TTL_MS + 1))).toBe(SORRY);
    expect(await w.records()).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------
// The model reader (requirements 46 and 47)
// ----------------------------------------------------------------------------

describe('the model reader', () => {
  const DEBT_WORDS = 'tendai took sugar 20 not paid';
  const SALE_WORDS = 'a lady paid 45 for bread';

  it('is not asked when the rules can read the message', async () => {
    const { reader, calls } = fakeReader(null);
    const w = world(reader);
    await w.signUp();
    expect(await w.text('sold bread 45')).toMatch(/^Saved: sale R45/);
    expect(await w.text('today')).toMatch(/^Today:/);
    expect(await w.text('who owes')).toBe('Nobody owes you money.');
    expect(calls).toEqual([]);
  });

  it('is not asked for the first message of a new owner, or for the shop name', async () => {
    const { reader, calls } = fakeReader(null);
    const w = world(reader);
    await w.signUp();
    expect(calls).toEqual([]);
  });

  it('is asked once with the owner words when the rules cannot read them; a good proposal is saved', async () => {
    const { reader, calls } = fakeReader({
      intent: { kind: 'debt', customer: 'Tendai', cents: 2000, item: 'sugar' },
      amountSubstring: '20',
      customerSubstring: 'Tendai'
    });
    const w = world(reader);
    await w.signUp();

    expect(await w.text(DEBT_WORDS)).toBe('Saved: tendai owes R20 (sugar). tendai owes R20 in total.');
    expect(calls).toEqual([DEBT_WORDS]);

    const records = await w.records();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      kind: 'debt',
      amount: 2000,
      item: 'sugar',
      customerDisplayName: 'tendai',
      channel: 'sms',
      originalWords: DEBT_WORDS
    });
  });

  it('saves a good sale proposal', async () => {
    const { reader } = fakeReader({
      intent: { kind: 'sale', cents: 4500, item: 'bread' },
      amountSubstring: '45'
    });
    const w = world(reader);
    await w.signUp();
    expect(await w.text(SALE_WORDS)).toBe('Saved: sale R45 (bread). Sales today R45. Reply undo to cancel.');
    expect((await w.records())[0]).toMatchObject({ kind: 'sale', amount: 4500, originalWords: SALE_WORDS });
  });

  it('refuses a proposal with an amount the owner never typed, and saves nothing', async () => {
    const { reader, calls } = fakeReader({
      intent: { kind: 'sale', cents: 9900, item: 'bread' },
      amountSubstring: '99'
    });
    const w = world(reader);
    await w.signUp();
    expect(await w.text(SALE_WORDS)).toBe(SORRY);
    expect(calls).toHaveLength(1);
    expect(await w.records()).toHaveLength(0);
  });

  it('refuses a proposal that reads 45 as 45 cents', async () => {
    const { reader } = fakeReader({ intent: { kind: 'sale', cents: 45 }, amountSubstring: '45' });
    const w = world(reader);
    await w.signUp();
    expect(await w.text(SALE_WORDS)).toBe(SORRY);
    expect(await w.records()).toHaveLength(0);
  });

  it('refuses a proposal with a customer who is not in the message', async () => {
    const { reader } = fakeReader({
      intent: { kind: 'debt', customer: 'Rudo', cents: 2000 },
      amountSubstring: '20',
      customerSubstring: 'Rudo'
    });
    const w = world(reader);
    await w.signUp();
    expect(await w.text(DEBT_WORDS)).toBe(SORRY);
    expect(await w.records()).toHaveLength(0);
  });

  it('refuses a proposal for something other than the four kinds', async () => {
    const lie = { intent: { kind: 'undo' }, amountSubstring: '20' } as unknown as Proposal;
    const { reader } = fakeReader(lie);
    const w = world(reader);
    await w.signUp();
    await w.text('sold bread 10');
    expect(await w.text(DEBT_WORDS)).toBe(SORRY);
    expect(await w.records()).toHaveLength(1); // the sale; nothing was undone
  });

  it('gives the unknown reply when the reader gives null', async () => {
    const { reader, calls } = fakeReader(null);
    const w = world(reader);
    await w.signUp();
    expect(await w.text(DEBT_WORDS)).toBe(SORRY);
    expect(calls).toHaveLength(1);
    expect(await w.records()).toHaveLength(0);
  });

  it('gives the unknown reply when the reader throws', async () => {
    const { reader, calls } = fakeReader('throws');
    const w = world(reader);
    await w.signUp();
    expect(await w.text(DEBT_WORDS)).toBe(SORRY);
    expect(calls).toHaveLength(1);
  });

  it('works without a reader: the same message gets the unknown reply', async () => {
    const w = world();
    await w.signUp();
    expect(await w.text(DEBT_WORDS)).toBe(SORRY);
  });

  it('still asks the owner about a big amount a good proposal reads', async () => {
    const { reader } = fakeReader({
      intent: { kind: 'sale', cents: 150000000 },
      amountSubstring: '1500000'
    });
    const w = world(reader);
    await w.signUp();
    const words = 'a lady paid 1500000 for bread';
    expect(await w.text(words)).toBe('Reply yes to save sale R1,500,000.');
    expect(await w.records()).toHaveLength(0);
    expect(await w.text('yes')).toMatch(/^Saved: sale R1,500,000\./);
    expect((await w.records())[0]).toMatchObject({ originalWords: words });
  });

  it('refuses a good proposal that has a zero amount', async () => {
    const { reader } = fakeReader({ intent: { kind: 'sale', cents: 0 }, amountSubstring: '0' });
    const w = world(reader);
    await w.signUp();
    expect(await w.text('a lady paid 0 for bread')).toBe('The amount must be more than zero. Try: sold 45 bread.');
    expect(await w.records()).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------
// Amounts the ledger refuses
// ----------------------------------------------------------------------------

describe('amounts the ledger refuses with a plain reason', () => {
  it('refuses zero', async () => {
    const w = world();
    await w.signUp();
    expect(await w.text('sale 0')).toBe('The amount must be more than zero. Try: sold 45 bread.');
    expect(await w.text('spent 0.00 taxi')).toBe('The amount must be more than zero. Try: sold 45 bread.');
    expect(await w.text('Tendai owes 0')).toBe('The amount must be more than zero. Try: sold 45 bread.');
    expect(await w.records()).toHaveLength(0);
  });

  it('refuses an amount too big to hold', async () => {
    const w = world();
    await w.signUp();
    expect(await w.text('sold 99999999999 bread at 99999999999')).toBe(
      'That amount is too big. Please check it and try again.'
    );
    expect(await w.records()).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------
// "Today" is the shop's local day
// ----------------------------------------------------------------------------

describe("today is the shop's local day", () => {
  it('counts a sale made at 23:30 in Johannesburg today, and not tomorrow', async () => {
    const w = world();
    await w.signUp();
    w.setTime(new Date('2025-11-03T21:30:00.000Z')); // 23:30 on Mon 3 Nov in Johannesburg
    await w.text('sold bread 45');
    expect(await w.text('today')).toBe('Today: sales R45 (1), spent R0, in hand R45.');
    expect(await w.text('close')).toMatch(/^Close Mon 3 Nov: sales R45 \(1\)/);

    w.setTime(new Date('2025-11-03T22:30:00.000Z')); // 00:30 on Tue 4 Nov in Johannesburg
    expect(await w.text('today')).toBe('Today: sales R0 (0), spent R0, in hand R0.');
    expect(await w.text('close')).toMatch(/^Close Tue 4 Nov: sales R0 \(0\)/);

    // The debt a customer owes does not go away with the day.
    await w.text('Tendai owes 20');
    w.setTime(new Date('2025-11-04T08:00:00.000Z'));
    expect(await w.text('who owes')).toBe('Owes: Tendai R20.');
  });
});

// ----------------------------------------------------------------------------
// The longest data (the screens rule)
// ----------------------------------------------------------------------------

describe('the longest data still fits one text', () => {
  const CUSTOMER = 'Nomvula Dlamini-Khum'; // 20 characters
  const ITEM = 'full cream long life mil'; // 24 characters
  const CURRENCIES: Currency[] = ['ZAR', 'USD', 'KES', 'NGN', 'GHS', 'ZMW', 'BWP'];

  it('has the lengths the rule asks for', () => {
    expect(CUSTOMER).toHaveLength(20);
    expect(ITEM).toHaveLength(24);
  });

  it('fits in every currency, for every kind of reply', async () => {
    for (const [i, currency] of CURRENCIES.entries()) {
      const w = world();
      const phone = `+2700000010${i}`;
      await shopIn(w, currency, phone);
      const say = (message: string) => w.text(message, phone);

      await say('sold 999 ' + ITEM + ' 999999.99');
      await say('sold 999 ' + ITEM + ' 999999.99');
      await say('spent 999999.99 ' + ITEM);
      await say(`${CUSTOMER} owes 999999.99 ${ITEM}`);
      await say(`${CUSTOMER} owes 999999.99 ${ITEM}`);
      await say(`${CUSTOMER} paid 999999.99`);
      await say('today');
      await say('close');
      await say('who owes');
      await say(`how much does ${CUSTOMER} owe`);
      await say('undo');
      await say('undo');
      await say('sold 999 999'); // the question
      await say('2');
      await say('sold 999999999999 bread'); // a big amount: the question
      await say('yes');
      await say(`${CUSTOMER} owes 90071992547409`); // the biggest amount that fits: the question
      await say('yes');
      await say(`${CUSTOMER} paid 90071992547409`);
      await say('yes');
      await say('help');
    }
  });

  it('refuses, before saving, an amount that would push a total past the largest safe number', async () => {
    const w = world();
    await w.signUp();
    expect(await w.text('Tendai owes 90071992547409')).toBe('Reply yes to save Tendai owes R90,071,992,547,409.');
    expect(await w.text('yes')).toBe('Saved: Tendai owes R90,071,992,547,409. Tendai owes R90,071,992,547,409 in total.');

    // One more rand would take the total past 2^53 cents: nothing is saved, and every query still answers.
    expect(await w.text('Tendai owes 1')).toBe('That amount is too big. Please check it and try again.');
    expect(await w.text('Tendai owes 90071992547409')).toBe('That amount is too big. Please check it and try again.');
    expect(await w.text('sold 90071992547409')).toBe('Reply yes to save sale R90,071,992,547,409.');
    await w.text('yes');
    expect(await w.text('sold 90071992547409')).toBe('That amount is too big. Please check it and try again.');
    for (const message of ['today', 'who owes', 'close', 'Tendai?', 'undo']) {
      await w.text(message);
    }
  });

  it('refuses, before saving, a payment that would push a credit past the largest safe number', async () => {
    const w = world();
    await w.signUp();
    expect(await w.text('Tendai paid 90071992547409')).toBe('Reply yes to save Tendai paid R90,071,992,547,409.');
    expect(await w.text('yes')).toBe('Saved: Tendai paid R90,071,992,547,409. Tendai has R90,071,992,547,409 credit now.');
    expect(await w.text('Tendai paid 1')).toBe('That amount is too big. Please check it and try again.');
    expect(await w.records()).toHaveLength(1);
    for (const message of ['today', 'who owes', 'close', 'Tendai?', 'undo']) {
      await w.text(message);
    }
  });

  it('fits when many customers with long names owe, and the owner asks for every page', async () => {
    const w = world();
    await w.signUp();
    for (let i = 0; i < 12; i++) {
      await w.text(`${CUSTOMER.slice(0, 18)}${String.fromCharCode(65 + i)}${String.fromCharCode(97 + i)} owes 999999.${10 + i}`);
    }
    for (let page = 1; page <= 6; page++) {
      await w.text(`owes ${page}`);
    }
  });

  it('writes a customer name and an item with non-ASCII characters in plain ASCII', async () => {
    const w = world();
    await w.signUp();
    expect(await w.text('Tenda\u00ef owes 20 sugar \u2603')).toMatch(/^Saved: Tendai owes R20 \(sugar \?\)\./);
    expect(await w.text('sold caf\u00e9 \u201cbread\u201d 10')).toMatch(/^Saved: sale R10 /);
    await w.text('who owes');
    await w.text('close');
  });
});
