/**
 * The Africa's Talking routes: POST /ussd (the dialled menu) and POST /sms (incoming texts).
 *
 * Africa's Talking shows whatever a USSD callback returns, so these routes answer 200 with a sentence the owner can
 * read. They answer 400 only for calls a real phone cannot make (a missing field, a number that is not a number).
 */

import { handleText, handleUssd } from '../../channels/index.js';
import type { App, AppContext } from '../context.js';
import { MAX_MENU_INPUT, MAX_SMS_TEXT, MESSAGE_ID_PATTERN, SENTENCES } from '../constants.js';
import { logError, ownerSentence } from '../errors.js';
import { isDemoPhone, normalizePhone } from '../phone.js';
import { refuse } from '../respond.js';

/** Sends the reply as a text, unless there is no sender or the number is a demo number. A failure is logged only. */
export async function sendReply(ctx: AppContext, phone: string, reply: string): Promise<void> {
  if (!ctx.smsSender || isDemoPhone(phone)) return;
  try {
    await ctx.smsSender.send(phone, reply);
  } catch (error) {
    logError('/sms sender', error, phone);
  }
}

function field(form: Record<string, unknown>, name: string): string | undefined {
  const value = form[name];
  return typeof value === 'string' ? value : undefined;
}

export function registerAtRoutes(app: App, ctx: AppContext): void {
  app.post('/ussd', async (c) => {
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const sessionId = field(form, 'sessionId');
    const serviceCode = field(form, 'serviceCode');
    const rawPhone = field(form, 'phoneNumber');
    const text = field(form, 'text') ?? '';

    if (!sessionId) return refuse(c, 400, SENTENCES.missing('sessionId'));
    if (!serviceCode) return refuse(c, 400, SENTENCES.missing('serviceCode'));
    if (!rawPhone) return refuse(c, 400, SENTENCES.missing('phoneNumber'));
    const phone = normalizePhone(rawPhone);
    if (!phone) return refuse(c, 400, SENTENCES.badPhone);
    c.set('phone', phone);

    // At most 30 requests a minute per phone number (a key press is a request). The owner sees why.
    if (!ctx.atPhoneLimiter.check(phone).allowed) return c.text(`END ${SENTENCES.rate}`, 200);

    // The latest input is the part after the last "*". The whole text is bounded by the body limit.
    const latest = text.split('*').pop() ?? '';
    if (latest.length > MAX_MENU_INPUT) return c.text(`END ${SENTENCES.menuLong}`, 200);

    const { response } = await handleUssd({
      sessionId,
      serviceCode,
      phoneNumber: phone,
      text,
      now: ctx.now(),
      store: ctx.store
    });
    if (typeof response !== 'string' || !(response.startsWith('CON ') || response.startsWith('END '))) {
      logError('/ussd', new Error('handleUssd gave a response that starts with neither CON nor END'), phone);
      return c.text(`END ${SENTENCES.generic}`, 200);
    }
    return c.text(response, 200);
  });

  app.post('/sms', async (c) => {
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const rawFrom = field(form, 'from');
    const text = field(form, 'text');

    if (!rawFrom) return refuse(c, 400, SENTENCES.missing('from'));
    if (text === undefined) return refuse(c, 400, SENTENCES.missing('text'));
    const phone = normalizePhone(rawFrom);
    if (!phone) return refuse(c, 400, SENTENCES.badPhone);
    c.set('phone', phone);

    // At most 30 requests a minute per phone number. Nothing is sent back as a text: a flood must not cost us texts.
    const verdict = ctx.atPhoneLimiter.check(phone);
    if (!verdict.allowed) {
      return refuse(c, 429, SENTENCES.rate, { 'Retry-After': String(verdict.retryAfterSeconds) });
    }

    // Too long to read: say so (and send it), without a claim or a handler call.
    if (text.length > MAX_SMS_TEXT) {
      await sendReply(ctx, phone, SENTENCES.smsLong);
      return c.text(SENTENCES.smsLong, 200);
    }

    // A repeated callback carries the same message id. Claim it once; a repeat gets the first reply.
    const rawId = field(form, 'id');
    const messageId = rawId !== undefined && MESSAGE_ID_PATTERN.test(rawId) ? rawId : undefined;
    if (messageId !== undefined) {
      const claim = await ctx.processed.claim(phone, messageId);
      if (claim.status === 'done') return c.text(claim.reply, 200);
      if (claim.status === 'working') return c.text(SENTENCES.working, 200);
    }

    // handleText is not idempotent (it may save before something later fails), so an error is kept as the reply
    // and a claim is never forgotten: a repeat must not run it a second time.
    let reply: string;
    try {
      ({ reply } = await handleText({
        phone,
        text,
        now: ctx.now(),
        store: ctx.store,
        pending: ctx.pending,
        ...(ctx.reader ? { reader: ctx.reader } : {})
      }));
    } catch (error) {
      logError('/sms', error, phone);
      reply = ownerSentence(error);
    }

    if (messageId !== undefined) {
      try {
        await ctx.processed.finish(phone, messageId, reply);
      } catch (error) {
        logError('/sms finish', error, phone);
      }
    }
    await sendReply(ctx, phone, reply);
    return c.text(reply, 200);
  });
}
