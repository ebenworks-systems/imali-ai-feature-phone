/**
 * The routes the browser phone and its side panel call: /api/phone/ussd, /api/phone/sms, /api/phone/demo,
 * GET /api/ledger and GET /api/export.
 *
 * Every one works on a demo number only (`+2700000` and four digits). Every one except the demo route that names no
 * phone is limited to 60 requests a minute per phone number, and every one (createApp's middleware) to 120 a minute
 * per client address.
 *
 * Only `POST /api/phone/demo` makes demo shops. The ussd and sms routes answer 404 for a demo number with no shop,
 * before any handler runs, and hand the handlers a store that cannot make a shop, so the dialled menu's and the
 * texts' sign-up can never run from here.
 */

import { randomInt, randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { generateExport } from '../../core/index.js';
import { handleText, handleUssd } from '../../channels/index.js';
import type { App, AppContext, AppEnv } from '../context.js';
import {
  DEMO_PHONE_PREFIX,
  DEMO_SERVICE_CODE,
  DEMO_SWEEP_PER_CALL,
  MAX_MENU_INPUT,
  MAX_SMS_TEXT,
  SENTENCES,
  SMS_REPLY_LIMIT
} from '../constants.js';
import { addressKey } from '../address.js';
import { buildDemoRecords, buildDemoShop } from '../demo.js';
import { logError } from '../errors.js';
import { clientAddress, isDemoPhone, normalizePhone } from '../phone.js';
import { DEMO_SHOP_MAX_AGE_MS } from '../../store/demo.js';
import { refuse } from '../respond.js';
import { buildLedgerView } from '../views.js';

type C = Context<AppEnv>;
type JsonObject = Record<string, unknown>;

/** The body as an object. `null` means it was not JSON or not an object. An empty body counts as `{}` if allowed. */
async function readJsonObject(c: C, allowEmpty = false): Promise<JsonObject | null> {
  let text: string;
  try {
    text = await c.req.text();
  } catch {
    return null;
  }
  if (allowEmpty && text.trim() === '') return {};
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
  } catch {
    return null;
  }
}

/**
 * The checks every browser route starts with, after the shape of the body is known: the phone number must be a demo
 * number, and the number must be within its 60 requests a minute. Returns the number, or the refusal to send.
 */
function guardPhone(c: C, ctx: AppContext, raw: unknown): string | Response {
  const phone = typeof raw === 'string' ? normalizePhone(raw) : null;
  if (phone === null || !isDemoPhone(phone)) return refuse(c, 400, SENTENCES.notDemo);
  return limited(c, ctx, phone) ?? phone;
}

/** A 429 when the key has used its requests, else null. The key is a phone number or `demo-create`. */
function limited(c: C, ctx: AppContext, key: string): Response | null {
  const verdict = ctx.limiter.check(key);
  if (verdict.allowed) {
    if (key !== 'demo-create') c.set('phone', key);
    return null;
  }
  return refuse(c, 429, SENTENCES.rate, { 'Retry-After': String(verdict.retryAfterSeconds) });
}

function badBody(c: C): Response {
  return refuse(c, 400, SENTENCES.badBody);
}

/**
 * Housekeeping of invented demo data: removes the demo shops made more than 7 days ago, with their
 * records and waiting questions (at most 50 a call), so the cap on demo shops frees itself. The store decides what a demo shop is, so
 * this can never remove a shop on another number, and it never removes a single record. A failure is logged and does
 * not stop the call: the housekeeping is not what the caller asked for.
 */
async function sweepOldDemoShops(ctx: AppContext): Promise<void> {
  try {
    const cutoff = new Date(ctx.now().getTime() - DEMO_SHOP_MAX_AGE_MS);
    const phones = await ctx.store.deleteExpiredDemoShops(cutoff, DEMO_SWEEP_PER_CALL);
    // The Postgres store removes the questions in the same transaction as the shops; the memory pending store is a
    // separate object. One call for all the phones, never one call for each shop, because this is on the request path.
    if (phones.length > 0) await ctx.pending.clearMany(phones);
  } catch (error) {
    logError('/api/phone/demo sweep', error);
  }
}

