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

## Files

```
api/index.ts                      Vercel entry
vercel.json
sql/001_init.sql                  migration
scripts/migrate.mjs               npm run db:migrate
src/server/constants.ts           limits, sentences, demo service code
src/server/phone.ts               normalise, demo-number check, mask
src/server/rateLimit.ts           per-phone sliding window, in memory
src/server/errors.ts              owner sentences, logError
src/server/sender.ts              Africa's Talking text sender
src/server/views.ts               LedgerView for the side panel
src/server/demo.ts                invented demo records
src/server/app.ts                 createApp
src/server/routes/at.ts           POST /ussd, POST /sms
src/server/routes/browser.ts      /api/phone/*, /api/ledger, /api/export
src/server/config.ts              readConfig, readPort
src/server/bootstrap.ts           createAppFromEnv
src/server/node.ts                createNodeApp (adds static files)
src/server/main.ts                starts the Node server (not imported by tests)
src/store/interface.ts            changed: AppendOptions, two new errors
src/store/limit.ts                withRecordLimit, RecordLimitError
src/store/memory/store.ts         changed: saveKey, unique phone, copy on list
src/store/postgres/client.ts      connectPostgres
src/store/postgres/store.ts       PostgresStore
src/store/postgres/pending.ts     PostgresPendingStore
src/store/postgres/index.ts       exports
docs/run-the-demo.md
test/server/*.test.ts             see Tests
test/store/contract.ts            shared LedgerStore contract
test/store/postgres/*.test.ts      store, pending, constraints
test/helpers/pg.ts                throwaway schema for Postgres tests
```

## Store interface changes (`src/store/interface.ts`)

```ts
export interface AppendOptions {
  /** One record per shop may use a given key. Used by the dialled menu so a repeated call saves once. */
  saveKey?: string;
}

export interface LedgerStore {
  createShop(shop: Shop): Promise<void>;                 // throws ShopPhoneTakenError
  findShopById(id: string): Promise<Shop | null>;
  findShopByPhone(phone: string): Promise<Shop | null>;
  appendRecord(record: Record, options?: AppendOptions): Promise<void>;
  // throws RecordAlreadyReversedError (reversal of a reversed record), DuplicateSaveError (same saveKey)
  findRecordById(id: string): Promise<Record | null>;
  findReversalOf(recordId: string): Promise<ReversalRecord | null>;
  listRecords(shopId: string, options?: { since?: string }): Promise<Record[]>;
  // append order, new array each call, `since` inclusive
}

export class DuplicateSaveError extends Error { constructor(saveKey: string) }       // name 'DuplicateSaveError'
export class ShopPhoneTakenError extends Error { constructor(phone: string) }        // name 'ShopPhoneTakenError'
```

The change is backward compatible: `options` is optional, so existing calls compile.

Convention for the key: the dialled menu passes `saveKey: 'ussd:' + sessionId` on the one save that ends a session.
The core operations (`recordSale` and the others) do not take options today, so the `dialled-menu` spec decides how
the key reaches `appendRecord` (see Open questions, 1).

`MemoryStore` changes: a `Set` of `shopId + '\0' + saveKey`, a phone check in `createShop`, and
`listRecords` returns `[...records]`. The last change matters because `generateExport` sorts the array it gets in
place, which would reorder the store's own list.

### Record cap (`src/store/limit.ts`)

```ts
export class RecordLimitError extends Error { constructor(shopId: string, max: number) }
export function withRecordLimit(store: LedgerStore, maxRecordsPerShop: number): LedgerStore;
```

A decorator. `appendRecord` calls `listRecords(record.shopId)`; when the length is `maxRecordsPerShop` or more it
throws `RecordLimitError` before appending. Everything else passes through, including `options`. `createApp` wraps
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
- **`appendRecord`** is one `insert`. On a `PostgresError` with code `23505` it maps by `constraint_name`:
  `records_one_reversal_per_record` gives `RecordAlreadyReversedError(record.reversesRecordId)`,
  `records_save_key_unique` gives `DuplicateSaveError(options.saveKey)`. Anything else is rethrown unchanged.
