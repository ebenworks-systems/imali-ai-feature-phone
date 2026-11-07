# Browser Phone Design

The page is static files in `public/`. All rules sit in three modules with no DOM in them, so Vitest can test them.
Two thin DOM files draw the result and run the timers. Requirement numbers refer to `requirements.md`.

## Files

| File | DOM? | Job |
|---|---|---|
| `public/index.html` | yes | All static markup: phone anatomy, steps card, ledger panel, footer, status regions, CSP meta tag |
| `public/styles.css` | yes | Tokens, layout, phone drawing, motion |
| `public/phone-logic.js` | **no** | Typing (multi-tap), dial, path, the phone state machine, the screen model, the counter text |
| `public/ledger-logic.js` | **no** | Money and time formatting, checking the ledger answer, who-owes order, record rows, demo numbers, export file name |
| `public/api.js` | **no** | `fetch` with a timeout and one error type; takes `fetch` as a parameter |
| `public/phone.js` | yes | Entry point. Binds keys, runs timers, runs the effects the state machine asks for, draws the LCD and counter |
| `public/ledger.js` | yes | Ledger panel, the three buttons, `localStorage`, the shop lifecycle |

`phone-logic.js` imports nothing. `ledger-logic.js` and `api.js` import nothing. `phone.js` imports the three
modules and `ledger.js`; `ledger.js` imports `ledger-logic.js` and `api.js`. `ledger.js` never imports `phone.js`; it
tells `phone.js` about the shop through a callback.

`index.html` loads one script, `<script type="module" src="phone.js">`. All URLs are relative (`styles.css`, not
`/styles.css`).

The brief named four files. `phone-logic.js`, `ledger-logic.js` and `api.js` are added because the tests cannot
load files that touch the DOM (jsdom is not installed, and adding it needs your say-so under the dependency rule).

## Route contract as the page reads it

| Call | Page sends | Page reads |
|---|---|---|
| `POST /api/phone/ussd` | `{ phone, sessionId, text }` (`phone` is `+2700000xxxx`) | `response` (string, `CON ` or `END ` prefix), `chars`, `limit` |
| `POST /api/phone/sms` | `{ phone, text }` | `reply`, `chars`, `limit` |
| `GET /api/ledger?phone=` | `phone` through `encodeURIComponent` (a bare `+` would arrive as a space) | see below |
| `GET /api/export?phone=` | same encoding | the body as a blob |
| `POST /api/phone/demo` | `{ phone }` | the status only |

`GET /api/ledger` answer, as `readLedger()` checks it (requirement 77). Anything else makes `readLedger()` return
`{ ok: false }`:

```js
{
  shop:   { name: string, currency: 'ZAR'|'USD'|'KES'|'NGN'|'GHS'|'ZMW'|'BWP', timeZone?: string },
  today:  { sales: int, salesCount: int, spent: int, inHand: int },   // cents, inHand may be negative
  whoOwes:[ { name: string, owed: int } ],                            // cents
  records:[ { id, kind: 'sale'|'expense'|'debt'|'payment'|'reversal', amount: int, createdAt: string /*UTC ISO*/,
              channel: 'ussd'|'sms'|'web', item?: string, customerDisplayName?: string, reversesRecordId?: string } ]
}
```

Every cents value must pass `Number.isSafeInteger`. If the server spec names the keys differently, only
`readLedger()` changes.

## Copy

Exact strings. Straight quotes are as written in the brief.

| Place | Text |
|---|---|
| Eyebrow pill | `Kiroween 2026 - Resurrection` |
| `h1` | `Keep your shop's books on any phone.` |
| Paragraph | `Dial a code or send a text message. The ledger works on any phone, with no data bundle, no app and no smartphone.` |
| Steps `h2` | `Try it in one minute` |
| Step 1 | `Press Start demo shop.` |
| Step 2 | `Dial *384*46254# and press the green key.` |
| Step 3 | `Press 1 for Sale, type 45, press 1 to skip the item, press 1 to save.` |
| Step 4 | `Open Messages and send "Tendai owes 20 sugar", then "who owes".` |
| Step 5 | `Send "undo", then "close", and press Export to download the records Imali AI can import.` |
| Ledger note | `Everything here is invented demo data.` |
| Footer line 1 | `An open-source companion to Imali AI.` (the whole line is one link to `https://imali-ai.ebenworks.co`) |
| Footer line 2 | `Imali AI: Africa's smartest AI Business OS.` (its own line, plain text, no link) |
| Footer line 3 | `Built with Kiro. MIT licence.` (the whole line is one link to `https://github.com/ebenworks-systems/imali-ai-feature-phone`) |
| First visit (LCD) | `Press Start demo shop` |
| Network error (LCD and thread) | `No network. Try again.` |
| Unknown code (LCD) | `Unknown code. Try *384*46254#.` |
| Waiting (LCD) | `Please wait...` |
| Empty thread (LCD) | `Text a line like: sold 45 bread` |
| Counter, menu / text | `This screen: 143 of 182 characters` / `Reply: 98 of 160 characters` |
| Counter, near / over | `... - near the limit` / `... - over the limit` |
| Ledger empty states | `Loading...` / `No records yet.` / `Nobody owes money.` / `No demo shop yet. Press Start demo shop.` |
| Ledger errors | `Could not refresh. Try again.` / `Could not export. Try again.` / `Could not start the demo shop. Try again.` |

Step 3 says "press 1" without naming the send key. The centre soft key reads "Send" on every menu screen, so the
word is on the screen when the owner needs it. `docs/judges.md` says "press Send (the centre key or the green key)".

`<noscript>` shows: `This demo needs JavaScript. It draws the phone in your browser.`

Copy rules (requirements 98 to 100):

- The headline and paragraph do not mention an AI. The ledger reads text with fixed rules first, and the page does not
  say more than it knows about the server. "Imali AI" appears only as the company name: the LCD network name, the
  thread name, the footer and the export step.
- Dashes are the ASCII hyphen. The page holds no em dash, no en dash and no curly quote; apostrophes are straight.
- Only two links leave the page, both in the footer. The company site is `imali-ai.ebenworks.co`; `imali.ai` is never
  linked. Links carry `rel="noopener noreferrer"`.

## Design tokens

All in one `:root` block in `styles.css`. Nothing else in the file holds a colour literal (requirement 12), except
that the film-grain image has none to hold.

