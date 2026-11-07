You are working in this repository, the Imali AI feature-phone ledger. Read the steering files in .kiro/steering/, the specs in .kiro/specs/ (especially server-and-store, whose /api/phone/* and /api/ledger routes this page calls), and the code in src/ before you start.

Write a new spec, .kiro/specs/browser-phone/, with requirements.md (numbered EARS requirements), design.md (page structure, components, the design tokens below, states, keyboard and screen-reader behaviour) and tasks.md (small checkbox tasks naming files and requirements). Do not write application code in this run: only the three spec files.

What the page is: the live demo judges open. Judges have no African SIM card, so the page draws a working feature phone that talks to the same handler as the real network. Plain HTML, CSS and JavaScript in public/ (index.html, styles.css, phone.js, ledger.js), no build step, no framework, no tracking scripts.

Layout (an editorial split):
- Desktop (1280 px wide): left column, a small pill eyebrow "Kiroween 2026 - Resurrection", a large serif headline "A shop ledger for any phone.", one short paragraph ("Dial a code or send a text. No data bundle, no app, no smartphone. The feature-phone menu, brought back with an AI behind it."), then "Try it in one minute": five numbered judge steps (1. Press Start demo shop. 2. Dial *384*46254# and press the green key. 3. Press 1 for Sale, type 45, press 1 to skip the item, press 1 to save. 4. Open Messages and send "Tendai owes 20 sugar", then "who owes". 5. Send "undo", then "close", and press Export to download the records Imali AI can import.) Under them, the live ledger panel. Right column: the phone, sticky while the left column scrolls.
- Phone width (390 px): the phone first, full width with 16 px side padding, then the steps, then the ledger panel. Nothing scrolls sideways; the whole phone, keypad included, is usable at 390 px.

The phone:
- A candybar feature phone drawn in CSS: a warm bone plastic body (light, never a dark fill), a sage monochrome LCD with a faint pixel grid, a soft key row (left soft key, centre key, right soft key), green call and clay end keys, and a 12-key pad (1, 2 abc, 3 def ... * 0 #) with letters under the digits.
- Home screen: "Imali AI" as the network name, the time, the demo number, and soft keys "Messages" and "Menu". Typing digits dials; the green key sends the dialled code. *384*46254# (the digits spell IMALI on a keypad, and it is the same code as our Africa's Talking sandbox channel) opens the dialled menu; the home screen shows the code as a hint (call /api/phone/ussd with a new sessionId and empty text, then send each reply with the whole path joined by *, as the network does). A screen starting END closes the session after the owner presses any key; CON shows a reply line. The end key always ends the session and goes home.
- Messages: a thread with the ledger (shown as "Imali AI"), newest at the bottom, scrolled on the LCD, and a compose line. Send posts to /api/phone/sms.
- Typing: the keypad works by tap; on the keypad, a "123 / abc" mode switches to multi-tap letters (press 2 twice for b, pause 900 ms to accept); the computer keyboard also types into the reply or compose line, Enter sends, Escape ends. Every key is a real button with an accessible name, a visible focus ring and a pressed state.
- Under the phone, a quiet counter: "This screen: 143 of 182 characters" (menu) or "Reply: 98 of 160 characters" (text), from the route's count.

The ledger panel (left column on desktop, below on phones): shop name and currency, today (sales and count, spent, in hand), who owes (name and amount, largest first), the last records (kind, amount, item or customer, the channel it came from, the time in the shop's day; reversed records struck through with "undone"), refreshed after every send. Buttons: "Start demo shop" (POST /api/phone/demo with a new random demo number in the fiction range +2700000xxxx, kept in localStorage), "Start over" (a new number), and "Export records" (downloads /api/export). A one-line note under it: "Everything here is invented demo data."

Design tokens (put them in design.md and use them as CSS custom properties):
- Background paper #FBF8F1 with a fixed, pointer-events-none film-grain overlay at opacity 0.03; ink #2A2320; soft ink #6B5F57; sage accent #8A9A7B; deep sage for accent text #4F5E45; clay #B4532A; hairlines rgba(42, 35, 32, 0.08).
- LCD background #C9D4B0, LCD ink #1F2A1A; phone body #ECE6DA to #DCD3C3; keys #F6F2EA with ink legends; call key #6E8B5E; end key #B4532A.
- Fonts from Google Fonts with display=swap: Fraunces for headings (large, tight leading), Geist for text, Geist Mono for counts and figures, VT323 for the LCD. Never Inter, Roboto, Arial or Helvetica.
- Cards (the steps card and the ledger panel) use a double bezel: an outer shell with a hairline ring, 6 px padding and a 28 px radius, holding an inner core with its own background, a soft inset highlight and a 22 px radius. Shadows are wide and soft (for example 0 40px 80px -30px rgba(60, 45, 30, 0.25) with 0 2px 6px rgba(60, 45, 30, 0.06)), never a hard dark shadow or a plain 1 px grey border.
- Buttons are pills; the primary button carries its arrow inside its own small circle that nudges up and right on hover; press scales to 0.98.
- Motion uses cubic-bezier(0.32, 0.72, 0, 1); keys depress with transform only; LCD text appears line by line like an old screen refresh (about 30 ms a line); sections fade up once as they enter the view through IntersectionObserver. All of it stops under prefers-reduced-motion. Animate only transform and opacity.
- Light theme only. Text contrast at least 4.5:1. Use a 100dvh minimum height, never 100vh.

States to design and test: first visit (no demo shop yet: the phone shows "Press Start demo shop"), loading, a network error (the LCD shows "No network. Try again." and the session ends), an END screen, a long who-owes list with "9 More", the counter near its limit.

Tests: a Vitest test (jsdom is not installed, so test the pure parts) for phone.js logic split into a module that has no DOM in it: the dial and path building, multi-tap letters, the 0 and 00 path rules, and the counter text. Keep the DOM code thin. Add a short manual check list in docs/judges.md for 1280 and 390 px wide.

End with a short summary: the number of requirements and tasks.
