# Imali AI feature-phone ledger

The Imali AI feature-phone ledger lets a shop owner keep the shop's books from any phone, including a basic keypad
phone with no data bundle. The owner dials a short menu code or sends a plain text message such as `sold 3 bread 45`
or `Tendai owes 20 sugar`, and the ledger saves the sale, expense, credit or payment in whole cents and replies with the
new figure. When the owner moves to a smartphone, the ledger exports every record in an open format that Imali AI can
import.

This repository is our entry for Kiroween 2026. Kiro wrote the application code from the specs in `.kiro/`.

## What works today

The ledger core keeps append-only records for sales, expenses, credit and payments, undoes the last record by adding a
reversal, and answers today's totals, who owes what and the closing summary for the shop's own day. The text-message
reader turns an owner's message into one of those actions, and it asks the owner when an amount could mean two
things (`sold 2 200`). The dialled menu, the text replies, the browser phone for judges and the live demo come next,
each from its own spec.

## Run the tests

You need Node.js 22.

```bash
npm ci
npm run typecheck
npm test
npm run build
```

## How Kiro builds it

- `.kiro/steering/` holds the rules Kiro follows on every task: who the shop owner is, how money and records work,
  the screen limits (182 characters for a menu screen, 160 for a text) and the technology choices.
- `.kiro/specs/` holds one spec per feature, each with requirements, a design and a task list that Kiro works through
  and ticks off. `ledger-core` is finished; `text-messages` is under way.
- `.kiro/hooks/` runs the tests when a source file is saved, checks screen lengths, scans staged files for keys
  before a commit, and asks Kiro to keep working until the code type-checks and the tests pass.
- We run Kiro through the Kiro CLI without a window (`kiro-cli --v3 chat --no-interactive`), review every change,
  and send what we find back to Kiro as a new task.

## Outside code

The project uses only the npm packages listed in `package.json` (TypeScript, Vitest, fast-check and the Node.js type
definitions). No code was copied from other projects.

## Licence

MIT. See `LICENSE`.