```css
:root {
  color-scheme: light;

  /* Surface and text */
  --paper:        #FBF8F1;
  --ink:          #2A2320;
  --ink-soft:     #6B5F57;
  --sage:         #8A9A7B;   /* accent for fills and rules only, never text (2.83:1) */
  --sage-deep:    #4F5E45;   /* accent text, focus ring */
  --clay:         #B4532A;
  --hairline:     rgba(42, 35, 32, 0.08);

  /* Cards */
  --shell:        rgba(42, 35, 32, 0.035);   /* outer shell fill */
  --core:         #FFFDF8;                   /* inner core fill */
  --highlight:    rgba(255, 255, 255, 0.7);  /* soft inset highlight */
  --pill-tint:    #EEF1E6;                   /* eyebrow pill fill */
  --on-ink:       var(--paper);
  --on-ink-tint:  rgba(251, 248, 241, 0.16); /* arrow circle on the primary button */

  /* Phone */
  --lcd-bg:       #C9D4B0;
  --lcd-ink:      #1F2A1A;
  --lcd-ink-soft: #44503E;
  --lcd-grid:     rgba(31, 42, 26, 0.07);
  --lcd-invert-bg: var(--lcd-ink);           /* pending character, highlight */
  --lcd-invert-fg: var(--lcd-bg);
  --body-top:     #ECE6DA;
  --body-bottom:  #DCD3C3;
  --key:          #F6F2EA;
  --key-legend:   var(--ink);
  --key-letters:  var(--ink-soft);
  --call:         #6E8B5E;
  --end:          #B4532A;
  --glyph-on-call: var(--ink);               /* 4.06:1, graphic only */
  --glyph-on-end:  var(--paper);             /* 4.70:1, graphic only */
  --focus:        var(--sage-deep);

  /* Handset detail (added for requirement 24; every value is light or a translucent shade) */
  --shade:        rgba(60, 45, 30, 0.16);    /* soft shade under keys, in recesses */
  --shade-deep:   rgba(60, 45, 30, 0.30);    /* rim of the speaker slot and LCD recess */
  --body-gloss:   rgba(255, 255, 255, 0.55); /* highlight band on the top edge of the body */
  --bezel-top:    #D3CAB8;                   /* LCD bezel, upper edge (a recess, lighter than any dark fill) */
  --bezel-bottom: #E6DFD1;                   /* LCD bezel, lower edge */
  --key-hi:       #FFFDF8;                   /* dome highlight */
  --key-lo:       #E4DCCB;                   /* dome lower rim */
  --speaker:      rgba(42, 35, 32, 0.38);    /* speaker slot fill; a 1 px cut-out, not a body colour */

  /* Type */
  --font-display: 'Fraunces', Georgia, 'Times New Roman', serif;
  --font-text:    'Geist', sans-serif;
  --font-mono:    'Geist Mono', ui-monospace, 'Courier New', monospace;
  --font-lcd:     'VT323', 'Courier New', monospace;
  --text-xs:      0.8125rem;
  --text-sm:      0.9375rem;
  --text-base:    1rem;
  --text-lg:      1.125rem;
  --text-display: clamp(2.5rem, 1.2rem + 4.2vw, 4.5rem);   /* h1; line-height 1.02, letter-spacing -0.02em */
  --text-h2:      clamp(1.5rem, 1.2rem + 1vw, 2rem);

  /* Space (4 px base) */
  --space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem; --space-4: 1rem;
  --space-6: 1.5rem;  --space-8: 2rem;   --space-12: 3rem;   --space-16: 4rem;
  --gutter-mobile: 16px;
  --column-gap: 64px;
  --phone-col: 380px;

  /* Shape */
  --radius-shell: 28px;
  --radius-core:  22px;      /* shell radius minus its 6 px padding */
  --radius-pill:  999px;
  --shell-pad:    6px;

  /* Shadow: wide and soft */
  --ring:         0 0 0 1px var(--hairline);
  --shadow-card:  0 40px 80px -30px rgba(60, 45, 30, 0.25), 0 2px 6px rgba(60, 45, 30, 0.06);
  --shadow-phone: 0 50px 90px -35px rgba(60, 45, 30, 0.35), 0 2px 8px rgba(60, 45, 30, 0.08);
  --shadow-key:   0 6px 10px -6px rgba(60, 45, 30, 0.28), 0 1px 2px rgba(60, 45, 30, 0.1);
  --inset-top:    inset 0 1px 0 var(--highlight);

  /* Motion */
  --ease:           cubic-bezier(0.32, 0.72, 0, 1);
  --dur-fast:       140ms;
  --dur:            280ms;
  --dur-slow:       700ms;
  --lcd-line-step:  30ms;
  --grain-opacity:  0.03;
}
```

### Contrast (measured)

| Pair | Ratio | Used for |
|---|---|---|
| ink on paper | 14.56 | body text |
| ink-soft on paper | 5.82 | counter, small print |
| ink-soft on core | 6.08 | card small print |
| ink-soft on key | 5.53 | letters under digits |
| sage-deep on paper | 6.56 | eyebrow text, links, focus ring |
| sage-deep on pill-tint | 6.08 | eyebrow text |
| clay on paper | 4.70 | counter near limit |
| clay on core | 4.91 | undone label, errors in the card |
| paper on ink | 14.56 | primary button |
| lcd-ink on lcd-bg | 9.63 | LCD text |
| lcd-ink-soft on lcd-bg | 5.49 | LCD hints |
| ink on body-bottom | 10.41 | any text printed on the body |
| ink-soft on body-bottom | **4.16** | **not allowed for text** |
| ink glyph on call | 4.06 | glyph, needs 3:1 |
| paper glyph on end | 4.70 | glyph, needs 3:1 |
| focus ring (sage-deep) on body-bottom | 4.69 | needs 3:1 |

White and ink text on the call key fall under 4.5:1, so the call and end keys carry a drawn glyph (handset, and
handset hung up) and no text. Their names come from `aria-label`. Text printed on the phone body uses `--ink`.