- **`createShop`** maps `23505` on `shops_phone_unique` to `ShopPhoneTakenError(shop.phone)`.
- **`listRecords`** is `where shop_id = $1 and ($2::timestamptz is null or created_at >= $2::timestamptz)
  order by seq`.
- **`findReversalOf`** is `where reverses_record_id = $1`.
- **Pending questions.** `set` is an upsert on `phone`; `expires_at` is `now() + ttlMs` using the injected clock, and
  it first deletes rows with `expires_at <= now()`. `get` returns a row only when `expires_at > now()`. The row
  holds `kind`, a `payload` (`jsonb`, the question without `createdAt`) and `created_at`; `get` puts the `Date`
  back.

## SQL schema (`sql/001_init.sql`)

No `begin` or `commit` in the file; the script wraps each file in a transaction.

```sql
create table shops (
  id          text primary key,
  name        text not null check (char_length(name) between 1 and 24),
  phone       text not null,
  currency    text not null check (currency in ('ZAR','USD','KES','NGN','GHS','ZMW','BWP')),
  time_zone   text not null,
  created_at  timestamptz not null,
  constraint shops_phone_unique unique (phone)
);

create table records (
  seq                    bigint generated always as identity,
  id                     text primary key,
  shop_id                text not null references shops (id),
  kind                   text not null check (kind in ('sale','expense','debt','payment','reversal')),
  amount                 bigint not null check (amount >= 0 and amount <= 9007199254740991),
  item                   text,
  customer_display_name  text,
  customer_key           text,
  reverses_record_id     text,
  channel                text not null check (channel in ('ussd','sms','web')),
  original_words         text not null,
  save_key               text,
  created_at             timestamptz not null,
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
-- the dialled menu's duplicate-save guard
create unique index records_save_key_unique on records (shop_id, save_key)
  where save_key is not null;
create index records_shop_seq on records (shop_id, seq);

create table pending_questions (
  phone       text primary key,
  kind        text not null check (kind in ('ambiguous','largeAmount')),
  payload     jsonb not null,
  created_at  timestamptz not null,
  expires_at  timestamptz not null
);
create index pending_questions_expires on pending_questions (expires_at);
```

`seq` is never returned by the store. The constraint and index names above are part of the contract: the store maps
errors by them.

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
export const DEFAULT_SHORTCODE = '46254';

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
} as const;                                  // all plain ASCII, each under 100 characters
```

### `src/server/phone.ts`

```ts
export function normalizePhone(raw: string): string | null;
// Removes spaces, hyphens, dots and brackets. "+" then 5-15 digits is kept; 5-15 digits alone gets a "+".
// Anything else gives null.
export function isDemoPhone(phone: string): boolean;     // /^\+2700000\d{4}$/ on a normalised number
export function maskPhone(phone: string): string;        // first 4 characters + '***' + last 2
```

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
  reader?: ModelReader;               // from src/ai/reader.ts
  smsSender?: SmsSender;
  now?: () => Date;                   // systemClock.now and mockClock(d).now both fit
}
export function createApp(deps: AppDeps): Hono;
```

What `createApp` does, in order:

1. `const store = withRecordLimit(deps.store, MAX_RECORDS_PER_SHOP)`; `const now = deps.now ?? (() => new Date())`;
   one `RateLimiter` for the browser routes.
2. `bodyLimit({ maxSize: MAX_BODY_BYTES, onError })`: 413 with `SENTENCES.tooBig` (JSON under `/api/`, text elsewhere).
3. A middleware that sets `Cache-Control: no-store` on `/api/*`.
4. `registerAtRoutes(app, ctx)` and `registerBrowserRoutes(app, ctx)`, with `ctx = { store, pending, reader, smsSender, now, limiter }`.
5. `GET /health`.
6. `app.onError` and `app.notFound` (see Errors).

`handleUssd` is imported from `../channels/index.js` and `handleText` from `../channels/sms/handler.js`.

