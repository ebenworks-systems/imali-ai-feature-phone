# Dialled Menu (USSD) - Design

## What the existing code tells us

These facts come from reading `src/core`, `src/store` and `src/channels/sms` as they are today. Each one shapes a
decision below.

| Fact in the code | What the menu does about it |
|---|---|
| The ledger operations and queries take a `Shop` object, not a shop id (`recordSale(store, shop, ...)`, `getTodaySummary(store, shop, now)`). The older `design.md` of `ledger-core` says `shopId`; the code wins. | Signatures below use `Shop`. |
| `Figure.cents` is the amount just saved, not the new total. `recordSale` returns `{ kind: 'salesToday', cents: 4500 }` for a R45 sale. | "Sales today R1,285" is worked out after the save with `getTodaySummary`, and a customer's total with `getCustomerBalance`. |
| `recordSale`, `recordExpense`, `recordDebt` and `recordPayment` do not check the amount is above zero. They return `needsConfirmation` (and save nothing) when `amount.requiresConfirmation` is true. | The menu checks the amount with `validateAmount` before any confirm screen. After the owner's second confirm it passes `{ cents, requiresConfirmation: false }`. |
| `parseAmount("2 200", ...)` returns `ambiguous` with two amounts (R200 and R2,200). `"2,200"` already returns R2,200. | `readAmount` takes the larger amount of an `ambiguous` result, which is always the thousands reading. A test pins this. |
| The record and shop factories always generate a random id. `MemoryStore.appendRecord` accepts a record whose id already exists (it overwrites the map entry and adds a second copy to the list). `MemoryStore.createShop` overwrites silently. | Three small core and store changes (tasks 3 to 5): an optional `id`, and typed duplicate errors. They are backwards compatible. |
| `findShopByPhone` is an exact string match. Tests and seeds use `+27 00 000 1234` with spaces. Africa's Talking sends `+27000001234`. `normalizePhone` is described in the old design but does not exist. | `src/channels/phone.ts` makes one normalised form. Both channels use it. |
| `undoLastRecord` reverses `activeRecords(...)`'s last record, and returns `{ success: false, error: 'Nothing to undo' }` when there is none. Its `figure` is the undone amount, not a new total. | The undo preview uses the same `activeRecords` call, a test checks that the preview and the undone record agree, and the new figure is read after the undo. |
| `createShop` stamps its own `createdAt` from the system clock. | Left alone. Only `createdAt` on a new shop is affected; no test depends on it. |
| `src/channels/index.ts` does not exist yet. The `text-messages` handler, replies, pending store and model reader are not built (its tasks are unticked). | This spec creates `src/channels/index.ts` (or adds one line if the text-messages work has made it by then). Tasks 30 and 31 are blocked on the text-messages handler and replies. |

## Modules

```
src/channels/
  index.ts              re-exports handleUssd and its two types (the only public surface of this spec)
  limits.ts             USSD_LIMIT, SMS_LIMIT, isPlainAscii, ussdProblems, smsProblems
  phone.ts              normalizePhone (shared by the menu and the text messages)
  ussd/
    handler.ts          handleUssd, runMenu
    request.ts          readRequest: checks the network fields, splits the path
    ids.ts              recordIdFor, shopIdFor
    input.ts            readAmount, readShopName, readCustomerName, readItem
    text.ts             plain, clip, money, dayLabel, NOTICE
    screen.ts           SCREEN_IDS, Screen, toResponse (the length guard)
    pages.ts            paginate and the two list budgets
    screens.ts          renderers for the screens the owner answers, and the list screens
    results.ts          renderers for the ending screens
    machine.ts          Frame, Draft, Terminal, replay (the state machine)
    ports.ts            MenuPorts, makePorts (reads and the idempotent shop creation)
    actions.ts          saveDraft, undoLast (the idempotent writes)
    worst-case.ts       seedWorstCase, WORST_SESSIONS (shared by the tests and check:screens)
scripts/check-screens.mjs
test/helpers/phone.ts
```

Dependencies point one way: `handler` uses `machine`, `ports`, `actions`, `screens`, `results`; `machine` uses
`input`, `pages` and `ports` (an interface); `screens` and `results` use `text`, `screen` and `src/core`. Nothing
under `src/core` imports from `src/channels`.

## Public signatures

```ts
// src/channels/ussd/handler.ts  (exported from src/channels/index.ts)
export interface HandleUssdParams {
  sessionId: string;
  serviceCode: string;   // read but not used; a later spec may use it for shortcuts
  phoneNumber: string;
  text: string;
  now: Date;
  store: LedgerStore;
}
export interface HandleUssdResult { response: string }
export async function handleUssd(params: HandleUssdParams): Promise<HandleUssdResult>;

// Same work, also says which screen was shown. For tests and check:screens only; not exported from index.ts.
export async function runMenu(params: HandleUssdParams): Promise<{ response: string; screen: ScreenId }>;
```