### Fonts

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&family=VT323&display=swap">
```

This URL was fetched and returns all four families with `font-display: swap`. Fallbacks are Georgia, a generic
sans-serif, `ui-monospace`/Courier New. A browser that shows Georgia for the headline still reads correctly.

Google Fonts sees each visitor's IP address. That is the one third-party request. `<meta name="referrer"
content="no-referrer">` stops it from seeing the page address. There is no script from any third party.

### Content-Security-Policy (meta tag)

```
default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com;
font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self';
base-uri 'none'; form-action 'none'
```

Outside its own origin the policy names two hosts: `fonts.googleapis.com` (the stylesheet) and `fonts.gstatic.com`
(the font files). `default-src 'none'` blocks everything else, including every inline script and style. The footer
links are plain navigations, which this policy does not govern, and they send no referrer.

No `style="..."` attributes in the markup and no inline `<script>`. JS sets styles only through
`element.style.setProperty('--i', n)` (a CSSOM call, which the policy allows) and by toggling classes.

### Film grain

`body::after { content: ""; position: fixed; inset: 0; pointer-events: none; opacity: var(--grain-opacity); z-index: 50;
background-image: url("data:image/svg+xml,...feTurbulence..."); background-size: 220px; }` The SVG is a
`feTurbulence` noise tile with no colour literal. It sits above content and below nothing the pointer needs.

## Page structure

```
body
├─ a.skip                          "Skip to the ledger" -> #ledger
├─ noscript
└─ main#main.page
   ├─ section.intro.reveal         eyebrow pill, h1, p                      (grid area: intro)
   ├─ section.phone-col                                                     (grid area: phone)
   │  ├─ div#phone.phone           the drawn phone (see Phone)
   │  ├─ div#start-cta             second "Start demo shop" button; hidden once a shop exists
   │  └─ p#counter.counter         the character counter
   ├─ section.steps.reveal         double bezel: h2 + ol of five steps      (grid area: steps)
   └─ section#ledger.ledger.reveal double bezel: ledger panel               (grid area: ledger)
footer.site-footer                 three lines (see Copy), after main, full width
visually hidden live regions (after the footer): #echo (typing), #panel-status (buttons and refresh)
```

The phone column does not use `.reveal`: it is interactive from the first frame and it is sticky.

### Grid

```css
.page { display: grid; gap: var(--space-8); padding: var(--space-4) var(--gutter-mobile) var(--space-12); min-height: 100dvh;
        grid-template-areas: "phone" "intro" "steps" "ledger"; }
@media (min-width: 900px) {
  .page { grid-template-columns: minmax(0, 1fr) var(--phone-col); column-gap: var(--column-gap);
          grid-template-areas: "intro phone" "steps phone" "ledger phone";
          grid-template-rows: auto auto 1fr; max-width: 1200px; margin-inline: auto; padding: var(--space-16) var(--space-8); }
  .phone-col { align-self: start; position: sticky; top: var(--space-6); }
}
@media (min-width: 900px) and (max-height: 699px) { .phone-col { position: static; } }   /* 44 px keys cannot shrink, so below 700 px the phone is taller than the view */
/* Short screens: .lcd height 66cqw, and no sticky while the first-visit Start button is in the column. */
@media (min-width: 900px) and (max-height: 760px) { /* ... see styles.css */ }
.site-footer { max-width: 1200px; margin-inline: auto; padding: var(--space-8) var(--gutter-mobile) var(--space-12); }
@media (min-width: 900px) { .site-footer { padding-inline: var(--space-8); } }
```

The footer is outside `main`, so it is not a grid item. The phone column is sticky only inside `main`, and the footer
scrolls in below it. Footer lines are block elements in `--ink-soft` (5.82:1 on paper); the two links are
`--sage-deep` (6.56:1) with an underline, so colour is not their only cue.

At 1280 px wide the left column is about 700 px and the phone column 380 px.

The DOM order is intro, phone, steps, ledger. On narrow screens CSS puts the phone first. The intro has nothing
focusable, so the Tab order is the same as the visual order. The headline stays first for a screen reader, which
suits a page title.

`.phone-col` width on wide screens: `--phone-w: clamp(260px, calc((100dvh - 11rem) * 0.5), 380px)`. At 1280x800 that is
328 px wide and about 620 px tall; with the first-visit button and counter (about 90 px) and the 24 px sticky offset
it ends near 735 px, inside 800. Below 900 px, `--phone-w: min(100%, 440px)` of the column (358 px at 390 px wide; centred and capped at 440 px so a
tablet does not get a poster-sized phone).

## Phone

### Anatomy (all `aria-hidden` decoration except the controls)

```
div#phone.phone  (role=group, aria-label="Imali AI demo phone")   container-type: inline-size
└─ div.phone-body                        the handset; sized from the container with cqw
   ├─ span.speaker                       speaker slot, decoration
   ├─ div.lcd-bezel                      the recess the screen sits in, decoration
   │  └─ div.lcd
   │     ├─ div.lcd-status               "Imali AI" ...... time ; NOT live
   │     ├─ div#lcd-body.lcd-body        role=log, tabindex=0, aria-label="Phone screen", aria-busy
   │     │   └─ p.lcd-line*              one per line, --i sets the reveal delay
   │     └─ div.lcd-entry                "> text" with the pending character inverted, mode "123"/"abc"
   ├─ div.softs                          #soft-left  #soft-centre  #soft-right
   ├─ div.callrow                        #key-call (green)  #key-mode ("123 / abc")  #key-end (clay)
   └─ div.pad[role=group aria-label="Keypad"]   12 buttons, data-key="1".."9","*","0","#"