### `src/server/routes/at.ts`

`POST /ussd`: `c.req.parseBody()` (form). Needs string fields `sessionId`, `serviceCode`, `phoneNumber`; `text` defaults
to `''`. Order of checks: missing field or bad phone -> 400 text; latest segment
(`text.split('*').pop()`) over `MAX_MENU_INPUT` -> 200 `END ` + `SENTENCES.menuLong`; call
`handleUssd({ sessionId, serviceCode, phoneNumber: normalised, text, now: now(), store })`; if `response` does not
start with `CON ` or `END `, log it and answer `END ` + `SENTENCES.generic`; else 200 `text/plain` with `response`.

`POST /sms`: needs `from` and `text` (`to`, `date`, `id` are read for the log only; the clock is ours). Missing or bad
phone -> 400 text. `text.length > MAX_SMS_TEXT` -> reply `SENTENCES.smsLong`, skip the handler. Otherwise
`handleText({ phone, text, now: now(), store, pending, reader })`. Then
`if (smsSender && !isDemoPhone(phone)) await smsSender.send(phone, reply)` inside a `try`; a failure is logged and
ignored. Answer 200 `text/plain` with the reply. Replies produced on the error path are sent the same way, because
Africa's Talking does not show the callback body to the owner.

### `src/server/routes/browser.ts`

Every browser route starts with the same helper, `guardPhone(c, rawPhone)`:

1. `normalizePhone(raw)`; if it is `null` or not `isDemoPhone`, 400 `SENTENCES.notDemo`.
2. `limiter.check(phone)`; if refused, 429 with `Retry-After` and `SENTENCES.rate`.
3. Return the phone for the route to use.

| Route | After `guardPhone` |
|---|---|
| `POST /api/phone/ussd` | validate `sessionId?` and `text?` are strings; latest segment over 182 -> 400; `handleUssd` with `serviceCode: DEMO_SERVICE_CODE` and `sessionId ?? crypto.randomUUID()`; answer `{ response, length, limit: 182 }` where `length = response.slice(4).length` |
| `POST /api/phone/sms` | `text` must be a string; over 480 -> 400; `handleText`; answer `{ reply, length: reply.length, limit: 160 }` (no text is sent) |
| `POST /api/phone/demo` | body `{ phone? }` (an empty body counts as `{}`); with a phone: 409 if `findShopByPhone` finds one; without: try up to 20 times `'+2700000' + randomInt(0, 10000)` padded to 4 digits until none has a shop, else 503; `createShop(buildDemoShop(...))`, append `buildDemoRecords` in order; 201 `{ phone, shop: { name, currency, timeZone } }` |
| `GET /api/ledger?phone=` | `findShopByPhone` or 404; `buildLedgerView` |
| `GET /api/export?phone=` | `findShopByPhone` or 404; `generateExport(store, shop)` then `{ ...data, exportedAt: now().toISOString() }`; `JSON.stringify(data, null, 2)` |

Export headers: `Content-Type: application/json; charset=utf-8`,
`Content-Disposition: attachment; filename="imali-ledger-<digits of phone>-<YYYY-MM-DD in UTC>.json"`,
`Cache-Control: no-store`.

On `POST /api/phone/demo` without a phone, the rate-limit key is the string `demo-create`, so one visitor cannot
make unlimited shops from one instance; with a phone it is the phone.

Body reading: `await c.req.json()` in a `try`; a failure or a non-object gives 400 `SENTENCES.badBody`.

### `src/server/config.ts`

```ts
export interface ServerConfig {
  databaseUrl?: string;
  geminiApiKey?: string;
  at?: { username: string; apiKey: string; shortcode: string };   // shortcode: AT_SHORTCODE or '46254'
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
  store: LedgerStore; pending: PendingStore; reader?: ModelReader; smsSender?: SmsSender;
}
export interface Started {
  app: Hono; parts: Parts; summary: string; warnings: string[]; close(): Promise<void>;
}
export function createAppFromEnv(
  env: Record<string, string | undefined>,
  overrides?: { now?: () => Date; fetch?: typeof fetch },
): Started;
```

