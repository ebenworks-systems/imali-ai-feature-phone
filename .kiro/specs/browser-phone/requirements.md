# Browser Phone Requirements

The live demo page. Judges have no African SIM card, so the page draws a working feature phone in the browser and
talks to the same handler the real network calls. It also shows the shop's ledger, so a judge can see each key press
turn into a record. Plain HTML, CSS and JavaScript in `public/`. No build step, no framework, no tracking.

## Terms

- **the page**: `public/index.html` with `styles.css`, `phone.js`, `ledger.js` and the DOM-free modules `phone-logic.js`,
  `ledger-logic.js` and `api.js`.
- **the phone**: the drawn feature phone and everything that drives it.
- **the LCD**: the green screen on the phone.
- **the entry**: the line the owner is typing (the dial line, a reply to a menu screen, or a text message).
- **a session**: one dialled-menu conversation, from dialling the code to an `END` screen or the end key.
- **the path**: the entries sent so far in a session, joined with `*`.
- **the ledger panel**: the card with the shop's figures, who owes, the last records and the three buttons.
- **the phone logic**, **the ledger logic**, **the api helper**: the three modules with no DOM in them.
- **the ledger code**: `*384*46254#`. The digits spell IMALI on a keypad. It is the code of our Africa's Talking
  sandbox channel.

## Routes the page calls

The page was first built against a contract written before the server existed. The two did not match when they ran
together (task 56), so the table below is now the server's own answer, as `server-and-store` documents it (its
requirements 23 to 30, and `src/server/views.ts`). Anything the page needs beyond it is listed under "Assumptions" at
the end. The test `test/integration/page-contract.test.ts` checks this table against the real app.

| Route | Request | Answer |
|---|---|---|
| `POST /api/phone/ussd` | JSON `{ phone, sessionId, text }` | `{ response, length, limit }`; `response` starts `CON ` or `END `; `length` counts the text after that prefix |
| `POST /api/phone/sms` | JSON `{ phone, text }` | `{ reply, length, limit }` |
| `GET /api/ledger?phone=` | none | `shop` (name, phone, currency, timeZone); `today` (date, `sales` `{ total, count }`, `expenses`, `moneyInHand`, `newDebts`, `paymentsReceived`, `totalOwed`); `owes` `{ customers: [{ name, owed }], more }`; and `records`, the last 20, newest first, each with `id`, `kind`, `amount`, `channel`, `originalWords`, `createdAt`, `reversed`, and optionally `item`, `customer`, `reversesRecordId` |
| `GET /api/export?phone=` | none | the records as a JSON download |
| `POST /api/phone/demo` | JSON `{ phone }` | makes a demo shop for that number |

Every money value in the `GET /api/ledger` answer is an object `{ cents, text }`. The page reads `cents` (a safe
integer) and writes its own text from it with `formatMoney`; it never shows the server's `text` (requirement 70).

## EARS Acceptance Criteria

### Page and layout

1. THE page SHALL be plain HTML, CSS and JavaScript in `public/` (`index.html`, `styles.css`, `phone.js`,
   `ledger.js`, `phone-logic.js`, `ledger-logic.js`, `api.js`) with no build step, no framework and no analytics or
   tracking script.

2. THE page SHALL request only files from its own origin plus the Google Fonts stylesheet (`fonts.googleapis.com`) and
   font files (`fonts.gstatic.com`), and SHALL declare a Content-Security-Policy meta tag that names those two hosts
   and no other origin, and blocks every inline script and inline style.

3. THE page SHALL use a light theme only and SHALL declare `color-scheme: light`.

4. WHEN the viewport is 900 px wide or more, THE page SHALL show two columns: on the left the pill eyebrow, the
   headline, the paragraph, the steps card and the ledger panel, in that order; on the right the phone. The footer
   SHALL sit below both columns, across the full width.

