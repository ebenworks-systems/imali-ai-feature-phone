# Server and Store Design

## Overview

One Hono app, `createApp`, holds every route. It gets its parts (store, pending store, optional model reader,
optional text sender, clock) as arguments, so tests build it with memory parts and a fixed clock and call it with
`app.request()`. Three small entry points build the real parts from environment variables:

```
Africa's Talking ──► POST /ussd, POST /sms ─┐
Browser phone ─────► POST /api/phone/*      ├─► createApp ─► handleUssd / handleText ─► core ─► LedgerStore
Side panel ────────► GET /api/ledger, /api/export          (src/channels)                       ├ MemoryStore
                                                                                                └ PostgresStore (Neon)

src/server/main.ts   Node: createAppFromEnv + static files from public/ + @hono/node-server
api/index.ts         Vercel: createAppFromEnv + hono/vercel (public/ is served by Vercel itself)
```

Decisions:

- **`createApp` is pure wiring.** It does not read `process.env`. `createAppFromEnv` (in `bootstrap.ts`) is the only
  place that reads the environment, so tests of the routes never depend on the machine.
- **Static files differ per host.** `serveStatic` from `@hono/node-server` is added only in the Node entry. On
  Vercel the platform serves `public/` and ignores `serveStatic`, so `createApp` has no static code.
- **No `tsx`.** `npm run dev` compiles with `tsc` and runs the output with Node. A TypeScript runner would be a new
  dependency, and Node's built-in type stripping cannot resolve our `./x.js` imports to `./x.ts` files.
- **Ordering in Postgres uses a `seq` identity column**, not `created_at`. The core finds "the last record" by list
  order, and a fixed test clock gives many records the same time stamp.
- **Calls to the core use the code as it is today.** `ledger-core/design.md` shows operations taking a `shopId`;
  the code takes a `Shop` (`getTodaySummary(store, shop, now)`, `getWhoOwes(store, shop)`,
  `generateExport(store, shop)`). This design follows the code.

### Reconciled with the finished channels

This spec was first written before `handleUssd` and `handleText` existed. It now follows the code they left:

- **One duplicate-save guard, the one the dialled menu built.** The menu makes the id of every record from the
  session (`rec_ussd_<sessionId>_<step>`) and the store refuses an id it already holds with `DuplicateRecordError`,
  checked before anything else. The first draft's `saveKey`, `AppendOptions`, `DuplicateSaveError` and
  `records_save_key_unique` index are gone. The Postgres store enforces the same rule with the primary key on
  `records.id` and raises the same `DuplicateRecordError`. In the same way the existing `ShopAlreadyExistsError`
  replaces the first draft's `ShopPhoneTakenError`.
- **Repeated text callbacks.** The text handler has no guard of its own. The route remembers the message `id` that
  Africa's Talking sends and answers a repeat from memory (see "Repeated text callbacks").
- **An optional callback key** `AT_CALLBACK_KEY` closes `POST /ussd` and `POST /sms` to callers without it.
- **Limits on demo shops:** 10 calls an hour per client address, and 5,000 demo shops in all.
- **`normalizePhone` already exists** in `src/channels/phone.ts` (7 to 15 digits). The server reuses it and adds only
  `isDemoPhone` and `maskPhone`.
- **`GeminiReader` takes an options object** (`{ apiKey, model }`), not a bare key.
- **`src/channels/index.ts`, `handleUssd`, `handleText`, `PendingStore`, `InMemoryPendingStore` and `ModelReader` all
  exist,** so nothing in the tasks waits for another spec.

## Files

```
api/index.ts                      Vercel entry
vercel.json
sql/001_init.sql                  migration
scripts/migrate.mjs               npm run db:migrate
src/server/constants.ts           limits, sentences, demo service code
src/server/context.ts             AppContext and the Hono environment type
src/server/respond.ts             refuse(): a plain sentence as JSON under /api/, else text
src/server/phone.ts               re-exports normalizePhone; demo-number check, mask
src/server/rateLimit.ts           per-phone sliding window, in memory
src/server/errors.ts              owner sentences, logError
src/server/sender.ts              Africa's Talking text sender
src/server/callbackKey.ts         constant-time check of the `k` query parameter
src/server/views.ts               LedgerView for the side panel
src/server/demo.ts                invented demo records
src/server/app.ts                 createApp
src/server/routes/at.ts           POST /ussd, POST /sms
src/server/routes/browser.ts      /api/phone/*, /api/ledger, /api/export
src/server/config.ts              readConfig, readPort
src/server/bootstrap.ts           createAppFromEnv
src/server/node.ts                createNodeApp (adds static files)
src/server/main.ts                starts the Node server (not imported by tests)
src/store/interface.ts            changed: countShopsWithPhonePrefix
src/store/processed.ts            ProcessedTextStore, InMemoryProcessedTextStore
src/store/limit.ts                withRecordLimit, RecordLimitError
src/store/memory/store.ts         changed: count by prefix, copy on list
src/store/postgres/client.ts      connectPostgres
src/store/postgres/store.ts       PostgresStore
src/store/postgres/pending.ts     PostgresPendingStore
src/store/postgres/processed.ts   PostgresProcessedTextStore
src/store/postgres/index.ts       exports
docs/run-the-demo.md
test/server/*.test.ts             see Tests
test/store/contract.ts            shared LedgerStore contract
test/store/processed.test.ts      shared checks for the two processed-text stores
test/store/postgres/*.test.ts      store, pending, processed, constraints
test/helpers/pg.ts                throwaway schema for Postgres tests
```

## Store interface changes (`src/store/interface.ts`)

The interface already has what the dialled menu needs. Two things were missing for the server.

```ts
export interface LedgerStore {
  createShop(shop: Shop): Promise<void>;                 // throws ShopAlreadyExistsError (id or phone taken)
  findShopById(id: string): Promise<Shop | null>;
  findShopByPhone(phone: string): Promise<Shop | null>;
  appendRecord(record: Record): Promise<void>;
  // throws DuplicateRecordError (the id is held; checked first),
  // then RecordAlreadyReversedError (reversal of a record that already has one)
  findRecordById(id: string): Promise<Record | null>;
  findReversalOf(recordId: string): Promise<ReversalRecord | null>;
  listRecords(shopId: string, options?: { since?: string }): Promise<Record[]>;
  // append order, a new array each call, `since` inclusive
  countShopsWithPhonePrefix(prefix: string): Promise<number>;     // NEW: used for the 5,000 demo shop cap
}
```

`DuplicateRecordError`, `ShopAlreadyExistsError` and `RecordAlreadyReversedError` stay as they are. They are already
re-exported from `src/core/index.ts`.

**The duplicate-save guard is the record id.** `handleUssd` calls `store.findRecordById(id)`, saves with
`id = rec_ussd_<sessionId>_<step>` and treats `DuplicateRecordError` as "a copy of this request got there first".
The same is done for an undo (the reversal has such an id too). Nothing else is needed from the store, so the first
draft's save key is dropped. Two rules matter and both stores must keep them:

1. The id is checked before the reversal rule. A repeated undo carries the same id and the same
   `reversesRecordId`; it must give `DuplicateRecordError`, because `handleUssd` reads that as "already done" and
   a `RecordAlreadyReversedError` would look like a failure.
2. A refused append changes nothing.

`MemoryStore` already does both. Its changes are `countShopsWithPhonePrefix` and `listRecords` returning a copy
(`[...records]`). The copy matters because `generateExport` sorts the array it gets in place, which would reorder the
store's own list.

### Processed texts (`src/store/processed.ts`)

Africa's Talking can send the same incoming-text callback again (a slow answer, a network retry). It sends an `id` for
the message. The route remembers the ids it has handled, so a repeat does not save twice. This is a separate small
interface, like `PendingStore`, so `LedgerStore` stays about the ledger.

```ts
export const PROCESSED_TEXT_TTL_MS = 48 * 60 * 60 * 1000;
export type TextClaim =
  | { status: 'new' }                       // this call won the claim and must handle the message
  | { status: 'done'; reply: string }       // handled before; here is the reply
  | { status: 'working' };                  // claimed, no reply stored yet (the first call is still running)

export interface ProcessedTextStore {
  claim(phone: string, messageId: string): Promise<TextClaim>;
  finish(phone: string, messageId: string, reply: string): Promise<void>;
}
export class InMemoryProcessedTextStore implements ProcessedTextStore {
  constructor(options?: { now?: () => Date });
}
```