With `databaseUrl`: `connectPostgres`, `createPostgresStore`, `new PostgresPendingStore(sql)`; `close()` ends the pool.
Without it: `new MemoryStore()` and `new InMemoryPendingStore()`; `close()` does nothing. `reader` is
`new GeminiReader(geminiApiKey)` when set. `smsSender` is `createAfricasTalkingSender({ ...config.at, fetch })`
when `config.at` is set. `summary` looks like
`store=postgres gemini=off sms=sandbox` (never a value). The entries log `summary` and each warning once.
If `onVercel` and there is no `databaseUrl`, a warning is added.

### `src/server/node.ts` and `src/server/main.ts`

```ts
export function createNodeApp(env, options?: { publicDir?: string }): Started;
// createAppFromEnv + app.get('*', serveStatic({ root: publicDir ?? './public' })) after the routes
```

`main.ts` calls `readPort`, `createNodeApp(process.env)`, `serve({ fetch: app.fetch, port })` from `@hono/node-server`,
logs the summary and `Listening on http://localhost:<port>`, and on SIGINT or SIGTERM runs `close()` and exits.
`serveStatic` calls `next()` when the file does not exist, so unknown GETs reach `notFound`. Check that `/` returns
`index.html`; if it does not, add `app.get('/', serveStatic({ path: './public/index.html' }))` first.
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

### `package.json` and `tsconfig.json` changes

```json
"dependencies": { "hono": "^4.13.17", "@hono/node-server": "^2.1.6", "postgres": "^4.1.0" },
"scripts": {
  "dev": "tsc && node --env-file-if-exists=.env dist/src/server/main.js",
  "start": "node --env-file-if-exists=.env dist/src/server/main.js",
  "db:migrate": "node --env-file-if-exists=.env scripts/migrate.mjs"
}
```

(Versions are the latest when this spec was written; install with `npm install` and keep what npm records.)
`tsconfig.json`: `"rootDir": "."` and `"include": ["src/**/*", "api/**/*"]`, so `npm run typecheck` also checks
`api/index.ts` and Vercel's compiler does not complain about a file outside `rootDir`. `tsc` then writes to
`dist/src/...` and `dist/api/...`. Run `npm run dev` from the repository root, because the static folder is the
relative path `./public`. `--env-file-if-exists` needs Node 22.9 or later.

## Route table

| Route | Input | Success | Refusals |
|---|---|---|---|
| `POST /ussd` | form: `sessionId`, `serviceCode`, `phoneNumber`, `text?` | 200 `text/plain`, `CON ...` or `END ...` | 400 text (missing field, bad phone); 200 `END ...` (input over 182, error); 413 |
| `POST /sms` | form: `from`, `text`, `to?`, `date?`, `id?` | 200 `text/plain`, the reply (also sent through AT when a sender is set) | 400 text; 200 sentence (text over 480, error); 413 |
| `POST /api/phone/ussd` | JSON `{ phone, sessionId?, text? }` | 200 `{ response, length, limit: 182 }` | 400 (shape, not a demo number, input over 182); 413; 429; 500 |
| `POST /api/phone/sms` | JSON `{ phone, text }` | 200 `{ reply, length, limit: 160 }` | 400 (shape, not a demo number, text over 480); 413; 429; 500 |
| `POST /api/phone/demo` | JSON `{ phone? }` | 201 `{ phone, shop: { name, currency, timeZone } }` | 400; 409; 413; 429; 503; 500 |
| `GET /api/ledger?phone=` | query | 200 `LedgerView` | 400; 404; 429; 500 |
| `GET /api/export?phone=` | query | 200 JSON download | 400; 404; 429; 500 |
| `GET /health` | none | 200 `{ "ok": true }` | none |

All `/api/*` answers send `Cache-Control: no-store`. JSON errors look like `{ "error": "<plain sentence>" }`.

## Errors

