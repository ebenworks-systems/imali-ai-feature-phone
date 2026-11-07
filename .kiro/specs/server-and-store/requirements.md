# Server and Store Requirements

The HTTP server (a Hono app that runs on Node locally and on Vercel), the Postgres store and the Postgres
pending store, so the dialled menu and the text replies can be used from a real Africa's Talking sandbox and from
the browser phone, with records that survive between serverless calls.

This spec calls two entry points that other specs are still writing: `handleUssd` (spec `dialled-menu`, exported
from `src/channels/index.ts`) and `handleText` (spec `text-messages`, in `src/channels/sms/handler.ts`).

Words used below: a **demo number** is a phone number written `+2700000` followed by four digits (the range
`+27 00 000 xxxx` with the spaces removed). The **browser routes** are `POST /api/phone/ussd`,
`POST /api/phone/sms`, `POST /api/phone/demo`, `GET /api/ledger` and `GET /api/export`. The **Africa's Talking
routes** are `POST /ussd` and `POST /sms`.

## EARS Acceptance Criteria

### The app and its entry points

1. The server shall export `createApp({ store, pending, reader?, smsSender?, now? })` from `src/server/app.ts`, and
   `createApp` shall return a Hono app without reading environment variables, opening a connection or listening on
   a port.

2. Where `now` is passed, the app shall use it for every handler call, rate-limit check, demo seed and export
   time stamp; where it is not passed, the app shall use the system clock.

3. When `npm run dev` starts the Node entry, the server shall listen on PORT (default 3000) and answer any GET
   that matches no route with the file from `public/` (the path `/` gives `public/index.html`).

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

8. Where GEMINI_API_KEY is set, the start-up code shall pass a `GeminiReader` to `createApp`; where it is not set,
   the start-up code shall pass no reader.

9. Where AT_USERNAME and AT_API_KEY are both set, the start-up code shall pass an Africa's Talking sender to
   `createApp`; where either is missing, the start-up code shall pass no sender, and where exactly one is set it
   shall log a warning that names the missing variable.

10. The start-up code shall treat an environment variable that is unset, empty or only spaces as not set.

11. The server shall read secrets only from environment variables, and `.env.example` shall list DATABASE_URL,
    GEMINI_API_KEY, AT_USERNAME, AT_API_KEY, AT_SHORTCODE, PORT and TEST_DATABASE_URL, each with an empty value.

12. When the server starts, it shall log one line that says which store is in use and whether the Gemini reader and
    the Africa's Talking sender are on, and the line shall not contain the value of any environment variable.

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

22. The Africa's Talking routes shall accept any phone number that, after spaces, hyphens, dots and brackets are
    removed and a missing leading `+` is added, is `+` followed by 5 to 15 digits, and shall not apply the demo
    number check.

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
    shall count together under one shared key and meet the same limit.

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

51. When `appendRecord` is called with `{ saveKey }` and a record for the same shop was already appended with the
    same `saveKey`, the store shall throw `DuplicateSaveError` and shall leave the first record as it was; both the
    memory store and the Postgres store shall do this.

52. When `createShop` is called with a phone number that already has a shop, the store shall throw
    `ShopPhoneTakenError` and shall not change the existing shop; both stores shall do this.

53. The `listRecords` method of both stores shall return records in the order they were appended, including
    records with the same time stamp, and shall return a new array that the caller may change.

### The Postgres store

54. The Postgres store shall implement `LedgerStore` using only the `postgres` package, in `src/store/postgres/`.

55. The Postgres store shall keep money in `bigint` columns, read it back as a JavaScript number, and throw if a
    value read is not a safe integer.

56. The Postgres store shall keep times in `timestamptz` columns and shall return the same ISO 8601 string that
    was written.

57. The migration `sql/001_init.sql` shall create the tables `shops`, `records` and `pending_questions` of the
    design, and `npm run db:migrate` shall apply every migration file not yet applied, in name order, each in one
    transaction, and note it in `schema_migrations`.

58. When `npm run db:migrate` runs a second time with nothing new, it shall change nothing and say so.

59. If DATABASE_URL is not set when `npm run db:migrate` runs, then the script shall print a plain message and
    exit with a non-zero code, and the script shall never print the value of DATABASE_URL.

60. The database shall allow one reversal per record through a unique index on the reversed record id, and when
    that index rejects an insert the Postgres store shall throw `RecordAlreadyReversedError`.

61. The database shall allow one record per shop for each `saveKey` through a unique index, and when that index
    rejects an insert the Postgres store shall throw `DuplicateSaveError`; the database shall allow one shop per
    phone number through a unique constraint, and when that rejects an insert the Postgres store shall throw
    `ShopPhoneTakenError`.

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
    store, including `RecordAlreadyReversedError`, `DuplicateSaveError`, `ShopPhoneTakenError`, append order,
    the `since` filter and amounts up to `Number.MAX_SAFE_INTEGER`.

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
    incoming-message callback `https://imali-ai-feature-phone.vercel.app/sms`, and shall say that text replies go
    out from the short code in AT_SHORTCODE (default 46254).

81. The documents, tests and examples written for this spec shall not contain a real key, password or
    connection string, and shall use only invented demo numbers.
