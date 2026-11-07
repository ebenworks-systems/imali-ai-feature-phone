You are working in this repository, the Imali AI feature-phone ledger. Read the steering files in .kiro/steering/, then the spec .kiro/specs/browser-phone/ (requirements.md, design.md, tasks.md). The server routes it calls are being built in parallel from another spec; build against the routes and answers named in the spec's assumptions A1 to A5, and keep all network calls in api.js so they are easy to adjust.

First settle the open points, and update the spec files to match before writing code:

1. The headline is a full sentence: "Keep your shop's books on any phone." The paragraph under it: "Dial a code or send a text message. The ledger works on any phone, with no data bundle, no app and no smartphone." Do not claim an AI in the page text.
2. The eyebrow stays "Kiroween 2026 - Resurrection" (an ASCII hyphen, never an em dash anywhere on the page).
3. Add a footer: "An open-source companion to Imali AI." with a link to https://imali-ai.ebenworks.co, then "Imali AI: Africa's smartest AI Business OS." on its own line, then "Built with Kiro. MIT licence." with a link to https://github.com/ebenworks-systems/imali-ai-feature-phone. Never link imali.ai.
4. Keep the second Start button under the phone for first visits, the Send soft key label, the refusal of * and # inside menu replies, the Content-Security-Policy meta tag (allow Google Fonts' two hosts and nothing else outside the page's own origin), and textContent for all server text.
5. The page must look expensive and finished, not like a template: follow the design tokens, the double-bezel cards, the soft wide shadows, the pill buttons with the arrow in its own circle, the LCD with a faint pixel grid and the motion rules exactly. The phone must look like a real candybar handset (rounded body, a subtle highlight along the top edge, a speaker slot, the LCD set into a bezel, domed keys with a soft shadow under each), drawn in CSS only, light bone plastic, never a dark body.

Then do every task in .kiro/specs/browser-phone/tasks.md, in order, ticking each ([x]) when done. Plain HTML, CSS and JavaScript in public/, no build step, no framework, no new npm dependency. Pure logic stays in DOM-free modules with Vitest tests. Check by reading your CSS that nothing scrolls sideways at 390 px wide and that the keypad buttons are at least 44 by 40 px there.

When you finish, run `npm run typecheck` and `npx vitest run --maxWorkers=4`, fix anything that fails, and end with the files you created and the test count. Do not run git commit.