```ts
// src/channels/limits.ts
export const USSD_LIMIT = 182;
export const SMS_LIMIT = 160;
export function isPlainAscii(text: string): boolean;        // chars 32..126 and '\n' only
export function ussdProblems(response: string): string[];   // [] when fine; else "no CON/END prefix", "over 182", "not ASCII"
export function smsProblems(reply: string): string[];       // [] when fine; else "over 160", "not ASCII"

// src/channels/phone.ts
export function normalizePhone(raw: string): string | null; // "+27 00 000 1234" -> "+270000001234"; null when not 7-15 digits
```

```ts
// src/channels/ussd/request.ts
export const MAX_TEXT_LENGTH = 500;
export const MAX_INPUTS = 30;
export interface MenuRequest { sessionId: string; phone: string; inputs: string[] }
export function readRequest(p: { sessionId: string; phoneNumber: string; text: string }):
  { ok: true; request: MenuRequest } | { ok: false };

// src/channels/ussd/ids.ts
export function recordIdFor(sessionId: string, step: number): string; // rec_ussd_<sessionId>_<step>
export function shopIdFor(sessionId: string): string;                 // shop_ussd_<sessionId>

// src/channels/ussd/input.ts
export type AmountReading = { ok: true; cents: number; big: boolean } | { ok: false; notice: string };
export function readAmount(raw: string, currency: Currency): AmountReading;
export type TextReading = { ok: true; value: string } | { ok: false; notice: string };
export function readShopName(raw: string): TextReading;      // uses validateShopName after trimming
export function readCustomerName(raw: string): TextReading;
export function readItem(raw: string): TextReading;
export const MAX_SHOP_NAME = 24, MAX_CUSTOMER_NAME = 20, MAX_ITEM = 20;

// src/channels/ussd/text.ts
export function plain(text: string): string;               // anything outside 32..126 becomes '?'
export function clip(text: string, max: number): string;   // plain(text), cut at max characters
export function money(cents: number, currency: Currency): string; // formatCents
export function dayLabel(date: string): string;            // "2025-11-03" -> "Mon 3 Nov"
export const NOTICE: { readonly [key: string]: string };   // every notice text, listed under "Notices"
```

```ts
// src/channels/ussd/screen.ts
export const SCREEN_IDS = [
  // the session continues (CON)
  'signupName', 'signupCurrency', 'main', 'amount', 'item', 'customer', 'payWho',
  'confirm', 'confirmBig', 'owesList', 'undoConfirm',
  // the session ends (END)
  'saved', 'undone', 'today', 'close', 'owesEnd', 'owesNone', 'nothingToUndo',
  'saveFailed', 'badRequest', 'tooBig',
] as const;
export type ScreenId = (typeof SCREEN_IDS)[number];

export interface Screen {
  id: ScreenId;
  end: boolean;
  notice?: string;       // first line, dropped first when the screen is too long
  lines: string[];       // joined with '\n'
  shrink?: string[][];   // smaller versions of `lines`, tried in order (used by the closing summary)
}
export function toResponse(screen: Screen): string; // the length guard: see "Keeping within 182"
```

```ts
// src/channels/ussd/pages.ts
export interface PageRange { start: number; end: number }  // end is exclusive
export function paginate(rowLengths: number[], budget: number, maxRows: number): PageRange[];
export function payWhoBudget(): number;                    // 117
export function owesBudget(headerLength: number): number;  // 182 - notice - header - "9 More"
```