| What happens | `/ussd` | `/sms` | `/api/*` |
|---|---|---|---|
| unexpected error from handler, store or sender | 200 `END Sorry, something went wrong. Please try again.` | 200 `Sorry, something went wrong. Please try again.` | 500 `{ error }` |
| `RecordLimitError` | 200 `END This shop book is full. Please start a new demo shop.` | 200 `This shop book is full. Please start a new demo shop.` | 500 `{ error }` with the same sentence |
| sender fails (after the reply is ready) | not used | logged; 200 with the reply | not used |
| no route | 404 `Not found.` text | | 404 `{ error: "Not found." }` |

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
| `AT_USERNAME` | server | Africa's Talking app name; `sandbox` selects the sandbox host | no text sender |
| `AT_API_KEY` | server | Africa's Talking API key | no text sender |
| `AT_SHORTCODE` | server | `from` of sent texts | `46254` |
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
| `test/server/bootstrap.test.ts` | 7 to 9, 12 |
| `test/server/node.test.ts` (temporary `public/` folder) | 3, 50 |
| `test/server/views.test.ts` | 28 to 30 |
| `test/server/demo.test.ts` | 35, 38 |
| `test/server/routes.at.test.ts` | 14 to 22, 41, 42 |
| `test/server/routes.phone.test.ts` | 23 to 27, 43 |
| `test/server/routes.ledger.test.ts`, `routes.export.test.ts`, `routes.demo.test.ts` | 28 to 39 |
| `test/server/health.test.ts`, `test/server/app.test.ts` | 1, 2, 34, 40, 44, 50 |
| `test/server/vercel.test.ts` | 5 |
| `test/scripts/migrate.test.ts` | 57 to 59 |
| `test/store/postgres/client.test.ts`, `mapping.test.ts` | 54 to 56, 60, 61, 63, 64 |
| `test/server/limits.test.ts` | 41 to 47 |
| `test/server/errors.routes.test.ts` | 17, 21, 48 to 50, 74 |
| `test/server/conversation.test.ts` | 73 |
| `test/store/contract.ts` + `memory/store.test.ts` + `postgres/store.test.ts` | 51 to 53, 55, 56, 60, 61, 75 to 77 |
| `test/store/postgres/constraints.test.ts` | 62, 63 |
| `test/store/limit.test.ts` | 47 |
| `test/store/postgres/pending.test.ts` | 65 to 67 |

How they work:

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
  `test/store/memory/store.test.ts` today, moved here, plus: duplicate phone, `saveKey`, append order with equal
  time stamps, a new array from `listRecords`, `since` is inclusive, `Number.MAX_SAFE_INTEGER` round trip. The
  checks use `toEqual`. The table constraints (requirement 62) are tested only against Postgres in
  `test/store/postgres/constraints.test.ts`, because the memory store has no such rules.
- **`test/helpers/pg.ts`** exports `createTestDatabase(url)`: it creates a schema named `t_` plus random hex, opens a
  connection with `connection: { search_path }`, applies every file in `sql/`, and returns
  `{ sql, schema, drop() }`. `drop()` runs `drop schema ... cascade` and ends the connection. `search_path` as a startup
  parameter does not work through Neon's pooled connection, so `TEST_DATABASE_URL` must be a direct connection.
- **Postgres tests** are written as
  `const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;` with the suite name
  `PostgresStore contract (skipped: set TEST_DATABASE_URL to run)` when it is not set, so `vitest --reporter=verbose`
  says why they were skipped. `beforeEach` truncates the three tables.
- **No real network.** The sender tests pass a fake `fetch`; the Gemini reader is never built in route tests; the fake
  `fetch` throws if called with an unexpected URL.

## docs/run-the-demo.md (outline)

1. What you need: Node 22, a Neon account, a Vercel account, an Africa's Talking sandbox app.
2. Run locally: `npm ci`, copy `.env.example` to `.env`, `npm run dev`, open `http://localhost:3000`; what runs with no
   variables (memory store, rules only); a `curl` example for each of `/health`, `/api/phone/demo`, `/api/phone/sms`.
