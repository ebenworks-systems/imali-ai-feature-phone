/**
 * Whole conversations through HTTP, with the real handlers: a dialled-menu session step by step, and a text
 * conversation message by message, each through the Africa's Talking route and through the browser route.
 * Every screen is checked for the limits of .kiro/steering/screens.md.
 */

import { describe, expect, it, vi } from 'vitest';
import { smsProblems, ussdProblems } from '../../src/channels/limits.js';
import { createSaleRecord } from '../../src/core/records/types.js';
import { createShop } from '../../src/core/shops/types.js';
import { MemoryStore } from '../../src/store/memory/store.js';
import { DEMO_PHONE, captureErrors, makeApp, postForm, postJson } from './helpers.js';

type TestApp = ReturnType<typeof makeApp>['app'];

// ---------------------------------------------------------------------------- the dialled menu

function ussdThroughAt(app: TestApp, phone: string) {
  return async (sessionId: string, text: string): Promise<string> => {
    const res = await postForm(app, '/ussd', { sessionId, serviceCode: '*384*46254#', phoneNumber: phone, text });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    return checkedScreen(await res.text());
  };
}

function ussdThroughBrowser(app: TestApp, phone: string) {
  return async (sessionId: string, text: string): Promise<string> => {
    const res = await postJson(app, '/api/phone/ussd', { phone, sessionId, text });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { response: string; length: number; limit: number };
    expect(body.limit).toBe(182);
    expect(body.length).toBe(body.response.slice(4).length);
    return checkedScreen(body.response);
  };
}

/** Starts with CON or END, at most 182 characters after that, plain ASCII. */
function checkedScreen(response: string): string {
  expect(ussdProblems(response), response).toEqual([]);
  return response;
}

/** The session steps that follow the main menu, for a shop that exists. `p` sends one request. */
async function runShopSession(p: (sessionId: string, text: string) => Promise<string>, store: MemoryStore, shopId: string, tag: string) {
  const before = (await store.listRecords(shopId)).length;

  // A sale, step by step, with the confirm.
  expect(await p(`${tag}_sale`, '')).toMatch(/^CON .*\n1 Sale\n2 Expense/s);
  expect(await p(`${tag}_sale`, '1')).toMatch(/^CON Sale amount\?/);
  expect(await p(`${tag}_sale`, '1*45')).toMatch(/^CON What was sold\?/);
  expect(await p(`${tag}_sale`, '1*45*bread')).toBe('CON Save sale R45 bread? 1 Yes 2 No\n0 Back 00 Menu');
  const saved = await p(`${tag}_sale`, '1*45*bread*1');
  expect(saved).toMatch(/^END Saved: sale R45 bread\. Sales today R\d/);
  // The network sends the confirming request again: the same screen, and one record only.
  expect(await p(`${tag}_sale`, '1*45*bread*1')).toBe(saved);
  expect(await p(`${tag}_sale`, '1*45*bread*1')).toBe(saved);
  expect((await store.listRecords(shopId)).length).toBe(before + 1);

  // The main menu now shows the new figure.
  expect(await p(`${tag}_main`, '')).toContain('Today: sales R');

  // Credit, then who owes.
  const debt = await p(`${tag}_debt`, '3*Zodwa*30*sugar*1');
  expect(debt).toBe('END Saved: Zodwa owes R30 sugar. Zodwa owes R30 in total.');
  const owes = await p(`${tag}_owes`, '6');
  expect(owes).toMatch(/^END Owed to you: R/);
  expect(owes).toContain('Zodwa R30');

  // Undo the credit, and again from the same session (a repeat): the same screen, one reversal.
  expect(await p(`${tag}_undo`, '7')).toBe('CON Undo Zodwa owes R30 sugar? 1 Yes 2 No\n0 Back 00 Menu');
  const undone = await p(`${tag}_undo`, '7*1');
  expect(undone).toBe('END Undone: Zodwa owes R30 sugar. Zodwa owes nothing now.');
  expect(await p(`${tag}_undo`, '7*1')).toBe(undone);
  const reversals = (await store.listRecords(shopId)).filter((r) => r.kind === 'reversal');
  expect(reversals.filter((r) => r.originalWords === '7*1')).toHaveLength(1);

  // Today and close the day.
  expect(await p(`${tag}_today`, '5')).toMatch(/^END Today\nSales R\d/);
  expect(await p(`${tag}_close`, '8')).toMatch(/^END Close .*\nSales R.*\nTotal owed R/s);
}