```ts
// src/channels/ussd/machine.ts
export type Kind = 'sale' | 'expense' | 'debt' | 'payment';
export interface Draft { kind: Kind; customer?: string; cents?: number; item?: string; bigOk?: boolean }
export type Frame =
  | { id: 'signupName' } | { id: 'signupCurrency'; name: string }
  | { id: 'main' }
  | { id: 'amount'; draft: Draft } | { id: 'item'; draft: Draft } | { id: 'customer'; draft: Draft }
  | { id: 'payWho'; page: number }
  | { id: 'confirm'; draft: Draft } | { id: 'confirmBig'; draft: Draft }
  | { id: 'owesList'; page: number }
  | { id: 'undoConfirm' };
export type Terminal =
  | { type: 'save'; draft: Draft; step: number }   // step = inputs read, counting the confirming one
  | { type: 'undo'; step: number }
  | { type: 'today' } | { type: 'close' }
  | { type: 'owesEnd'; page: number } | { type: 'owesNone' } | { type: 'nothingToUndo' };
export interface MenuState { frames: Frame[]; notice?: string; terminal?: Terminal }
export async function replay(inputs: string[], ports: MenuPorts, start: 'signup' | 'main'): Promise<MenuState>;

// src/channels/ussd/ports.ts
export interface UndoTarget { id: string; kind: Kind; cents: number; item?: string; customer?: string }
export interface MenuPorts {
  shop: Shop | null;                                         // set by createShop
  createShop(name: string, choice: number): Promise<Shop>;   // choice 1..7; idempotent
  owes(): Promise<CustomerBalance[]>;                        // largest first; ties by lower-case name
  undoTarget(): Promise<UndoTarget | null>;                  // what undoLastRecord would reverse
}
export function makePorts(a: { store: LedgerStore; shop: Shop | null; sessionId: string; phone: string; now: Date }): MenuPorts;

// src/channels/ussd/actions.ts
export interface ActionContext { store: LedgerStore; shop: Shop; sessionId: string; path: string[]; now: Date }
export type SaveOutcome = { ok: true; facts: SavedFacts } | { ok: false };
export type UndoOutcome = { ok: true; facts: UndoneFacts } | { ok: false; nothingToUndo: boolean };
export async function saveDraft(ctx: ActionContext, draft: Draft, step: number): Promise<SaveOutcome>;
export async function undoLast(ctx: ActionContext, step: number): Promise<UndoOutcome>;
```

`SavedFacts` and `UndoneFacts` hold the entry (`kind`, `cents`, `item?`, `customer?`) and the new figure
(`{ kind: 'salesToday' | 'expensesToday', cents }` or `{ kind: 'balance', customer, cents, wording: 'total' | 'now' }`
where `cents` is positive when the customer owes and negative when the customer has credit). The renderers in
`results.ts` turn them into text.

### Changes to the core and the store (tasks 3 to 5)

```ts
// src/core/records/types.ts: create*Record params and createReversal get an optional id
createSaleRecord(shopId, { ..., id?: string });   // likewise Expense, Debt, Payment
createReversal(record, channel, originalWords, now, id?: string);
// src/core/ledger/operations.ts: recordSale/Expense/Debt/Payment params and undoLastRecord params get `id?: string`
// src/core/shops/types.ts: createShop params get `id?: string`

// src/store/interface.ts
export class DuplicateRecordError extends Error { constructor(recordId: string) }    // name = 'DuplicateRecordError'
export class ShopAlreadyExistsError extends Error { constructor(detail: string) }    // name = 'ShopAlreadyExistsError'
// appendRecord: throws DuplicateRecordError when the id is held. This check comes BEFORE the reversed-once check.
// createShop: throws ShopAlreadyExistsError when the id or the phone already has a shop.
```

The future Postgres store has to give the same two errors from a primary key on the record id and a unique index on
the shop's phone. The tests in `test/store/memory/store.test.ts` describe the behaviour it must match.

## Handling one request

```
runMenu(params):
  1. readRequest(...)                   not ok -> badRequest screen (no store access)
  2. shop = store.findShopByPhone(phone)
     start = 'signup'  when shop is null OR shop.id === shopIdFor(sessionId)   (made earlier in this session)
             'main'    otherwise
  3. ports = makePorts(...)
     state = replay(inputs, ports, start)            // reads the inputs one by one
  4. state.terminal set?
        yes -> run it (save / undo / today / close / owes / nothing to undo) and show the END screen
        no  -> show the top frame of state.frames, with state.notice as its first line (CON)
  5. toResponse(screen)                              // prefix and length guard
  any thrown error in 1-5 -> log name and message only, return the badRequest screen
```

`handleUssd` is `runMenu` without the screen id.

### How the state machine reads the path

`replay` starts with one frame on the stack: `signupName` when `start` is `'signup'`, `main` otherwise. For each
input (trimmed) in order:

1. `00`: stack becomes the bottom frame only (`main`, or `signupName` while there is no shop). Notice cleared.
2. `0`: pop one frame unless only one is left. Notice cleared.
3. Anything else goes to the transition for the top frame (table below). A transition returns one of: push a frame,
   replace the stack, stay (with an optional notice), or a `Terminal`.
4. The notice is set only by the last input processed. An earlier refused input leaves the stack unchanged and its
   notice is overwritten by the next input, so the screen depends on the last input only (requirement 13).
5. A `Terminal` stops the loop. Inputs after it are ignored (requirement 14). Its `step` is the 1-based position of the
   input that produced it.

`0` and `00` are read before the screen's own rules, on typed screens too. So a customer cannot be called `0` or `00`,
and an item cannot be `0` or `00`. An amount of `0` was never valid.

### Transitions

`amount`, `item`, `customer` and `confirm` frames carry the `Draft` built so far, so going back with `0` returns to
the earlier screen with the earlier answers still in place.

