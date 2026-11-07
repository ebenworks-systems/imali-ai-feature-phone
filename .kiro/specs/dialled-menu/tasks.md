# Dialled Menu (USSD) - Tasks

Work in order. Each task names its files, the requirements it meets (numbers from `requirements.md`) and its tests,
which sit with the code they test. After each task `npm run typecheck` and `npm test` must pass. Tick a task only when
its tests pass.

Tasks 30 and 31 are blocked until the `text-messages` spec has built its handler (`handleText`) and its replies. Do
the rest first and leave those two unticked until then.

## Groundwork shared with other code

- [ ] 1. **Screen-limit checks**
  - Files: `src/channels/limits.ts`, `test/channels/limits.test.ts`
  - Requirements: 1, 2, 47, 49
  - `USSD_LIMIT = 182`, `SMS_LIMIT = 160`, `isPlainAscii` (characters 32 to 126 and `\n`).
  - `ussdProblems(response)`: reports a missing `CON `/`END ` prefix, a body over 182 characters, and non-ASCII.
  - `smsProblems(reply)`: reports over 160 and non-ASCII.
  - Tests: exactly 182 passes, 183 fails; the prefix is not counted; emoji, curly quote, em dash and `\u00e9` fail.

- [ ] 2. **Phone number normalisation**
  - Files: `src/channels/phone.ts`, `test/channels/phone.test.ts`
  - Requirements: 5, 44
  - `normalizePhone(raw)`: remove spaces, hyphens, dots and brackets; add a leading `+` when only digits are left;
    return `null` unless the result is `+` and 7 to 15 digits.
  - Tests: `+27 00 000 1234` and `+270000001234` give the same result; `0000`, `abc` and an empty string give `null`.

- [ ] 3. **Optional record id in the core**
  - Files: `src/core/records/types.ts`, `src/core/ledger/operations.ts`, `test/core/records/types.test.ts`,
    `test/core/ledger/operations.test.ts`
  - Requirements: 40, 51
  - `createSaleRecord`, `createExpenseRecord`, `createDebtRecord`, `createPaymentRecord` take `id?: string` in their
    params; `createReversal` takes it as a fifth argument. `recordSale`, `recordExpense`, `recordDebt`, `recordPayment`
    and `undoLastRecord` take `id?: string` and pass it on. Without it the id is generated as before.
  - Tests: a given id is used on the record and on the reversal; without one the id starts `rec_`; the existing tests
    pass unchanged.

- [ ] 4. **Optional shop id in the core**
  - Files: `src/core/shops/types.ts`, `test/core/shops/types.test.ts`
  - Requirements: 20, 51
  - `createShop` takes `id?: string` in its params and uses it; without it the id is generated as before.
  - Tests: given id used; generated id starts `shop_`.

- [ ] 5. **Duplicate errors in the store**
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

- [ ] 6. **Reading the request and building ids**
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

- [ ] 7. **Typed input readers**
  - Files: `src/channels/ussd/input.ts`, `src/channels/ussd/text.ts`, `test/channels/ussd/input.test.ts`,
    `test/channels/ussd/text.test.ts`
  - Requirements: 4, 17, 29, 33, 34
  - `text.ts`: `plain`, `clip`, `money`, `dayLabel`, and `NOTICE` with every notice text in `design.md`.
  - `readAmount` as in "Reading amounts": `parseAmount`, the larger of an `ambiguous` result, `validateAmount`, the
    three plain reasons, `big` from `requiresConfirmation`.
  - `readShopName` (uses `validateShopName` after trimming), `readCustomerName`, `readItem` as in "Reading names and
    items".
  - Tests: every case listed under "Reading amounts" in `design.md`, in ZAR and in KES (`KSh45`); a shop name of 24 and
    25 characters; a customer name with no letter; `\u00e9` in a name; `plain("caf\u00e9")` is `caf?`; `dayLabel("2025-11-03")`
    is `Mon 3 Nov`.

