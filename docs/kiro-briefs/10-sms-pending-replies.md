You are working in this repository, the Imali AI feature-phone ledger. Read the steering files in .kiro/steering/ and the spec in .kiro/specs/text-messages/ (requirements.md, design.md, tasks.md) before you start.

Do these tasks from .kiro/specs/text-messages/tasks.md, in order, and tick each one ([x]) in tasks.md when it is done:

1. Every task in the pending-question section (src/channels/sms/pending.ts, InMemoryPendingStore with a 10-minute expiry, and test/channels/sms/pending.test.ts). Give the store an injectable clock (a `now: () => Date` constructor option, defaulting to the system clock) so the expiry test does not sleep.
2. Every task in the replies section (src/channels/sms/replies.ts and test/channels/sms/replies.test.ts).

Rules that the tests must prove:

- Every reply is plain ASCII and at most 160 characters. Test each reply kind with the longest realistic data: a 20-character customer name (for example "Nomvula Dlamini-Khum"), a 24-character item, and amounts of R999,999.99 in every figure. When a reply is too long, drop the hint first ("Reply undo to cancel."), then the item, exactly as the spec says, and never cut a word or a number in half.
- Money is formatted only with formatCents from src/core/money/format.ts (R45, R45.50, R1,240). Never use floating point.
- Use the exact wording in the spec and steering for each reply. Who owes is sorted by amount owed, largest first, and when the list does not fit, end with "+N more. Reply owes 2" (with the next page number), never a cut-off name.
- The close reply uses the shop's local day name and date, for example "Close Mon 3 Nov: ...".
- No jargon on screen: never "transaction", "balance", "debit", "credit" as an accounting word (the spec's "has R5 credit" for a customer who overpaid is allowed).

Do not add dependencies. Do not change src/core except to fix a real bug, and if you do, say so. Do not run git commit. When you finish, run `npm run typecheck` and `npx vitest run`, fix anything that fails, and end with a short list of the files you created or changed and the test count.