5. WHILE two columns are shown and the viewport is at least 700 px high, THE phone column SHALL stay in view
   (sticky) while the left column scrolls, and the phone with its counter SHALL fit inside the viewport height.

6. WHILE two columns are shown and the viewport is less than 700 px high, THE phone column SHALL scroll with the
   page instead of sticking.

7. WHEN the viewport is narrower than 900 px, THE page SHALL show one column in this order: the phone at full width
   with 16 px side padding, then the eyebrow, headline and paragraph, then the steps card, then the ledger panel,
   then the footer.

8. THE page SHALL NOT scroll sideways at any width from 320 px up. WHEN the viewport is 390 px wide, THE phone,
   keypad included, SHALL be fully visible and usable without zooming or sideways scrolling.

9. THE page SHALL give the body a minimum height of `100dvh` and SHALL NOT use `vh` units anywhere.

10. THE page SHALL show the copy listed under "Copy" in `design.md` exactly as written there.

11. THE page SHALL set `lang="en"`, give the document a title, allow the user to zoom, use one `main` landmark, one
    `h1`, one `h2` per card, one `footer` landmark after `main`, and offer a skip link to the ledger panel as the
    first focusable element.

### Design tokens and surfaces

12. THE page SHALL define the colours, fonts, radii, shadows, easing and durations in `design.md` as CSS custom
    properties on `:root`, and `styles.css` SHALL NOT use a colour literal outside that block, except inside the
    film-grain image.

13. THE page SHALL set headings in Fraunces, text in Geist, counts and figures in Geist Mono and the LCD in VT323,
    all loaded from Google Fonts with `display=swap`, and no font stack in `styles.css` SHALL name Inter, Roboto,
    Arial or Helvetica.

14. THE page SHALL set the headline large with tight leading, and SHALL balance its line breaks.

15. THE page SHALL draw a film-grain overlay that is fixed, ignores the pointer and has an opacity of 0.03.

16. THE steps card and the ledger panel SHALL each be a double bezel: an outer shell with a hairline ring, 6 px of
    padding and a 28 px radius, holding an inner core with its own background, a soft inset highlight and a 22 px
    radius.

17. THE page SHALL use wide, soft shadows and SHALL NOT use a hard dark shadow or a plain 1 px grey border.

18. THE page SHALL draw every button as a pill. THE primary button SHALL carry its arrow inside its own small
    circle. WHEN the pointer is over the primary button or it has keyboard focus, THE circle SHALL move up and to the
    right. WHEN any button is pressed, it SHALL scale to 0.98.

19. THE page SHALL use `cubic-bezier(0.32, 0.72, 0, 1)` for every transition and animation, and SHALL animate only
    `transform` and `opacity`.

20. WHEN the intro, the steps card or the ledger panel first enters the view, THE page SHALL fade it up once, using
    `IntersectionObserver`. IF `IntersectionObserver` or JavaScript is missing, THEN THE page SHALL show those
    sections at once.

21. WHILE the visitor's system asks for reduced motion, THE page SHALL run no animation or transition, and SHALL show
    every section and every LCD line at once.

22. THE page SHALL give all text a contrast ratio of at least 4.5:1 against its background, and all key glyphs and
    focus rings at least 3:1. THE page SHALL NOT use the sage accent for text.

23. THE page SHALL give every button, link and scrollable area a visible focus ring, and SHALL NOT rely on colour
    alone to show a state (near the limit, undone, ended).

### The phone: hardware

24. THE phone SHALL be drawn in CSS only, with no images, as a candybar handset: a rounded body in light, warm bone
    plastic that is never a dark fill, with a subtle highlight along its top edge; a speaker slot above the screen;
    a sage monochrome LCD with a faint pixel grid, set into a bezel that is part of the body; a row of three soft
    keys (left, centre, right); a green call key and a clay end key; and a 12-key pad (1, 2 abc, 3 def, 4 ghi, 5 jkl,
    6 mno, 7 pqrs, 8 tuv, 9 wxyz, \*, 0, \#) with the letters under the digits. Every key SHALL be domed (lit from
    above, darker at its lower rim) and SHALL cast a soft shadow on the body beneath it.