There is no way to forget a claim, on purpose (see "Repeated text callbacks"). `InMemoryProcessedTextStore` keeps a
`Map<string, { reply: string | null; at: number }>` keyed by
`phone + '\0' + messageId`. A plain `Set` would remember that an id was seen but not the reply to give back, so the
`Map` is the set of ids with the reply beside each one. `claim` first deletes entries older than the TTL, then
returns `new` (and stores `reply: null`) when the key is absent, `working` when the reply is `null`, and `done` with the
reply otherwise. JavaScript runs `claim` without a pause, so two simultaneous claims cannot both get `new`.

The key is the phone and the id together, so a caller who guesses an id cannot block another owner's message.

### Record cap (`src/store/limit.ts`)

```ts
export class RecordLimitError extends Error { constructor(shopId: string, max: number) }
export function withRecordLimit(store: LedgerStore, maxRecordsPerShop: number): LedgerStore;
```

A decorator. `appendRecord` calls `listRecords(record.shopId)`; when the length is `maxRecordsPerShop` or more it
throws `RecordLimitError` before appending. Everything else passes through, including `countShopsWithPhonePrefix`.
A repeated request (same record id) at the cap meets `RecordLimitError` first; the dialled menu looks the id up with
`findRecordById` before it appends, so a repeat of a saved record still gets its answer. `createApp` wraps
its store with `withRecordLimit(store, MAX_RECORDS_PER_SHOP)`, so every route and the demo seed obey the cap.
The check and the insert are two steps, so concurrent writes can pass 2,000 by a few records. That is acceptable
for a demo cap and is not a safety limit.

## Postgres store (`src/store/postgres/`)

```ts
// client.ts
import postgres, { type Sql } from 'postgres';
export function connectPostgres(url: string): Sql;
// postgres(url, { max: 3, prepare: false, connect_timeout: 10, idle_timeout: 20, onnotice: () => {} })
// prepare:false so it works through Neon's pooled (PgBouncer) connection string; connects on first query.
export function closePostgres(sql: Sql): Promise<void>;   // sql.end({ timeout: 5 })

// store.ts
export class PostgresStore implements LedgerStore {
  constructor(sql: Sql);
  /* the seven LedgerStore methods */
}
export function createPostgresStore(sql: Sql): LedgerStore;

// processed.ts
export class PostgresProcessedTextStore implements ProcessedTextStore {
  constructor(sql: Sql, options?: { now?: () => Date; ttlMs?: number /* PROCESSED_TEXT_TTL_MS */ });
}

// pending.ts
export interface PostgresPendingOptions { ttlMs?: number /* 600000 */; now?: () => Date }
export class PostgresPendingStore implements PendingStore {
  constructor(sql: Sql, options?: PostgresPendingOptions);
  get(phone: string): Promise<PendingQuestion | null>;
  set(phone: string, question: PendingQuestion): Promise<void>;
  clear(phone: string): Promise<void>;
}
```

`PendingStore` and `PendingQuestion` are imported as types from `src/channels/sms/pending.ts`
(spec `text-messages`). That is a type-only import, so the driver stays out of `src/channels`.

How the store behaves:

- **Parameters.** Postgres.js v4 rejects `undefined`, so every optional field is sent as `null`
  (`item ?? null`). Times go in as ISO strings cast `::timestamptz`.
- **Reading money.** `bigint` comes back as a string. `toSafeInt(value)` converts a string, number or bigint with
  `Number()` and throws if `Number.isSafeInteger` is false.
- **Reading times.** `timestamptz` comes back as a `Date`; the store returns `date.toISOString()`. Millisecond
  strings written by the core read back identical.
- **Reading records.** `rowToRecord` builds the right record shape for the `kind` and leaves out fields that are
  `null` (no `item: null`). Contract tests use `toEqual`, which treats a missing field and `undefined` alike.
- **`appendRecord`** is one `insert ... on conflict (id) do nothing returning id`. That is the duplicate-save guard of
  the dialled menu in SQL: the primary key on `records.id` is a unique index, and an insert whose id is already there
  returns no row, so the store throws `DuplicateRecordError(record.id)` and changes nothing. Because the conflict
  rule names only `id`, Postgres checks the id first and a repeated undo gives `DuplicateRecordError`, the same as the
  memory store, not the reversal error. Two simultaneous copies are usually safe: the second waits for the first and
  then gets no row. Not always: when two copies start together, Postgres can meet one of the other unique indexes
  (`records_shop_id_id_unique`, `records_one_reversal_per_record`) before it sees the conflict on the id, and raise
  `23505` for that index instead (seen in a test run, about 2 in 100 simultaneous pairs). So after any `23505` the
  store looks the id up (`select 1 from records where id = $1`): an id that is held gives `DuplicateRecordError`,
  whichever index complained; if it is not held, `records_one_reversal_per_record` gives
  `RecordAlreadyReversedError(record.reversesRecordId)`. Anything else is rethrown unchanged, including the
  foreign-key and check errors of requirement 62.
- **`createShop`** maps `23505` on `shops_pkey` or `shops_phone_unique` to `ShopAlreadyExistsError` (both are plain unique checks with no `on conflict`, so no lookup is needed), with the same
  message text as the memory store (`id <id>` or `phone number`).
- **`countShopsWithPhonePrefix`** is `select count(*)::int from shops where starts_with(phone, $1)`. `starts_with` is
  used instead of `like` so a prefix needs no escaping.
- **`listRecords`** is `where shop_id = $1 and ($2::timestamptz is null or created_at >= $2::timestamptz)
  order by seq`.
- **`findReversalOf`** is `where reverses_record_id = $1`.
- **Processed texts** (`PostgresProcessedTextStore`, `processed.ts`). `claim` runs three steps: delete rows with
  `created_at` older than the TTL; `insert into processed_texts (phone, message_id, created_at) ... on conflict do
  nothing returning message_id` (a row back means `new`); otherwise `select reply` for the pair (`null` gives
  `working`, text gives `done`). Rows are never deleted except by the age sweep, so the select finds the row; if it
  still finds nothing (a sweep ran between the two statements) the insert is tried once more, then `working` is
  returned. `finish` sets `reply`. The primary key (`phone`, `message_id`) decides which of two simultaneous claims
  wins.
- **Pending questions.** `set` is an upsert on `phone`; `expires_at` is the injected clock's now plus `ttlMs` (not the
  database clock), and it first deletes rows with `expires_at` before now. `get` returns a row only when `expires_at`
  is now or later, so an answer at exactly 10 minutes is still in time, as in `InMemoryPendingStore`. The row holds
  `kind`, a `payload` (`jsonb`, the question without `kind` and `createdAt`) and `created_at`; `get` puts the `Date`
  back.

## SQL schema (`sql/001_init.sql`)

No `begin` or `commit` in the file; the script wraps each file in a transaction.

