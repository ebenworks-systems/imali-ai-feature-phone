# Server and Store Requirements

The HTTP server (a Hono app that runs on Node locally and on Vercel), the Postgres store and the Postgres
pending store, so the dialled menu and the text replies can be used from a real Africa's Talking sandbox and from
the browser phone, with records that survive between serverless calls.

This spec calls two entry points that are finished: `handleUssd` (spec `dialled-menu`) and `handleText` (spec
`text-messages`), both exported from `src/channels/index.ts`. It also builds on three things those specs left in the
code: the duplicate-save guard of the dialled menu (a record id made from the session, refused by the store with
`DuplicateRecordError`), `ShopAlreadyExistsError` (a shop id or phone number that is taken) and `normalizePhone` in
`src/channels/phone.ts`.

Words used below: a **demo number** is a phone number written `+2700000` followed by four digits (the range
`+27 00 000 xxxx` with the spaces removed). The **browser routes** are `POST /api/phone/ussd`,
`POST /api/phone/sms`, `POST /api/phone/demo`, `GET /api/ledger` and `GET /api/export`. The **Africa's Talking
routes** are `POST /ussd` and `POST /sms`.

## EARS Acceptance Criteria

### The app and its entry points

1. The server shall export `createApp({ store, pending, processed?, reader?, smsSender?, callbackKey?, now? })` from
   `src/server/app.ts`, and `createApp` shall return a Hono app without reading environment variables, opening a
   connection or listening on a port.

2. Where `now` is passed, the app shall use it for every handler call, rate-limit check, demo seed and export
   time stamp; where it is not passed, the app shall use the system clock.

3. When `npm run dev` starts the Node entry, the server shall listen on PORT (default 3000), on the local address
   `127.0.0.1` only, and answer any GET that matches no route with the file from `public/` (the path `/` gives
   `public/index.html`).

4. If PORT is set but is not a whole number from 1 to 65535, then the Node entry shall exit with a message that
   names PORT and shall not listen.

5. The file `api/index.ts` shall serve the same app on Vercel as one Node function through `hono/vercel`, and
   `vercel.json` shall send `/ussd`, `/sms`, `/health` and `/api/*` to that function and serve `public/` as
   static files.

6. The project shall add only `hono`, `@hono/node-server` and `postgres` to `dependencies`, and no file under
   `src/core` or `src/channels` shall import `postgres`.

### Choosing the parts at start

7. When DATABASE_URL is set, the start-up code shall build the Postgres store and the Postgres pending store;
   when it is not set, the start-up code shall build `MemoryStore` and `InMemoryPendingStore`.

8. Where GEMINI_API_KEY is set, the start-up code shall pass a `GeminiReader` to `createApp`, using the model in
   GEMINI_MODEL when that is set and the reader's own default model when it is not; where GEMINI_API_KEY is not set,
   the start-up code shall pass no reader, whatever GEMINI_MODEL says.

9. Where AT_USERNAME and AT_API_KEY are both set, the start-up code shall pass an Africa's Talking sender to
   `createApp`, with AT_SHORTCODE as the short code (`46254`, the sandbox short code, when AT_SHORTCODE is not set);
   where either is missing, the start-up code shall pass no sender, and where exactly one is set it shall log a
   warning that names the missing variable.

10. The start-up code shall treat an environment variable that is unset, empty or only spaces as not set.

11. The server shall read secrets only from environment variables, and `.env.example` shall list DATABASE_URL,
    GEMINI_API_KEY, GEMINI_MODEL, AT_USERNAME, AT_API_KEY, AT_SHORTCODE, AT_CALLBACK_KEY, PORT and
    TEST_DATABASE_URL, each with an empty value.

12. When the server starts, it shall log one line that says which store is in use, whether the Gemini reader and
    the Africa's Talking sender are on, and whether the callback key is on, and the line shall not contain the value
    of any environment variable.

13. If the server runs on Vercel (VERCEL is set) and DATABASE_URL is not set, then it shall log a warning that
    records are not kept between calls.