- [ ] 8. **The length guard**
  - Files: `src/channels/ussd/screen.ts`, `test/channels/ussd/screen.test.ts`
  - Requirements: 1, 2, 3
  - `SCREEN_IDS`, `ScreenId`, `Screen`, and `toResponse` with the four steps under "Keeping within 182".
  - Tests: a screen of exactly 182 passes; 183 drops the notice first; a `shrink` version is used when needed and in
    order; nothing fits gives `END These numbers are too big to show here.`; `CON ` and `END ` prefixes follow `end`.

- [ ] 9. **Pages that do not move**
  - Files: `src/channels/ussd/pages.ts`, `test/channels/ussd/pages.test.ts`
  - Requirements: 27, 28, 37
  - `paginate(rowLengths, budget, maxRows)`, `payWhoBudget()` (117) and `owesBudget(headerLength)`.
  - Tests: greedy fill; at most `maxRows`; a row longer than the budget still gets its own page; empty input gives no
    pages; the budgets are built from the same constants as the screens (change a notice length and the number
    changes); with the longest data three rows fit on a paid-back page.

- [ ] 10. **Screens the owner answers**
  - Files: `src/channels/ussd/screens.ts`, `test/channels/ussd/screens.test.ts`
  - Requirements: 11, 12, 16, 18, 23, 24, 25, 26, 27, 28, 30, 35, 38
  - Renderers returning a `Screen`: sign-up name, currency choice, main menu, the amount, customer and item prompts,
    the paid-back list, the four confirm screens, the big-amount confirm, the undo confirm and the who-owes list screen
    (`owesList` when `9 More` follows, `owesEnd` when it does not).
  - Tests: the exact text of each row in the tables in `design.md`, with and without an item and a notice; the main
    menu matches `.kiro/steering/screens.md` line by line; each screen with the longest data and every `toResponse`
    check from task 1.

- [ ] 11. **Ending screens**
  - Files: `src/channels/ussd/results.ts`, `test/channels/ussd/results.test.ts`
  - Requirements: 3, 31, 32, 36, 37, 38, 39
  - Renderers: saved (four kinds), undone (four kinds), today, close (with the two `shrink` versions), no one owes,
    nothing to undo, save failed, bad request, too big.
  - Tests: the exact text of each row in `design.md`; payment leaving owes, owes nothing and credit; negative in hand;
    close with the longest data is 160 or fewer and with a 24-character figure falls back to the too-big screen.

## The state machine

- [ ] 12. **Sign-up, main menu and going back**
  - Files: `src/channels/ussd/machine.ts`, `test/channels/ussd/machine.test.ts`
  - Requirements: 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22
  - `replay` with a fake `MenuPorts` in the test: the stack, `0`, `00`, the notice that depends on the last input only,
    stopping at a terminal, the sign-up frames and `createShop` through the ports, `main` choices 5 and 8 as terminals.
  - Tests: `""`; `"x"` at the main menu gives the choose-a-number notice; `"x*1"` has no notice and is on the sale
    amount screen; `0` at the main menu stays; `00` at sign-up returns to the name screen; sign-up path
    `Name*3` leaves the stack at `[main]`; inputs after a terminal are ignored.

- [ ] 13. **Sale and expense flows**
  - Files: `src/channels/ussd/machine.ts`, `test/channels/ussd/machine.test.ts`
  - Requirements: 24, 25, 30, 33, 34, 35
  - Amount, item (with `1` for skip), confirm, the big-amount confirm, `2 No` back to the main menu with `Not saved.`,
    the `save` terminal and its `step`, `bigOk`.
  - Tests: `1*45*1*1` saves at step 4 with no item; `1*45*bread*1` saves with the item; `1*1500000*1*1` goes to the
    big-amount confirm and `1*1500000*1*1*1` saves at step 5 with `bigOk`; `1*45*1*2` shows `Not saved.`; going back
    with `0` from the confirm screen reaches the item screen with the amount kept.

- [ ] 14. **Owes and paid-back flows**
  - Files: `src/channels/ussd/machine.ts`, `test/channels/ussd/machine.test.ts`
  - Requirements: 26, 27, 28, 29
  - Customer name, amount, item, confirm for owes; the paid-back list with pages, `8 Other name`, `9 More`, the empty
    list going straight to the name prompt, amount, confirm.
  - Tests: row numbers pick the right customer on page 1 and page 2; `8` and `9` are never customers; `9` on the last
    page is refused; `0` from page 2 reaches page 1; nobody owes goes to the name prompt; ties are ordered by name.

