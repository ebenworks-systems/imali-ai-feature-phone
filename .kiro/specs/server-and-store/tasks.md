# Server and Store Tasks

Each task names its files and the requirements it meets (numbers from `requirements.md`). Every module gets its
tests in the same task. Do the groups in order; inside a group, in order.

`handleUssd`, `handleText`, `PendingStore` and `GeminiReader` are all finished, so no task waits for another spec.
Route tests that check exactly what the app passes to a handler replace the handler with `vi.mock`; the whole-session
tests in group 7 use the real handlers.

Task 9.3 needed a person with a test database and has been done (it is ticked, with the date and the numbers). Task 9.4
needs a person with the Vercel and Neon accounts and stays unticked until that person has done it. Group 11 added later
fixes; its task 11.9 asks the same person to run the Postgres suites again for the new tests.

## 0. Before you start

- [x] 0.1 **Check what the other specs have delivered.** Read, do not change:
  `src/channels/index.ts` (exports `handleUssd` and `handleText`), `src/channels/sms/pending.ts` (exports
  `PendingStore`, `PendingQuestion`, `InMemoryPendingStore`), `src/channels/phone.ts` (exports `normalizePhone`),
  `src/ai/reader.ts` (exports `ModelReader`, `GeminiReader`, which takes `{ apiKey, model? }`),
  `src/store/interface.ts` (has `DuplicateRecordError` and `ShopAlreadyExistsError`) and how
  `src/channels/ussd/actions.ts` guards a repeated save (a record id made from the session, refused by the store).
  Write down anything missing; nothing is expected to be.
  - Files: none
  - Requirements: 14, 18, 51, 65

## 1. Dependencies and project files

- [x] 1.1 **Update `package.json` and `.gitignore`.** `npm install hono @hono/node-server postgres` and keep the
  `package-lock.json` in step. Rename the package to `imali-ai-feature-phone`, set `"private": true`, set
  `"engines": { "node": "22.x" }`, keep `hono` on the 4.x line (`^4.x.y`), and add the scripts `dev`, `start` and
  `db:migrate` as in the design. Point `main` and `types` at `dist/src/`. Add a line `.vercel` to `.gitignore`.
  `dependencies` holds only `hono`, `@hono/node-server` and `postgres`. A test reads `package.json` and `.gitignore`
  and checks each of these.
  - Files: `package.json`, `package-lock.json`, `.gitignore`, `test/server/package.test.ts`
  - Requirements: 6, 3, 96

- [x] 1.2 **Let the compiler see `api/`.** Set `rootDir` to `.` and `include` to `src/**/*` and `api/**/*`. The build
  output moves under `dist/src/`, so change the three imports and the file check in `scripts/check-screens.mjs` to
  `dist/src/channels/...`. Run `npm run typecheck`, `npm run build` and `npm run check:screens`; all three must pass.
  - Files: `tsconfig.json`, `scripts/check-screens.mjs`
  - Requirements: 5

- [x] 1.3 **List every variable in `.env.example`.** DATABASE_URL, GEMINI_API_KEY, GEMINI_MODEL, AT_USERNAME,
  AT_API_KEY, AT_SHORTCODE, AT_CALLBACK_KEY, PORT, TEST_DATABASE_URL, each `NAME=` with nothing after it.
  - Files: `.env.example`
  - Requirements: 11

## 2. Store interface, memory store, record cap, processed texts

- [x] 2.1 **Extend the store interface.** Add `countShopsWithPhonePrefix(prefix)` to `LedgerStore` and update the
  comments on `appendRecord` and `createShop` to say what the Postgres store must also do (id checked first;
  `DuplicateRecordError`; `ShopAlreadyExistsError` for the id or the phone). No new error classes: the two that the
  dialled menu uses are the guard.
  - Files: `src/store/interface.ts`
  - Requirements: 51, 52, 95

- [x] 2.2 **Teach `MemoryStore` the two missing rules.** `countShopsWithPhonePrefix`; `listRecords` returns a new array
  also when there is no `since`. Add tests to `test/store/memory/store.test.ts`: a returned array can be changed
  without changing the store, `generateExport` leaves the store's own order alone, and the count is right for a
  matching prefix, a prefix nobody has and the empty store. (Its duplicate-id and duplicate-phone behaviour is already
  tested there.)
  - Files: `src/store/memory/store.ts`, `test/store/memory/store.test.ts`
  - Requirements: 53, 95

- [x] 2.3 **Move the store checks into a shared contract.** Create `runLedgerStoreContract(label, harness)` holding the
  checks now in `test/store/memory/store.test.ts` plus: the same record id twice, a repeated reversal with the same id
  (`DuplicateRecordError`), a second reversal with a new id (`RecordAlreadyReversedError`), duplicate shop id and
  duplicate phone (`ShopAlreadyExistsError`), `countShopsWithPhonePrefix`, append order with equal time stamps, a new
  array from `listRecords`, inclusive `since`, `Number.MAX_SAFE_INTEGER` round trip. Every check creates its shop
  before it appends. The memory test file calls it with a harness that returns a new `MemoryStore`. The file is not
  named `*.test.ts`, so Vitest does not run it alone.
  - Files: `test/store/contract.ts`, `test/store/memory/store.test.ts`
  - Requirements: 75, 53, 51, 52, 95