```

`.phone` is the size container, so `cqw` inside it means 1 percent of the phone's width. `.phone-body` is the drawn
handset (a container cannot size its own padding in its own `cqw`).

Sizes come from the phone's own width, `W`, through container units (`cqw`) so the whole drawing scales together:

| Part | Size |
|---|---|
| Body | height comes from its content (about `1.9 W`); radius `14cqw` on top, `17cqw` at the bottom; padding `6cqw 7cqw 8cqw`; fill `linear-gradient(var(--body-top), var(--body-bottom))`; `--shadow-phone`, `--inset-top`, and a 1 px `--ring` |
| Top-edge highlight | `.phone-body::before`: a band `14cqw` tall along the top edge with the body's top radius, `radial-gradient(ellipse at 50% 0, var(--body-gloss), transparent 70%)`; `pointer-events: none` |
| Speaker slot | `.speaker`: `24cqw` by `2.4cqw` pill, centred, fill `--speaker`, inset shadow `--shade-deep` on top and `--highlight` on the lower lip |
| LCD bezel | `.lcd-bezel`: padding `2.4cqw`, radius `6cqw`, `linear-gradient(--bezel-top, --bezel-bottom)`, inset shadow `--shade-deep` on the top edge, `--highlight` line under the lower edge, so the screen looks sunk into the body |
| LCD | height `82cqw`; radius `3.6cqw`; fill `--lcd-bg`; inset shadow; the pixel grid is a `::after` of two 1 px linear gradients at a 3 px pitch in `--lcd-grid`, with `pointer-events: none` |
| LCD font | VT323, `clamp(17px, 5.7cqw, 24px)`, line-height 1; target: ten lines of body visible at 1280x800 and 390 wide |
| Soft keys | three keys in a row, left and right wide pills, centre a larger oval; height `max(44px, 11cqw)` |
| Call row | call and end keys wide, the mode key a small pill between; height `max(44px, 11cqw)` |
| Pad | 3 x 4 grid, gap `2.4cqw`, each key `max(44px, 13cqw)` high; digit in Geist Mono 500, letters in Geist at `max(10.5px, 3cqw)` in `--key-letters` |
| Keys | domed: `radial-gradient(120% 95% at 50% 12%, --key-hi, --key 55%, --key-lo)`, legend `--key-legend`; shadows `--inset-top`, `inset 0 -3px 4px -2px var(--shade)` for the lower rim, and `--shadow-key` for the soft shadow on the body underneath. The call and end keys use the same dome with their fill (`--call`, `--end`) and a `--highlight` inset on top |

Digits 1, \*, 0 and # have no letters printed (as in the brief). In "abc" mode 0 types a space and 1 types
punctuation (`docs/judges.md` says so).

### Key behaviour

- Every key is `<button type="button">`. Pad: `aria-label="2, a b c"`; keys without letters: `aria-label="1"`, `"star"`,
  `"hash"`, `"0"`. Soft keys: `aria-label="Left soft key, Messages"`; the visible label and the `aria-label` are
  updated together. Blank label: `aria-label="Left soft key, not used"` and `aria-disabled="true"` (requirement 27), except on an END screen (`anyKey`), where every key returns home (requirement 42) and the blank soft keys stay live and are not marked disabled.
  The mode key: `aria-label="Switch typing mode, now 123"`, visible text `123 / abc`, with the active half underlined.
- `touch-action: manipulation; user-select: none; -webkit-tap-highlight-color: transparent`.
- Pressed state (requirement 28): `:active` and a `.is-pressed` class that `phone.js` adds for 120 ms when the key is
  hit from the computer keyboard. Both do `transform: translateY(1px) scale(0.97)` with `transition: transform
  var(--dur-fast) var(--ease)`. A `::before` overlay fades in with `opacity` to darken the key. No colour or shadow
  transition.
- Focus: `outline: 2px solid var(--focus); outline-offset: 2px` on `:focus-visible`. Inside the LCD the ring is
  `--lcd-ink` and drawn inset.

### Counter

`p#counter` sits under the phone in Geist Mono, `--text-xs`, `--ink-soft`, centred, with `min-height: 1.5em` so the
layout does not jump. `aria-live="off"`. Levels from `counterInfo()`:

| Level | When | Look |
|---|---|---|
| `ok` | chars below 90 percent of limit | `--ink-soft` |
| `near` | `chars * 10 >= limit * 9` and chars not over limit (164 and up of 182; 144 and up of 160) | `--clay` and the words `- near the limit` |
| `over` | chars above limit | `--clay` and the words `- over the limit` |

Integer arithmetic only (no `0.9 * limit`).

## Phone logic (`public/phone-logic.js`)

No DOM, no `fetch`, no timers, no `Date`, no `Math.random`. Time (`now`, in ms) and ids come in as arguments.
Every function returns a new value; none changes its argument.

### Constants

```js
export const LEDGER_CODE   = '*384*46254#';
export const MULTITAP_MS   = 900;
export const DIAL_MAX      = 20;
export const ENTRY_MAX     = 40;    // reply to a menu screen
export const COMPOSE_MAX   = 160;   // one text message
export const NEAR_PERCENT  = 90;
export const PAD = [ /* { key:'1', letters:'' }, { key:'2', letters:'abc' }, ... { key:'9', letters:'wxyz' }, '*', '0', '#' */ ];
export const CYCLES = { 1: ".,?!'@1", 2: 'abc2', 3: 'def3', 4: 'ghi4', 5: 'jkl5', 6: 'mno6', 7: 'pqrs7', 8: 'tuv8', 9: 'wxyz9', 0: ' 0' };
```

### Editor (typing)

```js
// allow: 'dial' (0-9 * #), 'entry' (printable ASCII except * and #), 'text' (printable ASCII)
createEditor({ allow, mode = '123', max }) -> Editor
tap(editor, key, now)        // a pad key. 123: add the digit. abc: start or advance a multi-tap cycle
typeChar(editor, ch)         // computer keyboard: accept pending, add ch if allowed and under max
backspace(editor)            // drop pending, else drop the last character
toggleMode(editor)           // accept pending, flip 123/abc. No effect when allow === 'dial'
settle(editor, now)          // accept pending if now - pending.at >= MULTITAP_MS
view(editor)                 // { text, pendingIndex | null, mode }  text includes the pending character
isEmpty(editor)
```

Multi-tap (requirements 57 to 60):

1. In "abc" mode, a key in `CYCLES` with a pending cycle on the **same key** and `now - at < 900` moves the pending
   character to the next entry of the cycle, wrapping, and sets `at = now`.
2. Otherwise the pending character (if any) is accepted, and when under `max` a new pending character is started at
   index 0 of the key's cycle.
3. `*` and `#` accept the pending character, then add themselves if `allow` permits.
4. A pending letter is upper case when the accepted text before it is empty. Digits and punctuation are unaffected.
5. A late `settle()` is not needed for correctness: rule 1 checks the time itself, so a timer that fires late
   cannot join two taps more than 900 ms apart.
6. The length rule counts the pending character.

Sanitising: characters outside printable ASCII (0x20 to 0x7E) are dropped; `trimEntry(text)` trims the ends before a
send, and an empty result means "ignore the send".

### Path and dial

```js
buildUssdText(path, entry)  // [...path, entry].join('*')
classifyDial(text)          // 'empty' | 'ledger' (exactly LEDGER_CODE) | 'unknown'
parseUssdReply(json)        // { ok:true, kind:'CON'|'END', lines, chars, limit } | { ok:false }
parseSmsReply(json)         // { ok:true, text, chars, limit } | { ok:false }
counterInfo(kind, chars, limit)  // { text, level } ; kind 'menu' | 'text'
```

The 0 and 00 rules (requirement 40, assumption A3). The phone does **not** interpret `0` or `00`:

