# Server and Store Tasks

Each task names its files and the requirements it meets (numbers from `requirements.md`). Every module gets its
tests in the same task. Do the groups in order; inside a group, in order.

Three pieces come from other specs and may not exist yet. Tasks marked **[needs handlers]**, **[needs pending]** or
**[needs reader]** wait for them. Do not write stand-ins for them; do the tasks that do not need them first.

## 0. Before you start

- [ ] 0.1 **Check what the other specs have delivered.** Read, do not change:
  `src/channels/index.ts` (exports `handleUssd`), `src/channels/sms/handler.ts` (exports `handleText`),
  `src/channels/sms/pending.ts` (exports `PendingStore`, `PendingQuestion`, `InMemoryPendingStore`),
  `src/ai/reader.ts` (exports `ModelReader`, `GeminiReader`). Write down which are missing.
  - Files: none
  - Requirements: 14, 18, 65 (their entry points)
  - Blocked by a missing piece: 3.8 [needs pending], 5.2 to 5.5 and 5.9 [needs handlers], 6.1 [needs pending, reader],
    6.3, 7.1 and 7.2 [needs handlers].

## 1. Dependencies and project files

- [ ] 1.1 **Add the three dependencies and the scripts.** `npm install hono @hono/node-server postgres`; add
  scripts `dev`, `start` and `db:migrate` as in the design; keep `package-lock.json` in step.
  - Files: `package.json`, `package-lock.json`
  - Requirements: 6, 3

- [ ] 1.2 **Let the compiler see `api/`.** Set `rootDir` to `.` and `include` to `src/**/*` and `api/**/*`. Run
  `npm run typecheck` and `npm run build`; both must still pass, and the build output must be under `dist/src/`.
  - Files: `tsconfig.json`
  - Requirements: 5

- [ ] 1.3 **List every variable in `.env.example`.** DATABASE_URL, GEMINI_API_KEY, AT_USERNAME, AT_API_KEY,
  AT_SHORTCODE, PORT, TEST_DATABASE_URL, each `NAME=` with nothing after it.
  - Files: `.env.example`
  - Requirements: 11

## 2. Store interface, memory store, record cap

- [ ] 2.1 **Extend the store interface.** Add `AppendOptions`, the optional second argument of `appendRecord`,
  `DuplicateSaveError` and `ShopPhoneTakenError` (with `name` set, as `RecordAlreadyReversedError` does), and update
  the comments. Re-export the two errors from `src/core/index.ts` next to `RecordAlreadyReversedError`.
  - Files: `src/store/interface.ts`, `src/core/index.ts`
  - Requirements: 51, 52, 53

- [ ] 2.2 **Teach `MemoryStore` the new rules.** `saveKey` per shop throws `DuplicateSaveError` and keeps the first
  record; `createShop` with a taken phone throws `ShopPhoneTakenError` and keeps the first shop; `listRecords`
  returns a new array. Add tests for each to `test/store/memory/store.test.ts`.
  - Files: `src/store/memory/store.ts`, `test/store/memory/store.test.ts`
  - Requirements: 51, 52, 53

- [ ] 2.3 **Move the store checks into a shared contract.** Create `runLedgerStoreContract(label, harness)` holding the
  checks now in `test/store/memory/store.test.ts` plus: duplicate phone, `saveKey`, append order with equal time
  stamps, a new array from `listRecords`, inclusive `since`, `Number.MAX_SAFE_INTEGER` round trip. The memory test
  file calls it with a harness that returns a new `MemoryStore`. The file is not named `*.test.ts`, so Vitest does
  not run it alone.
  - Files: `test/store/contract.ts`, `test/store/memory/store.test.ts`
  - Requirements: 75, 53, 51, 52

- [ ] 2.4 **Write the record cap.** `RecordLimitError` and `withRecordLimit(store, max)`; tests with a small `max`:
  the record that reaches the cap is refused with the error, other shops are not affected, `options` pass through,
  reads pass through.
  - Files: `src/store/limit.ts`, `test/store/limit.test.ts`
  - Requirements: 47