| Top frame | Input | Result |
|---|---|---|
| `signupName` | text accepted by `readShopName` | push `signupCurrency{name}` |
| | refused | stay, notice from `readShopName` |
| `signupCurrency` | `1`..`7` | `ports.createShop(name, n)`, then stack = `[main]` |
| | other | stay, `Choose a number from the list.` |
| `main` | `1` | push `amount{kind: sale}` |
| | `2` | push `amount{kind: expense}` |
| | `3` | push `customer{kind: debt}` |
| | `4` | `owes()` empty: push `customer{kind: payment}`; else push `payWho{page: 1}` |
| | `5` | terminal `today` |
| | `6` | `owes()` empty: terminal `owesNone`; one page: terminal `owesEnd{1}`; else push `owesList{1}` |
| | `7` | `undoTarget()` null: terminal `nothingToUndo`; else push `undoConfirm` |
| | `8` | terminal `close` |
| | other | stay, `Choose a number from the list.` |
| `customer` | accepted by `readCustomerName` | push `amount{draft + customer}` |
| | refused | stay, notice |
| `payWho{page}` | `1`..`k` (k = customers on this page) | push `amount{payment, customer = that row}` |
| | `8` | push `customer{kind: payment}` |
| | `9` when more pages | push `payWho{page + 1}` (so `0` returns to the page before) |
| | other | stay, `Choose a number from the list.` |
| `amount` | accepted by `readAmount` | sale, expense, debt: push `item{draft + cents}`; payment: push `confirm{draft + cents}` |
| | refused | stay, notice from `readAmount` |
| `item` | `1` | push `confirm{draft}` (no item) |
| | accepted by `readItem` | push `confirm{draft + item}` |
| | refused | stay, notice |
| `confirm` | `1` | `cents` over 100,000,000: push `confirmBig{draft}`; else terminal `save` |
| | `2` | stack = `[main]`, notice `Not saved.` |
| | other | stay, `Choose a number from the list.` |
| `confirmBig` | `1` | terminal `save` with `bigOk: true` |
| | `2` | stack = `[main]`, notice `Not saved.` |
| `owesList{page}` | `9` | next page is the last: terminal `owesEnd{page + 1}`; else push `owesList{page + 1}` |
| | other | stay, `Choose a number from the list.` |
| `undoConfirm` | `1` | terminal `undo` |
| | `2` | stack = `[main]`, notice `Not undone.` |
| | other | stay, `Choose a number from the list.` |

Pages are always recomputed from the current records, and a page number past the end is clamped to the last page.

### Why an earlier list can change under the owner

Each request recomputes the paid-back list, so if a text message changes who owes between two requests, `1` can mean a
different customer than the one the owner saw. The confirm screen therefore repeats the customer's name and the amount,
and the owner sees the mistake before anything is saved. The undo screen has the same gap (another channel can add a
record between the preview and the `1`). The `Undone:` screen names the record that was really undone. A path cannot
carry more than the owner's keystrokes, so closing the gap fully would need server state, which this spec avoids.

## Screens and exact texts

`<Notice>` below means "the notice line, when there is one, comes first". Money is `formatCents` (`R45`, `R45.50`,
`R1,240`). `X` is a customer name (clipped to 20), `item` is clipped to 20, and the shop name to 24, all through
`plain`. `CON ` or `END ` is added by `toResponse`.

### Sign-up (CON)

```
<Notice>Welcome to the Imali AI ledger. Your shop name?
```
```
<Notice>Which money do you use?
1 R South Africa
2 $ US dollar
3 KSh Kenya
4 N Nigeria
5 GHS Ghana
6 K Zambia
7 P Botswana
```

| Choice | Currency | Time zone |
|---|---|---|
| 1 | ZAR | Africa/Johannesburg |
| 2 | USD | Africa/Johannesburg |
| 3 | KES | Africa/Nairobi |
| 4 | NGN | Africa/Lagos |
| 5 | GHS | Africa/Accra |
| 6 | ZMW | Africa/Lusaka |
| 7 | BWP | Africa/Gaborone |

### Main menu (CON)

```
<Notice><Shop name>
Today: sales R1,240
1 Sale
2 Expense
3 Owes (credit)
4 Paid back
5 Today
6 Who owes
7 Undo last
8 Close day
```

### Prompts for typed answers (CON)

| Frame | Text (after the notice) |
|---|---|
| `amount`, sale | `Sale amount?` |
| `amount`, expense | `Amount spent?` |
| `amount`, debt | `How much does X owe?` |
| `amount`, payment | `How much did X pay?` |
| `customer` (debt, or payment with "Other name") | `Customer name?` |
| `item`, sale | `What was sold? 1 to skip` |
| `item`, expense | `What was it for? 1 to skip` |
| `item`, debt | `What did X take? 1 to skip` |