- [x] 2.4 **Write the record cap.** `RecordLimitError` and `withRecordLimit(store, max)`; tests with a small `max`:
  the record that reaches the cap is refused with the error, other shops are not affected, reads and
  `countShopsWithPhonePrefix` pass through.
  - Files: `src/store/limit.ts`, `test/store/limit.test.ts`
  - Requirements: 47

- [x] 2.5 **Write the processed-text store (memory).** `ProcessedTextStore`, `TextClaim`, `PROCESSED_TEXT_TTL_MS` and
  `InMemoryProcessedTextStore`. Put the checks in `test/store/processed.ts` as `runProcessedTextContract(label, harness)`
  (not run alone) and call it from `test/store/processed.test.ts`: first claim is `new`; a second claim before `finish`
  is `working`; after `finish` it is `done` with the same reply; the same id from
  another phone is separate; two claims started together (`Promise.all`) give exactly one `new`; an entry 47 hours old is
  kept and one 49 hours old is deleted by the next claim (moving clock).
  - Files: `src/store/processed.ts`, `test/store/processed.ts`, `test/store/processed.test.ts`
  - Requirements: 85, 86, 87, 88, 89, 90

## 3. Postgres store

- [x] 3.1 **Write the migration.** Copy the schema from the design exactly, including the constraint and index names
  (`records_pkey`, `shops_pkey`, `shops_phone_unique`, `records_one_reversal_per_record`) and the `processed_texts`
  table. There is no save-key column.
  - Files: `sql/001_init.sql`
  - Requirements: 57, 60, 61, 62, 89

- [x] 3.2 **Write the migration script.** `applyMigrations(sql, dir)` is exported and returns the names it applied;
  the script runs it only when started directly. It creates `schema_migrations`, applies each unapplied file in name
  order inside `sql.begin`, prints `applied <name>` or `Nothing to apply.`, and exits 1 with a plain message when
  DATABASE_URL is empty, without printing its value. Add a test that starts the script with an empty environment and
  checks the exit code and that the output has no `postgres` URL. (The apply-twice check is in 3.7.)
  - Files: `scripts/migrate.mjs`, `test/scripts/migrate.test.ts`
  - Requirements: 57, 58, 59

- [x] 3.3 **Write the client.** `connectPostgres(url)` with `max: 3`, `prepare: false`, `connect_timeout: 10`,
  `idle_timeout: 20`, no notices; `closePostgres(sql)`. A test checks the options passed to `postgres` with `vi.mock`,
  so no connection is made.
  - Files: `src/store/postgres/client.ts`, `test/store/postgres/client.test.ts`
  - Requirements: 64, 54

- [x] 3.4 **Write `PostgresStore`: shops and row mapping.** `createShop` (maps `shops_pkey` and `shops_phone_unique` to
  `ShopAlreadyExistsError`), `findShopById`, `findShopByPhone`, `countShopsWithPhonePrefix`; `toSafeInt` that throws on
  a value that is not a safe integer; `rowToShop`. Unit-test `toSafeInt` and `rowToShop` without a database.
  - Files: `src/store/postgres/store.ts`, `test/store/postgres/mapping.test.ts`
  - Requirements: 54, 55, 56, 52, 61, 95

- [x] 3.5 **Write `PostgresStore`: records.** `appendRecord` as one `insert ... on conflict (id) do nothing returning id`
  (no row back means `DuplicateRecordError`; a `23505` on `records_one_reversal_per_record` means
  `RecordAlreadyReversedError`; `records_pkey` means `DuplicateRecordError`; any other error is rethrown), nulls for
  missing fields, `findRecordById`, `findReversalOf`, `listRecords` ordered by `seq`, `rowToRecord` for all five kinds
  with no `null` fields in the result. Unit-test `rowToRecord` for each kind and the error mapping with a fake
  `PostgresError`, and with a fake `sql` that returns no row, check that the id conflict becomes `DuplicateRecordError`.
  - Files: `src/store/postgres/store.ts`, `test/store/postgres/mapping.test.ts`
  - Requirements: 54, 55, 56, 51, 60, 61, 63, 53

- [x] 3.6 **Run the contract against Postgres.** `createTestDatabase(url)` in the test helper (throwaway schema,
  `connection: { options: '-c search_path=<schema>' }`, applies `sql/` through `applyMigrations`, `drop()`); `postgres/store.test.ts` calls
  `runLedgerStoreContract` with a harness that truncates the four tables and returns the store. When
  TEST_DATABASE_URL is not set, use `describe.skip` with the name
  `PostgresStore contract (skipped: set TEST_DATABASE_URL to run)`.
  - Files: `test/helpers/pg.ts`, `test/store/postgres/store.test.ts`
  - Requirements: 75, 76, 77, 78

- [x] 3.7 **Test the table rules and the migration against Postgres.** Same skip rule as 3.6. Cases: each
  constraint of requirement 62 refuses a bad insert; `applyMigrations` applied twice returns the names the first
  time and an empty list the second; the unique reversal index refuses a second reversal even if two inserts race
  (`Promise.all`); two simultaneous appends of the same record id leave one record and one `DuplicateRecordError`; a
  repeated reversal with the same id gives `DuplicateRecordError`, not `RecordAlreadyReversedError`.
  - Files: `test/store/postgres/constraints.test.ts`
  - Requirements: 57, 58, 60, 61, 62, 76

