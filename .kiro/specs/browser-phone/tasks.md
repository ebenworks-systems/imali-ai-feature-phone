# Browser Phone Tasks

Requirement numbers refer to `requirements.md`; section names refer to `design.md`. Order: the pure modules and their
tests first, then markup and CSS, then the two DOM files, then docs and checks. Do not write application code outside
`public/`, `test/public/` and `docs/judges.md`. Run `npm test` and `npm run typecheck` after each group.

## Pure modules: api helper

- [x] 1. **Api helper: errors and requests**
  - Files: `public/api.js`
  - Requirements: 63, 92
  - Write `ApiError` (`kind`: `network`, `timeout`, `http`, `json`; optional `status`) and `createApi({ fetchFn, timeoutMs = 10000 })` with `postJson`, `getJson`, `getBlob`; use `AbortController` for the timeout; `credentials: 'omit'`.

- [x] 2. **Api helper: URLs**
  - Files: `public/api.js`
  - Requirements: 74, 83
  - Add `ledgerUrl(phone)` and `exportUrl(phone)` using `encodeURIComponent` so `+` becomes `%2B`.

- [x] 3. **Api helper tests**
  - Files: `test/public/api.test.ts`
  - Requirements: 63, 94
  - With a fake `fetch` and Vitest fake timers: success, timeout at 10 s, rejected fetch, 404 and 500, body that is not JSON, `getBlob`, `+` encoded as `%2B`.

## Pure modules: ledger logic

- [x] 4. **Money formatting**
  - Files: `public/ledger-logic.js`
  - Requirements: 70
  - Write `formatMoney(cents, currency)` with the seven currency symbols, commas, no decimals at zero cents, integer maths only.

- [x] 5. **Money formatting tests, including parity with the server**
  - Files: `test/public/ledger-logic.test.ts`
  - Requirements: 70, 94
  - Examples `R45`, `R45.50`, `R1,240`, `R999,999.99`, `KSh`, `GHS`; a fast-check property that `formatMoney` equals `formatCents` from `src/core/money/format.ts` for every currency and random safe cents.

- [x] 6. **Clock and record time**
  - Files: `public/ledger-logic.js`
  - Requirements: 31, 72
  - Write `formatClock(nowMs, timeZone)` and `formatRecordTime(createdAt, timeZone, nowMs)` from `Intl.DateTimeFormat` parts with an own month table; default zone `Africa/Johannesburg`.

- [x] 7. **Clock and record time tests**
  - Files: `test/public/ledger-logic.test.ts`
  - Requirements: 72, 94
  - Same day shows `14:05`; a record just before and just after local midnight; an earlier day shows `3 Nov 14:05`; September prints `Sep`.

- [x] 8. **Ledger answer check**
  - Files: `public/ledger-logic.js`
  - Requirements: 77
  - Write `readLedger(json)` that returns `{ ok: true, ledger }` or `{ ok: false }`: known currency, safe-integer cents, known kinds and channels, arrays for `whoOwes` and `records`, optional `timeZone`.

- [x] 9. **Ledger answer check tests**
  - Files: `test/public/ledger-logic.test.ts`
  - Requirements: 77, 94
  - Accept a full answer; reject a float cent, an unknown currency, a missing list, a record with an unknown kind.

- [x] 10. **Who owes and record rows**
  - Files: `public/ledger-logic.js`
  - Requirements: 71, 72, 73
  - Write `sortOwes`, `splitOwes(list, 6)` and `recordRows` (kind words Sale, Spent, Owes, Paid, Undo; channel words Menu, Text, Web; detail; `undone`; reversal rows with `cancelsText`; newest first).

- [x] 11. **Who owes and record rows tests**
  - Files: `test/public/ledger-logic.test.ts`
  - Requirements: 71, 72, 73, 94
  - Order and tie-break; six shown and the rest hidden; a reversed record is `undone`; a reversal whose target is outside the list; a 24-character shop name and 20-character customer name pass through unchanged.

- [x] 12. **Demo numbers and export file name**
  - Files: `public/ledger-logic.js`, `test/public/ledger-logic.test.ts`
  - Requirements: 79, 83, 97
  - `demoPhone(n)`, `isDemoPhone(text)`, `displayPhone(phone)` (`+27 00 000 xxxx`), `exportFileName(nowMs)`; tests for edges (0, 9999, a stored value that is not a demo number).

## Pure modules: phone logic, typing

- [x] 13. **Constants and the pad**
  - Files: `public/phone-logic.js`
  - Requirements: 24, 31, 41, 51, 57, 60
  - Export `LEDGER_CODE`, the limits, `NEAR_PERCENT`, `PAD` (letters under digits) and `CYCLES`.

