---
inclusion: always
---

# Technology and structure

## Stack

- TypeScript in strict mode, ES modules, Node.js 22. No `any` without a comment saying why.
- [Hono](https://hono.dev) for HTTP, so one app runs locally on Node (`@hono/node-server`) and on Vercel.
- [Vitest](https://vitest.dev) for tests. Every module in `src/core` has unit tests; every channel has tests that
  drive it as a phone would (a USSD session step by step, an SMS conversation message by message).
- Storage behind one `LedgerStore` interface with two implementations: in-memory (tests, local runs) and Postgres
  (the live demo, on Neon, using the `postgres` package). The core never imports a database driver.
- The optional language model is Google Gemini through its REST API, called with `fetch`, only when
  `GEMINI_API_KEY` is set. With no key the ledger runs on rules alone and every test passes without a network.
- No Amazon Web Services SDKs, services or hosting in this project.
- Keep dependencies few. Ask before adding one that is not listed here.

## Layout

```
src/core/       money, parsing, the ledger and its records, summaries, export (pure, no I/O)
src/channels/   ussd.ts (Africa's Talking USSD), sms.ts (Africa's Talking SMS), shared handler
src/store/      LedgerStore interface, memory store, Postgres store
src/ai/         the optional Gemini reader and the rule check on what it proposes
src/server/     the Hono app and its routes
public/         the in-browser feature phone for the demo (plain HTML, CSS and JavaScript)
docs/           export format, how to run the demo, judge test steps
test/           Vitest tests, mirroring src/
```

## Routes

- `POST /ussd`: Africa's Talking USSD callback (form fields `sessionId`, `serviceCode`, `phoneNumber`, `text`).
  Returns `text/plain` starting `CON ` or `END `.
- `POST /sms`: Africa's Talking incoming SMS callback (form fields `from`, `to`, `text`, `date`, `id`). Replies by
  sending an SMS through Africa's Talking when its credentials are set; always returns the reply text in the body
  so the browser phone and tests can read it.
- `POST /api/phone/ussd` and `POST /api/phone/sms`: JSON versions of the same two calls for the browser phone.
- `POST /api/phone/demo`: makes a demo shop with invented records (10 a hour per client address, 5,000 in all).
- `GET /api/ledger?phone=...`: the shop, today's figures, who owes and the last records, for the side panel (demo
  shops only).
- `GET /api/export?phone=...`: the owner's records in the export format (demo shops only).
- `GET /health`: `{"ok":true}`, without reading the store.

When `AT_CALLBACK_KEY` is set, `POST /ussd` and `POST /sms` need the query parameter `k` to equal it (403 otherwise).
A repeated `/sms` callback (same `id`) gets the first reply and is not handled again.

## Secrets

Secrets come only from environment variables (`DATABASE_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `AT_USERNAME`,
`AT_API_KEY`, `AT_SHORTCODE`, `AT_CALLBACK_KEY`, `PORT`, `TEST_DATABASE_URL`).
Never write a key, password or token into a file in this repository, including tests and docs. `.env` files are
ignored by git; `.env.example` lists the names with empty values.
