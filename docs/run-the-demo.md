# Run the demo

How to run the Imali AI feature-phone ledger on your machine, test it, put it on Vercel with a Neon database, and
connect an Africa's Talking sandbox to it. Variables are shown by name only. Never put a key, a password or a
connection string in a file that git tracks.

## 1. What you need

- Node.js 22 (`node --version` should say `v22`).
- A Neon account, for the live database (optional for a local run).
- A Vercel account, for the live server.
- An Africa's Talking sandbox app, for the dialled menu and the text messages.
- A phone number for the demo shop. Demo numbers are invented. They are written `+2700000` and four more digits, such
  as `+27000001234`.

## 2. Run it locally

```bash
npm ci
cp .env.example .env     # then fill in only what you need; every line may stay empty
npm run dev
```

`npm run dev` builds the code and starts the server on `http://localhost:3000`. It listens on this machine only
(`127.0.0.1`). To use another port, set `PORT` (a whole number from 1 to 65535). Run it from the repository root,
because the web page is read from the `public/` folder.

With no variables set, the server keeps records in memory (they are gone when you stop it) and reads messages with the
fixed rules only. Open `http://localhost:3000` to use the browser phone.

Try the server with curl:

```bash
# Is it up?
curl http://localhost:3000/health

# Make a demo shop with invented records. The answer holds the demo number.
# This is the only call that makes a demo shop.
curl -X POST http://localhost:3000/api/phone/demo

# Send a text message as that shop's owner (use the number from the answer above).
curl -X POST http://localhost:3000/api/phone/sms \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+27000001234","text":"sold 3 bread 45"}'

# Dial the menu the way Africa's Talking does (form fields).
curl -X POST http://localhost:3000/ussd \
  -d 'sessionId=ATUid_1' -d 'serviceCode=*384*46254#' -d 'phoneNumber=+254711000000' -d 'text='
```

If `POST /api/phone/demo` is given a number, it makes the shop for that number:
`-d '{"phone":"+27000001234"}'`.

Limits on demo shops:

- One client address may call `POST /api/phone/demo` 10 times an hour, and the whole site may make 1,000 demo shops a
  day. The server keeps at most 5,000 demo shops.
- Both of those counts are kept in the database, so they hold across Vercel's instances. The address is never stored:
  the table holds a SHA-256 hash of the address and `ADDRESS_SALT` (see Variables). Rows older than 24 hours are removed.
- The address is read from `x-real-ip` (Vercel sets it to the address that connected), then from the last entry of
  `x-forwarded-for`, then it is the shared key `unknown`. The first entry of `x-forwarded-for` is never used, because a
  caller can write it. An IPv6 address is counted by its first four groups (its /64, after `::` is expanded), because
  one client usually holds a whole /64 and could send each request from a new address in it. An IPv4-mapped IPv6
  address (`::ffff:a.b.c.d`) counts as the IPv4 address. An IPv4 address is used as it is.
- Demo shops are invented data and are cleared away 7 days after they were made (the shop's `createdAt` is the time it was
  made; its invented records are dated about 2 days earlier and do not count). Each call to `POST /api/phone/demo` first
  removes up to 50 demo shops made more than 7 days ago, with their records, so the cap of 5,000 frees itself. Only
  shops on a demo number are ever removed. A shop on any other number is never touched.
- Every browser route is also limited to 120 requests a minute per client address, besides 60 a minute per phone number.
  These two counts live in the memory of one instance.

### What the browser phone's routes answer

The page in `public/` calls these routes. All of them take a demo number (`+2700000` and four digits) and answer
JSON. `test/integration/page-contract.test.ts` runs the real app and reads these answers with the page's own code.

| Route | Answer |
|---|---|
| `POST /api/phone/ussd` `{ phone, sessionId?, text? }` | `{ response, length, limit }`: `response` starts `CON ` or `END `, `length` counts the text after that prefix, `limit` is 182. `404` and `{ error }` when the number has no shop |
| `POST /api/phone/sms` `{ phone, text }` | `{ reply, length, limit }`: `limit` is 160. `404` and `{ error }` when the number has no shop |
| `GET /api/ledger?phone=...` | `shop` (name, phone, currency, timeZone); `today` (date, `sales` `{ total, count }`, `expenses`, `moneyInHand`, `newDebts`, `paymentsReceived`, `totalOwed`); `owes` `{ customers: [{ name, owed }], more }`; `records` (the last 20, newest first: id, kind, amount, item?, customer?, channel, originalWords, createdAt, `reversed`, `reversesRecordId?`) |

