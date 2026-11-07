# Judges' check list: the browser phone

This page draws a working feature phone in your browser and talks to the same handler the real network calls. You do
not need an African SIM card. Everything on it is invented demo data.

The steps below take about ten minutes. Do the 1280 px list on a laptop and the 390 px list on a phone, or in your
browser's device mode.

## 1. Before you start

1. Open the page (`/`) in a normal window.
2. For a clean first visit, clear this site's stored data: in DevTools open Application, then Local Storage, then
   delete the key `imali-demo-phone`. Or open the page in a private window.
3. Keep DevTools open on the Network tab. The only request to another site should be Google Fonts. Nothing else
   should leave the page.

## 2. At 1280 px wide (laptop)

Layout

- Two columns. On the left: the pill that says "Kiroween 2026 - Resurrection", the headline "Keep your shop's books on
  any phone.", the paragraph, the "Try it in one minute" card, then the ledger card. On the right: the phone.
- Scroll down. The phone stays in view while the left column moves. (If your window is shorter than 700 px the phone
  scrolls with the page instead. That is expected.)
- The phone looks like a real candybar handset in light bone plastic: a soft light along its top edge, a speaker slot,
  a green screen set into a bezel, and domed keys with a soft shadow under each.
- At the bottom of the page: a footer with three lines. "An open-source companion to Imali AI." and "Built with Kiro.
  MIT licence." are links. The middle line, "Imali AI: Africa's smartest AI Business OS.", is plain text.

The one-minute steps. A new demo shop already has invented records, so read each result as a change to the ledger
card, not as a total. Section 6 lists the changes.

1. Press **Start demo shop**. The screen shows the demo number (`+27 00 000 xxxx`), the hint `Dial *384*46254#`, and the
   time. The ledger card fills with a shop called Thandi's Spaza and its records. Before the next step, note Sales and
   its count, what Tendai owes, and the row at the top of "Last records".
2. Press the right soft key (**Menu**). It fills in `*384*46254#`. Press **Send**: the centre soft key or the green
   key. The main menu appears. The ledger card does not change.
3. Press `1` (Sale), then **Send**. Type `45`, **Send**. Press `1` to skip the item, **Send**. Press `1` to save,
   **Send**. The screen says `Saved: sale R45 ...`. In the ledger card, Sales goes up by R45 and its count by one, and
   a Sale R45 row with channel Menu appears at the top. Press any key on the phone to go back to the home screen.
4. Press the left soft key (**Messages**). Type `Tendai owes 20 sugar` on your computer keyboard and press Enter.
   Tendai's total owed goes up by R20, and an Owes R20 row (Tendai - sugar) with channel Text appears at the top.
   Then send `who owes`. Nothing in the ledger card changes, because asking saves nothing.
5. Send `undo`. The Owes row is marked undone, a new row "Undo: cancelled Owes R20 Tendai (sugar)" appears at the
   top, and Tendai's total goes back to what it was before step 4. Send `close`: nothing changes. Then press
   **Export records** in the ledger card. A file named `imali-ai-export-YYYY-MM-DD.json` downloads. This is the file
   Imali AI can import.

Keyboard

- Digits, `*` and `#` on your keyboard fill the dial line. Backspace clears. Enter sends. Escape is the end key.
- Up and Down scroll a long screen.
- Click a phone key with the mouse, then type on your keyboard: the typing still works (the page takes focus back).
- Tab through the page. The first stop is "Skip to the ledger". Every control shows a visible ring. Nothing traps focus.

Typing on the pad (the way a feature phone does it)

- Press the mode key (`123 / abc`) to switch. In `abc` mode tap a key again within a second to move through its
  letters. `2` gives a, b, c, 2. Message text starts with a capital letter.
- `0` types a space, then 0. `1` types punctuation: `. , ? ! ' @ 1`.
- The letter being typed is shown highlighted until you wait or tap another key.

## 3. At 390 px wide (phone)

1. The order is: the phone (full width), the pill and headline, the paragraph, "Try it in one minute", the ledger
   card, then the footer.
2. Nothing scrolls sideways. Every key on the pad is at least 44 px high and wide, and you can press all of them.
3. On a first visit a **Start demo shop** button sits directly under the phone, so you do not have to scroll to the
   ledger card. It disappears once the shop exists.
4. Repeat the five steps from section 2. Tap the keys with your thumb.
5. Zoom to 200 percent. The page stays readable and usable in one column.

## 4. States and how to trigger them

