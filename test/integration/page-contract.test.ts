/**
 * The contract between the server and the page.
 *
 * The page (public/) and the server (src/server/) were built from two specs. The route tests mock the handlers and
 * the page tests use answers the page author wrote, so neither could see a mismatch. This test builds the real app
 * (createApp, memory stores, no mocks), makes a demo shop, sends a sale through the dialled menu and a debt through
 * a text message, and hands the real JSON answers to the page's own readers.
 */

import { describe, expect, it } from 'vitest';
import { ApiError, ROUTES, createApi, isShopGone } from '../../public/api.js';
import { formatMoney, readLedger, recordRows, sortOwes } from '../../public/ledger-logic.js';
import { buildUssdText, counterInfo, parseSmsReply, parseUssdReply } from '../../public/phone-logic.js';
import { DEMO_PHONE, makeApp, postJson } from '../server/helpers.js';

type App = ReturnType<typeof makeApp>['app'];

async function json(res: Response | Promise<Response>): Promise<any> {
  const response = await res;
  expect(response.status).toBe(200);
  return response.json();
}

const getLedger = (app: App) => json(app.request(`/api/ledger?phone=${encodeURIComponent(DEMO_PHONE)}`));

/** Dials as the page does: each send carries the whole path, built with the page's own buildUssdText. */
async function dial(app: App, sessionId: string, entries: string[]) {
  const answers: any[] = [];
  const path: string[] = [];
  answers.push(await json(postJson(app, '/api/phone/ussd', { phone: DEMO_PHONE, sessionId, text: '' })));
  for (const entry of entries) {
    const text = buildUssdText(path, entry);
    answers.push(await json(postJson(app, '/api/phone/ussd', { phone: DEMO_PHONE, sessionId, text })));
    path.push(entry);
  }
  return answers;
}

const text = (app: App, line: string) => json(postJson(app, '/api/phone/sms', { phone: DEMO_PHONE, text: line }));

/** The page's reading of one ledger answer. Fails the test if the page does not accept it. */
function read(answer: unknown) {
  const result = readLedger(answer);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('the page did not accept the ledger answer');
  return result.ledger;
}

const owedBy = (ledger: ReturnType<typeof read>, name: string) =>
  ledger.whoOwes.find((entry: { name: string; owed: number }) => entry.name === name)?.owed ?? 0;