```sql
create table shops (
  id          text not null,
  name        text not null check (char_length(name) between 1 and 24),
  phone       text not null,
  currency    text not null check (currency in ('ZAR','USD','KES','NGN','GHS','ZMW','BWP')),
  time_zone   text not null,
  created_at  timestamptz not null,
  constraint shops_pkey primary key (id),
  constraint shops_phone_unique unique (phone)
);

create table records (
  seq                    bigint generated always as identity,
  id                     text not null,
  shop_id                text not null references shops (id),
  kind                   text not null check (kind in ('sale','expense','debt','payment','reversal')),
  amount                 bigint not null check (amount >= 0 and amount <= 9007199254740991),
  item                   text,
  customer_display_name  text,
  customer_key           text,
  reverses_record_id     text,
  channel                text not null check (channel in ('ussd','sms','web')),
  original_words         text not null,
  created_at             timestamptz not null,
  -- the duplicate-save guard of the dialled menu: one record per id, checked before anything else
  constraint records_pkey primary key (id),
  constraint records_shop_id_id_unique unique (shop_id, id),
  -- a reversal points at a record of the same shop (not enforced while reverses_record_id is null)
  constraint records_reverses_fk foreign key (shop_id, reverses_record_id) references records (shop_id, id),
  constraint records_amount_by_kind
    check ((kind = 'reversal' and amount = 0) or (kind <> 'reversal' and amount > 0)),
  constraint records_customer_by_kind
    check ((kind in ('debt','payment')) = (customer_display_name is not null and customer_key is not null)),
  constraint records_reverses_by_kind
    check ((kind = 'reversal') = (reverses_record_id is not null))
);

-- a record can be reversed once
create unique index records_one_reversal_per_record on records (reverses_record_id)
  where reverses_record_id is not null;
create index records_shop_seq on records (shop_id, seq);

create table pending_questions (
  phone       text primary key,
  kind        text not null check (kind in ('ambiguous','largeAmount','signup')),   -- the three kinds in PendingQuestion
  payload     jsonb not null,
  created_at  timestamptz not null,
  expires_at  timestamptz not null
);
create index pending_questions_expires on pending_questions (expires_at);

-- text callbacks already handled (Africa's Talking can send one twice); the reply is kept to answer a repeat
create table processed_texts (
  phone       text not null,
  message_id  text not null check (char_length(message_id) between 1 and 100),
  reply       text,
  created_at  timestamptz not null,
  constraint processed_texts_pkey primary key (phone, message_id)
);
create index processed_texts_created on processed_texts (created_at);
```

`seq` is never returned by the store. The constraint and index names above are part of the contract: the store maps
errors by them (`records_pkey`, `records_one_reversal_per_record`, `shops_pkey`, `shops_phone_unique`). The
duplicate-save guard is the primary key `records_pkey`; there is no second index for it.

### Migration script (`scripts/migrate.mjs`, `npm run db:migrate`)

Plain `.mjs`, like `scripts/secret-scan.mjs`, and it imports `postgres`.

1. Read DATABASE_URL (trimmed). If empty, print `DATABASE_URL is not set. Put it in .env or the environment.` and
   exit 1. Never print the value.
2. Connect with `max: 1, prepare: false`. Create `schema_migrations (name text primary key, applied_at timestamptz
   not null default now())` if missing.
3. List `sql/*.sql` matching `^\d+_.*\.sql$`, sorted by name. For each name not in `schema_migrations`:
   `sql.begin(tx => tx.unsafe(fileText) then insert the name)`, print `applied <name>`.
4. If nothing was applied, print `Nothing to apply.`. Close the connection and exit 0.
5. On failure print `Migration <name> failed: <error message>` and exit 1. The transaction rolls the file back.

## Server modules

### `src/server/constants.ts`

```ts
export const MAX_MENU_INPUT = 182;          // also the USSD screen limit
export const MAX_SMS_TEXT = 480;            // incoming text
export const SMS_REPLY_LIMIT = 160;
export const MAX_BODY_BYTES = 8192;
export const RATE_LIMIT = 60;               // requests
export const RATE_WINDOW_MS = 60_000;
export const MAX_RECORDS_PER_SHOP = 2000;
export const DEMO_SERVICE_CODE = '*384*46254#';
export const DEFAULT_SHORTCODE = '46254';        // the Africa's Talking sandbox short code
export const DEMO_PHONE_PREFIX = '+2700000';     // every demo number starts with this
export const DEMO_CREATES_PER_HOUR = 10;         // POST /api/phone/demo, per client address
export const DEMO_WINDOW_MS = 3_600_000;
export const MAX_DEMO_SHOPS = 5000;              // demo shops in all
export const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,100}$/;   // an Africa's Talking text id we will remember

export const SENTENCES = {
  generic:   'Sorry, something went wrong. Please try again.',
  menuLong:  'That entry is too long. Please dial again.',
  smsLong:   'That message is too long. Please send a shorter one.',
  full:      'This shop book is full. Please start a new demo shop.',
  rate:      'Too many requests. Please wait a minute and try again.',
  notDemo:   'Use a demo number: +2700000 followed by 4 digits.',
  noShop:    'No demo shop for this number. Start a demo first.',
  taken:     'That demo number is already in use. Pick another.',
  noNumbers: 'No demo numbers are free right now. Please try again later.',
  badBody:   'Send JSON like {"phone":"+27000001234","text":"today"}.',
  tooBig:    'That request is too big.',
  missing:   (field: string) => `Missing field: ${field}.`,
  notFound:  'Not found.',
  forbidden: 'Not allowed. Check the key in the callback address.',
  working:   'Got your message. Working on it.',
  demoRate:  'Too many demo shops from this address. Please try again later.',
  demoFull:  'The demo is full right now. Please try again later.',
} as const;                                  // all plain ASCII, each under 100 characters
```

### `src/server/phone.ts`

```ts
export { normalizePhone } from '../channels/phone.js';
// Existing function. Removes spaces, hyphens, dots and brackets, adds a missing "+", and keeps "+" then 7 to 15
// digits; anything else gives null. The dialled menu and the text handler use it, so the routes use it too.
export function isDemoPhone(phone: string): boolean;     // /^\+2700000\d{4}$/ on a normalised number
export function maskPhone(phone: string): string;        // first 4 characters + '***' + last 2
export function clientAddress(headers: { get(name: string): string | null | undefined }): string;
// x-real-ip (trimmed); else the LAST entry of x-forwarded-for (trimmed); else 'unknown'; cut to 64 characters
```

`clientAddress` reads `x-real-ip` first because Vercel sets it to the address that connected. A proxy adds the address it
saw to the end of `x-forwarded-for`, so the last entry is the platform's and the first is whatever the caller wrote; the
first entry is never used (group 11). Run anywhere else (a local run, tests) both can be written by the caller or are
missing, and the shared key `unknown` is used.

### `src/server/callbackKey.ts`

```ts
export function keyMatches(given: string | undefined, expected: string): boolean;
// sha256 both values to 32 bytes each, crypto.timingSafeEqual the digests; false when `given` is undefined
```

Hashing first makes the two buffers the same length, which `timingSafeEqual` needs, and hides the key's length.
The comparison runs even when `given` is missing, so a missing parameter takes the same time as a wrong one.

### `src/server/rateLimit.ts`

```ts
export type RateResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };
export interface RateLimiter { check(key: string): RateResult }
export function createRateLimiter(options: { limit: number; windowMs: number; now: () => Date }): RateLimiter;
```

Sliding window: a `Map<string, number[]>` of allowed-request times. `check` drops times older than the window; if the
count is at the limit it returns `retryAfterSeconds = ceil((oldest + windowMs - now) / 1000)` and records nothing;
otherwise it records the time. When the map passes 10,000 keys, `check` also removes keys whose times are all
expired. The state lives in the instance, so on Vercel each warm function instance counts for itself and the real
ceiling is 60 per minute per instance. It is a speed bump for a public demo, not a guarantee.

### `src/server/errors.ts`

```ts
export function ownerSentence(error: unknown): string;     // RecordLimitError -> SENTENCES.full, else SENTENCES.generic
export function logError(route: string, error: unknown, phone?: string): void;
// console.error(JSON.stringify({ level: 'error', route, name, message, stack, phone: masked }))
```

Logs carry no message text, no environment value and no full phone number.

### `src/server/sender.ts`

```ts
export interface SmsSender { send(to: string, message: string): Promise<void> }

export interface AfricasTalkingOptions {
  username: string;
  apiKey: string;
  shortcode: string;                 // the `from` field
  fetch?: typeof fetch;              // tests pass a fake
  timeoutMs?: number;                // 5000
}
export function africasTalkingHost(username: string): string;
// 'sandbox' -> 'https://api.sandbox.africastalking.com', otherwise 'https://api.africastalking.com'
export function createAfricasTalkingSender(options: AfricasTalkingOptions): SmsSender;
```