25. THE phone SHALL also have one small mode key, labelled "123 / abc", between the call key and the end key.

26. THE phone SHALL draw every key as a real `button` element with an accessible name. A digit key's name SHALL give
    the digit and its letters ("2, a b c"). A soft key's name SHALL say which key it is and its current label
    ("Left soft key, Messages").

27. WHEN a soft key has no label on the current screen, THE phone SHALL mark it `aria-disabled="true"`, SHALL keep
    it focusable and SHALL ignore it when pressed.

28. WHEN a key is pressed with the pointer, activated with the keyboard, or typed on the computer keyboard, THE phone
    SHALL show that key depressed, using `transform` only.

29. THE phone SHALL size itself from its own width: full width of the column below 900 px (centred, and no wider
    than 440 px so it stays a phone on a tablet), and on wide screens a width taken from the viewport height so
    requirement 5 holds. Every key SHALL be at least 44 px high and 44 px
    wide.

### Home screen and dialling

30. WHILE no demo shop exists, THE LCD SHALL show "Press Start demo shop", THE keys SHALL NOT dial, and THE page
    SHALL show a second "Start demo shop" button directly under the phone that does the same as the one in the
    ledger panel.

31. WHILE a demo shop exists and no session or message screen is open, THE LCD SHALL show "Imali AI" as the network
    name, the time in the shop's time zone, the demo number written `+27 00 000 xxxx`, the hint
    "Dial *384*46254#", the dial line, and the soft keys "Messages" (left) and "Menu" (right).

32. WHILE the home screen is shown, THE phone SHALL put typed digits, `*` and `#` into the dial line up to 20
    characters, and SHALL ignore every other character.

33. WHEN the owner presses the "Menu" soft key and the dial line is empty, THE phone SHALL fill the dial line with
    the ledger code.

34. WHEN the owner presses the green key, the centre key or Enter on the home screen and the dial line is exactly
    the ledger code, THE phone SHALL start a session: it SHALL make a new session id, show "Please wait...", and
    call `POST /api/phone/ussd` with the demo number, that id and an empty `text`.

35. IF the dial line is not empty and is not the ledger code, THEN THE LCD SHALL show "Unknown code. Try
    *384*46254#." and THE phone SHALL stay on the home screen and make no request.

36. THE phone SHALL use a new session id for every dial and SHALL NOT reuse one.

### The dialled menu

37. WHEN a reply starts `CON `, THE LCD SHALL show the text after the prefix, one LCD line per line break, with an
    empty entry line below it, and THE session SHALL continue.

38. WHEN the owner presses the green key, the centre key or Enter during a session and the entry is not empty, THE
    phone SHALL call `POST /api/phone/ussd` with the same session id and a `text` made of the path followed by the
    entry, joined with `*`.

39. WHEN the reply to a sent entry starts `CON `, THE phone SHALL add that entry to the path. IF the reply is an
    `END` screen or an error, THEN THE phone SHALL discard the path with the session.

40. THE phone SHALL send an entry of exactly `0` or exactly `00` as typed, as an ordinary entry in the path, and SHALL
    NOT remove entries from the path or clear it by itself. A `0` inside a longer entry (such as `100`) SHALL be an
    ordinary digit.

41. THE phone SHALL NOT accept `*` or `#` in an entry during a session, SHALL accept at most 40 characters, and SHALL
    ignore a send when the entry is empty.

42. WHEN a reply starts `END `, THE LCD SHALL show the text after the prefix and THE session SHALL be closed. WHEN
    the owner then presses any key (a digit, a soft key, the call key, the centre key, or a computer key), THE phone
    SHALL return to the home screen and SHALL do nothing else with that key.

