# Imali AI feature-phone ledger

Imali AI: Africa's smartest AI Business OS.

Imali AI runs the books, stock and sales of shops, suppliers and company groups. This open-source companion keeps a
shop's books for owners whose phones cannot run WhatsApp. The owner dials a short code or sends a plain text message such
as `sold 3 bread 45` or `Tendai owes 20 sugar`. The ledger saves the sale, expense, credit or payment in whole cents and
replies with the new figure. It works on any phone that can dial a code or send a text, without a data bundle or an
app. The ledger exports every record as one JSON file in an open format, documented in
`docs/export-format.md`, so the owner keeps a full copy of the books.

**Live demo:** https://imali-ai-feature-phone.vercel.app

Kiro wrote the application code from the steering, specs and hooks in `.kiro/`. Six later changes to the code
and its tests were made by hand, outside Kiro; `docs/built-with-kiro.md` lists them. This repository is our entry for
Kiroween 2026 in the Resurrection category: the keypad phone and its dialled menus, brought back to keep a shop's books.

## Try the demo

The demo page draws a working feature phone that calls the same handler as the real network. A new demo shop already
has records from its last three days, so each step shows as a change on the ledger card.

1. Open the live demo and press "Start demo shop".
2. Press "Menu", then "Send", to dial `*384*46254#`. Choose `1` Sale, type `45`, skip the item with `1` and save
   with `1`. The ledger card shows the sale.
3. Press "Messages" and type `Tendai owes 20 sugar`, then `who owes`, then `undo`, then `close`.
4. Press "Export records" to download every record as a JSON file.

`docs/judges.md` has the full check list for screens 1280 px and 390 px wide, every state the page can show and what
the ledger card should read after each step.

The same handler answers Africa's Talking's sandbox, on the USSD channel `*384*46254#` and the short code `46254`. To
try that route yourself, `docs/run-the-demo.md` shows how to point your own Africa's Talking sandbox app at a copy of
this server.

## What it does

The dialled menu (USSD) shows numbered screens of at most 182 characters, and each text message gets one reply of at
most 160 characters. Both find the shop by the same phone number, so a sale typed by text shows in the menu and the
other way round.

The owner can record a sale, an expense, money owed and money paid back, undo the last record, and ask for today's
figures, who owes and the closing summary for the day. Undo never deletes: it adds a record that reverses the last one,
so the history stays whole.

Amounts are whole cents from the moment they are read. The ledger supports seven currencies (ZAR, USD, KES, NGN, GHS,
ZMW and BWP), and each shop's day runs in its own time zone.

When a message could mean two things, such as `sold 2 200`, the ledger asks which one before it saves. An optional
model reader, off unless it is set up (`docs/run-the-demo.md` lists the settings), may suggest a reading for a message the
rules cannot read, and the ledger keeps the suggestion only if the amount and the name appear in the owner's own words.
The live demo has the reader switched on. The rules read every message they can without it.

A repeated menu request saves once, and a repeated text callback gets the first reply again without saving anything
new. A callback key keeps `/ussd` and `/sms` closed to anyone but the network, and the public demo limits how many demo
shops one visitor can make and removes demo shops after a week.

## Development goals

The ledger serves two targets of the UN Sustainable Development Goals:

- SDG 8, target 8.3: "Promote development-oriented policies that support productive activities, decent job creation,
  entrepreneurship, creativity and innovation, and encourage the formalization and growth of micro-, small- and
  medium-sized enterprises, including through access to financial services."
- SDG 9, target 9.3: "Increase the access of small-scale industrial and other enterprises, in particular in developing
  countries, to financial services, including affordable credit, and their integration into value chains and markets."

A shop owner with any phone that can dial a code or send a text keeps a dated record of every sale, expense, debt and
payment. The export turns that record into one file the owner can show a lender, a supplier or a savings group, which
is the record of trading that credit and formal growth start from.

## Run it locally

You need Node.js 22.

```bash
npm ci
npm run dev        # http://localhost:3000, records kept in memory
```

With no variables set, the server keeps records in memory and reads messages with the rules only. Copy `.env.example`
to `.env` to add a database or an Africa's Talking app. `docs/run-the-demo.md` explains each variable, the database
set-up, the deploy and the sandbox callbacks.

## Run it anywhere

Every part the ledger needs is open source: Node.js, Hono, and PostgreSQL through the `postgres` driver. Three parts
are built to be swapped for another provider:

- The network gateway. Africa's Talking's menu and text callbacks arrive in `src/server/routes/at.ts`, which hands
  them to `handleUssd` and `handleText`. Replies go out through the `SmsSender` interface in `src/server/sender.ts`
  (`send(to, message)`). Any USSD or SMS gateway that posts callbacks needs a route of its own and a sender.
- The store. `LedgerStore` in `src/store/interface.ts` has two versions, in memory and on Postgres.
- The model reader. `ModelReader` in `src/ai/reader.ts` takes the text of one message (`read(text)`). The Gemini
  reader is used when `GEMINI_API_KEY` is set. Leave it unset and the rules read every message they can, or put
  another model behind the same interface.

## Run the tests

```bash
npm run typecheck
npm test
npm run check:screens
npm run build
```

`npm test` needs no network and no database. It covers money parsing and formatting, every record kind, undo, the
day's figures in each time zone, both channels end to end, the server routes and their limits, and the page's own
logic. `npm run check:screens` plays every menu screen and every text reply with long, realistic data in all seven
currencies and fails if one is over its limit or not plain ASCII. On 7 November 2026 the longest menu screen it found
was 178 of 182 characters and the longest text reply 158 of 160.

To run the Postgres tests against a database of your own, set `TEST_DATABASE_URL` to a direct connection string. Each
suite works in a schema of its own and drops it at the end.

## How Kiro built it

`.kiro/steering/` holds the rules Kiro follows on every task: who the shop owner is, how money and records work, the
screen limits and the technology choices.

`.kiro/specs/` holds one spec per feature, from the money core to the browser phone, each with requirements, a design
and a task list that Kiro worked through and ticked off. The table in `docs/built-with-kiro.md` lists them.

`.kiro/hooks/` runs the tests when a source file is saved, checks screen lengths, scans staged files for keys before a
commit, and runs the type check and the tests each time Kiro finishes, so Kiro answers what they report.

`docs/built-with-kiro.md` describes how each spec was written and built, what our reviews sent back and what Kiro found
in its own work. The briefs for the runs from 7 November 2026 on are in `docs/kiro-briefs/`; the first day's briefs were not
kept.

## Privacy and safety

`PRIVACY.md` says what the ledger stores and for how long, who can read it, how an owner gets a copy or has a shop
erased, the data protection laws an operator must follow, and how the design keeps the service from being used to harm
anyone. Report a security or privacy problem to security@ebenworks.co.

## Outside code

The server uses three npm packages: `hono` and `@hono/node-server` for the routes, and `postgres` for the database. The
tests and build use `typescript`, `vitest`, `fast-check` and `@types/node`. The page serves the Fraunces, Geist, Geist
Mono and VT323 fonts from its own folder (`public/`), under the SIL Open Font License 1.1; the licence texts are in
`LICENSES/fonts/`. No code was copied from other projects.

## Licence

MIT. See `LICENSE`.