### Confirm screens (CON)

| Draft | Text |
|---|---|
| sale | `Save sale R45 bread? 1 Yes 2 No` (without an item: `Save sale R45? 1 Yes 2 No`) |
| expense | `Save expense R20 taxi? 1 Yes 2 No` |
| debt | `Save X owes R20 sugar? 1 Yes 2 No` |
| payment | `Save X paid R10? 1 Yes 2 No` |
| big amount (second confirm) | `That is a big amount: R1,500,000. 1 Yes, save 2 No` |
| undo | `Undo sale R45 bread? 1 Yes 2 No`, `Undo spent R20 taxi? 1 Yes 2 No`, `Undo X owes R20 sugar? 1 Yes 2 No`, `Undo X paid R10? 1 Yes 2 No` |

### Lists

Paid back (CON), at most 7 customers on a screen. `8` and `9` are never customers.

```
<Notice>Who paid back?
1 Tendai R50
2 Rudo R30
8 Other name
9 More          <- only when more customers follow
```

Who owes. The first line is the total owed. Rows are not numbered, because the owner cannot pick one.

```
<Notice>Owed to you: R380
Tendai R50
Rudo R30
9 More          <- CON screen, only when more customers follow
```

The last (or only) screen has no `9 More` and is an `END` screen. When nobody owes: `END Nobody owes you money.`

### Ending screens (END)

| Screen | Text |
|---|---|
| saved, sale | `Saved: sale R45 bread. Sales today R1,285.` |
| saved, expense | `Saved: spent R20 taxi. Spent today R300.` |
| saved, debt | `Saved: X owes R20 sugar. X owes R50 in total.` |
| saved, payment | `Saved: X paid R10. X owes R40 now.` / `X owes nothing now.` / `X has R5 credit now.` |
| undone, sale | `Undone: sale R45 bread. Sales today R1,240.` |
| undone, expense | `Undone: spent R20 taxi. Spent today R280.` |
| undone, debt | `Undone: X owes R20 sugar. X owes R30 now.` (or `owes nothing now`, `has R5 credit now`) |
| undone, payment | `Undone: X paid R10. X owes R50 now.` |
| nothing to undo | `Nothing to undo.` |
| today | `Today` / `Sales R1,240 (12)` / `Spent R300` / `In hand R940` (one per line) |
| close | `Close Mon 3 Nov` / `Sales R1,240 (12)` / `Spent R300` / `In hand R940` / `Credit given R70` / `Paid back R40` / `Total owed R380` |
| no one owes | `Nobody owes you money.` |
| save failed | `Sorry, that was not saved. Please try again.` |
| bad request or error | `Sorry, something went wrong. Please dial again.` |
| too big | `These numbers are too big to show here.` |

The item is left out (with its leading space) when there is none. A negative `In hand` shows as the core formats it
(`R-60`).

### Notices (first line)

| Key | Text |
|---|---|
| choose | `Choose a number from the list.` |
| amountWords | `Type the amount in numbers, like 45.` |
| amountZero | `The amount must be more than zero.` |
| amountBig | `That amount is too big.` |
| shopNameEmpty | `Type your shop name.` |
| shopNameLong | `That name is too long. Use 24 letters or less.` |
| customerBad | `Type the customer's name, like Tendai.` |
| customerLong | `That name is too long. Use 20 letters or less.` |
| itemEmpty | `Type a short word, or 1 to skip.` |
| itemLong | `That is too long. Use 20 letters or less.` |
| asciiOnly | `Use letters and numbers only.` |
| notSaved | `Not saved.` |
| notUndone | `Not undone.` |

### Reading amounts (`readAmount`)

1. Trim, then `parseAmount(text, shop.currency)`.
2. `success`: use it. `ambiguous`: use the entry of `possibleAmounts` with the most cents (the thousands reading).
3. `error`: `amountZero` when the text starts with `-`; `amountWords` when it has no digit; `amountBig` when it has 14
   or more digits and nothing but digits, spaces, commas, points and a leading currency symbol (the core refuses these
   as too large to store); otherwise `amountWords`.
4. `validateAmount(cents)`: zero becomes `amountZero`; not a safe integer becomes `amountBig`.
5. `big` is `requiresConfirmation(cents)` (above 100,000,000 cents).

Cases the test pins: `45`, `R45`, `45.50`, `45,50` (R45.50), `1,200`, `1 200`, `2 200` (R2,200, not R200), `12 200`
(R12,200), `0`, `0.00`, `-5`, `abc`, `45 bread`, an empty input, `99999999999999` (14 digits, over the safe limit) and a
30-digit number.

### Reading names and items