43. WHEN the owner presses the end key, the Escape key or the "Cancel" soft key in any state, THE phone SHALL end the
    session or leave Messages, discard any menu reply still on its way, and show the home screen with an empty dial
    line. A text message already sent SHALL NOT be cancelled; its reply still lands in the thread.

44. WHILE a menu request is on its way, THE phone SHALL ignore every key except the end key (and the "Cancel" soft
    key, which does the same).

45. IF a reply to the ussd route does not have a string `response` starting `CON ` or `END `, THEN THE phone SHALL
    treat it as a network error (requirement 63).

46. THE LCD SHALL show the text of every screen exactly as the route sent it, without cutting, joining or rewording
    lines, including a "9 More" line.

### Messages

47. WHEN the owner presses the left soft key ("Messages") on the home screen, THE phone SHALL open a thread with the
    ledger, shown as "Imali AI", with the owner's messages and the ledger's replies in the order they happened, the
    newest at the bottom, and a compose line below.

48. WHILE the thread is empty, THE LCD SHALL show the line "Text a line like: sold 45 bread".

49. WHEN the owner sends a non-empty compose line, THE phone SHALL add the owner's message to the thread at once,
    empty the compose line, call `POST /api/phone/sms` with the demo number and the text, and add the reply to the
    thread.

50. WHILE an sms reply is on its way, THE phone SHALL ignore another send.

51. THE phone SHALL accept at most 160 characters in the compose line and SHALL ignore a send when it is empty.

52. WHEN a line is added to the thread, THE LCD SHALL scroll so the newest line is in view.

53. THE phone SHALL keep the thread in memory only. THE thread SHALL start empty on each page load and after "Start
    over".

54. WHEN the owner presses the left soft key ("Back") in Messages, THE phone SHALL return to the home screen.

### Typing

55. WHEN a digit key is tapped in "123" mode, THE phone SHALL add that digit to the entry.

56. WHEN the mode key is pressed, THE phone SHALL switch between "123" and "abc" mode and SHALL show the current
    mode on the LCD. THE phone SHALL start the home screen and each session screen in "123" mode and the compose
    line in "abc" mode.

57. WHEN a key with letters is tapped in "abc" mode, THE phone SHALL add its first letter as a pending character. WHEN
    the same key is tapped again less than 900 ms after the last tap, THE phone SHALL replace the pending character
    with the next one in the key's cycle (for 2: a, b, c, 2, then a again). WHEN 900 ms pass, or another key is tapped,
    or the mode key is pressed, THE phone SHALL accept the pending character.

58. THE phone SHALL show the pending character on the LCD as highlighted until it is accepted.

59. WHILE the entry is empty in "abc" mode, THE phone SHALL type a letter as a capital. All other letters SHALL be
    lower case.

60. WHILE in "abc" mode, THE key 0 SHALL cycle space then 0, THE key 1 SHALL cycle `. , ? ! ' @ 1`, and `*` and `#`
    SHALL be added as typed (except where requirement 41 forbids them).

61. WHEN the "Clear" soft key is pressed or Backspace is typed, THE phone SHALL remove the pending character, or the
    last character if none is pending.

62. WHEN the computer keyboard is used while focus is on the page body or inside the phone, THE phone SHALL add
    printable ASCII characters that the current entry accepts, SHALL clear on Backspace, SHALL send on Enter, SHALL end
    on Escape, and SHALL scroll the LCD on the Up and Down arrow keys. THE phone SHALL ignore any key typed with
    Control, Meta or Alt held, and any key typed while focus is on a button outside the phone. WHEN focus is on a phone
    key, Enter and Space SHALL press that key and not send.

### States and errors

63. IF a request fails, times out after 10 seconds, answers with a non-2xx status, or answers with something that is
    not JSON, THEN THE LCD SHALL show "No network. Try again." and: in a session, the session SHALL end as an `END`
    screen would (requirement 42); in Messages, the phone SHALL remove the unsent message from the thread, add the
    line "No network. Try again." to the thread, and, if Messages is still open with an empty compose line, put the
    message text back in the compose line.