- An entry of `0` or `00` goes into the path like any other entry: `buildUssdText(['1','45'], '0')` is `1*45*0`, and the
  next send is `1*45*0*45`. The server replays the whole path and works out which screen that is. Only the server
  knows its screens, and an entry such as a rejected amount does not move a screen, so "drop the last entry" would
  go to the wrong place.
- `0` is a digit inside a longer entry (`100`, `20`), because a send always sends the whole entry.
- The phone never empties the path except by ending the session.

If the dialled-menu spec decides the client should resolve 0 and 00, only `buildUssdText()` and the path update in
the reducer change.

`parseUssdReply`: `response` must be a string starting `CON ` or `END `. `lines` is the text after the 4-character
prefix split on `\n`, unchanged (no trimming of inner spaces, no dropping of empty lines). `chars` and `limit` must
be safe integers, 0 or more, or they become `null` (the counter then stays empty).

### State machine

```js
createPhone() -> State                                   // view 'noShop', no phone
reduce(state, event, now) -> { state, effects }
screenModel(state, ctx) -> Screen                        // ctx: { phoneText, timeText }
```

State:

```js
{
  phone:   string | null,                    // '+2700000xxxx'; null = no demo shop
  view:    'noShop' | 'home' | 'session' | 'messages',
  editor:  Editor,                           // dial line, menu reply, or compose line
  notice:  string | null,                    // one line on home ("Unknown code. Try ...")
  screenId:number,                           // bumped when the LCD body is replaced as a whole
  session: null | { id, path: string[], phase: 'loading' | 'reply' | 'ended',
                    lines: string[], pendingEntry: string | null },
  thread:  Array<{ key:number, from:'me'|'ledger'|'system', text:string, sending:boolean }>,
  sms:     null | { messageId:number, text:string },
  counter: null | { kind:'menu'|'text', chars:number, limit:number }
}
```

Events (`now` is the second argument of `reduce`):

| Event | Meaning |
|---|---|
| `{ type:'shop', phone }` | A shop exists (`phone` string) or not (`null`). Resets to `home` or `noShop`, clears session, thread, counter |
| `{ type:'press', key }` | Pad key `0-9 * #` |
| `{ type:'char', ch }` | A character from the computer keyboard |
| `{ type:'backspace' }` | Clear soft key or Backspace |
| `{ type:'mode' }` | Mode key |
| `{ type:'send', sessionId, messageId }` | Green key, centre key or Enter. The caller supplies fresh ids |
| `{ type:'soft', side:'left'\|'right' }` | Left or right soft key |
| `{ type:'end' }` | End key, Escape, "Cancel" |
| `{ type:'tick' }` | Timer: call `settle(editor, now)` |
| `{ type:'ussdReply', sessionId, reply }` | `reply` is `parseUssdReply(...)` or `{ ok:false }` for any failure |
| `{ type:'smsReply', messageId, reply }` | `reply` is `parseSmsReply(...)` or `{ ok:false }` |

Effects: `{ type:'ussd', body:{ phone, sessionId, text } }`, `{ type:'sms', body:{ phone, text }, messageId }`,
`{ type:'refresh' }` (after every reply or failure; requirement 74).

Rules by view and phase:

| State | `press` / `char` | `send` | `soft left` | `soft right` | `end` |
|---|---|---|---|---|---|
| `noShop` | ignored | ignored | ignored | ignored | ignored |
| `home` | into dial editor | `classifyDial`: `ledger` starts a session (effect `ussd`, text `''`, phase `loading`); `unknown` sets `notice`; `empty` ignored | open `messages` (compose editor, mode `abc`) | empty dial: fill `LEDGER_CODE`; otherwise `backspace` | no change (clears dial line and notice) |
| `session`, `reply` | into entry editor (`allow:'entry'`) | trim entry; empty ignored; else effect `ussd` with `buildUssdText(path, entry)`, phase `loading`, `pendingEntry = entry` | same as `end` ("Cancel") | `backspace` | home, session dropped |
| `session`, `loading` | ignored | ignored | same as `end` | ignored | home, session dropped |
| `session`, `ended` | **any key** goes home and is consumed (`press`, `char`, `send`, `soft`, `backspace`, `mode`) | goes home | goes home | goes home | goes home |
| `messages` | into compose editor (`allow:'text'`) | trim; empty ignored; if `sms` pending ignored; else thread gets a `me` line (`sending`), effect `sms`, editor emptied | back to `home` | `backspace` | home; the thread is kept until the next `shop` event |

Replies:

- `ussdReply` with a `sessionId` that is not the current session's, or in any view but `session`, is dropped (this is
  how a reply after the end key is discarded, requirement 43).
- `{ ok:true, kind:'CON' }`: `path` gains `pendingEntry`, `lines` replaced, `phase:'reply'`, new empty entry editor in
  "123" mode, `counter = menu`, `screenId` + 1, effect `refresh`.
- `{ ok:true, kind:'END' }`: `lines` replaced, `phase:'ended'`, `path` dropped, `counter = menu`, effect `refresh`.
- `{ ok:false }`: `lines = ['No network. Try again.']`, `phase:'ended'`, `counter = null`, effect `refresh`.
- `smsReply` with the current `messageId` lands in the thread in any view, because the thread outlives the Messages
  screen and the text was already sent. `{ ok:true }` marks the `me` line as sent and appends a `ledger` line; the
  counter becomes `text` only when the view is `messages`. `{ ok:false }` removes the `me` line, appends a `system`
  line `No network. Try again.`, and, only when the view is `messages` with an empty compose line, puts the text back
  there. Either way the effect `refresh` follows. An `smsReply` with another `messageId` is dropped.
- Every move to `home` sets `counter = null` and `notice = null`.
- The `end` event never cancels a text already sent; it only leaves the Messages screen.

Screen model:

```js
{
  screenId,
  body: [ { key, text, tone: 'text'|'hint'|'me'|'ledger'|'system'|'dim' } ],  // 'dim' = still sending
  entry: null | { prompt: '>', text, pendingIndex, mode },                   // null on noShop/ended/loading
  softs: { left, centre, right },                                             // '' = unused
  busy: boolean,                                                              // loading
  anyKey: boolean,                                                            // END screen: every key, even a blank soft key, goes home
  scroll: 'top' | 'bottom',                                                   // thread scrolls to bottom
  counter: null | { text, level: 'ok'|'near'|'over' }
}
```

Labels:

