You are working in this repository, the Imali AI feature-phone ledger. Read the steering files in .kiro/steering/, then the spec .kiro/specs/dialled-menu/ (requirements.md, design.md, tasks.md), then the code in src/ (the text-message channel in src/channels/sms/ is now finished, with handleText, the replies and src/channels/index.ts).

First settle the spec's "Decisions to review", and update requirements.md, design.md and tasks.md to match before you write code:

1. Add the hint line "0 Back 00 Menu" as the last line of every typed-answer screen, every list screen with a CON prefix and every confirm screen, but only when it fits within 182 characters; when it does not fit, leave it out (never drop anything else for it). Never on the main menu or an END screen. Test both cases.
2. The last who-owes screen ending the session, No returning to the main menu with "Not saved." first, the time zone following the country, and customer names needing a letter are accepted as designed.
3. A negative amount must read "-R60", not "R-60", everywhere money is shown. Fix formatCents in src/core/money/format.ts for negative values (the sign before the currency symbol, for every currency), update its tests, and check that the text replies still pass.
4. Tasks 30 and 31 are no longer blocked: handleText exists. The cross-channel test saves a sale by text and reads it on the menu's main screen, and the reverse; check:screens renders the text replies too.

Then do every task in .kiro/specs/dialled-menu/tasks.md, in order, ticking each ([x]) when done. Keep the rules of the spec: the state machine replays the whole path with 0 and 00; every screen is plain ASCII, starts with CON or END, and is at most 182 characters after the prefix with the longest data (24-character shop name, 20-character customer name, R999,999.99); a repeated saving request for the same sessionId saves once; no new dependency; the core never imports a driver.

When you finish, run `npm run typecheck`, `npx vitest run` and `npm run check:screens`, fix anything that fails, and end with a short list of files created or changed, any spec change you made, and the test count. Do not run git commit.