### Africa's Talking routes

14. When `POST /ussd` receives the form fields `sessionId`, `serviceCode`, `phoneNumber` and optionally `text`,
    the app shall call `handleUssd` with those values, the normalised phone number, `now()` and the store, and
    shall answer 200 `text/plain` with the `response` it returns.

15. Where `text` is missing on `POST /ussd`, the app shall treat it as an empty string (the first dial).

16. If `sessionId`, `serviceCode` or `phoneNumber` is missing on `POST /ussd`, or the phone number is not shaped
    like a phone number, then the app shall answer 400 `text/plain` with a plain sentence and shall not call
    `handleUssd`.

17. If the `response` from `handleUssd` does not start with `CON ` or `END `, then the app shall log it and
    answer `END Sorry, something went wrong. Please try again.`

18. When `POST /sms` receives the form fields `from` and `text` (and optionally `to`, `date` and `id`), the app
    shall call `handleText` with the normalised `from` as `phone`, the text, `now()`, the store, the pending
    store and the reader, and shall answer 200 `text/plain` with the reply.

19. If `from` or `text` is missing on `POST /sms`, or `from` is not shaped like a phone number, then the app shall
    answer 400 `text/plain` with a plain sentence and shall not call `handleText`.

20. Where a sender was passed and `from` is not a demo number, the app shall send the reply to `from` through
    the sender and wait for it to finish before it answers.

21. If the sender fails, then the app shall log the failure and still answer 200 with the reply text.

22. The Africa's Talking routes shall accept any phone number that `normalizePhone` (`src/channels/phone.ts`) accepts,
    which is `+` followed by 7 to 15 digits once spaces, hyphens, dots and brackets are removed and a missing leading
    `+` is added, and shall not apply the demo number check. The server shall use that same function, so the dialled
    menu, the text handler and the routes find the same shop.

### The browser phone

23. When `POST /api/phone/ussd` receives JSON `{ phone, sessionId?, text? }`, the app shall call `handleUssd` the
    same way as `POST /ussd` (with the service code `*384*46254#`) and answer 200 JSON
    `{ response, length, limit }`, where `limit` is 182 and `length` is the number of characters in `response`
    after the `CON ` or `END ` prefix.

24. Where `sessionId` is missing on `POST /api/phone/ussd`, the app shall use a new random session id for that
    call; where `text` is missing, the app shall use an empty string.

25. When `POST /api/phone/sms` receives JSON `{ phone, text }`, the app shall call `handleText` the same way as
    `POST /sms` (but without sending a text message) and answer 200 JSON `{ reply, length, limit }`, where `limit`
    is 160 and `length` is the number of characters in `reply`.

26. If the body of a browser route is not a JSON object, or a field has the wrong type, then the app shall answer
    400 JSON `{ error }` with a plain sentence.

27. If the phone number on a browser route is not a demo number, then the app shall answer 400 JSON `{ error }`
    with a plain reason and shall not read or write the store.

### The side panel and the export

28. When `GET /api/ledger?phone=...` is called for a demo shop, the app shall answer 200 JSON with the shop
    (name, phone, currency, time zone), today's figures, who owes and the last 20 records.

29. The `today` part of the `GET /api/ledger` answer shall hold the shop's local date and the figures from
    `getTodaySummary`; the `owes` part shall hold the first 20 customers from `getWhoOwes` (largest first) and the
    number of customers not shown; the `records` part shall hold the last 20 records, newest first, each marked
    `reversed` when a reversal points at it.

30. Every money value in the `GET /api/ledger` answer shall be an object `{ cents, text }`, where `cents` is an
    integer and `text` is the amount formatted for the shop's currency in plain ASCII.

31. If no shop exists for the phone number on `GET /api/ledger` or `GET /api/export`, then the app shall answer
    404 JSON `{ error }` with a plain sentence.

32. When `GET /api/export?phone=...` is called for a demo shop, the app shall answer 200 with the output of
    `generateExport` in the format of `docs/export-format.md`, using `now()` as `exportedAt`, as pretty-printed
    JSON.