- [ ] 15. **Lookups and undo transitions**
  - Files: `src/channels/ussd/machine.ts`, `test/channels/ussd/machine.test.ts`
  - Requirements: 36, 37, 38, 39
  - Choices 5, 6, 7, 8 and the `owesList`, `undoConfirm` frames; the `owesEnd`, `owesNone`, `nothingToUndo`, `today`,
    `close` and `undo` terminals.
  - Tests: one page gives `owesEnd{1}`; three pages give `owesList{1}`, `owesList{2}`, then `owesEnd{3}`; `7` with no
    target gives `nothingToUndo`; `7*1` gives `undo` at step 2; `7*2` gives the main menu with `Not undone.`.

## Reading and writing the ledger

- [ ] 16. **Ports**
  - Files: `src/channels/ussd/ports.ts`, `test/channels/ussd/ports.test.ts`
  - Requirements: 19, 20, 21, 27, 38, 44
  - `makePorts` over a `LedgerStore`: `owes()` from `getWhoOwes` re-sorted by amount then lower-case name;
    `undoTarget()` from `activeRecords` (the last active record, the one `undoLastRecord` reverses);
    `createShop(name, choice)` with the country table, the normalised phone, the id from `shopIdFor`, and
    `ShopAlreadyExistsError` handled by reading the shop by phone.
  - Tests: ties; credit and zero balances left out; the target is the record that `undoLastRecord` then undoes; each
    of the seven choices gives the right currency and time zone; calling `createShop` twice gives one shop; a shop made
    by another session for the same phone is used.

- [ ] 17. **Saving a record, once**
  - Files: `src/channels/ussd/actions.ts`, `test/channels/ussd/actions.test.ts`
  - Requirements: 30, 31, 32, 35, 40, 41, 42, 45
  - `saveDraft` with the four steps under "Saving": id from `recordIdFor`, channel `ussd`, `originalWords` the path up
    to the confirming input, amount `{ cents, requiresConfirmation: false }` after the owner confirmed, the new figure
    read from `getTodaySummary` or `getCustomerBalance` after the save.
  - Tests: each kind saves one record with the right fields; a second call with the same arguments adds nothing and
    returns the same facts; two calls started together (`Promise.all`) add one record; an existing record with that id
    but another amount, kind, customer or item gives `ok: false` and adds nothing; a failing store error is thrown, not
    swallowed; the figure is the new total, not the amount saved.

- [ ] 18. **Undoing a record, once**
  - Files: `src/channels/ussd/actions.ts`, `test/channels/ussd/actions.test.ts`
  - Requirements: 38, 43
  - `undoLast` with the four steps under "Undoing".
  - Tests: undo adds one reversal and returns the record undone and the new figure for each kind; a repeat returns the
    same facts and adds no second reversal; with two records, a repeat does not undo the older one; two started
    together add one reversal; nothing to undo gives `nothingToUndo: true`; the record shown by `undoTarget` is the one
    undone.

- [ ] 19. **The handler**
  - Files: `src/channels/ussd/handler.ts`, `test/channels/ussd/handler.test.ts`
  - Requirements: 1, 5, 6, 7, 14, 22, 50
  - `runMenu` and `handleUssd` as in "Handling one request": find the shop, choose the start, replay, run the
    terminal, render the top frame, apply `toResponse`; catch errors, log `name` and `message` only, return the
    bad-request screen.
  - Tests with a stub store: a bad `sessionId` and a bad phone number never touch the store; a store that throws gives
    `END Sorry, something went wrong. Please dial again.` and the log has no phone number or text; `serviceCode` makes no
    difference; the response is the same for the same arguments; `now` decides today's figures.

## Test helper and session tests

