/**
 * The routes the browser phone and its side panel call: /api/phone/ussd, /api/phone/sms, /api/phone/demo,
 * GET /api/ledger and GET /api/export.
 *
 * Every one works on a demo number only (`+2700000` and four digits), and every one except the demo route that
 * names no phone is limited to 60 requests a minute per phone number.
 */

import { randomInt, randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { generateExport } from '../../core/index.js';
import { handleText, handleUssd } from '../../channels/index.js';
import type { App, AppContext, AppEnv } from '../context.js';
import {
  DEMO_PHONE_PREFIX,
  DEMO_SERVICE_CODE,
  MAX_MENU_INPUT,
  MAX_SMS_TEXT,
  SENTENCES,
  SMS_REPLY_LIMIT
} from '../constants.js';
import { buildDemoRecords, buildDemoShop } from '../demo.js';
import { clientAddress, isDemoPhone, normalizePhone } from '../phone.js';
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

    const { response } = await handleUssd({
      sessionId: sessionId && sessionId !== '' ? sessionId : randomUUID(),
      serviceCode: DEMO_SERVICE_CODE,
      phoneNumber: phone,
      text: typed,
      now: ctx.now(),
      store: ctx.store
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

    const { reply } = await handleText({
      phone,
      text: body.text,
      now: ctx.now(),
      store: ctx.store,
      pending: ctx.pending,
      ...(ctx.reader ? { reader: ctx.reader } : {})
    });
    return c.json({ reply, length: reply.length, limit: SMS_REPLY_LIMIT });
  });

  // ---------------------------------------------------------------- the demo shop
  app.post('/api/phone/demo', async (c) => {
    // 1. Ten calls an hour per client address. Every call counts. Nothing is read or written for a refusal.
    const address = ctx.demoLimiter.check(clientAddress(c.req.raw.headers));
    if (!address.allowed) {
      return refuse(c, 429, SENTENCES.demoRate, { 'Retry-After': String(address.retryAfterSeconds) });
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

    // 4. At most 5,000 demo shops in all (counted in the store, so it holds across instances).
    if ((await ctx.store.countShopsWithPhonePrefix(DEMO_PHONE_PREFIX)) >= ctx.maxDemoShops) {
      return refuse(c, 503, SENTENCES.demoFull);
    }

    // 5. Choose the number.
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

    // 6. Make the shop and its invented records, in order.
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