33. The `GET /api/export` answer shall have the headers `Content-Type: application/json; charset=utf-8`,
    `Content-Disposition: attachment; filename="imali-ledger-<digits of the phone>-<UTC date>.json"` and
    `Cache-Control: no-store`.

34. The app shall send `Cache-Control: no-store` on every answer under `/api/`.

### The demo shop

35. When `POST /api/phone/demo` is called with no phone number, the app shall choose a demo number that has no
    shop, create the shop "Thandi's Spaza" (currency ZAR, time zone Africa/Johannesburg) with the invented records
    in the design, and answer 201 JSON `{ phone, shop }`.

36. When `POST /api/phone/demo` is called with a demo number that has no shop, the app shall create the demo shop
    for that number and answer 201 JSON `{ phone, shop }`.

37. If `POST /api/phone/demo` is called with a number that already has a shop, then the app shall answer 409 JSON
    `{ error }` and shall not change any record.

38. The demo records shall be spread over today and the two days before it in the shop's time zone, in time order,
    none later than `now()`, with sales and an expense today, at least three customers who still owe money, one
    payment and one undone record, and all names, numbers and figures invented.

39. If twenty random demo numbers in a row already have a shop, then `POST /api/phone/demo` shall answer 503 JSON
    `{ error }` with a plain sentence.

### Health

40. When `GET /health` is called, the app shall answer 200 JSON `{ "ok": true }` without reading the store.

### Limits for a public demo

41. If the latest menu input on `POST /ussd` (the part of `text` after the last `*`) is longer than 182
    characters, then the app shall answer 200 `text/plain` with `END` and a plain sentence, and shall not call
    `handleUssd`.

42. If `text` on `POST /sms` is longer than 480 characters, then the app shall reply with a plain sentence (and
    send it when a sender is set), and shall not call `handleText`.

43. If the latest menu input on `POST /api/phone/ussd` is longer than 182 characters, or `text` on
    `POST /api/phone/sms` is longer than 480 characters, then the app shall answer 400 JSON `{ error }` and shall
    not call the handler.

44. If a request body is larger than 8,192 bytes, then the app shall answer 413 with a plain sentence.

45. If a phone number has made 60 requests to the browser routes in the last 60 seconds, then the app shall answer
    the next request from that number with 429, a `Retry-After` header in seconds and a plain sentence, and the
    refused request shall not count toward the 60; requests to `POST /api/phone/demo` that carry no phone number
    shall count together under one shared key and meet the same limit. Every browser route also counts against the client
    address (requirement 106).

46. The rate limiter shall keep its counts in the memory of the running instance, so on Vercel the limit is per
    instance.

47. If a shop already has 2,000 records, then the app shall refuse to append another record to it and the owner
    shall see a plain sentence, on every route that records.

### Errors

48. If a handler, the store or the sender throws an error the app does not expect, then the app shall log the
    route, the error name, message and stack and a masked phone number, and shall answer with a plain sentence:
    `END Sorry, something went wrong. Please try again.` for `/ussd`, the same sentence without `END ` as text for
    `/sms`, and 500 JSON `{ error }` for `/api/*`.

49. The app shall not put a stack trace, an SQL text, a database error message or a connection string in any
    response body or header.

50. If a path matches no route, then the app shall answer 404 with a plain sentence.

### Changes to the store interface

51. When `appendRecord` is called with a record whose id the store already holds, the store shall throw
    `DuplicateRecordError` and shall leave the first record as it was, and it shall make this check before any other,
    so a repeated undo gives `DuplicateRecordError` and not `RecordAlreadyReversedError`. This is the duplicate-save
    guard the dialled menu uses (its record ids are made from the session id and the step). Both the memory store and
    the Postgres store shall do this, and no second mechanism (no save key) shall be added.

52. When `createShop` is called with an id or a phone number that already has a shop, the store shall throw
    `ShopAlreadyExistsError` and shall not change the existing shop; both stores shall do this.

