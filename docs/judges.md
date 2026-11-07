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

The one-minute steps (the ledger card changes after each; see section 6)

1. Press **Start demo shop**. The screen shows the demo number (`+27 00 000 xxxx`), the hint
   `Dial *384*46254#`, and the time.
2. Press the right soft key (**Menu**). It fills in `*384*46254#`. Press **Send**: the centre soft key or the green
   key. The main menu appears.
3. Press `1` (Sale), then **Send**. Type `45`, **Send**. Press `1` to skip the item, **Send**. Press `1` to save,
   **Send**. The screen says `Saved: sale R45 ...`. Press any key to go back to the home screen.
4. Press the left soft key (**Messages**). Type `Tendai owes 20 sugar` on your computer keyboard and press Enter.
   Then send `who owes`.
5. Send `undo`, then `close`. Then press **Export records** in the ledger card. A file named
   `imali-ai-export-YYYY-MM-DD.json` downloads. This is the file Imali AI can import.

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
| Long who-owes | In Messages send nine texts such as `Aaa owes 10`, `Bbb owes 10` and so on. Dial the code and press `6`. The screen ends with `9 More`. The ledger card shows six names and a "Show all 9" button. |
| Counter near the limit | The longest who-owes screen shows `This screen: N of 182 characters - near the limit` in the clay colour when N is 164 or more. |
| Empty ledger | A new shop shows `R0`, "Nobody owes money." and "No records yet." |
| Stale number | Start a shop, then restart the server. On reload the page quietly returns to the first-visit state. |
| Storage blocked | Open the page with site data blocked. It works for the visit; the number is lost on reload. |
| Reduced motion | Turn on "Reduce motion" in your system settings. Sections and screen lines appear at once, with no fade. |
| No JavaScript | Disable JavaScript. The page shows a line saying the demo needs JavaScript, and the text is readable. |

## 5. Contrast and focus

- Press Tab through the whole page. Every button, link and the phone screen shows a visible ring.
- The phone screen can be focused and scrolled with the arrow keys.
- A warning is never colour alone: "near the limit", "over the limit" and "undone" are also written as words.
- The call and end keys carry a drawn handset and no text. Their names are "Call key, send" and "End key, cancel".

## 6. What the ledger card should show after each step

| After | Today | Who owes | Last records |
|---|---|---|---|
| Start demo shop | Sales R0 (0), Spent R0, In hand R0 | Nobody owes money. | No records yet. |
| Dial the code | unchanged | unchanged | unchanged (nothing is saved until you confirm) |
| Sale of R45 saved | Sales R45 (1), In hand R45 | Nobody owes money. | Sale R45, channel Menu |
| `Tendai owes 20 sugar` | unchanged | Tendai R20 | Owes R20 Tendai - sugar, channel Text, above the Sale |
| `who owes` | unchanged | Tendai R20 | unchanged (asking saves nothing) |
| `undo` | unchanged | Nobody owes money. | The Owes row is struck through and marked "undone". A new row "Undo - cancels Owes R20 Tendai - sugar" appears at the top |
| `close` | unchanged | unchanged | unchanged |
| Export records | unchanged | unchanged | unchanged; a JSON file downloads |

Nothing is ever deleted. "Undo" adds a reversing record, so the old row stays and is marked "undone".

## 7. Start over

Press **Start over**. The phone goes home, the thread is empty, and a new demo number is made. The old shop stays on
the server untouched.