- [ ] 20. **The phone helper**
  - Files: `test/helpers/phone.ts`, `test/helpers/phone.test.ts`
  - Requirements: 46, 47
  - `dial({ store, phone, now, sessionId? })` with `open`, `press`, `resend` and `text`. Every response goes through the
    exported `assertValidScreen(raw)`, which uses `ussdProblems` and throws with the screen text on a problem.
  - Tests: `text` is `""`, `"1"`, `"1*45"` after `open`, `press("1")`, `press("45")`; `resend` sends the same text and
    session id; `assertValidScreen` throws for a response with no prefix, with 183 characters, and with `\u00e9` in it, and
    accepts one of exactly 182; two phones get different session ids.

- [ ] 21. **Sign-up sessions**
  - Files: `test/channels/ussd/signup.test.ts`
  - Requirements: 16, 17, 18, 19, 20, 21
  - Tests: a new number sees the welcome screen; a name of 25 characters is refused with the plain reason and the
    session stays open; each of the seven currencies makes the right shop; the main menu follows with the new
    currency's symbol in the Today line (`Today: sales KSh0` for Kenya); the next request in the same session (`Name*1*1`) reads the sign-up inputs and
    opens the sale amount screen; the request `Name*1` sent twice and sent together makes one shop; another session that
    made the shop first is used; `00` and `0` during sign-up.

- [ ] 22. **Navigation and refused input sessions**
  - Files: `test/channels/ussd/navigation.test.ts`
  - Requirements: 9, 10, 11, 12, 13, 14, 15
  - Tests: from every screen id, `0` goes back one screen and `00` goes to the main menu with nothing saved; a wrong
    number on each choice screen shows the same screen with `Choose a number from the list.` first and `CON`; a refused
    amount shows its reason, and the same path with a good amount after it continues; spaces around a choice; an empty
    input; text after an ending screen is ignored.

- [ ] 23. **Recording sessions**
  - Files: `test/channels/ussd/record.test.ts`
  - Requirements: 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 45
  - Tests, each driven through the phone helper from the main menu to the `END` screen: a sale with and without an
    item; an expense; owes; paid back from the list, from page 2 and with `Other name`; a payment that leaves credit and
    one that leaves nothing owed; `2 No` saves nothing; zero, a negative number and words on the amount screen; `2 200`
    saves R2,200; `1500000` shows the big-amount confirm and saves only after the second `1`; the record's channel is
    `ussd` and its words are the typed path; the saved screens show the new totals, with earlier records in the store.