- [x] 3.8 **Write `PostgresPendingStore`.** `get`, `set` (upsert, deletes expired rows), `clear`;
  injected `now` and `ttlMs`; `createdAt` restored as a `Date`. Postgres tests (same skip rule): set then get equal,
  second `set` replaces, `clear`, expiry with a moving clock (9 minutes still there, 11 gone), expired rows deleted
  by `set`, an ambiguous question with `possibleAmounts` and a large-amount question both round-trip.
  - Files: `src/store/postgres/pending.ts`, `test/store/postgres/pending.test.ts`
  - Requirements: 65, 66, 67, 76

- [x] 3.9 **Write `PostgresProcessedTextStore`.** `claim` (delete old rows, insert on conflict do nothing, read the
  reply), `finish`; injected `now` and `ttlMs`. Unit-test with a fake `sql` that `claim` runs the insert and
  maps the three answers (`new`, `working`, `done`). Postgres tests (same skip rule) call
  `runProcessedTextContract` from 2.5 with a harness for Postgres.
  - Files: `src/store/postgres/processed.ts`, `test/store/postgres/processed.test.ts`
  - Requirements: 85, 86, 87, 88, 89, 90, 76

- [x] 3.10 **Export the Postgres parts.** `src/store/postgres/index.ts` exports `connectPostgres`, `closePostgres`,
  `PostgresStore`, `createPostgresStore`, `PostgresPendingStore`, `PostgresProcessedTextStore`.
  - Files: `src/store/postgres/index.ts`
  - Requirements: 54

## 4. Server helpers

- [x] 4.1 **Constants and phone helpers.** `constants.ts` as in the design; `isDemoPhone`, `maskPhone`,
  `clientAddress`, and `normalizePhone` re-exported from `src/channels/phone.ts` (do not write a second one).
  Tests: `+27 00 000 1234`, `+27-00-000-1234`, `27000001234`, `(+27) 00 000 1234` normalise; `abc`, `12`, a 16-digit
  number give `null`; `isDemoPhone` accepts `+27000001234` and refuses `+27000011234`, `+2700000123`,
  `+27000001234 5`, `+254711000000`; the mask never shows the middle digits; `clientAddress` takes the first entry of
  `x-forwarded-for` (`203.0.113.7, 10.0.0.1` gives `203.0.113.7`), falls back to `x-real-ip`, then to `unknown`, and
  treats a blank header as missing. Also a test that every sentence in `SENTENCES` is plain ASCII and shorter than
  100 characters.
  - Files: `src/server/constants.ts`, `src/server/phone.ts`, `test/server/phone.test.ts`
  - Requirements: 22, 27, 93

- [x] 4.2 **Rate limiter.** `createRateLimiter`. Tests with a movable clock: 60 allowed, the 61st refused with
  `retryAfterSeconds`, a refused call does not extend the window, calls are allowed again after the window, two keys
  are separate, expired keys are removed past 10,000 keys; and a limiter with `limit` 10 and a one-hour window behaves
  the same way (the demo limiter).
  - Files: `src/server/rateLimit.ts`, `test/server/rateLimit.test.ts`
  - Requirements: 45, 46, 92

- [x] 4.3 **Error helpers.** `ownerSentence`, `logError`. Tests: `RecordLimitError` gives the full sentence, anything else
  the generic one; `logError` writes one JSON line to `console.error` with the stack and a masked phone, and the line
  has no full phone number.
  - Files: `src/server/errors.ts`, `test/server/errors.test.ts`
  - Requirements: 48, 49

- [x] 4.4 **Africa's Talking sender.** `africasTalkingHost`, `createAfricasTalkingSender`. Tests with a fake `fetch`: URL
  and host for `sandbox` and for another username, the `apiKey` and `Accept` headers, the form body fields
  (`from` is the short code), a 500 answer throws, a recipient with `statusCode` 403 throws, a never-ending fetch is
  aborted by the timeout (use a short `timeoutMs`), and no thrown message contains the key. Use the fake key
  `test-key-not-real`.
  - Files: `src/server/sender.ts`, `test/server/sender.test.ts`
  - Requirements: 68, 69, 70, 71, 78

- [x] 4.5 **Config.** `readConfig`, `readPort`, `ConfigError`. Tests: blank and spaces count as unset; both AT variables
  give `at` with shortcode `46254`, `AT_SHORTCODE` overrides it; only one AT variable gives no `at` and a warning
  that names the missing one and contains no value; `GEMINI_MODEL` is read; `AT_CALLBACK_KEY` is read and trimmed;
  `VERCEL` without DATABASE_URL adds the memory warning; PORT `3000`, unset, `0`, `70000`, `abc` and `3000.5` behave
  as in requirement 4.
  - Files: `src/server/config.ts`, `test/server/config.test.ts`
  - Requirements: 4, 8, 9, 10, 11, 13, 82

- [x] 4.6 **Ledger view for the side panel.** `buildLedgerView`. Tests with `MemoryStore` and the demo records: today's
  figures, `date`, owes limited to 20 with `more`, last 20 records newest first, `reversed` flag, a negative money
  in hand formats with `-`, every `text` is ASCII.
  - Files: `src/server/views.ts`, `test/server/views.test.ts`
  - Requirements: 28, 29, 30

- [x] 4.7 **Demo data.** `buildDemoShop`, `buildDemoRecords` from the table in the design. Tests: 17 records in append
  order; times never decrease and none is after `now`; today's records fall on today's local date at 00:05, 12:00 and
  23:59 local; earlier records fall on the two days before; Tendai R20, Rudo R30, Sipho R25 owed and today's sales R195
  after the reversal is applied; the phone, names and numbers are the invented ones; the shop name is at most 24
  characters.
  - Files: `src/server/demo.ts`, `test/server/demo.test.ts`
  - Requirements: 35, 38