64. WHILE a request is on its way, THE LCD SHALL show "Please wait..." (in a session) or mark the new message as
    sending (in Messages), and THE phone SHALL set `aria-busy="true"` on the LCD.

65. WHEN a screen has more lines than the LCD can show, THE LCD SHALL scroll inside itself, reachable by touch,
    wheel and keyboard, and SHALL keep the entry line in view.

### The counter

66. WHEN a ussd reply or an sms reply arrives, THE page SHALL show under the phone "This screen: N of L characters"
    (menu) or "Reply: N of L characters" (text), taking N and L from the route's `length` and `limit`.

67. WHILE N is at least 90 percent of L, THE counter SHALL add the words "near the limit" and use the clay colour.
    WHILE N is more than L, THE counter SHALL say "over the limit" instead.

68. WHILE no counted screen is shown (home, first visit, an error, a new session waiting for its first reply), THE
    counter SHALL be empty and its space SHALL stay reserved. THE counter SHALL NOT be a live region.

### The ledger panel

69. THE ledger panel SHALL show the shop name and currency, today's figures (sales and their count, spent, in
    hand), who owes (name and amount, largest first), and the last records. WHILE the server reports customers it
    left out of the who-owes list (`owes.more` above zero), THE panel SHALL say how many more people owe money. WHILE no demo shop exists, it SHALL show
    "No demo shop yet. Press Start demo shop." in place of the figures.

70. THE page SHALL format money from whole cents the way the server does: the currency symbol, no decimals when the
    cents are zero, two decimals otherwise, and a comma for thousands (`R45`, `R45.50`, `R1,240`), without
    floating-point arithmetic.

71. WHEN more than six people owe money, THE ledger panel SHALL show the first six and a "Show all N" button that
    shows the rest and reports its state with `aria-expanded`.

72. THE ledger panel SHALL show each record with its kind in the owner's words (Sale, Spent, Owes, Paid, Undo), its
    amount, its item or customer, the channel it came from (Menu, Text or Web) and its time in the shop's time zone,
    newest first. A record from an earlier day SHALL show its date before the time.

73. WHEN the server marks a record `reversed`, THE ledger panel SHALL show it struck through and with the word
    "undone", so the state is never shown by line or colour alone. A reversal record SHALL appear as one row that reads
    in plain words, "Undo: cancelled Owes R20 Tendai (sugar)", naming the record it cancels by kind, amount, customer
    and item (the item in brackets after a customer, bare otherwise), or "Undo: cancelled an earlier record" when that
    record is not among the last 20.

74. WHEN the page loads, WHEN a demo shop starts, and after every ussd or sms attempt finishes (reply or failure),
    THE ledger panel SHALL fetch `GET /api/ledger` and redraw. WHILE a fetch is running, a further refresh SHALL be
    folded into one more fetch afterwards.

75. IF a refresh fails, THEN THE ledger panel SHALL keep the figures it has and show the line "Could not refresh.
    Try again." with a Retry button.

76. WHILE the ledger panel has no data yet, it SHALL show "Loading..." and set `aria-busy="true"`. WHEN there are no
    records, it SHALL say "No records yet."; WHEN nobody owes money, it SHALL say "Nobody owes money."

77. THE page SHALL check the ledger answer before drawing it (every `cents` is a safe integer, kinds and channels are
    known, `reversed` is a boolean, `owes.customers` and `records` are arrays). IF the answer is not valid, THEN THE
    page SHALL treat it as a failed refresh.

78. THE page SHALL put every value that came from the server or the owner into the page with `textContent` and
    SHALL NOT build markup from it.

### Demo shop buttons

79. WHEN the owner presses "Start demo shop", THE page SHALL make a random number `+2700000xxxx` using
    `crypto.getRandomValues`, call `POST /api/phone/demo` with it, show the button as busy, and on success keep the
    number in `localStorage` and show the home screen.