## 3. Postgres store

- [ ] 3.1 **Write the migration.** Copy the schema from the design exactly, including the constraint and index names.
  - Files: `sql/001_init.sql`
  - Requirements: 57, 60, 61, 62

- [ ] 3.2 **Write the migration script.** `applyMigrations(sql, dir)` is exported and returns the names it applied;
  the script runs it only when started directly. It creates `schema_migrations`, applies each unapplied file in name
  order inside `sql.begin`, prints `applied <name>` or `Nothing to apply.`, and exits 1 with a plain message when
  DATABASE_URL is empty, without printing its value. Add a test that starts the script with an empty environment and
  checks the exit code and that the output has no `postgres` URL. (The apply-twice check is in 3.7.)
  - Files: `scripts/migrate.mjs`, `test/scripts/migrate.test.ts`
  - Requirements: 57, 58, 59

- [ ] 3.3 **Write the client.** `connectPostgres(url)` with `max: 3`, `prepare: false`, `connect_timeout: 10`,
  `idle_timeout: 20`, no notices; `closePostgres(sql)`. A test checks the options passed to `postgres` with `vi.mock`,
  so no connection is made.
  - Files: `src/store/postgres/client.ts`, `test/store/postgres/client.test.ts`
  - Requirements: 64, 54

- [ ] 3.4 **Write `PostgresStore`: shops and row mapping.** `createShop` (maps `shops_phone_unique` to
  `ShopPhoneTakenError`), `findShopById`, `findShopByPhone`; `toSafeInt` that throws on a value that is not a safe
  integer; `rowToShop`. Unit-test `toSafeInt` and `rowToShop` without a database.
  - Files: `src/store/postgres/store.ts`, `test/store/postgres/mapping.test.ts`
  - Requirements: 54, 55, 56, 52, 61

- [ ] 3.5 **Write `PostgresStore`: records.** `appendRecord` (nulls for missing fields, error mapping by constraint
  name, any other error rethrown), `findRecordById`, `findReversalOf`, `listRecords` ordered by `seq`, `rowToRecord`
  for all five kinds with no `null` fields in the result. Unit-test `rowToRecord` for each kind and the error
  mapping with a fake `PostgresError`.
  - Files: `src/store/postgres/store.ts`, `test/store/postgres/mapping.test.ts`
  - Requirements: 54, 55, 56, 60, 61, 63, 53

- [ ] 3.6 **Run the contract against Postgres.** `createTestDatabase(url)` in the test helper (throwaway schema,
  `connection: { search_path }`, applies `sql/` through `applyMigrations`, `drop()`); `postgres/store.test.ts` calls
  `runLedgerStoreContract` with a harness that truncates the three tables and returns the store. When
  TEST_DATABASE_URL is not set, use `describe.skip` with the name
  `PostgresStore contract (skipped: set TEST_DATABASE_URL to run)`.
  - Files: `test/helpers/pg.ts`, `test/store/postgres/store.test.ts`
  - Requirements: 75, 76, 77, 78

- [ ] 3.7 **Test the table rules and the migration against Postgres.** Same skip rule as 3.6. Cases: each
  constraint of requirement 62 refuses a bad insert; `applyMigrations` applied twice returns the names the first
  time and an empty list the second; the unique reversal index refuses a second reversal even if two inserts race
  (`Promise.all`).
  - Files: `test/store/postgres/constraints.test.ts`
  - Requirements: 57, 58, 60, 61, 62, 76

- [ ] 3.8 **Write `PostgresPendingStore`.** [needs pending] `get`, `set` (upsert, deletes expired rows), `clear`;
  injected `now` and `ttlMs`; `createdAt` restored as a `Date`. Postgres tests (same skip rule): set then get equal,
  second `set` replaces, `clear`, expiry with a moving clock (9 minutes still there, 11 gone), expired rows deleted
  by `set`, an ambiguous question with `possibleAmounts` and a large-amount question both round-trip.
  - Files: `src/store/postgres/pending.ts`, `test/store/postgres/pending.test.ts`
  - Requirements: 65, 66, 67, 76