`send` posts to `<host>/version1/messaging` with `Content-Type: application/x-www-form-urlencoded`, headers `apiKey`
and `Accept: application/json`, body `username`, `to`, `message`, `from`, and an `AbortSignal.timeout(timeoutMs)`.
It throws `Error("Africa's Talking refused the text (status N)")` or `... (recipient code N)` when the HTTP status is
not 2xx or `SMSMessageData.Recipients[i].statusCode >= 400`. Messages name the status, never the key or the body.

### `src/server/views.ts`

```ts
export interface MoneyView { cents: number; text: string }
export interface RecordView {
  id: string; kind: RecordKind; amount: MoneyView; item?: string; customer?: string;
  channel: Channel; originalWords: string; createdAt: string;
  reversed: boolean; reversesRecordId?: string;
}
export interface LedgerView {
  shop: { name: string; phone: string; currency: Currency; timeZone: string };
  today: {
    date: string;                    // shop's local date, YYYY-MM-DD
    sales: { total: MoneyView; count: number };
    expenses: MoneyView; moneyInHand: MoneyView; newDebts: MoneyView;
    paymentsReceived: MoneyView; totalOwed: MoneyView;
  };
  owes: { customers: Array<{ name: string; owed: MoneyView }>; more: number };   // first 20, largest first
  records: RecordView[];             // last 20, newest first
}
export async function buildLedgerView(store: LedgerStore, shop: Shop, now: Date): Promise<LedgerView>;
```

It calls `getTodaySummary`, `getWhoOwes`, `getShopLocalDate`, `listRecords` and `activeRecords` (for `reversedIds`),
and formats with `formatCents(cents, shop.currency)`.

### `src/server/demo.ts`

```ts
export const DEMO_SHOP_NAME = "Thandi's Spaza";
export function buildDemoShop(phone: string, now: Date): Shop;       // ZAR, Africa/Johannesburg, createdAt = oldest record time
export function buildDemoRecords(shop: Shop, now: Date): Record[];    // in append order
```

Pure, no I/O. Records use `channel: 'sms'` and original words an owner would type. Days are found with
`getShopDayBounds(shop, getShopLocalDate(shop, now))` and 24-hour steps back (the demo time zone has no daylight
saving). Earlier days use fixed local clock times. Today's records are placed at `start + elapsed * fraction`, with
fractions 0.15, 0.30, 0.45, 0.60, 0.75, 0.90 of the time since local midnight, so they fall on today and are never
after `now`, whatever the hour.

| When | Record | Amount | Words |
|---|---|---|---|
| 2 days ago 09:10 | sale, bread | R120 | `sold 4 bread 120` |
| 2 days ago 11:30 | sale, airtime | R85 | `sold airtime 85` |
| 2 days ago 13:00 | expense, stock | R200 | `spent 200 stock` |
| 2 days ago 15:45 | debt, Tendai, sugar | R30 | `Tendai owes 30 sugar` |
| yesterday 08:20 | sale, bread | R96 | `sold 3 bread 96` |
| yesterday 10:05 | sale, drinks | R155 | `sold drinks 155` |
| yesterday 12:40 | debt, Rudo, paraffin | R45 | `Rudo owes 45 paraffin` |
| yesterday 14:15 | payment, Tendai | R10 | `Tendai paid 10` |
| yesterday 16:00 | sale, bread (a slip) | R999 | `sold 999 bread` |
| yesterday 16:01 | reversal of the R999 sale | R0 | `undo` |
| yesterday 17:10 | expense, transport | R60 | `spent 60 transport` |
| today, 15% | sale, bread | R45 | `sold 3 bread 45` |
| today, 30% | sale, drinks | R120 | `sold drinks 120` |
| today, 45% | expense, transport | R20 | `spent 20 transport` |
| today, 60% | debt, Sipho, bread | R25 | `Sipho owes 25 bread` |
| today, 75% | payment, Rudo | R15 | `Rudo paid 15` |
| today, 90% | sale, sweets | R30 | `sold sweets 30` |

Result: Tendai owes R20, Rudo R30, Sipho R25; sales today R195 (3 sales). The owner, shop and customers are invented.

### `src/server/app.ts`

```ts
export interface AppDeps {
  store: LedgerStore;
  pending: PendingStore;              // from src/channels/sms/pending.ts
  processed?: ProcessedTextStore;     // from src/store/processed.ts; default: a new InMemoryProcessedTextStore
  reader?: ModelReader;               // from src/ai/reader.ts
  smsSender?: SmsSender;
  callbackKey?: string;               // when set, /ussd and /sms need ?k=<callbackKey>
  demoLimits?: { perAddress?: number; windowMs?: number; maxShops?: number };   // defaults in constants.ts; tests shrink them
  now?: () => Date;                   // systemClock.now and mockClock(d).now both fit
}
export function createApp(deps: AppDeps): Hono;
```

What `createApp` does, in order:

1. `const store = withShopLimit(withRecordLimit(deps.store, MAX_RECORDS_PER_SHOP), 2000)` and `browserStore =
   withoutShopCreation(store)`; `const now = deps.now ?? (() => new Date())`; rate limiters (all per instance): 60 a
   minute per phone and 120 a minute per client address for the browser routes, 300 a minute per address and 30 a
   minute per phone for `/ussd` and `/sms`; `quota = deps.quota ?? new InMemoryDemoQuotaStore({ now })` for the demo
   limits that must hold across instances; `reader = withReaderLimit(deps.reader, 200 an hour)`; and
   `processed = deps.processed ?? new InMemoryProcessedTextStore({ now })`.
2. When `deps.callbackKey` is set (not blank): `app.use('/ussd', keyGuard)` and `app.use('/sms', keyGuard)`.
   `keyGuard` reads `c.req.query('k')`; if `keyMatches` is false it answers 403 `text/plain` `SENTENCES.forbidden` and
   does not call `next()`. It comes before the body limit, so a caller without the key never makes the app read a body.
   With no key set there is no guard, unless `deps.refuseCallbacks` is true (the entry sets it when the sender is set
   and the key is not): then a guard answers 503 `SENTENCES.callbacksOff` and nothing else runs. After the key guard,
   the address limiter (300 a minute) runs on `/ussd` and `/sms`, and the browser routes get the 120-a-minute address
   limiter, both before the body limit.
3. `bodyLimit({ maxSize: MAX_BODY_BYTES, onError })`: 413 with `SENTENCES.tooBig` (JSON under `/api/`, text elsewhere).
4. A middleware that sets `Cache-Control: no-store` on `/api/*`.
5. `registerAtRoutes(app, ctx)` and `registerBrowserRoutes(app, ctx)`, with
   `ctx = { store, browserStore, pending, processed, reader, smsSender, now, limiter, addressLimiter, atAddressLimiter,
   atPhoneLimiter, quota, demoPerAddress, demoWindowMs, maxDemoShopsPerDay, addressSalt, maxDemoShops }`.
6. `GET /health`.
7. `app.onError` and `app.notFound` (see Errors).

Both entry points are imported from `../../channels/index.js`, the public face of the channels. The shared types live in
`src/server/context.ts` (`AppContext`) and the answer helpers in `src/server/respond.ts` (`refuse`, which picks JSON or
plain text from the path).

### `src/server/routes/at.ts`

`POST /ussd`: `c.req.parseBody()` (form). Needs string fields `sessionId`, `serviceCode`, `phoneNumber`; `text` defaults
to `''`. Order of checks: missing field or bad phone -> 400 text; latest segment
(`text.split('*').pop()`) over `MAX_MENU_INPUT` -> 200 `END ` + `SENTENCES.menuLong`; call
`handleUssd({ sessionId, serviceCode, phoneNumber: normalised, text, now: now(), store })`; if `response` does not
start with `CON ` or `END `, log it and answer `END ` + `SENTENCES.generic`; else 200 `text/plain` with `response`.

`POST /sms`: needs `from` and `text` (`to` and `date` are read for the log only; the clock is ours). Missing or bad
phone -> 400 text. `text.length > MAX_SMS_TEXT` -> reply `SENTENCES.smsLong`, skip the handler (and skip the claim
below), send the reply. Otherwise:

1. **Claim the message id** (see "Repeated text callbacks"). Only when `id` matches `MESSAGE_ID_PATTERN`.
   `processed.claim(phone, id)` gives `done` (answer 200 with the stored reply; no handler, no send), `working`
   (answer 200 `SENTENCES.working`; no handler, no send) or `new` (go on). No usable `id`: go on without a claim.