describe('a dialled-menu session through POST /ussd', () => {
  it('signs up a new owner, then records, repeats, undoes and closes the day', async () => {
    const { app, store } = makeApp();
    const phone = '+254711000000';
    const p = ussdThroughAt(app, phone);

    // Sign-up: shop name, then the money.
    expect(await p('ATUid_signup', '')).toBe('CON Welcome to the Imali AI ledger. Your shop name?');
    expect(await p('ATUid_signup', 'Thandi Shop')).toMatch(/^CON Which money do you use\?\n1 R South Africa/);
    // The first screen of the shop shows today's figure.
    expect(await p('ATUid_signup', 'Thandi Shop*1')).toMatch(/^CON Thandi Shop\nToday: sales R0\n1 Sale\n2 Expense\n3 Owes \(credit\)\n4 Paid back\n5 Today\n6 Who owes\n7 Undo last\n8 Close day$/);
    const shop = (await store.findShopByPhone(phone))!;
    expect(shop.name).toBe('Thandi Shop');

    await runShopSession(p, store as MemoryStore, shop.id, 'AT');
  });

  it('pays back a customer who owes, step by step', async () => {
    const { app } = makeApp();
    const p = ussdThroughAt(app, '+254711000001');
    await p('S0', 'Corner Shop*1*3*Tendai*30*sugar*1');
    expect(await p('S1', '4')).toBe('CON Who paid back?\n1 Tendai R30\n8 Other name\n0 Back 00 Menu');
    expect(await p('S1', '4*1')).toMatch(/^CON How much did Tendai pay\?/);
    expect(await p('S1', '4*1*10')).toBe('CON Save Tendai paid R10? 1 Yes 2 No\n0 Back 00 Menu');
    expect(await p('S1', '4*1*10*1')).toBe('END Saved: Tendai paid R10. Tendai owes R20 now.');
  });
});

describe('a dialled-menu session through POST /api/phone/ussd', () => {
  it('shows the demo shop, then records, repeats, undoes and closes the day', async () => {
    const { app, store } = makeApp();
    await postJson(app, '/api/phone/demo', { phone: DEMO_PHONE });
    const p = ussdThroughBrowser(app, DEMO_PHONE);
    const shop = (await store.findShopByPhone(DEMO_PHONE))!;

    expect(await p('W_open', '')).toMatch(/^CON Thandi's Spaza\nToday: sales R195\n1 Sale/);
    await runShopSession(p, store as MemoryStore, shop.id, 'W');
  });

  it('shows in the menu what was sent by text, and the other way round', async () => {
    const { app } = makeApp();
    await postJson(app, '/api/phone/demo', { phone: DEMO_PHONE });
    const p = ussdThroughBrowser(app, DEMO_PHONE);
    const text = await (await postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: 'sold 3 bread 45' })).json();
    expect(text.reply).toMatch(/^Saved: sale R45 \(3 bread\)\. Sales today R240\./);
    expect(await p('X1', '')).toContain('Today: sales R240');
    await p('X2', '1*60*sweets*1');
    const today = await (await postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: 'today' })).json();
    expect(today.reply).toMatch(/^Today: sales R300 \(5\)/);
  });
});

// ---------------------------------------------------------------------------- text messages

function textThroughAt(app: TestApp, phone: string) {
  let n = 0;
  return async (text: string, id = `ATXid_conv_${(n += 1)}`): Promise<string> => {
    const res = await postForm(app, '/sms', { from: phone, to: '46254', text, date: '2026-11-07 12:00:00', id });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    return checkedReply(await res.text());
  };
}

function textThroughBrowser(app: TestApp, phone: string) {
  return async (text: string): Promise<string> => {
    const res = await postJson(app, '/api/phone/sms', { phone, text });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply: string; length: number; limit: number };
    expect(body.limit).toBe(160);
    expect(body.length).toBe(body.reply.length);
    return checkedReply(body.reply);
  };
}

/** At most 160 characters, plain ASCII. */
function checkedReply(reply: string): string {
  expect(smsProblems(reply), reply).toEqual([]);
  return reply;
}