Order of checks: trim and collapse spaces (`customerDisplayName`); empty; a character outside 32..126
(`asciiOnly`); too long; for a customer, no letter A-Z or a-z (`customerBad`). Shop names also pass `validateShopName`.
On an item screen `1` is read before `readItem` and means "skip".

## Keeping within 182

`toResponse(screen)`:

1. Try `notice + lines`. If the text is 182 characters or fewer, use it.
2. Try `lines` without the notice.
3. Try each `shrink` version in order (the closing summary: without the date line, then also without the counts).
4. Otherwise return `END These numbers are too big to show here.`

Every response goes through it, so no response can pass the limit. The renderers keep the notice, so it is dropped
only for unusually large figures. Worst cases, with a 24-character shop name, 20-character names and items, and the
widest symbol `GHS`, as measured when this design was written (the tests assert them):

| Screen | R999,999.99 | 15-character figure (`GHS9,999,999.99`) | 24-character figure (largest safe amount) |
|---|---|---|---|
| main menu with the longest notice | 170 | 172 | 181 |
| confirm, debt with item | 77 | 79 | 88 |
| big-amount confirm | 53 | 55 | 64 |
| saved, debt with item (the longest ending screen) | 118 | 122 | 140 |
| today | 73 | 79 | 106 |
| close | 160 | 172 | 226 (too long: shrinks, then falls back) |
| currency choice with a notice | 145 | 145 | 145 |

The aggregate screens (main menu, today, close, lists) are therefore guaranteed for any figure up to 15 characters.
An amount the owner types can be any safe integer and still fits on its own confirm and saved screens.

### Pages that do not move

A list page must hold the same rows whether or not a notice is showing, or the numbers would shift when the owner
mistypes. `paginate` fills each page greedily, counting each row as its length plus a newline, against a budget that
always reserves room for the longest notice and for the `9 More` line:

- Paid back: `182 - 31 (notice and newline) - 15 ("Who paid back?") - 13 ("8 Other name") - 6 ("9 More")` = 117.
  The longest row (`7 ` + 20-character name + space + `GHS999,999.99`) is 37 with its newline, so three rows fit; at
  most 7 rows whatever the length.
- Who owes: `182 - 31 - (header length + 1) - 6`. The header is `Owed to you: <total>`. Three rows of 35 fit with the
  longest data.
- Every page holds at least one row. Rows are sorted by amount (largest first), then by lower-case name, so the order
  is the same on every request.

## Repeated requests

Africa's Talking can send the same request again (no answer in time, or a network retry), and two copies can be in
flight at once. The menu is stateless, so a repeat replays the same path and reaches the same saving step.

**Ids.** The record made at step `n` of session `s` always has the id `rec_ussd_<s>_<n>`, where `n` is the number of
inputs read up to and including the confirming `1`. The shop made in session `s` has the id `shop_ussd_<s>`. The
`sessionId` is checked to be letters, digits, `_`, `-` and `.` (at most 100), so the ids are safe in a key and cannot
clash by accident (`n` is a number, so `s = A_1, n = 2` and `s = A, n = 1_2` cannot both exist).

**Saving** (`saveDraft`):

1. `existing = store.findRecordById(id)`. If it exists, go to step 4.
2. Call the ledger operation (`recordSale`, ...) with `id`. A `needsConfirmation` result or `success: false` is a failure
   (`saveFailed`), because the menu has already checked the amount.
3. If the store throws `DuplicateRecordError`, another copy won the race: `existing = store.findRecordById(id)`.
4. Compare `existing` with the draft: same `shopId`, `kind`, `amount`, `customerKey` and `item`. If they match, build
   the `Saved:` screen from the records as they are now. If not, return `saveFailed` and save nothing.

The store's refusal is the real guard. Step 1 only saves work. Because the check in the store happens before any other
check, a repeated undo cannot be mistaken for a second reversal.

**Undoing** (`undoLast`): the same shape, with the reversal's id.

1. `existing = findRecordById(id)`. If it is a reversal in this shop, go to step 4.
2. `undoLastRecord(store, shop, { channel: 'ussd', originalWords, now, id })`.
3. On `DuplicateRecordError`, or on `success: false` with `Nothing to undo` (a copy that ran just before this one took
   the only record), read `findRecordById(id)` again. If it is there go to step 4; if not, the answer is `nothingToUndo`.
4. Read the record the reversal points at (`reversesRecordId`) and build `Undone:` from it and the records as they are now.

**Sign-up** (`createShop` in `ports.ts`): `store.createShop(createShop({ ..., id: shopIdFor(sessionId) }))`. On
`ShopAlreadyExistsError`, read `findShopByPhone(phone)` and use that shop, whichever session made it. If that shop has
another session's id, the rest of the path is read as ordinary menu choices, and a stray name typed at the main menu
just shows the menu again with the choose-a-number notice.