- [x] 4.8 **Callback key check.** `keyMatches(given, expected)`: hashes both with SHA-256 and compares the digests with
  `crypto.timingSafeEqual`. Tests: equal keys match; a different key, a key that differs in the last character, an
  empty string, `undefined` and a longer or shorter key do not; `crypto.timingSafeEqual` is called (spy) even when
  `given` is `undefined`.
  - Files: `src/server/callbackKey.ts`, `test/server/callbackKey.test.ts`
  - Requirements: 82, 83

## 5. The app and its routes

In this group, route tests use `app.request()`, `MemoryStore`, `InMemoryPendingStore`, `InMemoryProcessedTextStore` and
the fixed clock, and replace the two handlers with `vi.mock` so they check exactly what the app passes in and out.

- [x] 5.1 **App skeleton.** `createApp`: record cap wrapper, default clock, body limit, `no-store` on `/api/*`,
  `GET /health`, `onError`, `notFound`, the shared `refuse` helper that picks JSON or text from the path. Tests:
  `/health` answers `{"ok":true}` and does not touch the store (a store whose methods throw); a 9 KB body gets 413 on
  `/ussd`, `/sms` and `/api/phone/sms`; an unknown path gets 404 in JSON under `/api/` and as text elsewhere; `no-store`
  is on every `/api/*` answer; `createApp` with an empty `process.env` still works.
  - Files: `src/server/app.ts`, `test/server/health.test.ts`, `test/server/app.test.ts`
  - Requirements: 1, 2, 34, 40, 44, 49, 50

- [x] 5.2 **The callback key guard.** In `createApp`, when `callbackKey` is set, a guard on `/ussd` and `/sms` before the
  body limit. Tests (`routes.key.test.ts`, handlers mocked): with the key set, `POST /ussd` and `POST /sms` with
  `?k=<key>` reach the handler; with no `k`, a wrong `k`, an empty `k` and a key of another length each get 403
  `text/plain` with the plain sentence, and the handler, the store, the processed-text store and the sender (all spies
  or throwing fakes) are not called; the 403 comes before the body is read (a 9 KB body without the key gets 403, not
  413); the 403 body does not contain the key; with no key set, both routes answer without `k`; a key of only spaces
  counts as not set; `/health`, `/api/phone/sms` and the other browser routes never need the key.
  - Files: `src/server/app.ts`, `test/server/routes.key.test.ts`
  - Requirements: 82, 83, 84

- [x] 5.3 **`POST /ussd`.** Form parsing, the checks and the call to `handleUssd` as in the design.
  Tests: the handler receives `sessionId`, `serviceCode`, the normalised phone, `text`, the fixed `now` and the
  store; the answer is 200 `text/plain` with the handler's `response`; a missing `text` becomes `''`; each missing
  field gives 400 without a handler call; a phone `+254711000000` is accepted; an input of 183 characters after the
  last `*` gives 200 `END ...` without a handler call, and 182 goes through; a long `text` made of short inputs goes
  through; a response without `CON ` or `END ` becomes the generic `END` sentence and is logged.
  - Files: `src/server/routes/at.ts`, `test/server/routes.at.test.ts`
  - Requirements: 14, 15, 16, 17, 22, 41

- [x] 5.4 **`POST /sms`.** Form parsing, the call to `handleText`, the sender. Tests: the handler
  receives `phone`, `text`, `now`, the store, the pending store and the reader (pass a fake reader); the answer is
  200 `text/plain` with the reply; a missing `from` or `text` gives 400; text of 481 characters gets the "too long"
  reply without a handler call and that reply is also sent; with a fake sender the reply is sent to `from` once; with
  a demo `from` nothing is sent; a sender that throws still gives 200 with the reply and one log line; with no sender
  nothing happens.
  - Files: `src/server/routes/at.ts`, `test/server/routes.at.test.ts`
  - Requirements: 18, 19, 20, 21, 22, 42

- [x] 5.5 **Repeated text callbacks.** In `POST /sms`: claim `(from, id)`, answer `done` and `working` without the
  handler, `finish` before the send, the error sentence stored when the handler throws. Tests (in `routes.at.test.ts`, handler
  mocked): the same `from` and `id` posted twice calls `handleText` once, sends one text, and answers the second time
  with the first reply, even when the mock would now return something else; a different `id` runs again; the same `id`
  from another number runs again; two posts started together (`Promise.all`) call the handler once; a post whose
  handler is still waiting (a promise the test settles later) makes a second post answer the "working" sentence with
  no handler call and no send; a handler that throws gives the error sentence, which is stored, so a second post gets the
  same sentence and the handler runs once (a claim is never forgotten); a failing `finish` is logged and the reply is
  still answered and sent; a failing sender does not stop the stored reply (a repeat is still answered from it); a missing `id`, an `id` of 101 characters and an `id` with a space are handled
  without a claim (two posts call the handler twice); a text of 481 characters makes no claim;
  `POST /api/phone/sms` makes no claim.
  - Files: `src/server/routes/at.ts`, `test/server/routes.at.test.ts`
  - Requirements: 85, 86, 87, 88, 89, 91

