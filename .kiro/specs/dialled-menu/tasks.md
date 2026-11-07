# Dialled Menu (USSD) - Tasks

Work in order. Each task names its files, the requirements it meets (numbers from `requirements.md`) and its tests,
which sit with the code they test. After each task `npm run typecheck` and `npm test` must pass. Tick a task only when
its tests pass.

The `text-messages` channel is finished (`handleText`, the replies and `src/channels/index.ts` exist), so nothing is
blocked. Tasks 31 and 32 use `handleText`.

## Groundwork shared with other code

- [x] 1. **Screen-limit checks**
  - Files: `src/channels/limits.ts`, `test/channels/limits.test.ts`
  - Requirements: 1, 2, 47, 49
  - `USSD_LIMIT = 182`, `SMS_LIMIT = 160`, `isPlainAscii` (characters 32 to 126 and `\n`).
  - `ussdProblems(response)`: reports a missing `CON `/`END ` prefix, a body over 182 characters, and non-ASCII.
  - `smsProblems(reply)`: reports over 160 and non-ASCII.
  - Tests: exactly 182 passes, 183 fails; the prefix is not counted; emoji, curly quote, em dash and `\u00e9` fail.

- [x] 2. **Phone number normalisation**
  - Files: `src/channels/phone.ts`, `test/channels/phone.test.ts`
  - Requirements: 5, 44
  - `normalizePhone(raw)`: remove spaces, hyphens, dots and brackets; add a leading `+` when only digits are left;
    return `null` unless the result is `+` and 7 to 15 digits.
  - Tests: `+27 00 000 1234` and `+27000001234` give the same result; `0000`, `abc` and an empty string give `null`.

- [x] 3. **Negative amounts read `-R60`**
  - Files: `src/core/money/format.ts`, `test/core/money/format.test.ts`, `test/channels/sms/replies.test.ts`
  - Requirements: 53
  - `formatCents` puts the minus sign before the currency symbol for every currency: `-R60`, `-R45.50`, `-$5`,
    `-KSh1,200`, `-GHS7`, `-N9`, `-K2`, `-P3`. It never writes `R-60`. Positive amounts and zero are unchanged.
  - Tests: the old case `R-45.50` becomes `-R45.50`; a negative in each of the seven currencies, with and without
    cents, with thousands (`-R1,200`) and with `alwaysShowDecimals`; zero never gets a sign; the text reply for a day
    with more spent than sold reads `in hand -R50.` (the one test in `replies.test.ts` that pinned `R-50`); the other
    text-reply tests pass unchanged.

- [x] 4. **Optional record id in the core**
  - Files: `src/core/records/types.ts`, `src/core/ledger/operations.ts`, `test/core/records/types.test.ts`,
    `test/core/ledger/operations.test.ts`
  - Requirements: 40, 51
  - `createSaleRecord`, `createExpenseRecord`, `createDebtRecord`, `createPaymentRecord` take `id?: string` in their
    params; `createReversal` takes it as a fifth argument. `recordSale`, `recordExpense`, `recordDebt`, `recordPayment`
    and `undoLastRecord` take `id?: string` and pass it on. Without it the id is generated as before.
  - Tests: a given id is used on the record and on the reversal; without one the id starts `rec_`; the existing tests
    pass unchanged.

- [x] 5. **Optional shop id in the core**
  - Files: `src/core/shops/types.ts`, `test/core/shops/types.test.ts`
  - Requirements: 20, 51
  - `createShop` takes `id?: string` in its params and uses it; without it the id is generated as before.
  - Tests: given id used; generated id starts `shop_`.

- [x] 6. **Duplicate errors in the store**
  - Files: `src/store/interface.ts`, `src/store/memory/store.ts`, `src/core/index.ts`, `test/store/memory/store.test.ts`
  - Requirements: 21, 41, 51
  - Add `DuplicateRecordError` and `ShopAlreadyExistsError` (with `name` set, like `RecordAlreadyReversedError`) and
    export them from `src/core/index.ts` next to it.
  - `MemoryStore.appendRecord` throws `DuplicateRecordError` when the id is held, before the reversed-once check, and
    changes nothing when it throws. `MemoryStore.createShop` throws `ShopAlreadyExistsError` when the id or the phone
    already has a shop.
  - Tests: a second append of the same id throws and the list still has one copy; a second reversal with a new id of an
    already reversed record still throws `RecordAlreadyReversedError`; a reversal re-sent with the same id throws
    `DuplicateRecordError`; same phone with another id throws; same id throws; all existing store tests pass.
  - Note in the file comment that the Postgres store must give the same two errors (primary key on the record id,
    unique index on the shop phone).