2. `handleText({ phone, text, now: now(), store, pending, reader })` inside a `try`. If it throws, the route logs the
   error (route, name, message, stack, masked phone) and uses `ownerSentence(error)` as the reply.
3. `processed.finish(phone, id, reply)` when a claim was made, **before** the send. A failure of `finish` is logged and
   does not stop the answer (the claim then stays `working`, which keeps a repeat from running).
4. `if (smsSender && !isDemoPhone(phone)) await smsSender.send(phone, reply)` inside a `try`; a failure is logged and
   ignored.
5. Answer 200 `text/plain` with the reply.

The route never forgets a claim. `handleText` is not idempotent: it may have saved a record before something later
threw, and a second run would save it again. So an error is stored as the reply like any other outcome, and a repeat
gets the same error sentence. The owner was told to try again and does so with a new message, which has a new id.
Errors outside the handler (the claim itself, the sender) reach `app.onError`, which answers the same way and sends the
sentence, because Africa's Talking does not show the callback body to the owner.

### Repeated text callbacks

```
POST /sms (id = X) ──► claim(from, X)
                         ├─ done ───────► answer the stored reply (handleText not called, nothing sent)
                         ├─ working ────► answer "Got your message. Working on it." (nothing called, nothing sent)
                         └─ new ────────► handleText ─► finish(reply) ─► send ─► answer
                                            └ throws ─► finish(error sentence) ─► send ─► answer
```

- The key is (`from`, `id`). The id is Africa's Talking's message id, unique per incoming text.
- Why store the reply: the repeat must get "the same reply" and `handleText` must not run again. A repeat that is
  answered `done` is not sent as a text again; the first call sent it.
- `working` covers a repeat that arrives while the first call is still running. The rare case of a function that dies
  between the claim and `finish` leaves a claim with no reply; repeats of that message then get the `working` sentence
  until the 48 hours pass, and the owner, who saw no reply, sends the text again (Africa's Talking gives the new
  message a new id). This is accepted for a demo: the other choice, letting such a repeat run again, can save twice.
- There is no release. A claim is only ever replaced by its reply or removed by the 48-hour sweep.
- The dialled menu needs none of this. Its record ids already come from the session and step.
- `POST /api/phone/sms` has no message id and does not use the store.

### `src/server/routes/browser.ts`

Every browser route starts with the same helper, `guardPhone(c, rawPhone)`:

1. `normalizePhone(raw)`; if it is `null` or not `isDemoPhone`, 400 `SENTENCES.notDemo`.
2. `limiter.check(phone)`; if refused, 429 with `Retry-After` and `SENTENCES.rate`.
3. Return the phone for the route to use.

| Route | After `guardPhone` |
|---|---|
| `POST /api/phone/ussd` | validate `sessionId?` and `text?` are strings; latest segment over 182 -> 400; no shop for the number -> 404 `SENTENCES.noDemoShop`; `handleUssd` (with `browserStore`, which cannot make a shop) with `serviceCode: DEMO_SERVICE_CODE` and `sessionId ?? crypto.randomUUID()`; answer `{ response, length, limit: 182 }` where `length = response.slice(4).length` |
| `POST /api/phone/sms` | `text` must be a string; over 480 -> 400; no shop for the number -> 404 `SENTENCES.noDemoShop`; `handleText` (with `browserStore`); answer `{ reply, length: reply.length, limit: 160 }` (no text is sent) |
| `POST /api/phone/demo` | see "Demo shop limits" below; then body `{ phone? }` (an empty body counts as `{}`); with a phone: 409 if `findShopByPhone` finds one; without: try up to 20 times `'+2700000' + randomInt(0, 10000)` padded to 4 digits until none has a shop, else 503; `createShop(buildDemoShop(...))`, append `buildDemoRecords` in order; 201 `{ phone, shop: { name, currency, timeZone } }` |
| `GET /api/ledger?phone=` | `findShopByPhone` or 404; `buildLedgerView` |
| `GET /api/export?phone=` | `findShopByPhone` or 404; `generateExport(store, shop)` then `{ ...data, exportedAt: now().toISOString() }`; `JSON.stringify(data, null, 2)` |

Export headers: `Content-Type: application/json; charset=utf-8`,
`Content-Disposition: attachment; filename="imali-ledger-<digits of phone>-<YYYY-MM-DD in UTC>.json"`,
`Cache-Control: no-store`.

On `POST /api/phone/demo` without a phone, the rate-limit key is the string `demo-create`, so one visitor cannot
make unlimited shops from one instance; with a phone it is the phone.

### Demo shop limits

Three things guard `POST /api/phone/demo`, in this order. The first runs before the body is read or any shop is read:

1. **10 a hour per client address, kept in the store.** `quota.claimCall(addressKey(clientAddress(headers), salt), { limit:
   10, windowMs: one hour })` (`DEMO_CREATES_PER_HOUR`, `DEMO_WINDOW_MS`). A refusal is 429 with `Retry-After` and
   `SENTENCES.demoRate`. Every allowed call counts, including a call that later ends in 400 or 409, so the route cannot
   be used to probe numbers without a cost; a refused call does not count. The count is in the `DemoQuotaStore`
   (memory in tests and local runs, the `demo_quota` table on Vercel), so it holds across instances (group 11).
2. **Housekeeping, then two ceilings.** After the body and phone checks, `deleteExpiredDemoShops(now - 7 days, 200)` clears
   away old demo shops (the memory pending store is cleared for the phone numbers it gives back). Then: the whole site
   may make 1,000 demo shops in 24 hours (`quota.madeToday()`), and the store may hold 5,000 demo shops
   (`countShopsWithPhonePrefix`); either gives 503 with `SENTENCES.demoFull` and nothing is created. The counts and the
   insert are separate steps, so simultaneous calls can pass a ceiling by a few shops, as with the record cap.
3. After a shop is made, `quota.noteMade(key)` adds it to the daily count.

Then the usual checks run: the 60-a-minute phone limit (`demo-create`, or the phone), the demo-number shape, 409, 503
for no free number, and creation. (The phone limit check runs before the housekeeping; see the code for the exact order.)

`addressKey(address, salt)` is the SHA-256 of the salt, a `\0` and the address, as 64 lower-case hex digits
(`src/server/address.ts`). The salt is ADDRESS_SALT or a fixed built-in one. Both quota stores and the table refuse a key
of any other shape, so an address cannot be written to the database. `demo_quota (id, address_hash, kind, happened_at)`
has the kinds `call` and `made`, indexes on `(address_hash, kind, happened_at)` and `(kind, happened_at)`, and is in
`sql/002_demo_quota.sql`. `claimCall` runs in one transaction that takes `pg_advisory_xact_lock(hashtextextended(key, 0))`
first, counts the `call` rows of the key inside the window, and inserts one row if there is room; old rows (24 hours)
are removed first, 500 at a time, with `for update skip locked`.

Body reading: `await c.req.json()` in a `try`; a failure or a non-object gives 400 `SENTENCES.badBody`.

### Housekeeping and the caps on shops (group 11)

- `LedgerStore.deleteExpiredDemoShops(createdBefore, maxShops): Promise<string[]>`. What a demo number is lives in
  `src/store/demo.ts` (`DEMO_PHONE_PATTERN`, and the same pattern for SQL). The method takes no prefix and no id. Postgres:
  `sql.begin`; `select id, phone from shops where phone ~ <pattern> and created_at < $1 order by created_at, id limit $2
  for update`; `delete from pending_questions where phone in (...)`; `delete from records where shop_id in (...)`;
  `delete from shops where id in (...) and phone ~ <pattern>`. Memory: the same on its maps. `limit` is clamped to 1,000.
- `withShopLimit(store, 2000)` (in `src/store/limit.ts`): `createShop` for a number that is not a demo number counts
  `countShopsWithPhonePrefix('')` minus the demo count and throws `ShopLimitError` at the cap, unless the shop (by phone or
  id) already exists, in which case the store answers as before. A number that starts with `+2700000` but is not a whole
  demo number is refused (`ShopLimitError`).