- [x] 5.6 **Browser guard and `POST /api/phone/ussd`.** `guardPhone` and the route in
  `routes/browser.ts`. Tests: a valid call gives `{ response, length, limit: 182 }` with `length` counted after
  the prefix; the handler gets `serviceCode` `*384*46254#`; no `sessionId` gives a new id each call, and a given
  one is passed on; no `text` gives `''`; a non-JSON body, a JSON array, a number `phone` and a number `text` each
  give 400 `{ error }`; `+254711000000`, `+2700000123`, `+27 00 001 1234` and a missing phone each give 400 with the
  demo-number sentence and no store call (a store whose methods throw); `+27 00 000 1234` is accepted; an input of
  183 characters after the last `*` gives 400.
  - Files: `src/server/routes/browser.ts`, `test/server/routes.phone.test.ts`
  - Requirements: 23, 24, 26, 27, 43

- [x] 5.7 **`POST /api/phone/sms`.** Tests: a valid call gives `{ reply, length, limit: 160 }`; the
  sender is never called, even when one is set; text of 481 characters gives 400; the demo-number check and the shape
  checks of 5.6 apply.
  - Files: `src/server/routes/browser.ts`, `test/server/routes.phone.test.ts`
  - Requirements: 25, 26, 27, 43

- [x] 5.8 **`GET /api/ledger`.** Tests: a seeded shop gives the shape in the design with `{ cents, text }` money; no shop
  gives 404; a non-demo number gives 400; a missing `phone` gives 400.
  - Files: `src/server/routes/browser.ts`, `test/server/routes.ledger.test.ts`
  - Requirements: 28, 29, 30, 31, 27

- [x] 5.9 **`GET /api/export`.** Tests: the body parses as JSON with `format` `imali-ai-ledger-export`, `version` 1,
  `exportedAt` equal to the fixed clock, the shop and all records including the reversal; the three headers are exact
  (filename uses the digits of the phone and the UTC date); the body is indented; the order of records in the store
  is unchanged afterwards; no shop gives 404; a non-demo number gives 400.
  - Files: `src/server/routes/browser.ts`, `test/server/routes.export.test.ts`
  - Requirements: 31, 32, 33, 27

- [x] 5.10 **`POST /api/phone/demo`.** Tests: no body, `{}` and an empty string body each create a shop with a demo
  number and 17 records and answer 201; a given free demo number is used; a given number that has a shop gives 409 and
  leaves the records as they were; a non-demo number gives 400; a store where every `findShopByPhone` finds a shop
  gives 503 after 20 tries; the new shop works with `GET /api/ledger`; the demo shop's own records pass through the
  record cap.
  - Files: `src/server/routes/browser.ts`, `test/server/routes.demo.test.ts`
  - Requirements: 35, 36, 37, 38, 39

- [x] 5.11 **Demo shop limits.** Per-address limit and the 5,000-shop cap on `POST /api/phone/demo`. Tests (in
  `routes.demo.test.ts`; shrink the cap with `demoLimits` where a test needs a small number): the 10th call from
  `x-forwarded-for: 203.0.113.7` passes and the 11th gets 429 with `Retry-After` in seconds and the plain sentence;
  the refused call does not extend the window; another address is not affected; the first entry of
  `203.0.113.7, 10.0.0.1` is the address (so `203.0.113.7, 10.0.0.2` counts for the same one); after the clock moves
  61 minutes the address works again; calls with a phone number and calls that end in 409 count; a call with no
  `x-forwarded-for` counts under `unknown`; a refused call makes no store call (a throwing store); with the cap at 3
  and three demo shops in the store, the next call gets 503 with the plain sentence and no shop is created; a shop that
  is not a demo number is not counted; at 2 of 3 the call succeeds.
  - Files: `src/server/routes/browser.ts`, `test/server/routes.demo.test.ts`
  - Requirements: 92, 93, 94, 95

- [x] 5.12 **Limits and error answers through the routes.** Tests in `limits.test.ts`: 60 calls to
  `/api/phone/sms` from one number pass and the 61st gets 429 with `Retry-After`; another number is not affected;
  after the clock moves 61 seconds the number works again; the five browser routes share one count; two
  `/api/phone/demo` calls with no phone share the `demo-create` key; the Africa's Talking routes are not limited; a
  shop seeded with 2,000 records refuses the next record: `/sms` and `/api/phone/sms` show the "shop book is full"
  sentence, and `/ussd` and `/api/phone/ussd` show the menu's own plain `END Sorry, something went wrong.` screen
  (the menu catches the error itself); nothing is saved (use the real handlers). Tests in `errors.routes.test.ts`: a store that throws
  `Error('connection to db.internal:5432 failed password authentication')` gives the plain sentence in each of the
  three shapes (`/ussd`, `/sms`, `/api/*`), the response body and headers contain neither the message nor `at ` stack
  lines, and `console.error` received both.
  - Files: `test/server/limits.test.ts`, `test/server/errors.routes.test.ts`, `src/server/app.ts`
  - Requirements: 45, 46, 47, 48, 49, 74, 72

## 6. Entry points