## Pure pieces of the menu

- [x] 7. **Reading the request and building ids**
  - Files: `src/channels/ussd/request.ts`, `src/channels/ussd/ids.ts`, `test/channels/ussd/request.test.ts`,
    `test/channels/ussd/ids.test.ts`
  - Requirements: 5, 7, 8, 40
  - `readRequest`: checks `sessionId` (1 to 100 of letters, digits, `_`, `-`, `.`), normalises the phone number,
    rejects `text` over 500 characters or over 30 inputs, splits `text` on `*` (empty text gives no inputs), keeps empty
    segments as empty inputs.
  - `recordIdFor(sessionId, step)` gives `rec_ussd_<sessionId>_<step>`; `shopIdFor(sessionId)` gives
    `shop_ussd_<sessionId>`.
  - Tests: `""` gives `[]`; `"1*45*1"` gives three inputs; `"1**2"` keeps the empty one; a space in the session id, 101
    characters, 501 characters of text and 31 inputs are refused; the ids are the same on every call.

- [x] 8. **Typed input readers**
  - Files: `src/channels/ussd/input.ts`, `src/channels/ussd/text.ts`, `test/channels/ussd/input.test.ts`,
    `test/channels/ussd/text.test.ts`
  - Requirements: 4, 17, 29, 33, 34, 52
  - `text.ts`: `plain`, `clip`, `money`, `dayLabel`, `HINT` (`0 Back 00 Menu`) and `NOTICE` with every notice text in
    `design.md`.
  - `readAmount` as in "Reading amounts": `parseAmount`, the larger of an `ambiguous` result, `validateAmount`, the
    three plain reasons, `big` from `requiresConfirmation`.
  - `readShopName` (uses `validateShopName` after trimming), `readCustomerName`, `readItem` as in "Reading names and
    items".
  - Tests: every case listed under "Reading amounts" in `design.md`, in ZAR and in KES (`KSh45`); a shop name of 24 and
    25 characters; a customer name with no letter; `\u00e9` in a name; `plain("caf\u00e9")` is `caf?`; `dayLabel("2025-11-03")`
    is `Mon 3 Nov`.

- [x] 9. **The length guard**
  - Files: `src/channels/ussd/screen.ts`, `test/channels/ussd/screen.test.ts`
  - Requirements: 1, 2, 3, 52
  - `SCREEN_IDS`, `ScreenId`, `Screen` (with `hint?: boolean`), and `toResponse` with the steps under "Keeping within
    182", where the hint line is added last and only when the whole screen then stays within 182.
  - Tests: a screen of exactly 182 passes; 183 drops the notice first; a `shrink` version is used when needed and in
    order; nothing fits gives `END These numbers are too big to show here.`; `CON ` and `END ` prefixes follow `end`.
    Hint, both cases: a body of 167 characters plus the hint is exactly 182 and shows the hint, a body of 168 leaves
    it out and is otherwise unchanged; the hint is never the reason the notice, a `shrink` step or any line is dropped
    (the same screen with and without `hint` differs only by the hint line); a screen without `hint: true` never shows
    it; an `end` screen never shows it even when `hint` is set.

- [x] 10. **Pages that do not move**
  - Files: `src/channels/ussd/pages.ts`, `test/channels/ussd/pages.test.ts`
  - Requirements: 27, 28, 37
  - `paginate(rowLengths, budget, maxRows)`, `payWhoBudget()` (117) and `owesBudget(headerLength)`.
  - Tests: greedy fill; at most `maxRows`; a row longer than the budget still gets its own page; empty input gives no
    pages; the budgets are built from the same constants as the screens (change a notice length and the number
    changes); with the longest data three rows fit on a paid-back page.