The figure on a repeated `Saved:` screen is read when the repeat arrives, so it can differ from the first reply if
something else was saved in between. The record is saved once either way.

## Shared with the text messages

- Both channels find the shop with `normalizePhone(...)` and make shops with the normalised number. Task 30 checks the
  text-message handler does this and changes it if it does not.
- Both use the same `LedgerStore`, `recordSale` and the other operations, `getTodaySummary`, `getWhoOwes`,
  `getCustomerBalance` and `getDayCloseSummary`. The menu has no records or totals of its own.
- A record from the menu has `channel: 'ussd'` and `originalWords` equal to the typed path up to the confirming input
  (for example `1*45*1*1`). The path is at most 500 characters.

## Error handling

| Situation | Result |
|---|---|
| Bad `sessionId`, `phoneNumber` or `text` | `badRequest`, store untouched |
| Refused typed input | same screen, reason first, `CON` |
| Wrong number on a choice screen | same screen, `Choose a number from the list.` first, `CON` |
| `needsConfirmation` from the ledger | cannot happen after the menu's own confirm; `saveFailed` if it does |
| Duplicate record id, matching | the same `Saved:` screen, nothing added |
| Duplicate record id, not matching | `saveFailed`, nothing added |
| `ShopAlreadyExistsError` | carry on with the shop that exists |
| Any other thrown error | log `error.name` and `error.message`, return `badRequest` |

The route (a later spec) must check that the call comes from Africa's Talking. Anyone who can post to `/ussd` can
claim any phone number, so that check matters before the demo is public.

## Tests

Tests sit next to what they test, mirroring `src/` under `test/`. Style follows the existing tests (Vitest, relative
imports with `.js`).

**The phone helper** (`test/helpers/phone.ts`):

```ts
export interface Shown { raw: string; end: boolean; body: string; lines: string[] }
export function assertValidScreen(raw: string): void;   // throws with the screen text when ussdProblems is not empty
export interface Phone {
  readonly sessionId: string;
  readonly text: string;                  // the path so far
  open(): Promise<Shown>;                 // sends ""
  press(input: string): Promise<Shown>;   // appends the input, sends the whole path
  resend(): Promise<Shown>;               // the last request again, byte for byte
}
export function dial(a: { store: LedgerStore; phone: string; now: Date; sessionId?: string }): Phone;
```

Every response from `open`, `press` and `resend` goes through `assertValidScreen` inside the helper, which throws with
the screen text when there is a problem, so a test cannot skip the check. A session test reads like a call:

```ts
// a shop called "Demo Spaza" (ZAR) with no records yet
const phone = dial({ store, phone: '+270000001234', now });
expect((await phone.open()).lines[0]).toBe('Demo Spaza');              // text ""
await phone.press('1');                                                // text "1"
await phone.press('45');                                               // text "1*45"
await phone.press('1');                                                // text "1*45*1"   skip the item
expect((await phone.press('1')).raw).toBe('END Saved: sale R45. Sales today R45.');   // text "1*45*1*1"
```

**Test files**

| File | What it covers (requirements) |
|---|---|
| `test/channels/limits.test.ts` | prefix, ASCII, 182 and 160 limits (1, 2, 47) |
| `test/channels/phone.test.ts` | spaces, hyphens, missing `+`, too short or long (5, 44) |
| `test/channels/ussd/request.test.ts`, `ids.test.ts` | bad fields, path split, id shape (5, 8, 40) |
| `test/channels/ussd/input.test.ts` | the amount cases above, names, items (17, 29, 33, 34) |
| `test/channels/ussd/text.test.ts`, `screen.test.ts` | `plain`, `clip`, `dayLabel`, the length guard and its ladder (3, 4) |
| `test/channels/ussd/pages.test.ts` | budgets 117 and the owes budget, at least one row, stable pages (27, 28, 37) |
| `test/channels/ussd/screens.test.ts`, `results.test.ts` | exact text of every screen in the tables above, with longest data (3, 11, 16, 18, 23 to 32, 35 to 39, 48) |
| `test/channels/ussd/machine.test.ts` | each transition row, `0`, `00`, refused input in the middle of a path, input after a terminal, with fake ports (8 to 15, 24 to 30) |
| `test/channels/ussd/ports.test.ts` | owes order and ties, undo target equals what `undoLastRecord` undoes, idempotent shop creation (21, 27, 38) |
| `test/channels/ussd/actions.test.ts` | save and undo, duplicates, mismatching duplicate, two at once (40 to 43, 45) |
| `test/channels/ussd/handler.test.ts` | bad requests, thrown store error, `serviceCode` ignored (5, 6, 50) |
| `test/channels/ussd/signup.test.ts` | the sign-up session for each currency and tz, repeat and race (16 to 21) |
| `test/channels/ussd/navigation.test.ts` | `0` and `00` on every screen, wrong numbers (9 to 15) |
| `test/channels/ussd/record.test.ts` | sale, expense, owes, paid back (list, pages, other name, credit), big amount, No (24 to 35) |
| `test/channels/ussd/views.test.ts` | today, who owes with pages, undo each kind, close (36 to 39) |
| `test/channels/ussd/repeat.test.ts` | `resend()` after every saving step, `Promise.all` of two identical requests, two sessions with the same keys making two records (40 to 43) |
| `test/channels/ussd/worst-case.test.ts` | every `WORST_SESSIONS` session for all seven currencies; every screen id rendered at least once (2, 3, 48, 49) |
| `test/channels/ussd/rules.test.ts`, `test/channels/index.test.ts` | no clock, network, driver or new package under `src/channels/ussd`; only `handleUssd` and its types are exported (50) |
| `test/helpers/phone.test.ts` | the helper's `text`, `resend` and `assertValidScreen` (46, 47) |
| `test/channels/crosschannel.test.ts` | sale by text shows in the menu's Today figure, and the reverse; undo across channels (44) |