- [x] 6.1 **`createAppFromEnv`.** Builds the parts as in the design and returns
  `{ app, parts, summary, warnings, close }`. Tests with a fake env: nothing set gives `MemoryStore`,
  `InMemoryPendingStore`, `InMemoryProcessedTextStore`, no reader, no sender, no callback key, `summary`
  `store=memory gemini=off sms=off callback=open`; `GEMINI_API_KEY` gives a `GeminiReader`; `GEMINI_MODEL` without
  `GEMINI_API_KEY` gives no reader; `GEMINI_MODEL` with the key reaches the reader (the reader's request URL, seen
  through a fake `fetch`, names the model); both AT variables give a sender, `AT_USERNAME=sandbox` is reported as
  `sms=sandbox` and sends to the sandbox host with `from` `46254`, `AT_SHORTCODE` changes `from`; the callback key
  from `AT_CALLBACK_KEY` closes `/sms` (403 without `k`); the summary and warnings never contain a value;
  `DATABASE_URL` set gives Postgres parts (mock `src/store/postgres/index.js` so no connection is made) and `close()`
  ends the pool; `VERCEL` without `DATABASE_URL` adds the warning.
  - Files: `src/server/bootstrap.ts`, `test/server/bootstrap.test.ts`
  - Requirements: 7, 8, 9, 10, 12, 13, 82

- [x] 6.2 **Node entry.** `createNodeApp` adds `serveStatic` after the routes; `main.ts` reads the port, serves with
  `@hono/node-server`, logs the summary and warnings, and closes on SIGINT and SIGTERM. A bad PORT prints the message
  and exits 1. Tests for `createNodeApp` with a temporary `public/` folder: `/` returns `index.html`; `/style.css`
  returns the file; an API route still wins over a file of the same name; an unknown GET gets 404.
  - Files: `src/server/node.ts`, `src/server/main.ts`, `test/server/node.test.ts`
  - Requirements: 3, 4, 50

- [x] 6.3 **Vercel entry.** `api/index.ts` and `vercel.json` as in the design. Run `npm run typecheck`.
  A test reads `vercel.json` and checks that the four rewrites exist, `outputDirectory` is `public`, and no
  rewrite sends a path to a file outside `api/`.
  - Files: `api/index.ts`, `vercel.json`, `test/server/vercel.test.ts`
  - Requirements: 5

## 7. Whole conversations through HTTP

- [x] 7.1 **A USSD session.** Through `POST /ussd`, step by step with a fixed `sessionId`: first dial
  shows the sign-up and then the main menu with today's figure; record a sale and confirm; check the saved line; open
  "Who owes"; undo; close the day. Send the confirming request twice and check that one record exists. Repeat the
  session through `POST /api/phone/ussd` with a demo number. Check every screen: starts `CON ` or `END `, at most 182
  characters after the prefix, ASCII only. Use the steps `dialled-menu` defines.
  - Files: `test/server/conversation.test.ts`
  - Requirements: 73, 72

- [x] 7.2 **A text conversation.** Through `POST /sms` from a new number (welcome, shop name), then
  `sold 3 bread 45`, `Tendai owes 20 sugar`, `Tendai paid 10`, `who owes`, `today`, `undo`, `gibberish`, `sold 2 200`
  then `1`; repeat a shorter run through `POST /api/phone/sms` with a demo number. Every reply is at most 160
  characters and ASCII. Add the cases: the same `sold 3 bread 45` posted twice with one `id` saves one sale and gives
  the same reply; a shop with 2,000 records and the text `sold 45 bread` gets a plain sentence.
  - Files: `test/server/conversation.test.ts`
  - Requirements: 73, 47, 72, 86

## 8. Documents

- [x] 8.1 **Write `docs/run-the-demo.md`.** Follow the outline in the design (seven sections). Use the real URLs
  `https://imali-ai-feature-phone.vercel.app/ussd` and `.../sms`, the code `*384*46254#` and the short code `46254`.
  Explain `AT_CALLBACK_KEY` and the `?k=` form of both addresses with the placeholder `<AT_CALLBACK_KEY>`.
  Show variables as names only, never a value or a connection string. Use only invented demo numbers
  (`+27000001234`). Keep sentences short.
  - Files: `docs/run-the-demo.md`
  - Requirements: 79, 80, 81

## 9. Wrap-up

- [x] 9.1 **Run all the checks.** `npm run typecheck`, `npx vitest run` (the Postgres suites show as skipped with
  their message when TEST_DATABASE_URL is not set), `npm run check:screens`, `npm run build`. Search the repository for
  a key or a connection string with `node scripts/secret-scan.mjs` and a search for `postgres://` in docs and tests.
  Confirm no test reaches the network: check that no test file calls the real `fetch`.
  - Files: none
  - Requirements: 72, 76, 78, 81

- [x] 9.2 **Make the steering file match.** Add `GET /api/ledger`, `POST /api/phone/demo` and `GET /health` to the
  Routes list in `.kiro/steering/tech.md`, and add `GEMINI_MODEL`, `AT_SHORTCODE`, `AT_CALLBACK_KEY`, `PORT` and
  `TEST_DATABASE_URL` to the line that names the environment variables.
  - Files: `.kiro/steering/tech.md`
  - Requirements: 11

- [x] 9.3 **Run the Postgres suites (done by a person with a test database).** With TEST_DATABASE_URL set to a direct
  (not pooled) Neon or local database the tests may use, run `npx vitest run test/store` and check that the suites are
  not skipped and pass.
  - Run 7 Nov 2026 against a Neon test branch: 90 test files, 1,895 tests passed, none skipped.
  - Files: none
  - Requirements: 75, 76, 77