- [ ] 3.9 **Export the Postgres parts.** `src/store/postgres/index.ts` exports `connectPostgres`, `closePostgres`,
  `PostgresStore`, `createPostgresStore`, `PostgresPendingStore`.
  - Files: `src/store/postgres/index.ts`
  - Requirements: 54

## 4. Server helpers

- [ ] 4.1 **Constants and phone helpers.** `constants.ts` as in the design; `normalizePhone`, `isDemoPhone`, `maskPhone`.
  Tests: `+27 00 000 1234`, `+27-00-000-1234`, `27000001234`, `(+27) 00 000 1234` normalise; `abc`, `12`, a 16-digit
  number give `null`; `isDemoPhone` accepts `+27000001234` and refuses `+27000011234`, `+2700000123`,
  `+27000001234 5`, `+254711000000`; the mask never shows the middle digits. Also a test that every sentence in
  `SENTENCES` is plain ASCII and shorter than 100 characters.
  - Files: `src/server/constants.ts`, `src/server/phone.ts`, `test/server/phone.test.ts`
  - Requirements: 22, 27

- [ ] 4.2 **Rate limiter.** `createRateLimiter`. Tests with a movable clock: 60 allowed, the 61st refused with
  `retryAfterSeconds`, a refused call does not extend the window, calls are allowed again after the window, two keys
  are separate, expired keys are removed past 10,000 keys.
  - Files: `src/server/rateLimit.ts`, `test/server/rateLimit.test.ts`
  - Requirements: 45, 46

- [ ] 4.3 **Error helpers.** `ownerSentence`, `logError`. Tests: `RecordLimitError` gives the full sentence, anything else
  the generic one; `logError` writes one JSON line to `console.error` with the stack and a masked phone, and the line
  has no full phone number.
  - Files: `src/server/errors.ts`, `test/server/errors.test.ts`
  - Requirements: 48, 49

- [ ] 4.4 **Africa's Talking sender.** `africasTalkingHost`, `createAfricasTalkingSender`. Tests with a fake `fetch`: URL
  and host for `sandbox` and for another username, the `apiKey` and `Accept` headers, the form body fields
  (`from` is the short code), a 500 answer throws, a recipient with `statusCode` 403 throws, a never-ending fetch is
  aborted by the timeout (use a short `timeoutMs`), and no thrown message contains the key. Use the fake key
  `test-key-not-real`.
  - Files: `src/server/sender.ts`, `test/server/sender.test.ts`
  - Requirements: 68, 69, 70, 71, 78

- [ ] 4.5 **Config.** `readConfig`, `readPort`, `ConfigError`. Tests: blank and spaces count as unset; both AT variables
  give `at` with shortcode `46254`, `AT_SHORTCODE` overrides it; only one AT variable gives no `at` and a warning
  that names the missing one and contains no value; `VERCEL` without DATABASE_URL adds the memory warning; PORT
  `3000`, unset, `0`, `70000`, `abc` and `3000.5` behave as in requirement 4.
  - Files: `src/server/config.ts`, `test/server/config.test.ts`
  - Requirements: 4, 9, 10, 11, 13

- [ ] 4.6 **Ledger view for the side panel.** `buildLedgerView`. Tests with `MemoryStore` and the demo records: today's
  figures, `date`, owes limited to 20 with `more`, last 20 records newest first, `reversed` flag, a negative money
  in hand formats with `-`, every `text` is ASCII.
  - Files: `src/server/views.ts`, `test/server/views.test.ts`
  - Requirements: 28, 29, 30

- [ ] 4.7 **Demo data.** `buildDemoShop`, `buildDemoRecords` from the table in the design. Tests: 17 records in append
  order; times never decrease and none is after `now`; today's records fall on today's local date at 00:05, 12:00 and
  23:59 local; earlier records fall on the two days before; Tendai R20, Rudo R30, Sipho R25 owed and today's sales R195
  after the reversal is applied; the phone, names and numbers are the invented ones; the shop name is at most 24
  characters.
  - Files: `src/server/demo.ts`, `test/server/demo.test.ts`
  - Requirements: 35, 38