53. The `listRecords` method of both stores shall return records in the order they were appended, including
    records with the same time stamp, and shall return a new array that the caller may change.

### The Postgres store

54. The Postgres store shall implement `LedgerStore` using only the `postgres` package, in `src/store/postgres/`.

55. The Postgres store shall keep money in `bigint` columns, read it back as a JavaScript number, and throw if a
    value read is not a safe integer.

56. The Postgres store shall keep times in `timestamptz` columns and shall return the same ISO 8601 string that
    was written.

57. The migration `sql/001_init.sql` shall create the tables `shops`, `records`, `pending_questions` and
    `processed_texts` of the design, and `npm run db:migrate` shall apply every migration file not yet applied, in name order, each in one
    transaction, and note it in `schema_migrations`.

58. When `npm run db:migrate` runs a second time with nothing new, it shall change nothing and say so.

59. If DATABASE_URL is not set when `npm run db:migrate` runs, then the script shall print a plain message and
    exit with a non-zero code, and the script shall never print the value of DATABASE_URL.

60. The database shall allow one reversal per record through a unique index on the reversed record id, and when
    that index rejects an insert the Postgres store shall throw `RecordAlreadyReversedError`.

61. The database shall allow one record per id through the primary key on `records.id`, and when an insert meets an
    id that is already there the Postgres store shall throw `DuplicateRecordError` (the check for the id comes
    before the check for a second reversal, as in requirement 51); the database shall allow one shop per id and one
    shop per phone number through the primary key and a unique constraint, and when either rejects an insert the
    Postgres store shall throw `ShopAlreadyExistsError`.

62. The database shall refuse a record whose fields do not fit its kind: an amount of zero or less on a sale,
    expense, debt or payment, a reversal with an amount other than zero, a debt or payment without a customer,
    and a reversal without a record to reverse or with one from another shop.

63. If the database fails for any reason other than the three above, then the Postgres store shall let the error
    pass up unchanged.

64. The Postgres client shall connect lazily, use at most 3 connections, send queries without prepared statements
    so it works behind Neon's pooled connection string, and give up connecting after 10 seconds.

### The Postgres pending store

65. The Postgres pending store shall implement `PendingStore` from `src/channels/sms/pending.ts`: `get`, `set`
    and `clear` by phone number, with at most one question per phone number, and `set` replacing an earlier one.

66. The Postgres pending store shall not return a question more than 10 minutes after it was set, measured with
    an injected clock, and `set` shall delete the expired questions.

67. The Postgres pending store shall return a question equal to the one set, including its `createdAt` date and
    any intent inside it.

### Sending text messages through Africa's Talking

68. When the sender is called with a number and a message, it shall make one POST to the Africa's Talking
    messaging endpoint with the form fields `username`, `to`, `message` and `from`, and the headers `apiKey` and
    `Accept: application/json`.

69. Where AT_USERNAME is `sandbox`, the sender shall use the host `api.sandbox.africastalking.com`; otherwise it
    shall use `api.africastalking.com`.

70. The sender shall use AT_SHORTCODE as `from`, and `46254` when AT_SHORTCODE is not set, and the number of the
    person who texted as `to`.

71. If the endpoint answers with a status outside 200 to 299, or with a recipient whose `statusCode` is 400 or
    more, or does not answer within 5 seconds, then the sender shall throw an error that does not contain the
    API key.

### Tests

72. The route tests shall drive the app through `app.request()` with `MemoryStore`, `InMemoryPendingStore` and a
    fixed clock, and shall cover each route in the design, the demo number check on each browser route, each
    limit, the export headers, and every error answer.

73. The route tests shall include a USSD session driven step by step through `POST /ussd` and
    `POST /api/phone/ussd`, and a text conversation driven message by message through `POST /sms` and
    `POST /api/phone/sms`, and each USSD screen shall be at most 182 characters after the prefix, each text
    reply at most 160 characters, and both plain ASCII.

74. The route tests shall include a store that throws an error with a database-looking message, and shall check
    that the message and the stack are not in the response and are in the log.