- [ ] 9.4 **Check the first deploy (done by a person with the Vercel and Neon accounts).** With the variables set on
  Vercel and `npm run db:migrate` run against Neon: `GET /health` answers; `POST /api/phone/demo` creates a shop; the
  rows are in Neon; `POST /ussd` with form fields answers `CON ...`; with `AT_CALLBACK_KEY` set, `POST /ussd` without
  `?k=` answers 403 and with it answers `CON ...`; the Vercel runtime log shows the start line
  (`store=postgres ...`) and no secret; a request to `/sms` reaches the function with the path `/sms` (the rewrite
  keeps the original path). If a check fails, use the fallbacks in the design's Risks section. Then dial
  `*384*46254#` in the Africa's Talking simulator and send a text to `46254`.
  - Files: none
  - Requirements: 5, 12, 80, 82

## 10. Fixes

- [x] 10.1 **Keep the Postgres suites out of `public` on Neon.** Neon's proxy drops the `search_path` start-up
  parameter, so `show search_path` gave `"$user", public`, migrations looked applied and parallel suites raced on
  `create table`. `test/helpers/pg.ts` now sends `connection: { options: '-c search_path=<schema>' }`, and
  `assertSearchPath` reads `show search_path` right after connecting and throws, before any migration, unless it is
  exactly the suite's schema (the helper then drops the empty schema it made). The helper comment and
  `docs/run-the-demo.md` say so. `src/store/postgres` is unchanged. Tests: `test/helpers/pg.test.ts` (fake
  `postgres`, no database needed; fails on the old helper). The Postgres suites themselves still need task 9.3.
  - Files: `test/helpers/pg.ts`, `test/helpers/pg.test.ts`, `docs/run-the-demo.md`
  - Requirements: 97, 77

- [x] 10.2 **Add a contract test between the server and the page.** The page and the server were built from two
  specs in parallel. Run together, the dialled menu, the text messages and the export worked, but the page read
  `chars` where the routes send `length`, and it read a ledger shape (`whoOwes`, `today.spent`, plain numbers,
  `customerDisplayName`) that is not the documented one. No test could see it: the route tests mock the handlers and
  the page tests use answers its author wrote. The new test builds the real app with `createApp` and the memory stores,
  makes a demo shop, sends a sale through `/api/phone/ussd` and a debt and an undo through `/api/phone/sms`, and
  passes the real answers through the page's `readLedger`, `parseUssdReply` and `parseSmsReply`. The server is
  unchanged: it was right, and the page was changed to read it (browser-phone tasks 56 to 60).
  - Files: `test/integration/page-contract.test.ts`
  - Requirements: 23, 25, 28, 29, 30, 98

- [x] 10.3 **Give the Postgres tests time.** Against a remote database one test took 5.6 s against vitest's default of
  5 s. `describePostgres` in `test/helpers/pg.ts` now gives its tests 30 s and its hooks 60 s, so the tests themselves
  stay unchanged. `test/helpers/pg-timeout.test.ts` checks the number the test gets (fake `postgres`, no database).
  `test/scripts/migrate.test.ts` uses a fake client and never connects, so it needed no change; the migration test that
  uses a database is in `test/store/postgres/constraints.test.ts` and is built on `describePostgres`.
  - Files: `test/helpers/pg.ts`, `test/helpers/pg-timeout.test.ts`
  - Requirements: 99

## 11. Fixes after the second review (before the live demo went public)

A second reviewer read the code and found six faults, each confirmed, plus one small item. Each fix has a test that
fails on the code as it was and passes now. The Postgres-only parts could not be run in the session that made them
(TEST_DATABASE_URL was not set); task 11.9 is for that.

- [x] 11.1 **The browser routes no longer make shops.** `POST /api/phone/ussd` and `POST /api/phone/sms` look the shop up
  after the shape, number and length checks; a demo number with no shop gets 404 `No demo shop on this number. Press
  Start demo shop.` before any handler runs, and nothing is written. The handlers get `withoutShopCreation(store)`, so even
  a shop cleared away between the check and the handler cannot be signed up again. Only `POST /api/phone/demo` makes
  shops. The page returns quietly to the first-visit state on this 404 (browser-phone task 64). `docs/judges.md` and
  `docs/run-the-demo.md` say so. Tests: `test/server/routes.noshop.test.ts` ("A*1", "hi" then a name, 100 numbers, the
  vanishing shop), `test/integration/page-contract.test.ts`; `makeShopApp` in `test/server/helpers.ts` seeds a shop for
  the older route tests.
  - Files: `src/server/routes/browser.ts`, `src/server/constants.ts`, `src/store/limit.ts`, `test/server/routes.noshop.test.ts`, `test/server/helpers.ts`, `docs/judges.md`, `docs/run-the-demo.md`
  - Requirements: 100, 101

- [x] 11.2 **Demo shops expire.** `LedgerStore.deleteExpiredDemoShops(createdBefore, maxShops)` on both stores
  (`src/store/demo.ts` holds what a demo number is; Postgres: one transaction, `for update`, the demo test in SQL twice,
  pending questions, records by `shop_id`, shops). `POST /api/phone/demo` calls it with now minus 7 days and 200 shops
  before the cap check; a failure is logged and does not stop the call. In the terms of the records rules this is
  housekeeping of invented data, not an edit of a record (requirement 102); no code path deletes a single record or a
  non-demo shop (a test scans the source). Tests: the store contract in `test/store/contract.ts` (memory, and Postgres
  when it runs), `test/store/postgres/housekeeping.test.ts` (fake `sql`: one transaction, statements and values),
  `test/server/housekeeping.test.ts`. A non-demo shop of any age, and shapes that only look like a demo number, are kept.
  - Files: `src/store/demo.ts`, `src/store/interface.ts`, `src/store/memory/store.ts`, `src/store/postgres/store.ts`, `src/store/limit.ts`, `src/server/routes/browser.ts`, tests as above
  - Requirements: 102, 103, 104, 105