## 5. The app and its routes

In this group, route tests use `app.request()`, `MemoryStore`, `InMemoryPendingStore` (or a small fake with the same
three methods until 0.1 is clear) and the fixed clock, and mock the two handlers with `vi.mock`.

- [ ] 5.1 **App skeleton.** `createApp`: record cap wrapper, default clock, body limit, `no-store` on `/api/*`,
  `GET /health`, `onError`, `notFound`, the shared `refuse` helper that picks JSON or text from the path. Tests:
  `/health` answers `{"ok":true}` and does not touch the store (a store whose methods throw); a 9 KB body gets 413 on
  `/ussd`, `/sms` and `/api/phone/sms`; an unknown path gets 404 in JSON under `/api/` and as text elsewhere; `no-store`
  is on every `/api/*` answer; `createApp` with an empty `process.env` still works.
  - Files: `src/server/app.ts`, `test/server/health.test.ts`, `test/server/app.test.ts`
  - Requirements: 1, 2, 34, 40, 44, 49, 50

- [ ] 5.2 **`POST /ussd`.** [needs handlers] Form parsing, the checks and the call to `handleUssd` as in the design.
  Tests: the handler receives `sessionId`, `serviceCode`, the normalised phone, `text`, the fixed `now` and the
  store; the answer is 200 `text/plain` with the handler's `response`; a missing `text` becomes `''`; each missing
  field gives 400 without a handler call; a phone `+254711000000` is accepted; an input of 183 characters after the
  last `*` gives 200 `END ...` without a handler call, and 182 goes through; a long `text` made of short inputs goes
  through; a response without `CON ` or `END ` becomes the generic `END` sentence and is logged.
  - Files: `src/server/routes/at.ts`, `test/server/routes.at.test.ts`
  - Requirements: 14, 15, 16, 17, 22, 41

- [ ] 5.3 **`POST /sms`.** [needs handlers] Form parsing, the call to `handleText`, the sender. Tests: the handler
  receives `phone`, `text`, `now`, the store, the pending store and the reader (pass a fake reader); the answer is
  200 `text/plain` with the reply; a missing `from` or `text` gives 400; text of 481 characters gets the "too long"
  reply without a handler call and that reply is also sent; with a fake sender the reply is sent to `from` once; with
  a demo `from` nothing is sent; a sender that throws still gives 200 with the reply and one log line; with no sender
  nothing happens.
  - Files: `src/server/routes/at.ts`, `test/server/routes.at.test.ts`
  - Requirements: 18, 19, 20, 21, 22, 42

- [ ] 5.4 **Browser guard and `POST /api/phone/ussd`.** [needs handlers] `guardPhone` and the route in
  `routes/browser.ts`. Tests: a valid call gives `{ response, length, limit: 182 }` with `length` counted after
  the prefix; the handler gets `serviceCode` `*384*46254#`; no `sessionId` gives a new id each call, and a given
  one is passed on; no `text` gives `''`; a non-JSON body, a JSON array, a number `phone` and a number `text` each
  give 400 `{ error }`; `+254711000000`, `+2700000123`, `+27 00 001 1234` and a missing phone each give 400 with the
  demo-number sentence and no store call (a store whose methods throw); `+27 00 000 1234` is accepted; an input of
  183 characters after the last `*` gives 400.
  - Files: `src/server/routes/browser.ts`, `test/server/routes.phone.test.ts`
  - Requirements: 23, 24, 26, 27, 43

- [ ] 5.5 **`POST /api/phone/sms`.** [needs handlers] Tests: a valid call gives `{ reply, length, limit: 160 }`; the
  sender is never called, even when one is set; text of 481 characters gives 400; the demo-number check and the shape
  checks of 5.4 apply.
  - Files: `src/server/routes/browser.ts`, `test/server/routes.phone.test.ts`
  - Requirements: 25, 26, 27, 43

