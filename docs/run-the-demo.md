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
`-d '{"phone":"+27000001234"}'`. The same address may make 10 demo shops an hour, and the server keeps at most 5,000
demo shops.

### Variables

| Name | What it does | If it is empty |
|---|---|---|
| `PORT` | Port for `npm run dev` | 3000 |
| `DATABASE_URL` | Postgres connection string (Neon) | records stay in memory |
| `GEMINI_API_KEY` | Turns on the optional model reader for messages the fixed rules cannot read | rules only |
| `GEMINI_MODEL` | Model name for the reader. Used only when `GEMINI_API_KEY` is set | the reader's own default |
| `AT_USERNAME` | Africa's Talking app name. `sandbox` uses the sandbox host | no text replies are sent |
| `AT_API_KEY` | Africa's Talking API key | no text replies are sent |
| `AT_SHORTCODE` | Short code that text replies come from | `46254` (the sandbox short code) |
| `AT_CALLBACK_KEY` | Closes `/ussd` and `/sms` to anyone without `?k=<AT_CALLBACK_KEY>` in the address | both stay open |
| `TEST_DATABASE_URL` | A database the Postgres tests may use | those tests are skipped |

Replies go out as text messages only when both `AT_USERNAME` and `AT_API_KEY` are set. Replies to demo numbers are
never sent.

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

   It prints `applied 001_init.sql`. Run it again and it prints `Nothing to apply.` If `DATABASE_URL` is empty it says
   so and stops, and it never prints the value.
5. Check that Neon now has four tables: `shops`, `records`, `pending_questions` and `processed_texts`
   (plus `schema_migrations`).

Use the **pooled** string as `DATABASE_URL` on Vercel. Use the **direct** string as `TEST_DATABASE_URL`.

## 5. Vercel (the live server)

1. Import the repository in Vercel. Leave the framework as **Other**. Vercel reads `vercel.json`, serves `public/` as
   static files and sends `/ussd`, `/sms`, `/health` and `/api/*` to the function in `api/index.ts`.
2. Add the environment variables: `DATABASE_URL`, and if you want them `GEMINI_API_KEY`, `GEMINI_MODEL`,
   `AT_USERNAME`, `AT_API_KEY`, `AT_SHORTCODE` and `AT_CALLBACK_KEY`.
3. Pick a function region near your Neon region.
4. Deploy, then open `https://imali-ai-feature-phone.vercel.app/health`. It should say `{"ok":true}`.

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
address, so it can show in request logs. Change it if it leaks. With `AT_CALLBACK_KEY` empty, both addresses are open.
The browser phone and `/health` never need the key.

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
| `Too many requests. Please wait a minute and try again.` | One phone number made more than 60 browser requests in a minute. |
| `Too many demo shops from this address.` | One address made 10 demo shops in an hour. |
| `The demo is full right now.` | The server already holds 5,000 demo shops. |
| `403 Not allowed.` on `/ussd` or `/sms` | `AT_CALLBACK_KEY` is set and the address has no matching `?k=`. |
| `Use a demo number: +2700000 followed by 4 digits.` | The browser routes accept demo numbers only. |
| `Got your message. Working on it.` | A repeat of a text arrived while the first one was still being handled. |
| Start-up warning: records are not kept between calls | The server is on Vercel without `DATABASE_URL`, so records live in one instance's memory. Set `DATABASE_URL`. |

No answer ever holds a stack trace, a database message or a connection string.

### Checks for the first deploy

- `GET /health` answers `{"ok":true}`.
- `POST /api/phone/demo` creates a shop, and its rows appear in Neon.
- `POST /ussd` with the form fields above answers `CON ...`. With `AT_CALLBACK_KEY` set, it answers `403` without
  `?k=` and `CON ...` with it.
- The runtime log shows one start line such as `store=postgres gemini=off sms=sandbox callback=key`, and no secret.
- A request to `/sms` reaches the function with the path `/sms`. The rewrite in `vercel.json` should keep the original
  path. If it does not, see "Risks and known gaps" in `.kiro/specs/server-and-store/design.md` for the fallbacks.