75. A contract test suite shall run the same `LedgerStore` checks against `MemoryStore` and against the Postgres
    store, including `RecordAlreadyReversedError`, `DuplicateRecordError` (also for a repeated reversal),
    `ShopAlreadyExistsError` (for the id and for the phone), the count of shops by phone prefix, append order, the
    `since` filter and amounts up to `Number.MAX_SAFE_INTEGER`. A second suite shall run the same checks on the two
    processed-text stores.

76. If TEST_DATABASE_URL is not set, then the Postgres tests shall be skipped, and the name of the skipped suite
    shall say that TEST_DATABASE_URL must be set to run them.

77. The Postgres tests shall run in a schema made for the run and drop it at the end, so they never read or change
    data in other schemas.

78. No test shall make a network call, except the Postgres tests when TEST_DATABASE_URL is set; the sender tests
    shall use a fake `fetch`.

### Documents and channel set-up

79. The file `docs/run-the-demo.md` shall explain how to run the server locally, run the tests (with and without
    TEST_DATABASE_URL), set up a Neon database and run the migration, deploy to Vercel with the environment
    variables, and point an Africa's Talking sandbox USSD channel and SMS callback at the deployed URL.

80. The Africa's Talking set-up in `docs/run-the-demo.md` shall name the existing sandbox channel `*384*46254#`
    with the callback `https://imali-ai-feature-phone.vercel.app/ussd`, and the SMS short code `46254` with the
    incoming-message callback `https://imali-ai-feature-phone.vercel.app/sms`, shall say that text replies go
    out from the short code in AT_SHORTCODE (default 46254), and shall explain AT_CALLBACK_KEY: when it is set, both
    callback addresses end in `?k=` followed by the key (shown as `<AT_CALLBACK_KEY>`, never a value).

81. The documents, tests and examples written for this spec shall not contain a real key, password or
    connection string, and shall use only invented demo numbers.

### Callback key (Africa's Talking routes)

82. Where AT_CALLBACK_KEY is set (not blank), `POST /ussd` and `POST /sms` shall require the query parameter `k` to
    equal it, and shall compare the two in constant time (both are hashed to the same length and the hashes are
    compared with `crypto.timingSafeEqual`, so neither the content nor the length of the key shows in the timing).

83. If `k` is missing or is not equal to AT_CALLBACK_KEY, then `POST /ussd` and `POST /sms` shall answer 403
    `text/plain` with a plain sentence, shall make the check before the body is read, and shall not call a handler,
    the store, the processed-text store or the sender.

84. Where AT_CALLBACK_KEY is not set and the Africa's Talking sender is not set either (a local run, and tests),
    `POST /ussd` and `POST /sms` shall accept every request; where the sender is set and the key is not, requirement
    113 applies. The browser routes and `GET /health` shall never need the key, and the key shall not appear in any
    response, log line or start-up line.

### Repeated text callbacks

85. When `POST /sms` receives an `id` of 1 to 100 characters made of letters, digits, `_`, `.`, `:` and `-`, the app
    shall claim the pair (normalised `from`, `id`) in the processed-text store after the length check and before it
    calls `handleText`; where `id` is missing or has another shape, the app shall skip the claim and handle the
    message as before.

86. If the pair was already processed, then the app shall answer 200 `text/plain` with the reply that was stored the
    first time, shall not call `handleText`, and shall not send a text message again.

87. If the pair was claimed and has no reply yet (the first call is still running), then the app shall answer 200
    `text/plain` with a plain sentence, shall not call `handleText`, and shall not send a text message.

88. When `handleText` finishes, the app shall store its reply with the claim before it sends the text message, so a
    failed send does not let a repeat run again; if `handleText` throws, the app shall log the error, store the
    plain error sentence as the reply, and answer and send that sentence. The app shall never forget a claim,
    because `handleText` may already have saved a record before it threw, and a second run would save it twice.