- [x] 11. **Screens the owner answers**
  - Files: `src/channels/ussd/screens.ts`, `test/channels/ussd/screens.test.ts`
  - Requirements: 11, 12, 16, 18, 23, 24, 25, 26, 27, 28, 30, 35, 38, 52
  - Renderers returning a `Screen`: sign-up name, currency choice, main menu, the amount, customer and item prompts,
    the paid-back list, the four confirm screens, the big-amount confirm, the undo confirm and the who-owes list screen
    (`owesList` when `9 More` follows, `owesEnd` when it does not). The amount, item, customer, paid-back list,
    who-owes list (`owesList`) and every confirm screen set `hint: true`; the sign-up screens, the main menu and
    `owesEnd` do not.
  - Tests: the exact text of each row in the tables in `design.md`, with and without an item and a notice; the main
    menu matches `.kiro/steering/screens.md` line by line; each screen with the longest data and every `toResponse`
    check from task 1. Hint, both cases: through `toResponse`, each screen that sets `hint` ends with
    `0 Back 00 Menu` when it fits (a short sale confirm); and with the longest data at least one screen
    (the paid-back list of three 20-character names in `GHS`, with the longest notice) is returned without the hint
    and with every other line unchanged; the main menu and sign-up screens never end with the hint.

- [x] 12. **Ending screens**
  - Files: `src/channels/ussd/results.ts`, `test/channels/ussd/results.test.ts`
  - Requirements: 3, 31, 32, 36, 37, 38, 39, 52, 53
  - Renderers: saved (four kinds), undone (four kinds), today, close (with the two `shrink` versions), no one owes,
    nothing to undo, save failed, bad request, too big.
  - Tests: the exact text of each row in `design.md`; payment leaving owes, owes nothing and credit; negative in hand reads `-R60`, never `R-60`; no ending screen carries the hint;
    close with the longest data is 160 or fewer and with a 24-character figure falls back to the too-big screen.

## The state machine

- [x] 13. **Sign-up, main menu and going back**
  - Files: `src/channels/ussd/machine.ts`, `test/channels/ussd/machine.test.ts`
  - Requirements: 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22
  - `replay` with a fake `MenuPorts` in the test: the stack, `0`, `00`, the notice that depends on the last input only,
    stopping at a terminal, the sign-up frames and `createShop` through the ports, `main` choices 5 and 8 as terminals.
  - Tests: `""`; `"x"` at the main menu gives the choose-a-number notice; `"x*1"` has no notice and is on the sale
    amount screen; `0` at the main menu stays; `00` at sign-up returns to the name screen; sign-up path
    `Name*3` leaves the stack at `[main]`; inputs after a terminal are ignored.

- [x] 14. **Sale and expense flows**
  - Files: `src/channels/ussd/machine.ts`, `test/channels/ussd/machine.test.ts`
  - Requirements: 24, 25, 30, 33, 34, 35
  - Amount, item (with `1` for skip), confirm, the big-amount confirm, `2 No` back to the main menu with `Not saved.`,
    the `save` terminal and its `step`, `bigOk`.
  - Tests: `1*45*1*1` saves at step 4 with no item; `1*45*bread*1` saves with the item; `1*1500000*1*1` goes to the
    big-amount confirm and `1*1500000*1*1*1` saves at step 5 with `bigOk`; `1*45*1*2` shows `Not saved.`; going back
    with `0` from the confirm screen reaches the item screen with the amount kept.

- [x] 15. **Owes and paid-back flows**
  - Files: `src/channels/ussd/machine.ts`, `test/channels/ussd/machine.test.ts`
  - Requirements: 26, 27, 28, 29
  - Customer name, amount, item, confirm for owes; the paid-back list with pages, `8 Other name`, `9 More`, the empty
    list going straight to the name prompt, amount, confirm.
  - Tests: row numbers pick the right customer on page 1 and page 2; `8` and `9` are never customers; `9` on the last
    page is refused; `0` from page 2 reaches page 1; nobody owes goes to the name prompt; ties are ordered by name.

- [x] 16. **Lookups and undo transitions**
  - Files: `src/channels/ussd/machine.ts`, `test/channels/ussd/machine.test.ts`
  - Requirements: 36, 37, 38, 39
  - Choices 5, 6, 7, 8 and the `owesList`, `undoConfirm` frames; the `owesEnd`, `owesNone`, `nothingToUndo`, `today`,
    `close` and `undo` terminals.
  - Tests: one page gives `owesEnd{1}`; three pages give `owesList{1}`, `owesList{2}`, then `owesEnd{3}`; `7` with no
    target gives `nothingToUndo`; `7*1` gives `undo` at step 2; `7*2` gives the main menu with `Not undone.`.