80. IF the demo route says the number is taken (HTTP 409), THEN THE page SHALL try a new number, up to three tries
    in all. IF it still fails, THEN THE page SHALL show "Could not start the demo shop. Try again." and keep the
    first-visit state.

81. WHEN the page loads with a stored number, THE page SHALL call `GET /api/ledger` for it. IF the answer is 404,
    THEN THE page SHALL forget the number and show the first-visit state. IF the call fails for another reason, THEN
    THE page SHALL keep the number, show the home screen and show requirement 75's note.

82. WHEN the owner presses "Start over", THE page SHALL end any session, empty the thread and make a new demo shop
    with a new number as in requirements 79 and 80. THE old shop SHALL be left untouched on the server.

83. WHEN the owner presses "Export records", THE page SHALL fetch `GET /api/export?phone=` with the number URL-encoded
    and save the answer as a file named `imali-ai-export-YYYY-MM-DD.json`, with the button shown as busy meanwhile.
    IF the fetch fails, THEN THE page SHALL show "Could not export. Try again."

84. WHILE no demo shop exists, THE "Start over" and "Export records" buttons SHALL be `aria-disabled="true"`. WHILE a
    demo shop exists, THE "Start demo shop" buttons SHALL be `aria-disabled="true"`. WHILE a button's action is
    running, it SHALL ignore a second press.

85. IF `localStorage` is not available, THEN THE page SHALL keep the number in memory for the visit and work as
    normal.

86. THE ledger panel SHALL show the line "Everything here is invented demo data." under its buttons.

### Screen readers and keyboard

87. THE LCD body SHALL be a focusable scrolling `role="log"` element with an accessible name, so a new screen or a
    new thread line is announced politely. THE status bar (network name and time) SHALL sit outside it and SHALL NOT be
    announced when the time changes.

88. WHEN the entry changes because of typing, THE phone SHALL announce it through a visually hidden polite status
    ("Entry: 45") after typing pauses for 500 ms.

89. WHEN a button in the ledger panel or under the phone starts, finishes or fails, THE page SHALL say so through a
    visually hidden polite status.

90. THE page SHALL work with the keyboard alone: every control reachable with Tab in reading order, no keyboard trap,
    and the computer-keyboard typing of requirement 62.

91. THE page SHALL remain readable and usable when zoomed to 200 percent.

### Tests and docs

92. THE phone logic SHALL contain no DOM access, no `fetch`, no timers and no clock reads. Times and ids SHALL be
    passed in.

93. THE test suite SHALL cover, with Vitest and no browser: dial and path building (requirements 34 to 41), the 0 and
    00 rules (40), multi-tap letters (56 to 61), the counter text (66 to 68), and the state rules for the end key,
    `END` screens and requests on their way (42 to 44, 50, 63).

94. THE test suite SHALL cover the ledger logic (money formatting that matches `src/core/money/format.ts` for every
    currency and for random cents, time formatting, who-owes order, record rows, ledger answer checks, demo numbers)
    and the api helper (timeout, non-2xx, bad JSON, URL encoding) using a fake `fetch`.

95. THE DOM files (`phone.js`, `ledger.js`) SHALL only draw, listen, set timers, call `fetch` through the api helper
    and use `localStorage`; every rule they need SHALL live in the logic modules.

96. THE repository SHALL contain `docs/judges.md`, a short manual check list for 1280 px and 390 px wide screens
    that includes each state in `design.md`. WHERE a state cannot happen on a fresh demo shop (the empty ledger), THE
    check list SHALL say how to see it.

97. THE page, its tests and its docs SHALL use only invented demo data, SHALL put demo numbers in `+27 00 000 xxxx`,
    and SHALL contain no key, token or password.

### Copy, footer and links