Core and store changes add cases to `test/core/records/types.test.ts`, `test/core/ledger/operations.test.ts`,
`test/core/shops/types.test.ts` and `test/store/memory/store.test.ts` (51).

**Worst-case data** (`src/channels/ussd/worst-case.ts`, used by the tests and by `check:screens`):

- Shop name `Nomsa's Corner Tuck Shop` (24 characters), items `Maize meal 12.5kg x2` (20), customers
  `Longname Customer 01` to `10` (20 each) with balances of R999,999.99 less a few cents.
- Three sales of R999,999.99 today (sales total `GHS2,999,999.97`), and one expense, one debt and one payment of
  R999,999.99 or less each, so that every figure on the aggregate screens reaches 15 characters but not more (the
  ten customers owe less than 10,000,000 in all).
- `seedWorstCase(store, currency, now)` makes the shop and records; `WORST_SESSIONS` is a list of
  `{ name, inputs, sessionId?, prepare?, hugeFigures? }`. Each session is run on a fresh store, once per currency, by
  pressing the inputs one by one. Three entries are special so that every screen id can be reached: a bad request
  (`sessionId: ''`), a failed save (`prepare` seeds a record with the id the save will use and a different amount) and
  a closing summary that cannot fit (`hugeFigures` seeds one sale of the largest safe amount). The sessions cover: the empty first call; every wrong number; every notice; each flow to its end with the longest data; the
  big-amount screen; both paid-back pages and Other name; both who-owes pages; each kind of undo; today; close; sign-up
  with each currency.

**`check:screens`.** `package.json`: `"check:screens": "tsc && node scripts/check-screens.mjs"`. `tsc` builds `dist/`
(no new dependency; Node cannot run the `.ts` files with `.js` import paths directly). The script imports
`dist/channels/ussd/worst-case.js`, `dist/channels/ussd/handler.js` and `dist/channels/limits.js`, runs every
session, and:

1. checks every response with `ussdProblems`;
2. collects the `screen` ids that `runMenu` reports and fails if any id in `SCREEN_IDS` was never shown;
3. runs the text-message conversations from `WORST_SESSIONS` through `handleText` with the same data and checks each
   reply with `smsProblems` (task 31; until the text-messages handler exists the script prints
   `text replies: not built yet` and still passes, and task 31 turns a missing handler into a failure);
4. prints each failure as `<currency> <session> <text> -> <length> <problem>` and exits with code 1 if there were any.

The save-hook `Check screen limits on save` already runs `npm run check:screens` when a file in `src/channels` or
`src/core` is saved, so the script must work while the work is half built; the placeholder stays until task 29.

## Decisions to review

- **No `0 Back` or `00 Menu` hint on screens.** The texts you gave are used word for word and the main menu is fixed by
  `screens.md`. Owners learn `0` and `00` by thumb. A one-line hint (`0 Back 00 Menu`, 14 characters) would fit on
  most screens if you want it.
- **The last who-owes screen ends the session.** So does the only one. Owners who want the menu dial again, as with
  Today and Close.
- **No** on a confirm screen returns to the main menu (`CON`, `Not saved.` first) instead of ending the session.
- **Time zone follows the country in the sign-up list.** The `text-messages` spec sets every new shop to
  `Africa/Johannesburg`. For Nigeria that moves "today" by an hour, so a closing at 23:30 in Lagos would land on the next
  day. The two channels should agree; the text-message sign-up should follow this table when it is built.
- **Customer names need a letter.** This stops `45` typed at the name prompt from becoming a customer.