| View / phase | Left | Centre | Right |
|---|---|---|---|
| `noShop` | | | |
| `home` | Messages | OK | Menu (dial line empty) / Clear |
| `session` `reply` | Cancel | Send | Clear |
| `session` `loading` | Cancel | | |
| `session` `ended` | | OK | |
| `messages` | Back | Send | Clear |

Body text:

| View / phase | Body lines |
|---|---|
| `noShop` | `Press Start demo shop` |
| `home` | `ctx.phoneText`, `Dial *384*46254#` (tone `hint`), `notice` when set |
| `session` `loading` | `Please wait...` |
| `session` `reply` / `ended` | the reply lines, unchanged |
| `messages` | the thread; if empty `Text a line like: sold 45 bread` (tone `hint`). Lines read `Me: ...`, `Imali AI: ...`, or the system text |

## Ledger logic (`public/ledger-logic.js`)

```js
formatMoney(cents, currency)          // same rules as src/core/money/format.ts; integer maths only
formatClock(nowMs, timeZone)          // '14:05' (24 hour), Intl.DateTimeFormat parts, no locale month names
formatRecordTime(createdAt, timeZone, nowMs)   // '14:05' on the shop's today, else '3 Nov 14:05'; own month table
readLedger(json) -> { ok:true, ledger } | { ok:false }   // checks and normalises (see contract)
sortOwes(list)                        // largest owed first, ties by name; returns a new array
splitOwes(list, shown = 6)            // { shown, hidden }
recordRows(records, currency, timeZone, nowMs) -> Row[]   // newest first
demoPhone(n)                          // 0..9999 -> '+2700000' + 4 digits
isDemoPhone(text)                     // /^\+2700000\d{4}$/
displayPhone(phone)                   // '+27 00 000 xxxx'
exportFileName(nowMs)                 // 'imali-ai-export-YYYY-MM-DD.json' (UTC date)
```

`formatMoney` copies `formatCents`: symbol table `ZAR R, USD $, KES KSh, NGN N, GHS GHS, ZMW K, BWP P`; whole part
with commas; `.xx` only when the cents are not zero; a leading `-` after the symbol for negatives. A test compares it
with `src/core/money/format.ts` for every currency and for random cents (fast-check is already a dev dependency).

`Row`: `{ id, kindWord, amountText, detail, channelWord, timeText, undone, isReversal, cancelsText }`.

- `kindWord`: sale `Sale`, expense `Spent`, debt `Owes`, payment `Paid`, reversal `Undo`.
- `detail`: customer and item joined by ` - ` when both exist, whichever exists otherwise, empty if none.
- `channelWord`: ussd `Menu`, sms `Text`, web `Web`.
- `undone`: true when some reversal record in the list has `reversesRecordId` equal to this record's id. A reversal
  always comes after its target, so a target inside the last 20 has its reversal inside it too.
- Reversal rows have `amountText = ''` and `cancelsText = 'cancels Sale R45 bread'`, or `'cancels an earlier record'` when the target is
  not in the list.

## Api helper (`public/api.js`)

```js
class ApiError extends Error { kind: 'network' | 'timeout' | 'http' | 'json'; status?: number }
createApi({ fetchFn = globalThis.fetch, timeoutMs = 10000 }) -> {
  postJson(url, body) -> Promise<object>,     // throws ApiError
  getJson(url)        -> Promise<object>,
  getBlob(url)        -> Promise<Blob>,
}
ledgerUrl(phone)   // '/api/ledger?phone=%2B2700000xxxx'
exportUrl(phone)
```

Rules: `AbortController` aborts after `timeoutMs` (`kind:'timeout'`); `fetch` rejection is `network`; a non-2xx status is
`http` with `status`; a body that is not JSON is `json`. Credentials are not sent (`credentials: 'omit'`) and there
is no cookie. The api helper never logs request bodies.

## DOM modules

### `ledger.js`

`initLedger({ root, api, storage, random, onShop })` returns `{ refresh(), phone() }`.

- On load: read the number from `storage` (key `imali-demo-phone`) and check it with `isDemoPhone`. No number:
  first-visit state. A number: `GET /api/ledger`; 404 forgets the number (requirement 81).
- `startDemo()`: pick up to three numbers with `crypto.getRandomValues` (`value % 10000`; the bias of 7296 in 2^32 is
  negligible for a demo). `POST /api/phone/demo`; 409 tries the next number; success stores the number, calls
  `onShop(phone)` and `refresh()`.
- `startOver()`: same as `startDemo()`, but run from the "Start over" button. The new `onShop(phone)` call resets the
  phone (session, thread, counter). If making the new shop fails, the old shop and the phone are left as they were.
- `exportRecords()`: `getBlob`, an object URL, a temporary `<a download>`, a click, then `URL.revokeObjectURL`.
- `refresh()`: one fetch at a time; if called while running, runs once more after (requirement 74). Draws with
  `textContent` only. A 404 from any refresh (not only the first) means the server forgot the shop: the number is
  forgotten and the first-visit state returns.
- If `storage` throws (private mode), it keeps the number in a variable.
- Redraw is keyed: the who-owes and record lists are rebuilt with `replaceChildren`.

### `phone.js`

Holds the `State`, an `Editor` timer and the current effect handlers.

- `dispatch(event)`: `{ state, effects } = reduce(state, event, performance.now())`, then render, then run effects.
  Effects call `api.postJson` and dispatch `ussdReply` or `smsReply`; a `refresh` effect calls `ledger.refresh()`.
  A reply the reducer drops (the owner pressed End first) still means the server may have saved a record, so
  `phone.js` calls `ledger.refresh()` itself whenever a dropped reply produced no `refresh` effect.
- Render: updates the status clock, the LCD body (re-created when `screenId` changes, otherwise patched by `key`),
  the entry line, soft key labels, `aria-busy`, and the counter.
- Timers: a 900 ms timer re-armed on each pad tap in "abc" mode that dispatches `tick`; a clock timer aligned to the next
  minute; a 500 ms debounce that writes the entry text into `#echo`; a 120 ms timer to clear `.is-pressed`.
- Ids: `sessionId` from `crypto.randomUUID()` (fallback: 16 random hex bytes), `messageId` a counter.
- Keyboard: one `keydown` listener on `document` (rules below). Printable keys, digits included, are sent as `char`
  events so the computer keyboard types the character itself in "abc" mode; the matching pad key is shown pressed.

## States