89. The processed-text store shall let exactly one of two simultaneous claims of the same pair win; the memory
    store shall do this with a `Map` (a keyed set of ids that also holds the reply), and the Postgres store with a
    table `processed_texts` whose primary key is (`phone`, `message_id`) and an insert that does nothing on
    conflict.

90. The processed-text stores shall keep a claim for 48 hours, measured with an injected clock, and a claim shall
    delete the entries older than that.

91. The browser route `POST /api/phone/sms` has no message id and shall not use the processed-text store.

### Limits on the public demo shops

92. If a client address has called `POST /api/phone/demo` 10 times in the last hour, then the app shall answer the
    next call with 429, a `Retry-After` header in seconds and a plain sentence, shall not read or write the store
    for it, and the refused call shall not count toward the 10; every call counts, including calls that name a phone
    number and calls that end in 409. The count is kept in the store, not in the memory of one instance, so it holds
    across serverless instances (requirement 108; this replaces "kept in the memory of the running instance").

93. The client address shall be `x-real-ip`, trimmed (Vercel sets it to the address that connected, and a caller cannot
    write it); where that is missing or blank, the last entry of `x-forwarded-for`, trimmed (the entry the platform
    added); where that is also missing or blank, one shared key `unknown`. The first entry of `x-forwarded-for` shall
    never be used, because a caller can write it. A value longer than 64 characters shall be cut to 64. (This replaces
    "the first address in the `x-forwarded-for` header".)

94. If the store already holds 5,000 or more shops with a demo number (or the site has made 1,000 in the last 24 hours,
    requirement 108), then `POST /api/phone/demo` shall answer 503
    JSON `{ error }` with a plain sentence and shall create nothing. The check and the insert are two steps, so
    simultaneous calls can pass 5,000 by a few shops.

95. The store interface shall have `countShopsWithPhonePrefix(prefix)`, and both stores shall implement it; the app
    shall count demo shops with the prefix `+2700000`.

### Package and repository files

96. The file `package.json` shall name the package `imali-ai-feature-phone`, set `"private": true`, set
    `"engines": { "node": "22.x" }` so Vercel runs Node 22, and keep `dependencies` to `hono` (on the 4.x line, with
    a `^4` range), `@hono/node-server` and `postgres`; and `.gitignore` shall list `.vercel`.

97. The Postgres test helper shall put each suite's connection in its own schema with the libpq `options` start-up
    parameter (`-c search_path=<schema>`), and right after connecting shall read `show search_path` and throw a clear
    error, before any migration or test runs, unless the answer is exactly that schema, so a pooled URL or a proxy
    that drops the option can never make a suite write into `public`. The production store keeps using `public`.

98. A contract test shall build the real app (`createApp` with the memory stores, no mocked handlers), make a demo
    shop through `POST /api/phone/demo`, send a sale through `POST /api/phone/ussd` and a debt through
    `POST /api/phone/sms`, and pass the real JSON answers of `GET /api/ledger`, `POST /api/phone/ussd` and
    `POST /api/phone/sms` through the browser page's own readers (`readLedger`, `parseUssdReply`, `parseSmsReply` in
    `public/`). The test shall fail when the page reads a field the server does not send. It lives in
    `test/integration/page-contract.test.ts` (the browser-phone spec, requirement 106).