- [ ] 5.6 **`GET /api/ledger`.** Tests: a seeded shop gives the shape in the design with `{ cents, text }` money; no shop
  gives 404; a non-demo number gives 400; a missing `phone` gives 400.
  - Files: `src/server/routes/browser.ts`, `test/server/routes.ledger.test.ts`
  - Requirements: 28, 29, 30, 31, 27

- [ ] 5.7 **`GET /api/export`.** Tests: the body parses as JSON with `format` `imali-ai-ledger-export`, `version` 1,
  `exportedAt` equal to the fixed clock, the shop and all records including the reversal; the three headers are exact
  (filename uses the digits of the phone and the UTC date); the body is indented; the order of records in the store
  is unchanged afterwards; no shop gives 404; a non-demo number gives 400.
  - Files: `src/server/routes/browser.ts`, `test/server/routes.export.test.ts`
  - Requirements: 31, 32, 33, 27

- [ ] 5.8 **`POST /api/phone/demo`.** Tests: no body, `{}` and an empty string body each create a shop with a demo
  number and 17 records and answer 201; a given free demo number is used; a given number that has a shop gives 409 and
  leaves the records as they were; a non-demo number gives 400; a store where every `findShopByPhone` finds a shop
  gives 503 after 20 tries; the new shop works with `GET /api/ledger`; the demo shop's own records pass through the
  record cap.
  - Files: `src/server/routes/browser.ts`, `test/server/routes.demo.test.ts`
  - Requirements: 35, 36, 37, 38, 39

- [ ] 5.9 **Limits and error answers through the routes.** [needs handlers] Tests in `limits.test.ts`: 60 calls to
  `/api/phone/sms` from one number pass and the 61st gets 429 with `Retry-After`; another number is not affected;
  after the clock moves 61 seconds the number works again; the five browser routes share one count; two
  `/api/phone/demo` calls with no phone share the `demo-create` key; the Africa's Talking routes are not limited; a
  shop seeded with 2,000 records refuses the next record on `/sms`, `/ussd` and `/api/phone/sms` with the
  "shop book is full" sentence (use the real handlers if they are ready, otherwise a mocked handler that appends a
  record). Tests in `errors.routes.test.ts`: a store that throws `Error('connection to db.internal:5432 failed
  password authentication')` gives the plain sentence in each of the three shapes (`/ussd`, `/sms`, `/api/*`), the
  response body and headers contain neither the message nor `at ` stack lines, and `console.error` received both.
  - Files: `test/server/limits.test.ts`, `test/server/errors.routes.test.ts`, `src/server/app.ts`
  - Requirements: 45, 46, 47, 48, 49, 74, 72

## 6. Entry points

- [ ] 6.1 **`createAppFromEnv`.** [needs pending, reader] Builds the parts as in the design and returns
  `{ app, parts, summary, warnings, close }`. Tests with a fake env: nothing set gives `MemoryStore`,
  `InMemoryPendingStore`, no reader, no sender, `summary` `store=memory gemini=off sms=off`; `GEMINI_API_KEY` gives a
  `GeminiReader`; both AT variables give a sender, `AT_USERNAME=sandbox` is reported as `sms=sandbox`; the summary and
  warnings never contain a value; `DATABASE_URL` set gives Postgres parts (mock `src/store/postgres/index.js` so no
  connection is made) and `close()` ends the pool; `VERCEL` without `DATABASE_URL` adds the warning.
  - Files: `src/server/bootstrap.ts`, `test/server/bootstrap.test.ts`
  - Requirements: 7, 8, 9, 10, 12, 13

- [ ] 6.2 **Node entry.** `createNodeApp` adds `serveStatic` after the routes; `main.ts` reads the port, serves with
  `@hono/node-server`, logs the summary and warnings, and closes on SIGINT and SIGTERM. A bad PORT prints the message
  and exits 1. Tests for `createNodeApp` with a temporary `public/` folder: `/` returns `index.html`; `/style.css`
  returns the file; an API route still wins over a file of the same name; an unknown GET gets 404.
  - Files: `src/server/node.ts`, `src/server/main.ts`, `test/server/node.test.ts`
  - Requirements: 3, 4, 50