| State | How to see it |
|---|---|
| First visit | Private window, or clear `imali-demo-phone`. The screen says `Press Start demo shop`, the keys do nothing, and the ledger card says "No demo shop yet. Press Start demo shop." |
| Starting | Press Start demo shop with DevTools set to Slow 3G. The button reads "Starting..." and ignores a second press. |
| Loading (menu) | Dial with DevTools on Slow 3G. The screen says `Please wait...`. Only the end key and Cancel work. |
| Loading (text) | Send a message on Slow 3G. Your line shows dimmed with "..." and a second Send is ignored. |
| Network error (menu) | In DevTools choose Offline, then dial or press Send. The screen says `No network. Try again.` Any key goes home. |
| Network error (text) | Go Offline in Messages and send. Your line disappears, your words come back in the compose line, and the thread says `No network. Try again.` |
| Ledger refresh error | Start a shop, then go Offline in DevTools and send a message. After the failed send the page tries to refresh the ledger card, which keeps its figures and shows "Could not refresh. Try again." with a Retry button. Go back Online and press Retry. |
| END screen | Finish a Sale. The screen shows the saved line and the centre key says OK. Any key goes home. |
| Unknown code | Type `*384#` on the dial line and press Send. The screen says `Unknown code. Try *384*46254#.` |
| Long who-owes | The demo shop already has three people who owe money. In Messages send seven texts: `Customer 1 owes 10`, `Customer 2 owes 10` and so on up to `Customer 7 owes 10`. Dial the code and press `6`. The screen ends with `9 More`. The ledger card shows six names and a "Show all 10" button. |
| Counter near the limit | Keep going in Messages with `Customer 8 owes 10` up to `Customer 14 owes 10`. The who-owes screen is then 164 characters and shows `This screen: 164 of 182 characters - near the limit` in the clay colour. The server breaks a long list into screens before it gets longer, so this is the closest it comes. |
| Empty ledger | This does not happen on a fresh demo shop, which always has records. To see the empty words, answer the ledger call with empty lists: in DevTools, Network, right-click the `ledger?phone=...` request, choose "Override content", and set `owes` to `{"customers":[],"more":0}` and `records` to `[]`. Press Retry. The card says "Nobody owes money." and "No records yet." |
| Stale number | Start a shop, then restart the server. On reload the page quietly returns to the first-visit state. The same happens when you dial or send a message after the shop has gone: the server answers 404 "No demo shop on this number. Press Start demo shop." and the page goes back to the first-visit state without an error message. Demo shops are cleared away after about a week, so a number kept in a browser for longer than that ends up here. |
| Storage blocked | Open the page with site data blocked. It works for the visit; the number is lost on reload. |
| Reduced motion | Turn on "Reduce motion" in your system settings. Sections and screen lines appear at once, with no fade. |
| No JavaScript | Disable JavaScript. The page shows a line saying the demo needs JavaScript, and the text is readable. |

## 5. Contrast and focus

- Press Tab through the whole page. Every button, link and the phone screen shows a visible ring.
- The phone screen can be focused and scrolled with the arrow keys.
- A warning is never colour alone: "near the limit", "over the limit" and "undone" are also written as words.
- The call and end keys carry a drawn handset and no text. Their names are "Call key, send" and "End key, cancel".

## 6. What the ledger card should show after each step

A new demo shop has invented records (a shop called Thandi's Spaza with sales, one expense and people who owe, Tendai,
Rudo and Sipho among them). They are placed relative to the current time, so the totals differ from run to run.
Compare with what you saw just before the step.

| After | Today | Who owes | Last records |
|---|---|---|---|
| Start demo shop | Figures are filled in: Sales with a count, Spent, In hand | Several people, largest first, Tendai among them | Records from today and the two days before, newest first. An earlier day shows its date before the time. One old Sale R999 is struck through and marked "undone", with an Undo row above it |
| Dial the code | unchanged | unchanged | unchanged (nothing is saved until you confirm) |
| Sale of R45 saved | Sales goes up by R45 and its count by one. In hand goes up by R45. Spent is unchanged | unchanged | A Sale R45 row with channel Menu appears at the top |
| `Tendai owes 20 sugar` | unchanged | Tendai's total goes up by R20 | An Owes R20 row (Tendai - sugar) with channel Text appears at the top, above the Sale |
| `who owes` | unchanged | unchanged | unchanged (asking saves nothing) |
| `undo` | unchanged | Tendai's total goes back to what it was before the Owes message | The Owes row is struck through and marked "undone". A new row "Undo: cancelled Owes R20 Tendai (sugar)" appears at the top |
| `close` | unchanged | unchanged | unchanged |
| Export records | unchanged | unchanged | unchanged; a JSON file downloads |

Nothing you record is ever deleted. "Undo" adds a reversing record, so the old row stays and is marked "undone" in words
(and struck through), never by colour alone. The one exception is housekeeping of the invented demo data: a demo shop
and its records are cleared away about a week after it was made, so the demo stays free for the next judge.

## 7. Start over

Press **Start over**. The phone goes home, the thread is empty, and a new demo number is made. The old shop stays on
the server untouched until it is cleared away, about a week after it was made.

Only the **Start demo shop** and **Start over** buttons make a demo shop. Dialling or texting a demo number that has no
shop does not make one.