- [x] 14. **Editor: 123 mode, keyboard characters, backspace**
  - Files: `public/phone-logic.js`
  - Requirements: 32, 41, 51, 55, 61, 62
  - Write `createEditor({ allow, mode, max })`, `tap` in "123" mode, `typeChar`, `backspace`, `view`, `isEmpty`, with the `dial`, `entry` and `text` character sets and the max length.

- [x] 15. **Editor: multi-tap letters**
  - Files: `public/phone-logic.js`
  - Requirements: 56, 57, 58, 59, 60
  - Add "abc" mode to `tap`: cycle on the same key within 900 ms, accept on another key, `toggleMode`, `settle(editor, now)`, the capital letter at the start, the 0 and 1 cycles, `*` and `#` as typed.

- [x] 16. **Multi-tap tests**
  - Files: `test/public/phone-logic/multitap.test.ts`
  - Requirements: 56 to 61, 93
  - Every key's cycle and wrap; 899 ms joins and 900 ms starts a new character; another key accepts the pending one; the capital rule; `Tendai` typed by taps; mode toggle accepts pending; backspace on a pending character; `max` counts the pending character; `dial` ignores mode.

## Pure modules: phone logic, dial, path, replies, counter

- [x] 17. **Dial and path**
  - Files: `public/phone-logic.js`
  - Requirements: 34, 35, 38, 40, 41
  - Write `classifyDial`, `buildUssdText(path, entry)`, `trimEntry`.

- [x] 18. **Reply parsers**
  - Files: `public/phone-logic.js`
  - Requirements: 37, 42, 45, 46, 49
  - Write `parseUssdReply` (CON or END prefix, lines unchanged, `chars` and `limit` as safe integers or `null`) and `parseSmsReply`.

- [x] 19. **Counter text**
  - Files: `public/phone-logic.js`
  - Requirements: 66, 67, 68
  - Write `counterInfo(kind, chars, limit)` with integer maths and the wording from the Counter section of `design.md`.

- [x] 20. **Dial, path and counter tests**
  - Files: `test/public/phone-logic/dial-and-path.test.ts`, `test/public/phone-logic/counter.test.ts`
  - Requirements: 34 to 41, 45, 46, 66 to 68, 93
  - `*384*46254#` is `ledger`; `*384*46254` and `*384#` are `unknown`; empty is `empty`. Path `1*45*1`; `0` and `00` sent as typed (`1*45*0`, `1*45*0*00`); `100` untouched; `*` and `#` refused in an entry; replies with a bad prefix or a missing `response` fail. Counter: 143/182 ok, 163/182 ok, 164/182 near, 182/182 near, 183/182 over, 98/160 ok, 144/160 near.

## Pure modules: phone logic, state machine

- [x] 21. **State and `shop` event**
  - Files: `public/phone-logic.js`
  - Requirements: 30, 31, 53
  - Write `createPhone()` and `reduce` for `shop`, with the state shape in `design.md`; `noShop` ignores keys.

- [x] 22. **Home screen: dial, Menu, unknown code**
  - Files: `public/phone-logic.js`
  - Requirements: 32, 33, 34, 35, 36
  - `press`, `char`, `backspace`, `soft right` and `send` on `home`; starting a session returns the `ussd` effect with an empty `text` and the supplied session id.

- [x] 23. **Session: CON, END, errors**
  - Files: `public/phone-logic.js`
  - Requirements: 37, 38, 39, 42, 44, 45, 63, 64
  - `send` in `reply` phase builds the path; `ussdReply` with CON, END and `{ ok: false }`; stale session ids dropped; keys ignored while `loading`; any key leaves `ended` and is consumed; the `refresh` effect after each reply.

- [x] 24. **End key and Cancel from every view**
  - Files: `public/phone-logic.js`
  - Requirements: 43
  - `end` and `soft left` in `session` go home, drop the session and discard a late reply; in `messages` leave the screen and keep the thread and any text already sent; `counter` and `notice` reset on every move home.

- [x] 25. **Messages**
  - Files: `public/phone-logic.js`
  - Requirements: 47, 48, 49, 50, 51, 52, 54, 63
  - Open and leave Messages; compose editor starts in "abc"; `send` adds the `me` line (`sending`) and returns the `sms` effect; `smsReply` success and failure rules, including restoring the text and landing in the thread after leaving.

- [x] 26. **Screen model**
  - Files: `public/phone-logic.js`
  - Requirements: 31, 37, 42, 46, 48, 56, 58, 64, 66
  - Write `screenModel(state, ctx)` with the label table and body table from `design.md`: lines unchanged, `9 More` kept, pending index, mode, `busy`, `scroll`, and the counter.