- [ ] 6.3 **Vercel entry.** [needs handlers] `api/index.ts` and `vercel.json` as in the design. Run `npm run typecheck`.
  A test reads `vercel.json` and checks that the four rewrites exist, `outputDirectory` is `public`, and no
  rewrite sends a path to a file outside `api/`.
  - Files: `api/index.ts`, `vercel.json`, `test/server/vercel.test.ts`
  - Requirements: 5

## 7. Whole conversations through HTTP

- [ ] 7.1 **A USSD session.** [needs handlers] Through `POST /ussd`, step by step with a fixed `sessionId`: first dial
  shows the main menu with today's figure; record a sale and confirm; check the saved line; open "Who owes"; undo;
  close the day. Repeat the session through `POST /api/phone/ussd` with a demo number. Check every screen: starts
  `CON ` or `END `, at most 182 characters after the prefix, ASCII only. Use the steps `dialled-menu` defines.
  - Files: `test/server/conversation.test.ts`
  - Requirements: 73, 72

- [ ] 7.2 **A text conversation.** [needs handlers] Through `POST /sms` from a new number (welcome, shop name), then
  `sold 3 bread 45`, `Tendai owes 20 sugar`, `Tendai paid 10`, `who owes`, `today`, `undo`, `gibberish`, `sold 2 200`
  then `1`; repeat a shorter run through `POST /api/phone/sms` with a demo number. Every reply is at most 160
  characters and ASCII. Add a case: a shop with 2,000 records and the text `sold 45 bread` gets a plain sentence.
  - Files: `test/server/conversation.test.ts`
  - Requirements: 73, 47, 72

## 8. Documents

- [ ] 8.1 **Write `docs/run-the-demo.md`.** Follow the outline in the design (seven sections). Use the real URLs
  `https://imali-ai-feature-phone.vercel.app/ussd` and `.../sms`, the code `*384*46254#` and the short code `46254`.
  Show variables as names only, never a value or a connection string. Use only invented demo numbers
  (`+27000001234`). Keep sentences short.
  - Files: `docs/run-the-demo.md`
  - Requirements: 79, 80, 81

## 9. Wrap-up

- [ ] 9.1 **Run all the checks.** `npm run typecheck`, `npm test` (the Postgres suites show as skipped with their
  message when TEST_DATABASE_URL is not set), `npm run build`. Then run the Postgres suites once against a direct
  Neon or local database with TEST_DATABASE_URL set. Search the repository for a key or a connection string with
  `node scripts/secret-scan.mjs` on staged files and a search for `postgres://` in docs and tests. Confirm no test
  reaches the network: run the tests with the network off, or check that no test file calls the real `fetch`.
  - Files: none
  - Requirements: 72, 76, 78, 81

- [ ] 9.2 **Make the steering file match.** Add `GET /api/ledger`, `POST /api/phone/demo` and `GET /health` to the
  Routes list in `.kiro/steering/tech.md`, and add `AT_SHORTCODE`, `PORT` and `TEST_DATABASE_URL` to the line that
  names the environment variables.
  - Files: `.kiro/steering/tech.md`
  - Requirements: 11

- [ ] 9.3 **Check the first deploy (done by a person with the Vercel and Neon accounts).** With the variables set on
  Vercel and `npm run db:migrate` run against Neon: `GET /health` answers; `POST /api/phone/demo` creates a shop; the
  rows are in Neon; `POST /ussd` with form fields answers `CON ...`; the Vercel runtime log shows the start line
  (`store=postgres ...`) and no secret; a request to `/sms` reaches the function with the path `/sms` (the rewrite
  keeps the original path). If a check fails, use the fallbacks in the design's Risks section. Then dial
  `*384*46254#` in the Africa's Talking simulator and send a text to `46254`.
  - Files: none
  - Requirements: 5, 12, 80
