/**
 * Channels: how a shop owner reaches the ledger.
 *
 * Dialled menu (USSD): `handleUssd` takes one request from the network (`sessionId`, `serviceCode`, `phoneNumber`
 * and `text`, the owner's keys joined by `*`) and returns the screen to show, `CON ...` or `END ...`, at most 182
 * characters after the prefix. Nothing is kept between requests; the whole path is replayed each time.
 *
 *   const { response } = await handleUssd({ sessionId, serviceCode, phoneNumber, text, now: new Date(), store });
 *
 * SMS (plain text messages): `handleText` takes one message from one phone and returns the reply to send.
 * It reads the message with fixed rules, asks the optional model reader only when the rules cannot read it
 * (and checks what the model proposes against the owner's own words), carries the intent out on a
 * `LedgerStore`, and keeps waiting questions (which amount? yes to a big amount? shop name) in a
 * `PendingStore`. Every reply is plain ASCII and at most 160 characters.
 *
 *   const { reply } = await handleText({ phone, text, now: new Date(), store, pending, reader });
 *
 * The store, the pending store and the reader are passed in, so the same handler runs in tests, locally and
 * on the server.
 */

export { handleUssd } from './ussd/handler.js';
export type { HandleUssdParams, HandleUssdResult } from './ussd/handler.js';

export { handleText, MAX_TEXT_LENGTH } from './sms/handler.js';
export type { HandleTextParams, HandleTextResult } from './sms/handler.js';

// What a message can mean.
export { readIntent } from './sms/reader.js';
export type {
  Intent,
  IntentKind,
  SaleIntent,
  ExpenseIntent,
  DebtIntent,
  PaymentIntent,
  WhoOwesIntent,
  BalanceIntent,
  AmbiguousIntent,
  SimpleIntent
} from './sms/reader.js';

// Waiting questions.
export { InMemoryPendingStore, PENDING_TTL_MS } from './sms/pending.js';
export type { PendingStore, PendingQuestion, InMemoryPendingStoreOptions } from './sms/pending.js';

// Replies.
export { buildReply, isPlainAscii, SMS_MAX_LENGTH } from './sms/replies.js';
export type { ReplyContext } from './sms/replies.js';

// The optional model reader.
export type { ModelReader, Proposal } from '../ai/reader.js';
export { GeminiReader } from '../ai/reader.js';
export { checkProposal } from '../ai/check.js';