## Reading and writing the ledger

- [x] 17. **Ports**
  - Files: `src/channels/ussd/ports.ts`, `test/channels/ussd/ports.test.ts`
  - Requirements: 19, 20, 21, 27, 38, 44
  - `makePorts` over a `LedgerStore`: `owes()` from `getWhoOwes` re-sorted by amount then lower-case name;
    `undoTarget()` from `activeRecords` (the last active record, the one `undoLastRecord` reverses);
    `createShop(name, choice)` with the country table, the normalised phone, the id from `shopIdFor`, and
    `ShopAlreadyExistsError` handled by reading the shop by phone.
  - Tests: ties; credit and zero balances left out; the target is the record that `undoLastRecord` then undoes; each
    of the seven choices gives the right currency and time zone; calling `createShop` twice gives one shop; a shop made
    by another session for the same phone is used.

- [x] 18. **Saving a record, once**
  - Files: `src/channels/ussd/actions.ts`, `test/channels/ussd/actions.test.ts`
  - Requirements: 30, 31, 32, 35, 40, 41, 42, 45
  - `saveDraft` with the four steps under "Saving": id from `recordIdFor`, channel `ussd`, `originalWords` the path up
    to the confirming input, amount `{ cents, requiresConfirmation: false }` after the owner confirmed, the new figure
    read from `getTodaySummary` or `getCustomerBalance` after the save.
  - Tests: each kind saves one record with the right fields; a second call with the same arguments adds nothing and
    returns the same facts; two calls started together (`Promise.all`) add one record; an existing record with that id
    but another amount, kind, customer or item gives `ok: false` and adds nothing; a failing store error is thrown, not
    swallowed; the figure is the new total, not the amount saved.

- [x] 19. **Undoing a record, once**
  - Files: `src/channels/ussd/actions.ts`, `test/channels/ussd/actions.test.ts`
  - Requirements: 38, 43
  - `undoLast` with the four steps under "Undoing".
  - Tests: undo adds one reversal and returns the record undone and the new figure for each kind; a repeat returns the
    same facts and adds no second reversal; with two records, a repeat does not undo the older one; two started
    together add one reversal; nothing to undo gives `nothingToUndo: true`; the record shown by `undoTarget` is the one
    undone.

- [x] 20. **The handler**
  - Files: `src/channels/ussd/handler.ts`, `test/channels/ussd/handler.test.ts`
  - Requirements: 1, 5, 6, 7, 14, 22, 50
  - `runMenu` and `handleUssd` as in "Handling one request": find the shop, choose the start, replay, run the
    terminal, render the top frame, apply `toResponse`; catch errors, log `name` and `message` only, return the
    bad-request screen.
  - Tests with a stub store: a bad `sessionId` and a bad phone number never touch the store; a store that throws gives
    `END Sorry, something went wrong. Please dial again.` and the log has no phone number or text; `serviceCode` makes no
    difference; the response is the same for the same arguments; `now` decides today's figures.

## Test helper and session tests

- [x] 21. **The phone helper**
  - Files: `test/helpers/phone.ts`, `test/helpers/phone.test.ts`
  - Requirements: 46, 47
  - `dial({ store, phone, now, sessionId? })` with `open`, `press`, `resend` and `text`. Every response goes through the
    exported `assertValidScreen(raw)`, which uses `ussdProblems` and throws with the screen text on a problem.
  - Tests: `text` is `""`, `"1"`, `"1*45"` after `open`, `press("1")`, `press("45")`; `resend` sends the same text and
    session id; `assertValidScreen` throws for a response with no prefix, with 183 characters, and with `\u00e9` in it, and
    accepts one of exactly 182; two phones get different session ids.

- [x] 22. **Sign-up sessions**
  - Files: `test/channels/ussd/signup.test.ts`
  - Requirements: 16, 17, 18, 19, 20, 21
  - Tests: a new number sees the welcome screen; a name of 25 characters is refused with the plain reason and the
    session stays open; each of the seven currencies makes the right shop; the main menu follows with the new
    currency's symbol in the Today line (`Today: sales KSh0` for Kenya); the next request in the same session (`Name*1*1`) reads the sign-up inputs and
    opens the sale amount screen; the request `Name*1` sent twice and sent together makes one shop; another session that
    made the shop first is used; `00` and `0` during sign-up.