describe('the page reads the real server answers', () => {
  it('accepts the ledger of a new demo shop and reads its figures', async () => {
    const { app, clock } = makeApp();
    const made = await postJson(app, '/api/phone/demo', { phone: DEMO_PHONE });
    expect(made.status).toBe(201);

    const ledger = read(await getLedger(app));
    expect(ledger.shop).toEqual({ name: "Thandi's Spaza", currency: 'ZAR', timeZone: 'Africa/Johannesburg' });
    // The invented records: three sales today (R45 + R120 + R30), R20 spent, and three people who owe.
    expect(ledger.today).toEqual({ sales: 19500, salesCount: 3, spent: 2000, inHand: 19500 + 1500 - 2000 });
    expect(sortOwes(ledger.whoOwes)).toEqual([
      { name: 'Rudo', owed: 3000 },
      { name: 'Sipho', owed: 2500 },
      { name: 'Tendai', owed: 2000 },
    ]);
    expect(ledger.owesMore).toBe(0);
    expect(ledger.records).toHaveLength(17);

    const rows = recordRows(ledger.records, ledger.shop.currency, ledger.shop.timeZone, clock.now().getTime());
    expect(rows[0]).toMatchObject({ kindWord: 'Sale', amountText: 'R30', detail: 'sweets', channelWord: 'Text' });
    // The R999 slip made yesterday was undone, and the page says so.
    expect(rows.filter((row) => row.undone).map((row) => row.amountText)).toEqual(['R999']);
    expect(rows.find((row) => row.isReversal)?.undoText).toBe('Undo: cancelled Sale R999 bread');
  });

  it('writes the same money text as the server for every amount in the answer', async () => {
    const { app } = makeApp();
    await postJson(app, '/api/phone/demo', { phone: DEMO_PHONE });
    const body = await getLedger(app);
    const moneys: Array<{ cents: number; text: string }> = [];
    const walk = (value: unknown): void => {
      if (value && typeof value === 'object') {
        const object = value as Record<string, unknown>;
        if (typeof object.cents === 'number' && typeof object.text === 'string') moneys.push(object as never);
        Object.values(object).forEach(walk);
      }
    };
    walk(body);
    expect(moneys.length).toBeGreaterThan(20);
    for (const money of moneys) expect(formatMoney(money.cents, body.shop.currency)).toBe(money.text);
  });

  it('shows a sale from the dialled menu and a debt from a text message as changes, newest first', async () => {
    const { app, clock } = makeApp();
    await postJson(app, '/api/phone/demo', { phone: DEMO_PHONE });
    const before = read(await getLedger(app));

    // A sale of R45 through the menu: 1 Sale, the amount, 1 to skip the item, 1 to save.
    clock.advance(60_000);
    const screens = await dial(app, 'S1', ['1', '45', '1', '1']);
    const saved = parseUssdReply(screens[screens.length - 1]);
    expect(saved).toMatchObject({ ok: true, kind: 'END' });
    if (!saved.ok) return;
    expect(saved.lines[0]).toMatch(/^Saved: sale R45/);

    // A debt through a text message.
    clock.advance(60_000);
    const reply = await text(app, 'Tendai owes 20 sugar');
    const parsedReply = parseSmsReply(reply);
    expect(parsedReply.ok).toBe(true);
    if (!parsedReply.ok) return;
    expect(parsedReply.text).toMatch(/^Saved: Tendai owes R20 \(sugar\)/);

    const after = read(await getLedger(app));
    expect(after.shop.name).toBe("Thandi's Spaza");
    expect(after.today.sales).toBe(before.today.sales + 4500);
    expect(after.today.salesCount).toBe(before.today.salesCount + 1);
    expect(after.today.inHand).toBe(before.today.inHand + 4500);
    expect(after.today.spent).toBe(before.today.spent);
    expect(owedBy(after, 'Tendai')).toBe(owedBy(before, 'Tendai') + 2000);
    expect(owedBy(after, 'Rudo')).toBe(owedBy(before, 'Rudo'));

    const rows = recordRows(after.records, after.shop.currency, after.shop.timeZone, clock.now().getTime());
    expect(rows[0]).toMatchObject({
      kindWord: 'Owes',
      amountText: 'R20',
      detail: 'Tendai - sugar',
      channelWord: 'Text',
      timeText: '12:02',
    });
    expect(rows[1]).toMatchObject({ kindWord: 'Sale', amountText: 'R45', channelWord: 'Menu', timeText: '12:01' });
    expect(rows[2].timeText).not.toBe('12:01'); // the invented records come before both
  });

  it('marks the debt undone after undo, names it in the Undo row, and takes it off Tendai', async () => {
    const { app, clock } = makeApp();
    await postJson(app, '/api/phone/demo', { phone: DEMO_PHONE });
    const before = read(await getLedger(app));

    clock.advance(60_000);
    await text(app, 'Tendai owes 20 sugar');
    const withDebt = read(await getLedger(app));
    expect(owedBy(withDebt, 'Tendai')).toBe(owedBy(before, 'Tendai') + 2000);

    clock.advance(60_000);
    const undone = parseSmsReply(await text(app, 'undo'));
    expect(undone.ok).toBe(true);

    const after = read(await getLedger(app));
    expect(owedBy(after, 'Tendai')).toBe(owedBy(before, 'Tendai'));
    const rows = recordRows(after.records, after.shop.currency, after.shop.timeZone, clock.now().getTime());
    expect(rows[0]).toMatchObject({
      kindWord: 'Undo',
      isReversal: true,
      undoText: 'Undo: cancelled Owes R20 Tendai (sugar)',
    });
    expect(rows[1]).toMatchObject({ kindWord: 'Owes', amountText: 'R20', detail: 'Tendai - sugar', undone: true });
  });

  it('reads length and limit for the counter from every menu screen and every text reply', async () => {
    const { app } = makeApp();
    await postJson(app, '/api/phone/demo', { phone: DEMO_PHONE });

    const screens = await dial(app, 'S2', ['1', '45', '1']);
    expect(screens).toHaveLength(4);
    for (const answer of screens) {
      const parsed = parseUssdReply(answer);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      // `length` counts the text after the CON or END prefix, which is what the LCD shows.
      expect(parsed.chars).toBe(answer.response.slice(4).length);
      expect(parsed.limit).toBe(182);
      expect(counterInfo('menu', parsed.chars, parsed.limit)).toMatchObject({
        text: `This screen: ${parsed.chars} of 182 characters`,
      });
    }

    for (const line of ['sold 3 bread 45', 'today', 'who owes', 'what is this']) {
      const answer = await text(app, line);
      const parsed = parseSmsReply(answer);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.chars).toBe(answer.reply.length);
      expect(parsed.limit).toBe(160);
      expect(counterInfo('text', parsed.chars, parsed.limit)).toMatchObject({
        text: `Reply: ${parsed.chars} of 160 characters`,
      });
    }
  });

  it('keeps the counter off for an answer that has no length, so a wrong name cannot pass quietly', () => {
    expect(parseUssdReply({ response: 'CON Hi', chars: 2, limit: 182 })).toMatchObject({ chars: null });
    expect(parseSmsReply({ reply: 'Hi', chars: 2, limit: 160 })).toMatchObject({ chars: null });
  });
});

describe('the page reads the server\'s 404 for a number with no demo shop', () => {
  // The page's own api helper, with the real app behind its fetch: what a stale number in localStorage would meet.
  const pageApi = (app: App) =>
    createApi({
      fetchFn: ((url: string, init?: RequestInit) => app.request(url, init)) as unknown as typeof fetch
    });

  it('sees the ledger, ussd and sms routes all say "gone", so it returns to the first-visit state on any of them', async () => {
    const { app } = makeApp();
    const api = pageApi(app);
    const stale = '+27000004321';
    const attempts = [
      api.getJson(`${ROUTES.ledger}?phone=${encodeURIComponent(stale)}`),
      api.postJson(ROUTES.ussd, { phone: stale, sessionId: 's1', text: '' }),
      api.postJson(ROUTES.sms, { phone: stale, text: 'today' })
    ];
    for (const attempt of attempts) {
      const error = await attempt.then(
        () => null,
        (e: unknown) => e
      );
      expect(error).toBeInstanceOf(ApiError);
      expect(isShopGone(error)).toBe(true);
    }
  });

  it('does not see it for a number that has a shop', async () => {
    const { app } = makeApp();
    await postJson(app, '/api/phone/demo', { phone: DEMO_PHONE });
    const api = pageApi(app);
    expect(parseUssdReply(await api.postJson(ROUTES.ussd, { phone: DEMO_PHONE, sessionId: 's1', text: '' })).ok).toBe(true);
    expect(parseSmsReply(await api.postJson(ROUTES.sms, { phone: DEMO_PHONE, text: 'today' })).ok).toBe(true);
  });
});