98. THE page SHALL end with a `footer` that holds, in this order and with these exact words: the line "An open-source
    companion to Imali AI." as a link to `https://imali-ai.ebenworks.co`; the line "Imali AI: Africa's smartest AI
    Business OS." on a line of its own, as plain text; and the line "Built with Kiro. MIT licence." as a link to
    `https://github.com/ebenworks-systems/imali-ai-feature-phone`. THE page SHALL NOT link to `imali.ai`, and SHALL
    contain no other link to a site outside its own origin.

99. THE page text SHALL NOT claim that the ledger, the phone or the demo uses or contains an AI. The company name
    "Imali AI" and the footer line in requirement 98 are names and are allowed.

100. THE page SHALL use an ASCII hyphen wherever it needs a dash, and SHALL contain no em dash, no en dash and no
     other non-ASCII character in its markup, styles or scripts.

101. THE page's `formatMoney` SHALL write a negative amount with the minus sign before the currency symbol, `-R60` and
     `-KSh1,200.50`, never `R-60`, for every currency, exactly as `formatCents` in `src/core/money/format.ts` does.

### Matching the server (added after the first run against it)

102. THE phone SHALL read the character count of a menu screen or a text reply from the route's `length` field, and
     the limit from `limit`. IF `length` is missing or is not a safe integer of 0 or more, THEN THE counter SHALL stay
     empty (it SHALL NOT read a field called `chars`).

103. THE page SHALL read `GET /api/ledger` in the server's shape (the Routes table): money from `{ cents }`, today's
     sales from `today.sales.total` and `today.sales.count`, spent from `today.expenses`, money in hand from
     `today.moneyInHand`, who owes from `owes.customers`, and each record's customer from `customer`. THE page SHALL
     keep its own money formatting from cents and SHALL NOT show the server's `text`.

104. THE demo shop starts with invented records (a shop called Thandi's Spaza), so the "Try it in one minute" card and
     `docs/judges.md` sections 2, 4 and 6 SHALL describe each step as a change (Sales goes up by R45 and its count by
     one; a Sale R45 row with channel Menu appears at the top; Tendai's total owed goes up by R20; after undo, the Owes
     row is marked undone and Tendai's total goes back) and SHALL NOT state absolute totals, because the invented
     records are placed relative to the current time.

105. THE steps card SHALL write the text-message examples inside their code chips with no quote marks
     (`Tendai owes 20 sugar`), because the chip already marks the words.

106. THE test suite SHALL include a contract test, `test/integration/page-contract.test.ts`, that builds the real app
     with `createApp` and the memory stores, makes a demo shop through `POST /api/phone/demo`, sends a sale through
     `/api/phone/ussd` and a debt through `/api/phone/sms`, and passes the real JSON answers of `/api/ledger`,
     `/api/phone/ussd` and `/api/phone/sms` through the page's own `readLedger`, `parseUssdReply` and
     `parseSmsReply`. It SHALL check that the answers are accepted and read correctly: the shop name, today's sales,
     the debt in the who-owes list, the newest record first, the Undo row after `undo`, and the counter numbers. It
     SHALL fail on the page as it was before task 56.

## Assumptions about the other specs

These are the points where this page needs more than the route contract above says. Each should be confirmed
against the `server-and-store` and `dialled-menu` specs. The page needs only a one-function change if one is wrong.

- **A1.** `GET /api/ledger` returns the top-level keys `shop`, `today`, `owes` and `records` (confirmed by the contract
  test), and answers 404 for a number with no shop. `shop.timeZone` is always sent; if it is missing or unknown the
  page uses `Africa/Johannesburg`.
- **A2.** `POST /api/phone/demo` answers 2xx on success and 409 when the number is already a shop.
- **A3.** The dialled menu works out `0` (back one screen) and `00` (main menu) from the raw path, as the network
  would send it, because only the server knows its screens.
- **A4.** A non-2xx answer from the ussd or sms route carries nothing the owner should see, so the page shows its own
  "No network. Try again."
- **A5.** `GET /api/export?phone=` answers 200 with JSON for a demo shop, and `GET /` serves `public/index.html` with
  its files beside it.