- `withoutShopCreation(store)`: `createShop` throws `ShopCreationNotAllowedError`; every other method passes through.

### `src/server/config.ts`

```ts
export interface ServerConfig {
  databaseUrl?: string;
  geminiApiKey?: string;
  geminiModel?: string;                                           // GEMINI_MODEL; used only when geminiApiKey is set
  at?: { username: string; apiKey: string; shortcode: string };   // shortcode: AT_SHORTCODE or '46254'
  callbackKey?: string;                                           // AT_CALLBACK_KEY
  callbacksMissingKey?: true;                                     // the sender is set and AT_CALLBACK_KEY is not
  addressSalt?: string;                                           // ADDRESS_SALT
  onVercel: boolean;                                              // VERCEL is set
  warnings: string[];                                             // e.g. 'AT_API_KEY is missing, so replies are not sent as texts'
}
export function readConfig(env: Record<string, string | undefined>): ServerConfig;
export class ConfigError extends Error {}
export function readPort(env: Record<string, string | undefined>): number;   // default 3000; throws ConfigError naming PORT
```

A value that is `undefined`, `''` or only spaces counts as not set. Warnings never contain a value.
`readPort` is separate so a stray PORT cannot stop a Vercel function from loading.

### `src/server/bootstrap.ts`

```ts
export interface Parts {
  store: LedgerStore; pending: PendingStore; processed: ProcessedTextStore;
  reader?: ModelReader; smsSender?: SmsSender; callbackKey?: string;
}
export interface Started {
  app: Hono; parts: Parts; summary: string; warnings: string[]; close(): Promise<void>;
}
export function createAppFromEnv(
  env: Record<string, string | undefined>,
  overrides?: { now?: () => Date; fetch?: typeof fetch },
): Started;
```

With `databaseUrl`: `connectPostgres`, `createPostgresStore`, `new PostgresPendingStore(sql)`,
`new PostgresProcessedTextStore(sql)`; `close()` ends the pool. Without it: `new MemoryStore()`,
`new InMemoryPendingStore()` and `new InMemoryProcessedTextStore()`; `close()` does nothing.

`reader` is made **only when GEMINI_API_KEY is set**: `new GeminiReader({ apiKey, model })`, where `model` is
`geminiModel` when GEMINI_MODEL is set and left out otherwise (the reader then uses its own default,
`DEFAULT_GEMINI_MODEL`). With no key there is no reader, whatever GEMINI_MODEL says.

`smsSender` is `createAfricasTalkingSender({ username, apiKey, shortcode, fetch })` from `config.at`, where
`shortcode` is AT_SHORTCODE or `46254`, and the host is the sandbox host when AT_USERNAME is `sandbox`. `callbackKey`
comes from AT_CALLBACK_KEY and goes to `createApp`.

`summary` looks like `store=postgres gemini=off sms=sandbox callback=key salt=default` (`sms` is `off`, `sandbox` or
`live`; `callback` is `key`, `missing-key` or `open`; `salt` is `default` or `set`; never a value). `callback=missing-key`
means the sender is set and AT_CALLBACK_KEY is not, so `createApp` gets `refuseCallbacks: true`. The entries log `summary` and each warning once. If `onVercel` and there
is no `databaseUrl`, a warning is added.

### `src/server/node.ts` and `src/server/main.ts`

```ts
export function createNodeApp(env, options?: { publicDir?: string }): Started;
// createAppFromEnv + app.get('*', serveStatic({ root: publicDir ?? './public' })) after the routes
```

`main.ts` calls `readPort`, `createNodeApp(process.env)`, `serve({ fetch: app.fetch, port, hostname: '127.0.0.1' })` from
`@hono/node-server` (the local server listens on this machine only; Vercel serves the live one),
logs the summary and `Listening on http://localhost:<port>`, and on SIGINT or SIGTERM runs `close()` and exits.
`serveStatic` (imported from `@hono/node-server/serve-static`) calls `next()` when the file does not exist, so unknown
GETs reach `notFound`; it serves `index.html` for `/` and refuses paths with `..`.
`main.ts` has no exports and no tests; `node.ts` carries the testable part.

### `api/index.ts`

```ts
import { handle } from 'hono/vercel';
import { createAppFromEnv } from '../src/server/bootstrap.js';
const { app, summary, warnings } = createAppFromEnv(process.env);
// log summary and warnings once at cold start
export const GET = handle(app);
export const POST = handle(app);
```

`hono/vercel`'s `handle` is marked deprecated in Hono 4 and removed in Hono 5 (the replacement is the separate
`@hono/vercel` package). It is `(req) => app.fetch(req)`, so staying on `hono@^4` is safe, and moving later is a
one-line change to `export default { fetch: app.fetch }`, which the Vercel Node runtime also accepts.