99. The Postgres test helper shall give every test inside `describePostgres` a timeout of 30 seconds and its
    `beforeAll` and `afterAll` hooks 60 seconds, so that a test against a remote database (one took 5.6 s against
    vitest's default of 5 s) does not time out, and the tests themselves shall carry no timeout.


### Fixes after the second review (before the live demo went public)

A second reviewer read the code and found six faults; each was confirmed. Requirements 100 to 117 close them. Where one
of them replaces a sentence above, the sentence says so.

#### The browser routes do not make shops

100. If `POST /api/phone/ussd` or `POST /api/phone/sms` receives a demo number that has no shop, then the app shall
     answer 404 JSON `{ error }` with the sentence `No demo shop on this number. Press Start demo shop.`, shall make
     the check after the shape, number and length checks and before any handler runs, and shall write nothing: no
     shop, no record and no waiting question. Before this, `text` "A*1" on the first route and "hi" then a name on the
     second signed a new shop up for any demo number, without the limit per address or the cap of 5,000, so one client
     could use up all 10,000 demo numbers and "Start demo shop" would fail for everyone. (Amends requirements 23, 25
     and 27: they describe a number that has a shop.)

101. The app shall hand the handlers on the two browser routes a store that cannot make a shop (`createShop` throws
     `ShopCreationNotAllowedError`), so that only `POST /api/phone/demo` makes demo shops even if a shop is cleared
     away between the check in requirement 100 and the handler's own look.

#### Housekeeping of invented demo data

102. The demo shop, its customers, its phone number and every figure are invented (the product rules). Clearing away a
     finished demonstration is housekeeping of invented data and is not the deletion of an owner's record. In the
     terms of the records rules: records are append-only for an owner and "undo" adds a reversal; an owner's record is
     never deleted or changed. A demo shop is removed whole, with all its records and its waiting question, or not at
     all, and only after 7 days. No record is ever deleted on its own, and no shop on a number that is not a demo
     number is ever deleted at all.

103. The store interface shall have `deleteExpiredDemoShops(createdBefore, maxShops)`, and both stores shall implement
     it. It shall remove the shops whose phone number is a whole demo number (`+2700000` and exactly four digits) and
     whose `createdAt` is before `createdBefore`, oldest first, at most `maxShops` of them and never more than 1,000,
     with all their records, and return the phone numbers it removed. The store, not the caller, shall decide what a
     demo number is: the method shall take no prefix, no shop id and no record id. A shop on any other number, of any
     age, shall never be removed. A `maxShops` that is 0, negative or not a number, or a `createdBefore` that is not a
     real date, shall remove nothing. A removed number, shop id and record id can be used again.

104. The Postgres store shall do requirement 103 in one transaction: select the shops `for update` with the demo test
     in SQL, delete their `pending_questions` rows, delete their `records` rows by `shop_id` in one statement (the
     foreign keys between a shop's own records are checked at the end of the statement), then delete the shops with the
     demo test repeated. The memory store shall do the same to its own maps. The memory pending store is a separate
     object, so the app clears the waiting question of each phone number the store gives back.

105. When `POST /api/phone/demo` has passed its limit on the client address and its body and phone checks, the app shall
     call `deleteExpiredDemoShops` with now minus 7 days and at most 200 shops, before it checks the daily ceiling and
     the cap of 5,000, so the cap frees itself over the judging weeks. If the housekeeping fails, the app shall log the
     error and carry on with the call. No other route shall call it, and no other code shall delete a shop or a record
     (a test scans the source for that). A demo shop's `createdAt` is the time of its oldest invented record, two days
     before it is made, so a demo shop lives about 5 days after it is made.

#### Limits per client address

106. Every browser route (`POST /api/phone/ussd`, `POST /api/phone/sms`, `POST /api/phone/demo`, `GET /api/ledger` and
     `GET /api/export`) shall also count against the client address (requirement 93): at most 120 requests a minute
     per address. The 121st gets 429 with `Retry-After` and the usual sentence, before any body is read, and a refused
     request is not counted. The count is in the memory of the running instance, in addition to the 60 a minute per
     phone number (requirement 45).

107. The salt that addresses are hashed with shall come from ADDRESS_SALT; where it is not set (not blank), the server
     shall use a fixed built-in salt, the same in every instance so that every instance counts alike. The start line
     shall say `salt=default` when ADDRESS_SALT is not set and `salt=set` when it is, and shall never show the value.

108. The limit of 10 calls an hour per client address on `POST /api/phone/demo` (requirements 92 and 93) and a ceiling of
     1,000 demo shops made in 24 hours by the whole site shall be kept in a `DemoQuotaStore` (memory in tests and local
     runs, Postgres in the live demo), so they hold across serverless instances. The store shall be keyed by the
     SHA-256 of the salt and the address as 64 hex digits, and shall never be given or keep the address itself: both
     stores refuse a key of any other shape, and the table refuses it too. Every allowed call counts, including a call
     that ends in 409; a refused call does not count; a demo shop that was really made counts toward the ceiling. Rows
     older than 24 hours are removed as part of a claim. When the ceiling is reached the app shall answer 503 with the
     demo-full sentence and make nothing.

109. The Postgres version shall use the table `demo_quota` (new file `sql/002_demo_quota.sql`; an applied migration is
     never edited), claim a call in one transaction that first takes `pg_advisory_xact_lock` on the key so two
     instances cannot both pass the limit, and prune old rows in small batches with `for update skip locked`.

110. ADDRESS_SALT shall be in `.env.example` and in the variables table of `docs/run-the-demo.md`.

111. The optional model reader shall be asked at most 200 times an hour in all, by every caller together, in the
     memory of the running instance. Beyond that the app shall skip the reader (it answers `null` at once) and the
     rules answer alone. A skipped call is not counted.

#### The Africa's Talking callbacks

112. The callback key shall still be compared in constant time, as in requirement 82, whatever is added around the check:
     the check comes first, before the 503 of requirement 113 and before the limits of requirement 114.

113. Where the Africa's Talking sender is configured (AT_USERNAME and AT_API_KEY set) and AT_CALLBACK_KEY is not, `POST
     /ussd` and `POST /sms` shall answer 503 `text/plain` with a plain sentence (`This service is not set up yet. Please
     try again later.`), before any body is read, and shall not call a handler, the store, the processed-text store or
     the sender; the start line shall say `callback=missing-key` and a start-up warning shall name AT_CALLBACK_KEY; the
     server shall still start and the browser routes and `GET /health` shall still work. Where there is no sender
     (a local run), the callbacks stay open as in requirement 84. Where a key is set, requirements 82 and 83 apply.
     Before this, the callbacks were open without a key, so anyone could read and write the ledger of any non-demo
     number and make the server send a text from the account.

114. `POST /ussd` and `POST /sms` shall be limited, after the key check, to 300 requests a minute per client address (429
     with `Retry-After` before any body is read) and 30 a minute per phone number (`/ussd` answers 200 `END` with the
     usual sentence; `/sms` answers 429, sends no text and does not call the handler). A refused request is not
     counted. Both counts are in the memory of the running instance. One key press on the dialled menu is one request.

115. The store shall hold at most 2,000 shops whose number is not a demo number. A sign-up beyond that shall be refused
     with `ShopLimitError` and no shop made; `/sms` shall answer `Sorry, no new shops can be added right now. Please try
     again later.` The count is made in the store each time (all shops minus demo shops), so it holds across instances.
     A repeat of a sign-up that already worked (the shop for that phone or id exists) is passed to the store, which
     answers it as before. A number that starts like a demo number but is not a whole one (`+270000012345`) is refused,
     because it would be counted as a demo shop and slip past both caps.

#### Tests

116. Each of requirements 100 to 115 shall have a test that fails on the code as it was before and passes now:
     `test/server/routes.noshop.test.ts`, `housekeeping.test.ts`, `limits.address.test.ts`, `routes.closed.test.ts`,
     `phone.test.ts`, `bootstrap.test.ts` and `config.test.ts` for the app; `test/store/contract.ts` (both stores),
     `limit.test.ts`, `quota.ts` and `quota.test.ts` for the memory side; and `test/store/postgres/housekeeping.test.ts`,
     `quota.test.ts` and `constraints.test.ts` for Postgres. The Postgres tests that need a database are skipped without
     TEST_DATABASE_URL (task 11.9); the ones with a fake `sql` run everywhere.

117. A test through `POST /ussd` with two phone numbers and one session id (the client chooses the session id, and the
     shop id is made from it) shall show that the second phone gets the plain sorry screen, not the first phone's menu,
     and that no shop is made for it (requirement 54 of the `dialled-menu` spec).