- [x] 23. **Navigation and refused input sessions**
  - Files: `test/channels/ussd/navigation.test.ts`
  - Requirements: 9, 10, 11, 12, 13, 14, 15, 52
  - Tests: from every screen id, `0` goes back one screen and `00` goes to the main menu with nothing saved; a wrong
    number on each choice screen shows the same screen with `Choose a number from the list.` first and `CON`; a refused
    amount shows its reason, and the same path with a good amount after it continues; spaces around a choice; an empty
    input; text after an ending screen is ignored; the hint line ends the amount, item, customer, paid-back, who-owes
    (`CON`) and confirm screens and is on no other screen; after `0` or `00` the screen reached has the hint only if it
    is one of those.

- [x] 24. **Recording sessions**
  - Files: `test/channels/ussd/record.test.ts`
  - Requirements: 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 45, 52
  - Tests, each driven through the phone helper from the main menu to the `END` screen: a sale with and without an
    item; an expense; owes; paid back from the list, from page 2 and with `Other name`; a payment that leaves credit and
    one that leaves nothing owed; `2 No` saves nothing; zero, a negative number and words on the amount screen; `2 200`
    saves R2,200; `1500000` shows the big-amount confirm and saves only after the second `1`; the record's channel is
    `ussd` and its words are the typed path; the saved screens show the new totals, with earlier records in the store; the confirm screen of each kind ends with
    `0 Back 00 Menu` and the `END Saved:` screen does not.