- [x] 11.3 **Limits per client address.** (a) `clientAddress` reads `x-real-ip`, then the last `x-forwarded-for` entry, then
  `unknown`. (b) Every browser route counts 120 a minute per address (middleware in `createApp`, before the body limit).
  (c) The demo-create limit (10 an hour per address) and a ceiling of 1,000 demo shops a day are kept in a `DemoQuotaStore`
  (`src/store/quota.ts` and `postgres/quota.ts`), keyed by `addressKey(address, salt)` (`src/server/address.ts`), with
  the new migration `sql/002_demo_quota.sql`; ADDRESS_SALT (default: a fixed built-in salt, start line `salt=default`) is in
  `.env.example` and `docs/run-the-demo.md`. (d) `withReaderLimit` caps model-reader calls at 200 an hour per instance.
  Tests: `test/server/phone.test.ts`, `limits.address.test.ts`, `routes.demo.test.ts`, `bootstrap.test.ts`,
  `config.test.ts`, `test/store/quota.ts` with `quota.test.ts` (memory) and `postgres/quota.test.ts` (Postgres, plus a
  fake-`sql` test and a test of the migration file).
  - Files: `src/server/phone.ts`, `src/server/address.ts`, `src/server/app.ts`, `src/server/context.ts`, `src/server/readerLimit.ts`, `src/server/config.ts`, `src/server/bootstrap.ts`, `src/server/routes/browser.ts`, `src/store/quota.ts`, `src/store/postgres/quota.ts`, `src/store/postgres/index.ts`, `sql/002_demo_quota.sql`, `.env.example`, `docs/run-the-demo.md`, tests as above
  - Requirements: 92, 93, 94, 106, 107, 108, 109, 110, 111

- [x] 11.4 **Africa's Talking callbacks closed without a key.** `readConfig` sets `callbacksMissingKey` when AT_USERNAME and
  AT_API_KEY are set and AT_CALLBACK_KEY is not; `createApp({ refuseCallbacks })` then answers 503 on `/ussd` and `/sms`
  before the body; the start line says `callback=missing-key`; browser routes and `/health` work. With no sender they stay
  open. `/ussd` and `/sms` are limited per address (300 a minute) and per phone number (30 a minute), and
  `withShopLimit(store, 2000)` caps shops that are not demo shops (`ShopLimitError`, owner sentence `shopsFull`). The key
  is still compared by `keyMatches` in constant time, and the check comes first. Tests: `test/server/routes.closed.test.ts`,
  `bootstrap.test.ts`, `config.test.ts`, `test/store/limit.test.ts`.
  - Files: `src/server/app.ts`, `src/server/config.ts`, `src/server/bootstrap.ts`, `src/server/routes/at.ts`, `src/server/errors.ts`, `src/server/constants.ts`, `src/store/limit.ts`, tests as above
  - Requirements: 112, 113, 114, 115

- [x] 11.5 **The shop found by id.** See `dialled-menu` task 34. Tested through `POST /ussd` with two phones and one session id
  in `test/server/routes.closed.test.ts`.
  - Files: `test/server/routes.closed.test.ts`
  - Requirements: 117

- [x] 11.6 **The item in "sold 45 3 bread".** See `text-messages` fixes. The browser route and `/sms` pass the pending question
  through the existing pending stores unchanged (Postgres keeps the whole intent as JSON, so `item` is kept).
  - Files: none in this spec
  - Requirements: none new

- [x] 11.7 **Skip link and intro text.** The skip link is in `browser-phone` task 65. The intro of this file said 9.3 and 9.4
  stay unticked; 9.3 was ticked on 7 Nov 2026, so the intro now says so.
  - Files: `.kiro/specs/server-and-store/tasks.md`
  - Requirements: none

- [x] 11.8 **Steering and docs match.** `.kiro/steering/tech.md` lists ADDRESS_SALT and the new route behaviour;
  `docs/run-the-demo.md` has the new limits, the 503, the variable, the second migration and the new start line;
  `docs/judges.md` says only the start buttons make a demo shop and that demo shops are cleared away after about a week.
  - Files: `.kiro/steering/tech.md`, `docs/run-the-demo.md`, `docs/judges.md`
  - Requirements: 110

- [x] 11.9 **Run the Postgres suites again (done by a person with a test database).** With TEST_DATABASE_URL set to a direct
  Neon or local database, run `npx vitest run test/store test/scripts` and check that the suites are not skipped and pass. The new
  parts that only a real database can check: `deleteExpiredDemoShops` in the store contract (reversals, foreign keys,
  `for update`), the `demo_quota` table rules and `claimCall` with eight simultaneous claims (advisory lock), the
  migration applying `002_demo_quota.sql` after `001_init.sql`, and `hashtextextended` (PostgreSQL 11 or later). Then run
  `npm run db:migrate` against the live database before the next deploy, because the app now reads `demo_quota`.
  - Run 7 Nov 2026 against a Neon test branch: 99 test files, 2,098 tests passed, none skipped.
  - Files: none
  - Requirements: 104, 108, 109