| State | What the user sees | Where it comes from |
|---|---|---|
| First visit | LCD `Press Start demo shop`, keys do nothing, a primary button under the phone, the panel shows `No demo shop yet. Press Start demo shop.` in place of figures, "Start over" and "Export records" `aria-disabled` | no stored number, or a stored number that answered 404 |
| Starting | the button reads `Starting...`, `aria-busy`, second press ignored | `POST /api/phone/demo` running |
| Loading (menu) | LCD `Please wait...`, `aria-busy` on the LCD, only End/Cancel work | `ussd` effect pending |
| Loading (text) | the sent line is dim, a second send is ignored | `sms` effect pending |
| Loading (panel) | `Loading...`, `aria-busy` on the panel | first `GET /api/ledger` |
| Network error (menu) | LCD `No network. Try again.`, any key goes home | ussd failed, timed out, bad status or bad reply |
| Network error (text) | the sent line disappears, its text is back in the compose line, thread line `No network. Try again.` | sms failed |
| Panel refresh error | old figures stay, `Could not refresh. Try again.` and a Retry button | ledger fetch or `readLedger` failed |
| END screen | the END text on the LCD, centre key `OK`, any key goes home | reply began `END ` |
| Long who-owes | the LCD shows the server's lines including `9 More`; pressing 9 and Send asks for the next page; the panel shows six names and `Show all N` | six-plus debtors |
| Counter near limit | `This screen: 176 of 182 characters - near the limit` in clay | `chars * 10 >= limit * 9` |
| Counter over limit | `... - over the limit` in clay | `chars > limit` (a server bug made visible) |
| Empty ledger | `No records yet.`, `Nobody owes money.`, today figures at `R0` | new shop |
| Unknown code | `Unknown code. Try *384*46254#.` under the hint | non-empty dial line that is not the code |
| Stale number | quietly the first-visit state | 404 on load |
| Storage blocked | works for the visit, number lost on reload | `localStorage` throws |
| Reduced motion | no animation, every section and line at once | `prefers-reduced-motion: reduce` |
| No JavaScript | `<noscript>` line | script not run |

## Ledger panel layout

Inside the double bezel (`.bezel > .bezel-core`):

```
h2 "<Shop name>"                                    p.meta "Currency ZAR (R)"           (Fraunces / Geist Mono)
section "Today"      three figures: Sales R1,240 (12)  |  Spent R300  |  In hand R940   (Geist Mono)
section "Who owes"   ol: name ........ R50 (largest first, six shown, "Show all N" button)
section "Last records"  ul: [Sale] R45 bread        Menu   14:05
                            [Owes] R20 Tendai - sugar  Text  14:07
                            [Sale] R45 (struck through) undone
                            [Undo] cancels Sale R45 bread
div.actions          [Start demo shop ->] primary   [Start over] quiet   [Export records] quiet
p.note               "Everything here is invented demo data."
p#panel-error        "Could not refresh. Try again." [Retry]   (hidden until needed)
```

On 358 px a record row wraps to two lines: kind and amount on the first with the time at the right, detail and
channel on the second. Lists are real `ol`/`ul`. The "undone" word is real text; the line-through is only a second cue.
While a shop does not exist, "Start demo shop" is the only live button. Once one exists, "Start demo shop" is
`aria-disabled="true"` and "Start over" and "Export records" are live.

### Double bezel

```css
.bezel       { padding: var(--shell-pad); border-radius: var(--radius-shell); background: var(--shell);
               box-shadow: var(--ring), var(--shadow-card); }
.bezel-core  { border-radius: var(--radius-core); background: var(--core);
               box-shadow: var(--inset-top); padding: var(--space-6); }
```

### Buttons

```css
.btn           { display: inline-flex; align-items: center; gap: var(--space-3); min-height: 44px;
                 padding: 0 var(--space-6); border-radius: var(--radius-pill); font: 500 var(--text-sm) var(--font-text);
                 transition: transform var(--dur-fast) var(--ease); }
.btn:active    { transform: scale(0.98); }
.btn--primary  { background: var(--ink); color: var(--on-ink); padding-right: var(--space-2); }
.btn--quiet    { background: transparent; color: var(--ink); box-shadow: var(--ring); }
.btn__arrow    { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%;
                 background: var(--on-ink-tint); }
.btn__arrow svg { transition: transform var(--dur) var(--ease); }
@media (hover: hover) { .btn--primary:hover .btn__arrow svg { transform: translate(2px, -2px); } }
.btn--primary:focus-visible .btn__arrow svg { transform: translate(2px, -2px); }
.btn[aria-disabled="true"] { opacity: 0.45; }
```

The arrow is an inline SVG (not a font glyph). Disabled buttons use opacity 0.45 and keep their text readable
because `--ink` on `--paper` starts at 14.56:1; the disabled state is also announced through `aria-disabled`.

## Motion

| Effect | How | Properties |
|---|---|---|
| Section fade-up | `html.js .reveal` starts `opacity:0; transform: translateY(18px)`; `IntersectionObserver` (`threshold 0`, `rootMargin 0 0 -8% 0`, so a section reveals as soon as its top edge is 8 percent inside the view; a ratio threshold could never be met by a tall section on a short, zoomed screen) adds `.is-in` once and unobserves; `transition: opacity, transform` over `--dur-slow` | opacity, transform |
| LCD line refresh | each new `.lcd-line` runs `lcd-in` (opacity 0 to 1, 2 px translate) with `animation-delay: calc(var(--i) * var(--lcd-line-step))`; `--i` is the line index capped at 14, set with `style.setProperty` | opacity, transform |
| Key press | `:active` / `.is-pressed` | transform |
| Key hover and press tint | `::before` overlay | opacity |
| Primary arrow | translate on hover and focus | transform |
| Button press | `scale(0.98)` | transform |

Patching the thread by key means a new message animates alone; old lines do not replay. The text is in the DOM at
once, so a screen reader reads the whole screen and is not held up by the animation.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
  html.js .reveal { opacity: 1; transform: none; }
}
```

Without `IntersectionObserver` or JavaScript, the `js` class is never added (or the script adds `.is-in` to all
three sections), so nothing is stuck hidden.

## Keyboard and screen reader

### Computer keyboard

One `keydown` listener on `document`. It acts only when `event.target` is `document.body`, or inside `#phone`, and no
Control, Meta or Alt key is held. Otherwise the event is left alone (so Tab, browser shortcuts, and the Enter or
Space on a ledger button all behave normally).