export function registerBrowserRoutes(app: App, ctx: AppContext): void {
  // ---------------------------------------------------------------- the dialled menu
  app.post('/api/phone/ussd', async (c) => {
    const body = await readJsonObject(c);
    if (body === null) return badBody(c);
    const { sessionId, text } = body;
    if (sessionId !== undefined && typeof sessionId !== 'string') return badBody(c);
    if (text !== undefined && typeof text !== 'string') return badBody(c);
    const phone = guardPhone(c, ctx, body.phone);
    if (typeof phone !== 'string') return phone;

    const typed = text ?? '';
    if ((typed.split('*').pop() ?? '').length > MAX_MENU_INPUT) return refuse(c, 400, SENTENCES.menuLong);

    // A demo number with no shop is refused here, before the menu runs: the menu would sign a new owner up.
    if (!(await ctx.store.findShopByPhone(phone))) return refuse(c, 404, SENTENCES.noDemoShop);

    const { response } = await handleUssd({
      sessionId: sessionId && sessionId !== '' ? sessionId : randomUUID(),
      serviceCode: DEMO_SERVICE_CODE,
      phoneNumber: phone,
      text: typed,
      now: ctx.now(),
      store: ctx.browserStore
    });
    return c.json({ response, length: response.slice(4).length, limit: MAX_MENU_INPUT });
  });

  // ---------------------------------------------------------------- text messages (no text is sent)
  app.post('/api/phone/sms', async (c) => {
    const body = await readJsonObject(c);
    if (body === null) return badBody(c);
    if (typeof body.text !== 'string') return badBody(c);
    const phone = guardPhone(c, ctx, body.phone);
    if (typeof phone !== 'string') return phone;
    if (body.text.length > MAX_SMS_TEXT) return refuse(c, 400, SENTENCES.smsLong);

    // A demo number with no shop is refused here, before the text handler runs: it would sign a new owner up.
    if (!(await ctx.store.findShopByPhone(phone))) return refuse(c, 404, SENTENCES.noDemoShop);

    const { reply } = await handleText({
      phone,
      text: body.text,
      now: ctx.now(),
      store: ctx.browserStore,
      pending: ctx.pending,
      ...(ctx.reader ? { reader: ctx.reader } : {})
    });
    return c.json({ reply, length: reply.length, limit: SMS_REPLY_LIMIT });
  });

  // ---------------------------------------------------------------- the demo shop
  app.post('/api/phone/demo', async (c) => {
    // 1. Ten calls an hour per client address, counted in the store so it holds across instances. The address is
    //    kept only as a salted SHA-256 hash. Every call counts. Nothing about a shop is read or written for a refusal.
    const address = addressKey(clientAddress(c.req.raw.headers), ctx.addressSalt);
    const claim = await ctx.quota.claimCall(address, { limit: ctx.demoPerAddress, windowMs: ctx.demoWindowMs });
    if (!claim.allowed) {
      return refuse(c, 429, SENTENCES.demoRate, { 'Retry-After': String(claim.retryAfterSeconds) });
    }

    // 2. The body: `{ phone? }`, and an empty body counts as `{}`.
    const body = await readJsonObject(c, true);
    if (body === null) return badBody(c);
    if (body.phone !== undefined && typeof body.phone !== 'string') return badBody(c);

    // 3. The phone: a given demo number, or the shared key for calls that name none.
    let phone: string | undefined;
    if (body.phone !== undefined) {
      const guarded = guardPhone(c, ctx, body.phone);
      if (typeof guarded !== 'string') return guarded;
      phone = guarded;
    } else {
      const refused = limited(c, ctx, 'demo-create');
      if (refused) return refused;
    }

    // 4. Clear away the demo shops made more than 7 days ago (a bounded number), so the cap below frees itself.
    await sweepOldDemoShops(ctx);

    // 5. At most 1,000 demo shops a day in all (counted in the store), and at most 5,000 in all (likewise).
    if ((await ctx.quota.madeToday()) >= ctx.maxDemoShopsPerDay) return refuse(c, 503, SENTENCES.demoFull);
    if ((await ctx.store.countShopsWithPhonePrefix(DEMO_PHONE_PREFIX)) >= ctx.maxDemoShops) {
      return refuse(c, 503, SENTENCES.demoFull);
    }

    // 6. Choose the number.
    if (phone !== undefined) {
      if (await ctx.store.findShopByPhone(phone)) return refuse(c, 409, SENTENCES.taken);
    } else {
      for (let tries = 0; tries < 20 && phone === undefined; tries += 1) {
        const candidate = `${DEMO_PHONE_PREFIX}${String(randomInt(0, 10000)).padStart(4, '0')}`;
        if (!(await ctx.store.findShopByPhone(candidate))) phone = candidate;
      }
      if (phone === undefined) return refuse(c, 503, SENTENCES.noNumbers);
    }
    c.set('phone', phone);

    // 7. Make the shop and its invented records, in order.
    const now = ctx.now();
    const shop = buildDemoShop(phone, now);
    try {
      await ctx.store.createShop(shop);
    } catch (error) {
      // Another call took the number between the check and the insert.
      if (error instanceof Error && error.name === 'ShopAlreadyExistsError') return refuse(c, 409, SENTENCES.taken);
      throw error;
    }
    for (const record of buildDemoRecords(shop, now)) {
      await ctx.store.appendRecord(record);
    }
    await ctx.quota.noteMade(address);
    return c.json({ phone, shop: { name: shop.name, currency: shop.currency, timeZone: shop.timeZone } }, 201);
  });

  // ---------------------------------------------------------------- the side panel
  app.get('/api/ledger', async (c) => {
    const phone = guardPhone(c, ctx, c.req.query('phone'));
    if (typeof phone !== 'string') return phone;
    const shop = await ctx.store.findShopByPhone(phone);
    if (!shop) return refuse(c, 404, SENTENCES.noShop);
    return c.json(await buildLedgerView(ctx.store, shop, ctx.now()));
  });

  app.get('/api/export', async (c) => {
    const phone = guardPhone(c, ctx, c.req.query('phone'));
    if (typeof phone !== 'string') return phone;
    const shop = await ctx.store.findShopByPhone(phone);
    if (!shop) return refuse(c, 404, SENTENCES.noShop);

    const now = ctx.now();
    const data = { ...(await generateExport(ctx.store, shop)), exportedAt: now.toISOString() };
    const digits = phone.replace(/\D/g, '');
    const day = now.toISOString().slice(0, 10);
    return new Response(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="imali-ledger-${digits}-${day}.json"`,
        'Cache-Control': 'no-store'
      }
    });
  });
}