### `vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "buildCommand": null,
  "outputDirectory": "public",
  "rewrites": [
    { "source": "/ussd", "destination": "/api" },
    { "source": "/sms", "destination": "/api" },
    { "source": "/health", "destination": "/api" },
    { "source": "/api/:path*", "destination": "/api" }
  ]
}
```

`/health` is added to the three paths the brief names, because without a rewrite it would be a 404 on Vercel.
Vercel serves `public/` from `outputDirectory`; the function in `api/index.ts` is found by Vercel without more
settings. The function sees the original request path after a rewrite, so Hono routes on `/ussd`, not `/api`
(to be confirmed on the first deploy, see Risks).

### `package.json`, `.gitignore` and `tsconfig.json` changes

```json
"name": "imali-ai-feature-phone",
"private": true,
"engines": { "node": "22.x" },
"dependencies": { "hono": "^4.13.17", "@hono/node-server": "^2.1.6", "postgres": "^4.1.0" },
"scripts": {
  "dev": "tsc && node --env-file-if-exists=.env dist/src/server/main.js",
  "start": "node --env-file-if-exists=.env dist/src/server/main.js",
  "db:migrate": "node --env-file-if-exists=.env scripts/migrate.mjs"
}
```

- The name was `imali-ledger-core`. `private: true` stops an accidental `npm publish`. `engines.node` of `22.x` makes
  Vercel run Node 22 (it reads `engines`).
- `^4.13.17` keeps `hono` on the 4.x line (`hono/vercel` `handle` is removed in 5, see below). The range for the other
  two is whatever `npm install` records. The dependency list stays at these three.
- `main` and `types` become `./dist/src/index.js` and `./dist/src/index.d.ts` because the build output moves under
  `dist/src/`. `scripts/check-screens.mjs` imports from `../dist/src/channels/...` for the same reason.
- `.gitignore` gets a line `.vercel` (the folder `vercel link` and `vercel dev` create).
- `tsconfig.json`: `"rootDir": "."` and `"include": ["src/**/*", "api/**/*"]`, so `npm run typecheck` also checks
  `api/index.ts` and Vercel's compiler does not complain about a file outside `rootDir`. `tsc` then writes to
  `dist/src/...` and `dist/api/...`. Run `npm run dev` from the repository root, because the static folder is the
  relative path `./public`. `--env-file-if-exists` needs Node 22.9 or later.

## Route table

| Route | Input | Success | Refusals |
|---|---|---|---|
| `POST /ussd` | form: `sessionId`, `serviceCode`, `phoneNumber`, `text?`; query `k` when AT_CALLBACK_KEY is set | 200 `text/plain`, `CON ...` or `END ...` | 403 text (key); 503 text (sender set, no key); 429 text (address); 400 text (missing field, bad phone); 200 `END ...` (input over 182, phone over 30 a minute, error); 413 |
| `POST /sms` | form: `from`, `text`, `to?`, `date?`, `id?`; query `k` when AT_CALLBACK_KEY is set | 200 `text/plain`, the reply (also sent through AT when a sender is set); a repeated `id` gets the first reply | 403 text (key); 503 text (sender set, no key); 429 text (address or phone); 400 text; 200 sentence (text over 480, repeat still running, error); 413 |
| `POST /api/phone/ussd` | JSON `{ phone, sessionId?, text? }` | 200 `{ response, length, limit: 182 }` | 400 (shape, not a demo number, input over 182); 404 (no shop on the number); 413; 429; 500 |
| `POST /api/phone/sms` | JSON `{ phone, text }` | 200 `{ reply, length, limit: 160 }` | 400 (shape, not a demo number, text over 480); 404 (no shop on the number); 413; 429; 500 |
| `POST /api/phone/demo` | JSON `{ phone? }` | 201 `{ phone, shop: { name, currency, timeZone } }` | 400; 409; 413; 429 (address or phone limit, or 10 an hour per address); 503 (no free number, 1,000 shops today, or 5,000 demo shops); 500 |
| `GET /api/ledger?phone=` | query | 200 `LedgerView` | 400; 404; 429; 500 |
| `GET /api/export?phone=` | query | 200 JSON download | 400; 404; 429; 500 |
| `GET /health` | none | 200 `{ "ok": true }` | none |

All `/api/*` answers send `Cache-Control: no-store`. JSON errors look like `{ "error": "<plain sentence>" }`.

## Errors

| What happens | `/ussd` | `/sms` | `/api/*` |
|---|---|---|---|
| unexpected error from handler, store or sender | 200 `END Sorry, something went wrong. Please try again.` | 200 `Sorry, something went wrong. Please try again.` | 500 `{ error }` |
| `RecordLimitError` | 200 `END Sorry, something went wrong. Please dial again.` (see below) | 200 `This shop book is full. Please start a new demo shop.` | 500 `{ error }` with the full-book sentence (`/api/phone/ussd` answers 200 like `/ussd`) |
| sender fails (after the reply is ready) | not used | logged; 200 with the reply | not used |
| `k` missing or wrong while AT_CALLBACK_KEY is set | 403 text | 403 text | not used |
| sender set and AT_CALLBACK_KEY not set | 503 text | 503 text | not used |
| `ShopLimitError` (2,000 shops that are not demo shops) | 200 `END Sorry, something went wrong. Please dial again.` (the menu catches it) | 200 `Sorry, no new shops can be added right now. Please try again later.` | not used |
| repeat of a text still being handled | not used | 200 `Got your message. Working on it.` | not used |
| no route | 404 `Not found.` text | | 404 `{ error: "Not found." }` |

`handleUssd` catches every error itself and shows its own plain screen (`END Sorry, something went wrong. Please dial
again.`), logging only the error name and message. So an error inside the menu, a full shop book included, never reaches
`app.onError`; the app's own `END` sentence is for what escapes (a response without `CON` or `END`, or a handler that
throws, which the tests make with a mocked handler). The text handler lets errors out, so `/sms` shows the full-book
sentence.

Africa's Talking shows whatever a USSD callback returns, so the AT routes answer 200 with a sentence the owner can
read. They return 400 only for malformed calls that a real phone cannot make. `app.onError` chooses the shape from
the path, calls `logError(path, error, phone)` and answers with `ownerSentence(error)`. No response ever includes
`error.message`, `error.stack`, SQL or the connection string.

## Environment variables

| Name | Used by | Meaning | If not set |
|---|---|---|---|
| `PORT` | Node entry | listening port | 3000 |
| `DATABASE_URL` | server, `db:migrate` | Postgres connection string from Neon | memory store; `db:migrate` exits 1 |
| `GEMINI_API_KEY` | server | turns the Gemini reader on | rules only |
| `AT_USERNAME` | server | Africa's Talking app name; `sandbox` selects `api.sandbox.africastalking.com` | no text sender |
| `AT_API_KEY` | server | Africa's Talking API key | no text sender |
| `GEMINI_MODEL` | server | Gemini model name; read only when `GEMINI_API_KEY` is set | the reader's default |
| `AT_SHORTCODE` | server | `from` of sent texts | `46254` (the sandbox short code) |
| `AT_CALLBACK_KEY` | server | when set, `POST /ussd` and `POST /sms` need `?k=<this value>` or answer 403 | those routes are open when no sender is set, and answer 503 when the sender is set |
| `ADDRESS_SALT` | server | the salt client addresses are hashed with before the demo limits are kept | a fixed built-in salt (`salt=default` on the start line) |
| `TEST_DATABASE_URL` | Postgres tests | a direct (not pooled) connection to a database the tests may use | those tests skip |
| `VERCEL` | set by Vercel | used only for the memory-store warning | |

`.env.example` has all of the above except `VERCEL`, each with an empty value. The `.gitignore` already ignores `.env`
and `.env.*` except `.env.example`.

## Tests

Fixed clock for route tests: `2026-11-07T10:00:00Z` (12:00 in Johannesburg), held in a variable the test can move.

| File | Covers requirements |
|---|---|
| `test/server/phone.test.ts` | 22, 27 |
| `test/server/rateLimit.test.ts` | 45, 46 |
| `test/server/errors.test.ts` | 48, 49 |
| `test/server/sender.test.ts` (fake `fetch`) | 68 to 71 |
| `test/server/config.test.ts` | 4, 8 to 11, 13 |
| `test/server/bootstrap.test.ts` | 7 to 9, 12, 82 |
| `test/server/node.test.ts` (temporary `public/` folder) | 3, 50 |
| `test/server/views.test.ts` | 28 to 30 |
| `test/server/demo.test.ts` | 35, 38 |
| `test/server/routes.at.test.ts` | 14 to 22, 41, 42, 82 to 91 |
| `test/server/callbackKey.test.ts`, `routes.key.test.ts` | 82 to 84 |
| `test/server/routes.phone.test.ts` | 23 to 27, 43 |
| `test/server/routes.ledger.test.ts`, `routes.export.test.ts`, `routes.demo.test.ts` | 28 to 39, 92 to 95 |
| `test/server/health.test.ts`, `test/server/app.test.ts` | 1, 2, 34, 40, 44, 50 |
| `test/server/vercel.test.ts` | 5 |
| `test/scripts/migrate.test.ts` | 57 to 59 |
| `test/store/postgres/client.test.ts`, `mapping.test.ts` | 54 to 56, 60, 61, 63, 64 |
| `test/server/limits.test.ts` | 41 to 47 |
| `test/server/errors.routes.test.ts` | 17, 21, 48 to 50, 74 |
| `test/server/conversation.test.ts` | 73 |
| `test/store/contract.ts` + `memory/store.test.ts` + `postgres/store.test.ts` | 51 to 53, 55, 56, 60, 61, 75 to 77, 95 |
| `test/store/processed.test.ts` (memory) + `postgres/processed.test.ts` | 85 to 90 |
| `test/server/package.test.ts` | 96 |
| `test/store/postgres/constraints.test.ts` | 62, 63 |
| `test/store/limit.test.ts` | 47 |
| `test/store/postgres/pending.test.ts` | 65 to 67 |
| `test/integration/page-contract.test.ts` | 28 to 30, 23, 25, 98 |
| `test/helpers/pg-timeout.test.ts` (fake `postgres`) | 99 |

How they work:

- **The page contract test** (`test/integration/page-contract.test.ts`) uses no mocks: `createApp` with the memory
  stores and a movable clock. It makes a demo shop, sends a sale through `/api/phone/ussd` and a debt and an undo
  through `/api/phone/sms`, and hands the real JSON of `/api/ledger`, `/api/phone/ussd` and `/api/phone/sms` to the
  page's `readLedger`, `parseUssdReply` and `parseSmsReply`. The plumbing tests below mock the handlers and the page
  tests use answers the page's author wrote, so neither could see that the two sides named fields differently
  (`length` against `chars`; `owes.customers` against `whoOwes`). This test can.
- **Plumbing tests** for the Africa's Talking and browser routes replace the two handlers with
  `vi.mock('../../src/channels/index.js')` and `vi.mock('../../src/channels/sms/handler.js')`, so they check exactly what
  the app passes in and out and do not depend on the handlers being finished.
- **`conversation.test.ts`** uses the real handlers. USSD: first dial, then `text` = `1`, `1*45`, `1*45*bread` and so on
  as `dialled-menu` defines the steps, through `POST /ussd` with a fixed `sessionId`; it then repeats the session through
  `POST /api/phone/ussd`. Text: `sold 3 bread 45`, `Tendai owes 20 sugar`, `Tendai paid 10`, `who owes`, `today`,
  `undo`, an unknown message and an ambiguous `sold 2 200` followed by `1`, through `POST /sms` and
  `POST /api/phone/sms`. Every USSD screen is checked for 182 characters after the prefix, every text for 160, both
  for ASCII. A shop with 2,000 records answers a sale with a plain sentence.
- **`test/store/contract.ts`** exports `runLedgerStoreContract(label, harness)` with
  `harness = { make(): Promise<LedgerStore>; teardown?(): Promise<void> }`. The checks are the ones in
  `test/store/memory/store.test.ts` today, moved here, plus: the same record id twice (`DuplicateRecordError`, first
  record unchanged), a repeated reversal with the same id (`DuplicateRecordError`, not `RecordAlreadyReversedError`),
  a second reversal with a new id (`RecordAlreadyReversedError`), duplicate shop id and duplicate phone
  (`ShopAlreadyExistsError`), `countShopsWithPhonePrefix`, append order with equal time stamps, a new array from
  `listRecords`, `since` is inclusive, `Number.MAX_SAFE_INTEGER` round trip. Every check creates its shop before it
  appends a record, because the Postgres tables have a foreign key from a record to its shop. The
  checks use `toEqual`. The table constraints (requirement 62) are tested only against Postgres in
  `test/store/postgres/constraints.test.ts`, because the memory store has no such rules.
- **`test/helpers/pg.ts`** exports `createTestDatabase(url)`: it creates a schema named `t_` plus random hex, opens a
  connection with `connection: { options: '-c search_path=<schema>' }` (the libpq `options` parameter; Neon's proxy
  drops a bare `search_path` start-up parameter but honours `options`), reads `show search_path` and throws, before any
  migration or test, unless the answer is exactly the schema (`assertSearchPath`). It then applies every file in
  `sql/`, and returns `{ sql, schema, drop() }`. `drop()` runs `drop schema ... cascade` and ends the connection.
  `TEST_DATABASE_URL` must still be a direct connection, and the check is what stops a pooled URL.
  `describePostgres(name, body, options)` wraps `describe` with `{ timeout: 30_000 }` (`POSTGRES_TEST_TIMEOUT_MS`) and
  gives `beforeAll` and `afterAll` 60 s (`POSTGRES_HOOK_TIMEOUT_MS`), because a remote database answers slowly (one test
  took 5.6 s against vitest's 5 s default). Tests inside it need no timeout of their own.
- **Postgres tests** are written as
  `const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;` with the suite name
  `PostgresStore contract (skipped: set TEST_DATABASE_URL to run)` when it is not set, so `vitest --reporter=verbose`
  says why they were skipped. `beforeEach` truncates the four tables.
- **No real network.** The sender tests pass a fake `fetch`; the Gemini reader is never built in route tests; the fake
  `fetch` throws if called with an unexpected URL.

## docs/run-the-demo.md (outline)

1. What you need: Node 22, a Neon account, a Vercel account, an Africa's Talking sandbox app.
2. Run locally: `npm ci`, copy `.env.example` to `.env`, `npm run dev`, open `http://localhost:3000`; what runs with no
   variables (memory store, rules only); a `curl` example for each of `/health`, `/api/phone/demo`, `/api/phone/sms`.
3. Run the tests: `npm test`; the Postgres tests with `TEST_DATABASE_URL` (a direct Neon connection or a local
   database); how to see the skipped message.
4. Neon: create a project, copy the connection string into your shell or `.env` (never into a tracked file), run
   `npm run db:migrate`, check the four tables. Use the pooled string for Vercel; use the direct one for
   `TEST_DATABASE_URL`.
5. Vercel: import the repository, leave the framework as Other, add `DATABASE_URL` (and optionally `GEMINI_API_KEY`,
   `GEMINI_MODEL`, `AT_USERNAME`, `AT_API_KEY`, `AT_SHORTCODE`, `AT_CALLBACK_KEY`), pick a function region near the Neon region, deploy, then check
   `https://imali-ai-feature-phone.vercel.app/health`.
6. Africa's Talking sandbox: the USSD channel `*384*46254#` with callback
   `https://imali-ai-feature-phone.vercel.app/ussd`; the SMS short code `46254` with incoming-message callback
   `https://imali-ai-feature-phone.vercel.app/sms`; set `AT_USERNAME` to `sandbox` and `AT_API_KEY` to the sandbox app's key
   so replies go out from `46254` (`AT_SHORTCODE`); when `AT_CALLBACK_KEY` is set, end both callback addresses with
   `?k=<AT_CALLBACK_KEY>` (the key is part of the address, so it can show in request logs; change it if it leaks);
   test in the simulator.
7. If something fails: what a plain error means, where the log is (Vercel runtime logs), the memory-store warning,
   and the checks for the first deploy (rewrite keeps the original path; `/health` answers).

## Decisions that were open

1. **How the duplicate-save guard works** (settled by the finished `dialled-menu`). The menu uses a record id made from
   the session and step, and the store's `DuplicateRecordError`. The first draft's save key is removed; the Postgres
   store uses the primary key on `records.id` for the same rule (see "Store interface changes").
2. **`response` includes the prefix.** `handleUssd` returns `CON ...` or `END ...` complete. The app still checks this
   (requirement 17) rather than adding a prefix.
3. **"Menu input over 182".** Read as the latest input, the part of `text` after the last `*`. The whole `text` is
   bounded only by the 8,192-byte body cap. Reading it as the whole cumulative `text` would cut off long but valid
   sessions.
4. **`src/channels/index.ts`** exports both channels. This spec does not change it.
5. **`tech.md` lists five routes.** This spec adds `GET /api/ledger`, `POST /api/phone/demo` and `GET /health`; task 9.2
   updates the steering file.
6. **Phone length.** The server follows `normalizePhone` (7 to 15 digits) so it cannot disagree with the handlers.

## Risks and known gaps

- **Vercel and the rewritten path.** Hono must see `/ussd`, not `/api`. Vercel keeps the original URL for rewrites to a
  function, but this is checked only on the first deploy (task 9.3). If it fails, the fallback is a `rewrites`-free
  layout with `api/ussd.ts`, `api/sms.ts` and `api/[...path].ts` that all export the same `handle(app)`.
- **Vercel and TypeScript.** The function imports `../src/server/bootstrap.js` where the file is `.ts`. Vercel compiles
  TypeScript for `api/`; if it cannot resolve the `.js` specifier, the fallback is to run `tsc` as the build command and
  import from `dist/`.
- **Africa's Talking callbacks are not signed.** With `AT_CALLBACK_KEY` unset, anyone who knows the URL can post to
  `/sms` and `/ussd`. With it set, the caller needs the key in the address. The key travels in the URL, so it can appear
  in request logs; it keeps casual callers out and is not a signature. The server never texts a demo number, and the
  sandbox sends no real messages.
- **Retries.** Africa's Talking can repeat an SMS callback. The route now remembers the message id and answers the
  repeat from the stored reply. A function that dies after the claim and before the reply leaves a claim that answers
  "working" until it expires (48 hours).
- **Demo shops.** Each costs 18 rows (the shop and 17 records); 5,000 shops is about 90,000 rows. The cap, the 10 an hour
  per address and the 1,000 a day are counted in the database; demo shops are cleared away after about 5 days (their
  `createdAt` is two days before they are made). The 60-per-minute limit on `demo-create`, the 120 a minute per address
  and the limits on `/ussd` and `/sms` are per instance. The address comes from `x-real-ip` and the last entry of
  `x-forwarded-for`; a caller that talks to the Node server directly could write both, which does not matter for a local
  run. A demo number can still be signed up through `/ussd` or `/sms` by someone who has the callback key (those routes
  are for Africa's Talking). The 7-day clean-up removes those shops too, but the cap of 5,000 is checked only when a demo
  shop is made through `POST /api/phone/demo`, so such sign-ups are held back by the key and the limits on `/ussd` and
  `/sms`, not by that cap.
- **The 2,000-record cap is check-then-insert** and can be passed by a few concurrent writes.
- **The rate limit is per instance** (requirement 46).