| Key | Does | Notes |
|---|---|---|
| `0-9`, `*`, `#` | `char`, and the matching pad key shows pressed | typed as the character itself, so "abc" mode does not start a multi-tap |
| Letters, space, punctuation | `char` | only when the current editor takes it; otherwise left alone |
| Backspace | `backspace` | `preventDefault` when the phone used it |
| Enter | `send` | not when focus is on a button: that button's own click runs (requirement 62) |
| Space | `char` in a text editor | not when focus is on a button: the button's own click runs |
| Escape | `end` | no-op on home |
| Up / Down | scroll `#lcd-body` by one line | not when `#lcd-body` itself has focus: it scrolls natively |
| Tab | not handled | normal focus order |

After a pointer click on a phone key, `phone.js` blurs the key so focus returns to the page body. Without this, the
first Space typed in a message would press the key that was just clicked (for example "Back") again. A click that
comes from the keyboard (`event.detail === 0`) keeps focus, so keyboard users never lose their place.

In "abc" mode the computer keyboard types characters directly; multi-tap applies only to the on-screen pad.

### Focus order

Skip link, left soft key, centre key, right soft key, call, mode, end, pad 1 to #, the first-visit button (when
shown), the ledger panel's controls (Show all, Retry, Start demo shop, Start over, Export records), then the two
footer links. Soft keys
never become `disabled`, because a disabled button loses focus mid-use; they use `aria-disabled`.

### Announcements

| Region | Markup | Says |
|---|---|---|
| LCD body | `role="log"` (polite, not atomic), `tabindex="0"`, `aria-label="Phone screen"`, `aria-busy` while loading | each new screen (all its lines) or each new thread line |
| Status bar (network, time) | plain text, outside the log | never announced |
| `#echo` | visually hidden, `role="status"` | `Entry: 45` after typing pauses 500 ms; `Entry empty` after clearing |
| `#panel-status` | visually hidden, `role="status"` | `Demo shop started`, `Started over with a new demo number`, `Export saved`, and the three error lines |
| `#counter` | `aria-live="off"` | read on demand |

Other markup: the `h1`, two `h2`s, and `h3`s for Today, Who owes and Last records; the steps in an `ol`; record
and owes lists as lists; the film grain and phone decoration are pseudo-elements or `aria-hidden`; all interactive
targets are 44 px or more; the layout reflows at 200 percent zoom (single column, no fixed heights on text).

## Tests

Vitest, no browser, under `test/public/` (the include pattern `test/**/*.test.ts` already matches).

| File | Covers |
|---|---|
| `test/public/phone-logic/dial-and-path.test.ts` | `classifyDial`, `buildUssdText`, the 0 and 00 rules, `parseUssdReply` / `parseSmsReply`, the `*`/`#` ban, entry trim, limits |
| `test/public/phone-logic/multitap.test.ts` | cycles for every key, wrap, the 900 ms boundary (899 joins, 900 starts a new character), another key accepting the pending one, mode toggle, capital rule, backspace on a pending character, `max` |
| `test/public/phone-logic/counter.test.ts` | `counterInfo`: 143/182 ok, 163/182 ok, 164/182 near, 182/182 near, 183/182 over, 98/160 ok, 144/160 near, wording |
| `test/public/phone-logic/state.test.ts` | the reducer table: no shop, dial to session, CON, END plus any key, end key from every view, request in flight ignores keys, stale `ussdReply` dropped, sms send/fail/restore, refresh effects, new session id each dial, `screenModel` labels and the "9 More" line surviving unchanged |
| `test/public/ledger-logic.test.ts` | money parity with `src/core/money/format.ts` (7 currencies, property test), clock and record time in `Africa/Johannesburg` across midnight, `readLedger` accept and reject cases, `sortOwes`, `splitOwes`, `recordRows` (undone, reversal, target outside list), demo number helpers, export file name |
| `test/public/api.test.ts` | fake `fetch`: success, timeout (fake timers), network error, non-2xx, bad JSON, `+` encoded as `%2B` |

Every screen the page writes itself (first visit, home, unknown code, wait, error, empty thread) is checked in the
tests as plain ASCII and within 182 characters, the same rules as `.kiro/steering/screens.md`. Server text is shown as sent.

The DOM files have no unit tests. They are checked by hand with `docs/judges.md`.

### `docs/judges.md` outline

1. Before you start (open the page, clear `localStorage` for a first visit).
2. At 1280 px wide: layout, the sticky phone, the one-minute steps end to end, the keyboard, and each state.
3. At 390 px wide: order (phone, steps, ledger), no sideways scroll, every key reachable, the same steps.
4. States, how to trigger each: first visit (private window), loading (DevTools Slow 3G), network error (DevTools
   Offline then Send), END (finish a sale), long who-owes (nine texts `Name owes 10`, then dial 6; the screen shows
   `9 More`), counter near limit (the longest who-owes screen), reduced motion (OS setting).
5. Contrast and focus (Tab through the phone; a visible ring everywhere).
6. How to read the result (what the ledger panel should show after each step).

## Decisions

- **Pure modules.** Putting the state machine in `phone-logic.js` makes the rules that matter (the end key, END, a
  request in flight) testable without a browser, and leaves `phone.js` to draw and set timers.
- **No `<input>` for typing.** A real input would pop up the on-screen keyboard on a phone and fight the drawn pad.
  The cost is the extra announcements (`#echo`) and the keyboard rules above.
- **Raw path.** The page sends the path as the network would. A faithful demo is the point of the page.
- **Second Start button.** At 390 px the ledger panel is a long scroll below the phone. A judge who sees "Press Start
  demo shop" on the LCD needs the button in reach, so it appears under the phone on first visit.
- **"Menu" soft key.** It fills the dial line with the ledger code, so a judge on a touch screen does not need nine taps.
- **Thread in memory.** It is lost on reload; the records are not. Persisting it is a small change if wanted.
- **No AI claim in the copy.** The headline and paragraph describe what the owner gets (a ledger on any phone) and not
  how it is built. The server may use a language model, but the page cannot see that and does not say so.
- **Footer.** It carries the company line and the repository link the brief asks for. It sits outside `main` so the
  sticky phone column ends where the page content ends.
- **Extra tokens.** The brief's token block is kept as written. A small "handset detail" group was added after it for
  the highlight, the bezel and the key domes, so `styles.css` still holds no colour literal outside `:root`.
- **Time zone.** The phone clock and record times use the shop's zone (`Africa/Johannesburg` when the ledger answer
  gives none), so "14:05" on the LCD matches the record list.