- [x] 27. **State machine tests**
  - Files: `test/public/phone-logic/state.test.ts`
  - Requirements: 30 to 54, 63, 64, 93
  - Drive the reducer as a phone would: first visit, dial, Sale flow `1`, `45`, `1`, `1` ending in `END`, any key home, end key from each view, keys ignored while loading, stale reply dropped, a new session id for every dial, sms send and failure, thread kept after Back. Check the screens the page writes itself are ASCII and under 182 characters.

## Markup

- [x] 28. **Head, skip link, regions**
  - Files: `public/index.html`
  - Requirements: 1, 2, 3, 11, 13, 87, 89
  - Doctype, `lang`, title, viewport (zoom allowed), CSP and referrer meta tags, font links with `display=swap`, empty favicon, skip link, `noscript` line, `main`, and the two visually hidden status regions.

- [x] 29. **Intro and steps card**
  - Files: `public/index.html`
  - Requirements: 10, 11, 16
  - Eyebrow pill, `h1` ("Keep your shop's books on any phone."), the paragraph, and the steps card (double bezel, `h2`, `ol` with the five steps in `design.md` Copy), with `<kbd>`/`<code>` around the code. No AI claim in the text (requirement 99).

- [x] 30. **Phone markup**
  - Files: `public/index.html`
  - Requirements: 24, 25, 26, 27, 87
  - `.phone` container, `.phone-body`, speaker, `.lcd-bezel` around the LCD (status bar, `#lcd-body` as a focusable `role="log"`, entry bar), soft keys, call, mode and end keys, 12 pad keys with `aria-label`s and letters; inline SVG glyphs for call and end; second Start button and `#counter` under it.

- [x] 31. **Ledger panel and footer markup**
  - Files: `public/index.html`
  - Requirements: 16, 69, 76, 84, 86, 98, 100
  - Double bezel with shop heading, Today, Who owes, Last records, error line with Retry, the three buttons (primary arrow in its own circle), and the note. After `main`, the `footer` with its three lines and two links exactly as in `design.md` Copy (never `imali.ai`).

## Styles

- [x] 32. **Tokens, base, fonts, grain**
  - Files: `public/styles.css`
  - Requirements: 3, 9, 12, 13, 14, 15
  - The `:root` block from `design.md` verbatim; base type; `min-height: 100dvh`; the film-grain `body::after`; visually hidden class; skip link.

- [x] 33. **Layout**
  - Files: `public/styles.css`
  - Requirements: 4, 5, 6, 7, 8, 29
  - The grid, the 900 px breakpoint, the sticky phone column and its short-screen fallback, `--phone-w`, the 16 px side padding on narrow screens, and the footer (full width below the columns, links in `--sage-deep` with an underline).

- [x] 34. **Cards and buttons**
  - Files: `public/styles.css`
  - Requirements: 16, 17, 18, 19, 23, 84
  - Double bezel, pill buttons, the arrow circle and its nudge, press scale 0.98, `aria-disabled` look, focus ring.

- [x] 35. **Phone drawing**
  - Files: `public/styles.css`
  - Requirements: 24, 25, 27, 28, 29
  - Bone body gradient with the top-edge highlight and rounded candybar corners, speaker slot, LCD bezel and LCD with pixel grid, soft key row, call/mode/end row, pad, all sized in `cqw` with 44 px minimums; domed keys with a soft shadow under each; key pressed state by transform and an opacity overlay.

- [x] 36. **LCD text and counter**
  - Files: `public/styles.css`
  - Requirements: 22, 46, 58, 65, 66, 67, 68
  - VT323 lines that wrap and never truncate, scrolling body with the entry bar pinned, the inverted pending character, the counter levels with their words.

- [x] 37. **Ledger panel styles**
  - Files: `public/styles.css`
  - Requirements: 69, 71, 72, 73, 91
  - Figures in Geist Mono, owes list, record rows that wrap to two lines at 358 px, struck-through and "undone" styling, Show all and error line.

- [x] 38. **Motion**
  - Files: `public/styles.css`
  - Requirements: 19, 20, 21, 28
  - Fade-up classes under `html.js`, the `lcd-in` line animation, and the `prefers-reduced-motion` block. Check only `transform` and `opacity` are animated.

## DOM: ledger panel

- [x] 39. **Ledger panel drawing**
  - Files: `public/ledger.js`
  - Requirements: 69, 70, 71, 72, 73, 76, 78
  - Draw shop, today, who owes (Show all with `aria-expanded`), and records from `readLedger()` output using `textContent` and `replaceChildren` only.

- [x] 40. **Refresh**
  - Files: `public/ledger.js`
  - Requirements: 74, 75, 77, 81
  - One fetch at a time with folding of extra calls; failure keeps old figures and shows the error line with Retry; `aria-busy` while loading.