- [x] 25. **Lookup and undo sessions**
  - Files: `test/channels/ussd/views.test.ts`
  - Requirements: 36, 37, 38, 39
  - Tests: today with and without records and with a day boundary (a record just before local midnight is not
    today's); who owes with one page, with three pages (`6`, `6*9`, `6*9*9`) and with nobody; undo of each kind with
    the figure after it; undo with nothing to undo; `7*2`; the record named in `Undone:` is the record shown in the
    confirm screen; close with a day's records, in a non-Johannesburg time zone.

- [x] 26. **Repeated-request sessions**
  - Files: `test/channels/ussd/repeat.test.ts`
  - Requirements: 40, 41, 42, 43
  - Tests: for each of the four kinds, `resend()` after the saving `1` returns the same `Saved:` screen and the store
    holds one record; the same for the big-amount path; `Promise.all` of two identical saving requests leaves one
    record; the same for undo, including with two records in the store; two different sessions with the same keys make
    two records; a reused `sessionId` with a different path (a different step) makes a second record; a record that
    holds the id but has another amount gives the save-failed screen.

- [x] 27. **Worst-case data**
  - Files: `src/channels/ussd/worst-case.ts`, `test/channels/ussd/worst-case.test.ts`
  - Requirements: 2, 3, 4, 48, 49, 52
  - `seedWorstCase(store, currency, now)` and `WORST_SESSIONS` as described under "Worst-case data" in `design.md`
    (invented names only, phone numbers in the `+27 00 000 xxxx` range).
  - Three sessions are special: bad request (`sessionId` of `''`), save failed (`prepare` seeds a record with the id the
    save will use but another amount) and too big (`hugeFigures` seeds a sale, an expense, a debt and a payment of 4 to 9 quadrillion
    cents, still safe whole numbers, so the closing summary cannot fit even without its date and counts).
  - Tests: for each of the seven currencies, run every session on a fresh seeded store through `runMenu` and
    `assertValidScreen`; the screens listed in `design.md` have the lengths in its table; the sessions together show
    every id in `SCREEN_IDS`; stored non-ASCII names are shown with `?`; the hint is present on a screen where it fits
    and absent, with nothing else removed, on at least one worst-case screen where it does not.

- [x] 28. **Source rules test**
  - Files: `test/channels/ussd/rules.test.ts`
  - Requirements: 50
  - A test that reads every file under `src/channels/ussd/` and fails if one contains `new Date()` (with no argument),
    `Date.now`, `fetch(`, `process.env`, an import of `postgres`, or an import from a package that is not in
    `package.json`.
  - Tests: the rule test passes on the real files; it fails on a sample string for each banned pattern.

## Public entry point and the screen check

- [x] 29. **Export the entry point**
  - Files: `src/channels/index.ts`, `test/channels/index.test.ts`
  - Requirements: 50
  - Create `src/channels/index.ts` (if the text-messages work already made it, add to it) exporting `handleUssd`,
    `HandleUssdParams` and `HandleUssdResult` only.
  - Tests: the module exports `handleUssd`; `runMenu` and the renderers are not exported from it.

- [x] 30. **`check:screens` for the menu**
  - Files: `scripts/check-screens.mjs`, `package.json`
  - Requirements: 48, 49
  - Replace the placeholder with `"check:screens": "tsc && node scripts/check-screens.mjs"`. The script imports
    `dist/channels/limits.js`, `dist/channels/ussd/handler.js` and `dist/channels/ussd/worst-case.js`; runs every
    `WORST_SESSIONS` session for every currency; checks each response with `ussdProblems`; fails when an id in
    `SCREEN_IDS` was never shown; fails when the "too big to show" fallback appears in any session except the one
    built to cause it (`hugeFigures`), because anywhere else it means a screen grew past the limit; prints each
    failure as `<currency> <session> <text> -> <length> <problem>`; exits 1 on any failure. The text replies are
    added to it by task 32.
  - Check: run it and see it pass; temporarily make a fixed line (`8 Close day`) 200 characters long and see it
    fail with the session named; put it back. (A long notice cannot be used for this check: the length guard
    drops a notice that does not fit, by design, so the screen stays valid.)
  - No new dependency.

## Both channels together

- [x] 31. **Menu and text messages share one ledger**
  - Files: `test/channels/crosschannel.test.ts`, and `src/channels/sms/handler.ts` only if it does not already call
    `normalizePhone`
  - Requirements: 44
  - Uses `handleText` and `InMemoryPendingStore` from the finished `text-messages` channel.
  - Tests on one `MemoryStore`: a shop made by the menu (phone `+27000001234`) is found by a text from
    `+27 00 000 1234`; a sale saved by text (`sold 45 bread`) shows on the menu's main screen (`Today: sales R45`)
    and in `5 Today`; and the reverse, a sale saved in the menu (`1*45*bread*1`) shows in the reply to `today` by
    text and in the next main screen; `undo` by text reverses the menu's last sale; undo in the menu reverses a sale
    made by text; a customer who owes via text is in the menu's paid-back list; a debt made in the menu is in the
    reply to `who owes` by text.

- [x] 32. **`check:screens` for the text replies**
  - Files: `scripts/check-screens.mjs`, `src/channels/ussd/worst-case.ts`
  - Requirements: 49
  - Uses `handleText` and the replies from the finished `text-messages` channel.
  - Add the text conversations to `WORST_SESSIONS` (sold, spent, owes, paid, undo, today, who owes with pages, close,
    help, unknown, `sold 2 200`, an amount over 1,000,000) with the same worst-case data, run them through
    `handleText`, and check each reply with `smsProblems` (160 characters, ASCII). Make a
    missing `dist/channels/sms/handler.js` a failure.
  - Check: it passes; temporarily raise `SMS_MAX_LENGTH` in `src/channels/sms/replies.ts` to 200 and see it fail with
    the message, conversation and currency named; take away `dist/channels/sms/handler.js` and see it fail; put both
    back.

## Finish

- [x] 33. **Final check and README**
  - Files: `README.md`
  - Requirements: all
  - Run `npm run typecheck`, `npm test`, `npm run build` and `npm run check:screens`; read each requirement against its
    test one last time.
  - Update "What works today" in `README.md` to say the dialled menu works, and leave the browser phone, the route and
    the live demo as "come next".

## Success criteria

1. All 33 tasks ticked; `npm run typecheck`, `npm test`, `npm run build` and `npm run check:screens` pass.
2. Every screen in every test passes `ussdProblems` through the phone helper (prefix, ASCII, 182).
3. A repeated or doubled saving request leaves one record; a repeated or doubled undo leaves one reversal.
4. A sale by text shows in the menu's Today figure and the reverse (task 31).
5. The hint line `0 Back 00 Menu` ends every typed-answer, `CON` list and confirm screen when it fits within 182
   characters, and is left out (with nothing else dropped) when it does not; it is never on the main menu, the
   sign-up screens or an `END` screen.
6. A negative amount reads `-R60` on both channels, in every currency.
7. `package.json` has no new dependency; no source file reads the clock or the network.