describe('a text conversation through POST /sms', () => {
  it('welcomes a new number, takes the shop name, then reads each message', async () => {
    const { app, store } = makeApp();
    const phone = '+254711000000';
    const t = textThroughAt(app, phone);

    expect(await t('hi')).toBe('Welcome to the Imali AI shop ledger. Reply with your shop name to start.');
    expect(await t('Thandi Shop')).toBe('Thandi Shop is ready. Try: sold 45 bread.');
    expect(await t('sold 3 bread 45')).toBe('Saved: sale R45 (3 bread). Sales today R45. Reply undo to cancel.');
    expect(await t('Tendai owes 20 sugar')).toBe('Saved: Tendai owes R20 (sugar). Tendai owes R20 in total.');
    expect(await t('Tendai paid 10')).toBe('Saved: Tendai paid R10. Tendai owes R10 now.');
    expect(await t('who owes')).toBe('Owes: Tendai R10.');
    expect(await t('today')).toBe('Today: sales R45 (1), spent R0, in hand R55.');
    expect(await t('undo')).toBe('Undone: Tendai paid R10. Tendai owes R20 now.');
    expect(await t('gibberish')).toBe(
      'Sorry, I did not get that. Try: sold 45 bread, spent 20 taxi, Tendai owes 30, today, who owes.'
    );
    expect(await t('sold 2 200')).toBe('Did you mean 1) R200 for 2 or 2) R2,200? Reply 1 or 2.');
    expect(await t('1')).toBe('Saved: sale R200. Sales today R245. Reply undo to cancel.');
    expect(await t('close')).toMatch(/^Close .*: sales R245 \(2\), spent R0, in hand R245, credit given R20, paid back R0, total owed R20\.$/);

    const shop = (await store.findShopByPhone(phone))!;
    // 2 sales, 1 debt, 1 payment, 1 reversal
    expect((await store.listRecords(shop.id)).map((r) => r.kind)).toEqual(['sale', 'debt', 'payment', 'reversal', 'sale']);
  });

  it('saves once when the same message arrives twice with one id, and gives the same reply', async () => {
    const { app, store } = makeApp();
    const phone = '+254711000002';
    const t = textThroughAt(app, phone);
    await t('hi');
    await t('Corner Shop');
    const first = await t('sold 3 bread 45', 'ATXid_same');
    const second = await t('sold 3 bread 45', 'ATXid_same');
    expect(second).toBe(first);
    expect(first).toBe('Saved: sale R45 (3 bread). Sales today R45. Reply undo to cancel.');
    const shop = (await store.findShopByPhone(phone))!;
    expect((await store.listRecords(shop.id)).filter((r) => r.kind === 'sale')).toHaveLength(1);
    // A new message with a new id is a new sale.
    expect(await t('sold 3 bread 45', 'ATXid_other')).toBe('Saved: sale R45 (3 bread). Sales today R90. Reply undo to cancel.');
  });

  it('answers a repeated sign-up message from memory, so the shop name is not taken twice', async () => {
    const { app, store } = makeApp();
    const t = textThroughAt(app, '+254711000003');
    await t('hi', 'ATXid_a');
    const first = await t('Corner Shop', 'ATXid_b');
    const again = await t('Corner Shop', 'ATXid_b');
    expect(again).toBe(first);
    expect(await store.countShopsWithPhonePrefix('+254711000003')).toBe(1);
  });

  it('gives a plain sentence to a shop with 2,000 records', async () => {
    captureErrors();
    const store = new MemoryStore();
    const shop = createShop({ name: 'Full Shop', phone: '+254711000004', currency: 'ZAR', timeZone: 'Africa/Johannesburg' });
    await store.createShop(shop);
    for (let i = 0; i < 2000; i += 1) {
      await store.appendRecord(
        createSaleRecord(shop.id, { id: `r${i}`, amount: 100, channel: 'sms', originalWords: 'sold 1', now: new Date('2026-11-07T09:00:00Z') })
      );
    }
    const { app } = makeApp({ store });
    const t = textThroughAt(app, '+254711000004');
    expect(await t('sold 45 bread')).toBe('This shop book is full. Please start a new demo shop.');
    expect(await t('today')).toMatch(/^Today: sales R2,000/);
  });
});

describe('a text conversation through POST /api/phone/sms', () => {
  it('reads the demo shop\'s messages and keeps every reply within 160 characters', async () => {
    const { app } = makeApp();
    await postJson(app, '/api/phone/demo', { phone: DEMO_PHONE });
    const t = textThroughBrowser(app, DEMO_PHONE);

    expect(await t('today')).toBe('Today: sales R195 (3), spent R20, in hand R190.');
    expect(await t('who owes')).toBe('Owes: Rudo R30, Sipho R25, Tendai R20.');
    expect(await t('sold 3 bread 45')).toBe('Saved: sale R45 (3 bread). Sales today R240. Reply undo to cancel.');
    expect(await t('Tendai paid 20')).toBe('Saved: Tendai paid R20. Tendai owes nothing now.');
    expect(await t('undo')).toBe('Undone: Tendai paid R20. Tendai owes R20 now.');
    expect(await t('what is this')).toMatch(/^Sorry, I did not get that\./);
    expect(await t('sold 2 200')).toMatch(/^Did you mean/);
    expect(await t('2')).toMatch(/^Saved: sale R2,200\./);
  });

  it('never sends a text message', async () => {
    const sender = { send: vi.fn(async () => {}) };
    const { app } = makeApp({ smsSender: sender });
    await postJson(app, '/api/phone/demo', { phone: DEMO_PHONE });
    await textThroughBrowser(app, DEMO_PHONE)('sold 3 bread 45');
    expect(sender.send).not.toHaveBeenCalled();
  });
});