3. Run the tests: `npm test`; the Postgres tests with `TEST_DATABASE_URL` (a direct Neon connection or a local
   database); how to see the skipped message.
4. Neon: create a project, copy the connection string into your shell or `.env` (never into a tracked file), run
   `npm run db:migrate`, check the three tables. Use the pooled string for Vercel; use the direct one for
   `TEST_DATABASE_URL`.
5. Vercel: import the repository, leave the framework as Other, add `DATABASE_URL` (and optionally `GEMINI_API_KEY`,
   `AT_USERNAME`, `AT_API_KEY`, `AT_SHORTCODE`), pick a function region near the Neon region, deploy, then check
   `https://imali-ai-feature-phone.vercel.app/health`.
6. Africa's Talking sandbox: the USSD channel `*384*46254#` with callback
   `https://imali-ai-feature-phone.vercel.app/ussd`; the SMS short code `46254` with incoming-message callback
   `https://imali-ai-feature-phone.vercel.app/sms`; set `AT_USERNAME` to `sandbox` and `AT_API_KEY` to the sandbox app's key
   so replies go out from `46254` (`AT_SHORTCODE`); test in the simulator.
7. If something fails: what a plain error means, where the log is (Vercel runtime logs), the memory-store warning,
   and the checks for the first deploy (rewrite keeps the original path; `/health` answers).

## Open questions

1. **How the save key reaches `appendRecord`.** The `dialled-menu` spec is being written in parallel and I could not
   read it. This spec adds the mechanism (`AppendOptions.saveKey`, `DuplicateSaveError`, a unique index) and the key
   convention `ussd:<sessionId>`. If `dialled-menu` guards duplicates another way, tasks 2.1, 2.2 and 3.1 change
   with it. Until that spec lands, the guard is tested at store level only.
2. **`response` includes the prefix.** The design assumes `handleUssd` returns `CON ...` or `END ...` complete. The app
   checks this (requirement 17) rather than adding a prefix.
3. **"Menu input over 182".** Read as the latest input, the part of `text` after the last `*`. The whole `text` is
   bounded only by the 8,192-byte body cap. Reading it as the whole cumulative `text` would cut off long but valid
   sessions.
4. **`src/channels/index.ts` has two authors.** `text-messages` (last task) and `dialled-menu` both export from it.
   Whoever lands second must merge, not overwrite.
5. **`tech.md` lists five routes.** This spec adds `GET /api/ledger`, `POST /api/phone/demo` and `GET /health` (the
   brief asks for them); task 9.2 updates the steering file.

## Risks and known gaps

- **Vercel and the rewritten path.** Hono must see `/ussd`, not `/api`. Vercel keeps the original URL for rewrites to a
  function, but this is checked only on the first deploy (task 9.3). If it fails, the fallback is a `rewrites`-free
  layout with `api/ussd.ts`, `api/sms.ts` and `api/[...path].ts` that all export the same `handle(app)`.
- **Vercel and TypeScript.** The function imports `../src/server/bootstrap.js` where the file is `.ts`. Vercel compiles
  TypeScript for `api/`; if it cannot resolve the `.js` specifier, the fallback is to run `tsc` as the build command and
  import from `dist/`.
- **Africa's Talking callbacks are not signed**, so anyone who knows the URL can post to `/sms` and `/ussd`. The server
  never texts a demo number, and the sandbox sends no real messages, but a live account would need a secret in the
  callback path before it is used. Not done here.
- **Retries.** Africa's Talking can repeat an SMS callback; the text handler has no duplicate guard, so a repeat could
  save twice. Only the dialled menu has one (`saveKey`).
- **Demo shops are not capped in number.** Each costs 18 rows (the shop and 17 records). The 60-per-minute limit on `demo-create` is per
  instance.
- **The 2,000-record cap is check-then-insert** and can be passed by a few concurrent writes.
- **The rate limit is per instance** (requirement 46).