Every money value is `{ cents, text }`: whole cents and the same amount written for the shop's currency. A demo shop
starts with 17 invented records spread over today and the two days before.

A demo number that has no shop is refused on `/api/phone/ussd` and `/api/phone/sms` with `404` and
`No demo shop on this number. Press Start demo shop.`, before any handler runs, and nothing is written. The dialled
menu and the text messages would otherwise sign a new owner up. Only `POST /api/phone/demo` makes demo shops. The page
treats that `404`, like the one from `/api/ledger`, as a stale number and quietly returns to the first-visit state.

The same holds on Africa's Talking's own addresses, with or without the callback key. `POST /ussd` for a demo number
with no shop answers `END No demo shop for this number. Start a demo first.`, and `POST /sms` answers that sentence as
its body and sends no text. Neither runs a handler or writes anything (no shop, no record, no waiting question, no
claim on the text's `id`). A demo number that has a shop can use `/ussd` and `/sms`, but those routes cannot make one.
With no sender and no key (a local run) the two addresses are open, so this is what stops them making demo shops. The
page asks for a shop with `POST /api/phone/demo` and an empty body `{}`, and uses the number in the `201` answer. The
server tries up to 20 free numbers, so the page never picks a number or retries a clash.

### Variables

| Name | What it does | If it is empty |
|---|---|---|
| `PORT` | Port for `npm run dev` | 3000 |
| `DATABASE_URL` | Postgres connection string (Neon) | records stay in memory |
| `GEMINI_API_KEY` | Turns on the optional model reader for messages the fixed rules cannot read | rules only |
| `GEMINI_MODEL` | Model name for the reader. Used only when `GEMINI_API_KEY` is set | the reader's own default |
| `GEMINI_VERTEX_PROJECT` | A Google Cloud project id. Used only when `GEMINI_API_KEY` is set: the reader then asks Gemini on Vertex AI in that project (global location), so the call is billed to the project's Cloud billing account. `GEMINI_API_KEY` is then a Google Cloud API key tied to a service account that may use Vertex AI | the Gemini API |
| `AT_USERNAME` | Africa's Talking app name. `sandbox` uses the sandbox host | no text replies are sent |
| `AT_API_KEY` | Africa's Talking API key | no text replies are sent |
| `AT_SHORTCODE` | Short code that text replies come from | `46254` (the sandbox short code) |
| `AT_CALLBACK_KEY` | Closes `/ussd` and `/sms` to anyone without `?k=<AT_CALLBACK_KEY>` in the address | with `AT_USERNAME` and `AT_API_KEY` set: both answer `503` until it is set. With no sender (a local run): both stay open |
| `ADDRESS_SALT` | A long random string. Client addresses are hashed with it before the demo limits are kept | a fixed built-in salt, the same in every instance (the start line says `salt=default`). The salt is in this public repository, so on Vercel set `ADDRESS_SALT`: without it anyone who can read the `demo_quota` table can recover IPv4 addresses by hashing every address, and the start-up warns. A local run has no warning |
| `TEST_DATABASE_URL` | A database the Postgres tests may use | those tests are skipped |

Replies go out as text messages only when both `AT_USERNAME` and `AT_API_KEY` are set. Replies to demo numbers are
never sent.

Two more limits, both in the memory of one instance: the model reader (`GEMINI_API_KEY`) is asked at most 200 times an
hour in all, and beyond that the fixed rules answer alone. `/ussd` and `/sms` accept 300 requests a minute per client
address and 30 a minute per phone number. The store also refuses to make more than 2,000 shops that are not demo shops.

## 3. Run the tests

```bash
npm run typecheck
npm test
npm run check:screens
```

`npm test` needs no network and no database. The Postgres tests are skipped, and their names say why. To see that:

```bash
npx vitest run test/store --reporter=verbose
```

Look for `PostgresStore contract (skipped: set TEST_DATABASE_URL to run)`.

To run the Postgres tests too, point `TEST_DATABASE_URL` at a database the tests may use. It must be a **direct**
connection (not Neon's pooled one). A local Postgres 14 or later works too.

```bash
TEST_DATABASE_URL='<direct connection string>' npx vitest run test/store
```

Against a remote database a test can take several seconds, so every test in a Postgres suite gets 30 seconds and
the suite's set-up and clean-up get 60 (set once in `describePostgres` in `test/helpers/pg.ts`).

Each suite makes a schema of its own (named `t_` and random hex), runs inside it, and drops it at the end. It never
reads or changes anything in other schemas.

The suite picks its schema with the libpq `options` start-up parameter (`-c search_path=<schema>`). Neon's proxy drops
a plain `search_path` start-up parameter but honours `options`, and plain PostgreSQL honours both. Right after
connecting, the test helper runs `show search_path`. If the answer is not exactly the suite's schema, it stops with an
error that says so, before it migrates anything or runs a test, and it drops the empty schema it made. That error means
the URL is a pooled one, or a proxy dropped the option. Use the direct connection string.

## 4. Neon (the live database)

1. In Neon, create a project and a database.
2. Copy the connection strings from the Neon page. There are two: a **pooled** one and a **direct** one.
3. Put the string in your shell or in `.env` (which git ignores). Never put it in a tracked file.
4. Create the tables:

   ```bash
   DATABASE_URL='<connection string>' npm run db:migrate
   ```

   It prints `applied 001_init.sql` and `applied 002_demo_quota.sql`. Run it again and it prints `Nothing to apply.` If
   `DATABASE_URL` is empty it says so and stops, and it never prints the value. A migration that has been applied is
   never edited; a change goes in a new file.
5. Check that Neon now has five tables: `shops`, `records`, `pending_questions`, `processed_texts` and `demo_quota`
   (plus `schema_migrations`). `demo_quota` holds the demo limits per address hash; it never holds an address.

Use the **pooled** string as `DATABASE_URL` on Vercel. Use the **direct** string as `TEST_DATABASE_URL`.

### Migrations are not run by a deploy

Nothing runs migrations when Vercel deploys (`vercel.json` has no build step that does). **Every deploy that adds a
file in `sql/` needs `npm run db:migrate` against the direct (unpooled) connection string before that deployment is
promoted.** Until it has run, any code that needs the new table answers `500`. The order is:

1. Run `DATABASE_URL='<direct connection string>' npm run db:migrate` and check that it printed the new file's name.
2. Then promote the deployment (or merge, if merging deploys to production).

Use the direct string, not the pooled one, for the migration.

## 5. Vercel (the live server)

1. Import the repository in Vercel. Leave the framework as **Other**. Vercel reads `vercel.json`, serves `public/` as
   static files and sends `/ussd`, `/sms`, `/health` and `/api/*` to the function in `api/index.ts`.
2. Add the environment variables: `DATABASE_URL`, `ADDRESS_SALT` (a long random string), and if you want them
   `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_VERTEX_PROJECT`, `AT_USERNAME`, `AT_API_KEY`, `AT_SHORTCODE` and `AT_CALLBACK_KEY`. Set
   `AT_CALLBACK_KEY` whenever you set `AT_USERNAME` and `AT_API_KEY` (see "The callback key").
3. Pick a function region near your Neon region.
4. If this deploy adds a file in `sql/`, run `npm run db:migrate` against the direct connection string first (see
   "Migrations are not run by a deploy"). Then deploy, and open `https://imali-ai-feature-phone.vercel.app/health`. It
   should say `{"ok":true}`.

Vercel runs Node 22 because `package.json` says `"engines": { "node": "22.x" }`.

## 6. Africa's Talking sandbox

Set `AT_USERNAME` to `sandbox` and `AT_API_KEY` to the key of your sandbox app on Vercel, then:

- **Dialled menu.** The sandbox channel is `*384*46254#`. Set its callback to
  `https://imali-ai-feature-phone.vercel.app/ussd`.
- **Text messages.** The short code is `46254`. Set its incoming-message callback to
  `https://imali-ai-feature-phone.vercel.app/sms`.
- **Replies.** Text replies go out from the short code in `AT_SHORTCODE` (it is `46254` when the variable is empty).

### The callback key

Africa's Talking does not sign its callbacks. To keep strangers out, set `AT_CALLBACK_KEY` on Vercel to a long random
string, and end both callback addresses with `?k=` and that string:

- `https://imali-ai-feature-phone.vercel.app/ussd?k=<AT_CALLBACK_KEY>`
- `https://imali-ai-feature-phone.vercel.app/sms?k=<AT_CALLBACK_KEY>`

A call without the right `k` gets `403` and a plain sentence, and nothing is read or saved. The key is part of the
address, so it can show in request logs. Change it if it leaks. The browser phone and `/health` never need the key.

Without a key, anyone could read and write the ledger of any number and make the server send texts from your account.
So when `AT_USERNAME` and `AT_API_KEY` are set and `AT_CALLBACK_KEY` is not, `/ussd` and `/sms` answer `503` and a plain
sentence, nothing is read or saved, and the start line says `callback=missing-key`. The server still starts and the
browser phone still works. With no sender (a local run) both addresses are open, as before.

### Repeated text callbacks

Africa's Talking can send the same incoming text twice. It gives each text an `id`. The server remembers the ids it has
handled for 48 hours and answers a repeat with the reply it gave the first time. The text is not read again and nothing
is saved twice.

### Try it

1. In the Africa's Talking simulator, dial `*384*46254#`. The first time, it asks for a shop name.
2. Send a text to `46254`, such as `sold 3 bread 45`. The reply is sent back from `46254`.

## 7. If something fails

| What you see | What it means |
|---|---|
| `Sorry, something went wrong. Please try again.` | The server hit an error it did not expect. The full error is in the log (Vercel: the project's runtime logs). The log line has the route, the error name, message and stack, and a masked phone number. |
| `This shop book is full. Please start a new demo shop.` | The shop already holds 2,000 records. |
| `Too many requests. Please wait a minute and try again.` | One phone number made more than 60 browser requests in a minute, or one address more than 120 (browser routes) or 300 (`/ussd` and `/sms`), or one phone number more than 30 on `/ussd` and `/sms`. |
| `Too many demo shops from this address.` | One address made 10 calls to `POST /api/phone/demo` in an hour. |
| `The demo is full right now.` | The server already holds 5,000 demo shops, or the site made 1,000 today. |
| `No demo shop on this number. Press Start demo shop.` (404) | A browser route was called for a demo number with no shop (never made, or cleared away after about a week). |
| `Sorry, no new shops can be added right now.` | The store already holds 2,000 shops that are not demo shops. |
| `403 Not allowed.` on `/ussd` or `/sms` | `AT_CALLBACK_KEY` is set and the address has no matching `?k=`. |
| `503 This service is not set up yet.` on `/ussd` or `/sms` | The Africa's Talking sender is set but `AT_CALLBACK_KEY` is not. Set the key. |
| `Use a demo number: +2700000 followed by 4 digits.` | The browser routes accept demo numbers only. |
| `Got your message. Working on it.` | A repeat of a text arrived while the first one was still being handled. |
| Start-up warning: ADDRESS_SALT is not set, so stored address hashes use the public default salt | The server is on Vercel without `ADDRESS_SALT`. Set it to a long random string. |
| `500` or `Sorry, something went wrong.` right after a deploy, and the log names a missing table | The deploy added a file in `sql/` and `npm run db:migrate` has not been run. Run it against the direct connection string. |
| `END No demo shop for this number. Start a demo first.` on `/ussd`, or that sentence as the body of `/sms` | A demo number with no shop. Only `POST /api/phone/demo` makes demo shops. |
| Start-up warning: records are not kept between calls | The server is on Vercel without `DATABASE_URL`, so records live in one instance's memory. Set `DATABASE_URL`. |

No answer ever holds a stack trace, a database message or a connection string.

### Checks for the first deploy

- `GET /health` answers `{"ok":true}`.
- `POST /api/phone/demo` creates a shop, and its rows appear in Neon.
- `POST /ussd` with the form fields above answers `CON ...`. With `AT_CALLBACK_KEY` set, it answers `403` without
  `?k=` and `CON ...` with it.
- The runtime log shows one start line such as `store=postgres gemini=vertex sms=sandbox callback=key salt=set`, and no
  secret. `gemini=vertex` means the model reader asks Gemini on Vertex AI, `gemini=on` the Gemini API, `gemini=off` that the rules read alone. `callback=missing-key` means `/ussd` and `/sms` are answering `503`; `salt=default` means `ADDRESS_SALT` is not set.
- A request to `/sms` reaches the function with the path `/sms`. The rewrite in `vercel.json` should keep the original
  path. If it does not, see "Risks and known gaps" in `.kiro/specs/server-and-store/design.md` for the fallbacks.