- [x] 41. **Shop lifecycle and buttons**
  - Files: `public/ledger.js`
  - Requirements: 30, 79, 80, 81, 82, 84, 85
  - Stored number (checked with `isDemoPhone`, memory fallback if storage throws), Start demo shop with up to three tries on 409, Start over, `aria-disabled` rules, busy labels, `onShop` callback, both Start buttons.

- [x] 42. **Export**
  - Files: `public/ledger.js`
  - Requirements: 83, 89
  - Fetch the blob, save it as `imali-ai-export-YYYY-MM-DD.json` with a temporary link, revoke the object URL, report success or failure to `#panel-status`.

## DOM: phone

- [x] 43. **Render the model**
  - Files: `public/phone.js`
  - Requirements: 31, 46, 52, 58, 64, 65, 66
  - `dispatch` runs `reduce`, then draws the status bar, LCD body (rebuilt when `screenId` changes, patched by `key` otherwise, `--i` set by `style.setProperty`), entry bar, soft key labels with `aria-label` and `aria-disabled`, `aria-busy`, scroll, and `#counter`.

- [x] 44. **Run effects**
  - Files: `public/phone.js`
  - Requirements: 34, 38, 49, 63, 74
  - Handle `ussd`, `sms` and `refresh` effects through the api helper; turn replies and any `ApiError` into `ussdReply` and `smsReply` events; new `sessionId` per dial.

- [x] 45. **Bind keys and timers**
  - Files: `public/phone.js`
  - Requirements: 28, 55, 56, 57, 61
  - Click handlers for all keys; the 900 ms `tick` timer; the minute-aligned clock; the pressed class for 120 ms.

- [x] 46. **Computer keyboard**
  - Files: `public/phone.js`
  - Requirements: 62, 90
  - One `keydown` listener with the target and modifier rules from `design.md` (Keyboard and screen reader).

- [x] 47. **Announcements**
  - Files: `public/phone.js`, `public/ledger.js`
  - Requirements: 87, 88, 89
  - The 500 ms debounced `#echo` text; the clock kept out of the log; `#panel-status` messages.

- [x] 48. **Entry point and reveal**
  - Files: `public/phone.js`
  - Requirements: 20, 21, 95
  - Wire `ledger.js` to the phone through `onShop`; add the `js` class to `html`; the `IntersectionObserver` reveal for the intro, steps and ledger with the no-observer fallback.

## Docs, checks, wrap-up

- [x] 49. **Judges' check list**
  - Files: `docs/judges.md`
  - Requirements: 96
  - Follow the outline in `design.md`: 1280 px and 390 px lists, how to trigger every state, what the ledger panel should show after each of the five steps, the multi-tap tip (0 types a space, 1 punctuation).

- [x] 50. **Static checks**
  - Files: none (run in the shell)
  - Requirements: 1, 2, 9, 12, 13, 19, 97, 98, 99, 100
  - `grep` `public/` for `vh` units, `Inter`, `Roboto`, `Arial`, `Helvetica`, `innerHTML`, `<script src="http`, `style="`, colour literals outside `:root`, any non-ASCII character (which covers em and en dashes), the string `imali.ai`, any `http` link other than the two footer links and the two Google Fonts hosts, and the words "AI" and "artificial" in the page text outside the company name and the footer line; run `node scripts/secret-scan.mjs` on staged files. Fix anything found.

- [x] 51. **Serve `public/`**
  - Files: `src/server/` (only if the server spec has not already done it)
  - Requirements: 1 (assumption A5)
  - Check that `GET /` serves `public/index.html` and its files on Node and on Vercel. If the server spec does not, report it rather than adding a route in this spec.
  - Result: this checkout has no `src/server/` yet, so there is nothing to check on Node or Vercel. Reported, not added. The page was run against a throwaway mock of routes A1 to A5 that also served `public/`.

- [x] 52. **Manual run at both sizes**
  - Files: none
  - Requirements: 4 to 8, 22, 23, 29, 90, 91
  - Walk `docs/judges.md` at 1280x800, 1280x720 and 390x844, plus a 200 percent zoom and a 320 px width. Record anything that fails as a new task.
  - Result: walked by script in headless Chromium against the mock (layout and fit at 1280x900, 800, 760, 720, 700 and 699 high, 390x844, 320 wide, 640x400 as 200 percent zoom, reduced motion, no JavaScript, every state in `design.md`). Not a human pass with a real server, a real screen reader or a touch device; that is still worth doing once the server spec lands.

- [x] 53. **Run the suite**
  - Files: none
  - Requirements: 93, 94
  - `npm test` and `npm run typecheck` pass; no test touches the network.

- [x] 54. **README line**
  - Files: `README.md`
  - Requirements: 96
  - Change "the browser phone for judges ... come next" to say the browser phone is built, and point to `docs/judges.md`.