- [ ] 24. **Lookup and undo sessions**
  - Files: `test/channels/ussd/views.test.ts`
  - Requirements: 36, 37, 38, 39
  - Tests: today with and without records and with a day boundary (a record just before local midnight is not
    today's); who owes with one page, with three pages (`6`, `6*9`, `6*9*9`) and with nobody; undo of each kind with
    the figure after it; undo with nothing to undo; `7*2`; the record named in `Undone:` is the record shown in the
    confirm screen; close with a day's records, in a non-Johannesburg time zone.

- [ ] 25. **Repeated-request sessions**
  - Files: `test/channels/ussd/repeat.test.ts`
  - Requirements: 40, 41, 42, 43
  - Tests: for each of the four kinds, `resend()` after the saving `1` returns the same `Saved:` screen and the store
    holds one record; the same for the big-amount path; `Promise.all` of two identical saving requests leaves one
    record; the same for undo, including with two records in the store; two different sessions with the same keys make
    two records; a reused `sessionId` with a different path (a different step) makes a second record; a record that
    holds the id but has another amount gives the save-failed screen.

- [ ] 26. **Worst-case data**
  - Files: `src/channels/ussd/worst-case.ts`, `test/channels/ussd/worst-case.test.ts`
  - Requirements: 2, 3, 4, 48, 49
  - `seedWorstCase(store, currency, now)` and `WORST_SESSIONS` as described under "Worst-case data" in `design.md`
    (invented names only, phone numbers in the `+27 00 000 xxxx` range).
  - Three sessions are special: bad request (`sessionId` of `''`), save failed (`prepare` seeds a record with the id the
    save will use but another amount) and too big (`hugeFigures` seeds one sale of the largest safe amount, so the
    closing summary cannot fit).
  - Tests: for each of the seven currencies, run every session on a fresh seeded store through `runMenu` and
    `assertValidScreen`; the screens listed in `design.md` have the lengths in its table; the sessions together show
    every id in `SCREEN_IDS`; stored non-ASCII names are shown with `?`.

- [ ] 27. **Source rules test**
  - Files: `test/channels/ussd/rules.test.ts`
  - Requirements: 50
  - A test that reads every file under `src/channels/ussd/` and fails if one contains `new Date()` (with no argument),
    `Date.now`, `fetch(`, `process.env`, an import of `postgres`, or an import from a package that is not in
    `package.json`.
  - Tests: the rule test passes on the real files; it fails on a sample string for each banned pattern.

## Public entry point and the screen check

- [ ] 28. **Export the entry point**
  - Files: `src/channels/index.ts`, `test/channels/index.test.ts`
  - Requirements: 50
  - Create `src/channels/index.ts` (if the text-messages work already made it, add to it) exporting `handleUssd`,
    `HandleUssdParams` and `HandleUssdResult` only.
  - Tests: the module exports `handleUssd`; `runMenu` and the renderers are not exported from it.

- [ ] 29. **`check:screens` for the menu**
  - Files: `scripts/check-screens.mjs`, `package.json`
  - Requirements: 48, 49
  - Replace the placeholder with `"check:screens": "tsc && node scripts/check-screens.mjs"`. The script imports
    `dist/channels/limits.js`, `dist/channels/ussd/handler.js` and `dist/channels/ussd/worst-case.js`; runs every
    `WORST_SESSIONS` session for every currency; checks each response with `ussdProblems`; fails when an id in
    `SCREEN_IDS` was never shown; prints each failure as `<currency> <session> <text> -> <length> <problem>`; exits 1
    on any failure. Until task 31 it also prints `text replies: not built yet`.
  - Check: run it and see it pass; temporarily raise a notice to 200 characters and see it fail with the failing
    screen named; put it back.
  - No new dependency.

## Blocked until the text-messages handler exists

- [ ] 30. **Menu and text messages share one ledger**
  - Files: `test/channels/crosschannel.test.ts`, and `src/channels/sms/handler.ts` only if it does not already call
    `normalizePhone`
  - Requirements: 44
  - Needs `handleText` and `InMemoryPendingStore` from the `text-messages` spec.
  - Tests on one `MemoryStore`: a shop made by the menu (phone `+270000001234`) is found by a text from
    `+27 00 000 1234`; `sold 45 bread` by text shows in the menu's `Today: sales` line and in `5 Today`; a sale saved
    in the menu shows in the reply to `today` by text; `undo` by text reverses the menu's last sale; undo in the menu
    reverses a sale made by text; a customer who owes via text is in the menu's paid-back list.

- [ ] 31. **`check:screens` for the text replies**
  - Files: `scripts/check-screens.mjs`, `src/channels/ussd/worst-case.ts`
  - Requirements: 49
  - Needs `handleText` and the replies from the `text-messages` spec.
  - Add the text conversations to `WORST_SESSIONS` (sold, spent, owes, paid, undo, today, who owes with pages, close,
    help, unknown, `sold 2 200`, an amount over 1,000,000) with the same worst-case data, run them through
    `handleText`, and check each reply with `smsProblems` (160 characters, ASCII). Remove the
    `text replies: not built yet` line, and make a missing `dist/channels/sms/handler.js` a failure.
  - Check: it passes; a reply temporarily made 161 characters long fails with the message and currency named.

## Finish

- [ ] 32. **Final check and README**
  - Files: `README.md`
  - Requirements: all
  - Run `npm run typecheck`, `npm test`, `npm run build` and `npm run check:screens`; read each requirement against its
    test one last time.
  - Update "What works today" in `README.md` to say the dialled menu works, and leave the browser phone, the route and
    the live demo as "come next".

## Success criteria

1. All 32 tasks ticked; `npm run typecheck`, `npm test`, `npm run build` and `npm run check:screens` pass.
2. Every screen in every test passes `ussdProblems` through the phone helper (prefix, ASCII, 182).
3. A repeated or doubled saving request leaves one record; a repeated or doubled undo leaves one reversal.
4. A sale by text shows in the menu's Today figure and the reverse (task 30).
5. `package.json` has no new dependency; no source file reads the clock or the network.
