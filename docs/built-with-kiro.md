# How Kiro built the ledger

Kiro wrote the application code in this repository: the ledger core, the text-message reader and handler, the dialled
menu, the server and its Postgres store, and the browser phone. We wrote the steering files, the briefs that started
each spec, and the reviews. Every change came back to Kiro as a new task; we did not edit its code by hand.

## The set-up

We ran Kiro through the Kiro CLI without a window, so a whole spec could be built in one run and checked when it
finished:

```bash
kiro-cli --v3 chat --no-interactive --trust-all-tools --trust-workspace --model <model> "<the brief>"
```

`--trust-workspace` matters. Our first runs left it out and showed no hook output at all. With it, the "typecheck and
tests on stop" hook ran when Kiro finished, and Kiro answered its report: in one run it pointed out that the one failing
test was a fault it had already reported, and in another it found the packages missing, installed them and ran the
checks again.

The four steering files carry the rules that never change between tasks: who the shop owner is and what a reply must
sound like (`product.md`), money as whole cents and records that are only ever added (`money-and-records.md`), the
182 and 160 character limits and plain ASCII (`screens.md`), and the stack and routes (`tech.md`).

## Spec by spec

Each feature went through the same loop: a brief from us, a spec from Kiro (requirements, design, tasks), our review of
the spec, Kiro's revision, then a build run in which Kiro worked through the task list and ticked each task. The counts below
are the ticked tasks in each spec's `tasks.md` on 8 November 2026.

| Spec | Tasks ticked | What it built |
|---|---|---|
| `ledger-core` | 30 | Money parsing and formatting, records, undo by reversal, today, who owes, the closing summary and the export |
| `text-messages` | 46 | The rule reader, questions for unclear amounts, short replies, the optional model reader and its check, `handleText` |
| `dialled-menu` | 34 | A stateless USSD menu that replays the whole path on each request, the screens, the guard against saving twice, `npm run check:screens` |
| `server-and-store` | 69 | The Hono routes for Africa's Talking and the page, the Postgres store, the serverless entry, the callback key and the demo limits |
| `browser-phone` | 67 | The candybar phone drawn in CSS, typing on the keypad, the ledger card, the judges' check list |

## What the reviews sent back

Most of what our reviews found sat where a spec was silent. Kiro fixed each of these faults with a test that failed
first:

- The first money spec would have stored 1,000,000.00 as 10,000,000 cents, and an early parser read `45` as 45 cents.
- One reader test passed whatever the reader returned.
- The text reader read `sold 45 3 bread` as a sale of 3 with the item "45". It now asks the owner, as it does for
  `sold 2 200`.
- The page wrote a negative figure as `R-60` after the core moved to `-R60`.
- The server spec, written before the menu existed, invented a second guard against double saves. Kiro dropped it for
  the one the menu already had, and added a guard for repeated text callbacks, which Africa's Talking can send twice.
- Our database host's connection proxy drops the `search_path` start-up parameter, so the Postgres test suites shared one schema and raced each
  other. The helper now passes the search path as a connection option and refuses to run if it did not take.

Kiro found faults in its own work too. On 7 November 2026, while building the dialled menu, it reported that
`sold 45 bread`, the example our help reply gives, saved the sale without the item, and that the shop's day began about
0.4 seconds late because its search for the start of the day stopped at one second. In the server build the same day it
ran a stress test of simultaneous saves, measured about 2 in 100 pairs failing on the wrong index, and fixed the store
to report the duplicate correctly. Both figures are Kiro's own, from its run reports.

One run ended in the middle of a mutation check and left two guards removed from `src/ai/check.ts`; a later test
looped forever on an empty search string. We sent it back, Kiro restored both guards and added tests that fail if
either is removed again. Since then every review starts with a `git diff` of the source after any run that mutates
code.

## Models and credits

On Kiro Free, on 3 November 2026, we tried three models on the first specs. DeepSeek 3.2 wrote the first spec, Qwen3 Coder Next looped on a
wrong test, and Claude Haiku 4.5 finished six to eight tasks a batch for 2 to 5 credits, by Kiro's `/usage` readings that day. With the Kiroween credits, Claude
Sonnet 5.5 built each remaining spec in one run of 20 to 50 minutes (from the run logs of 7 November). By the night of 7 to
8 November 2026 the whole build had used 46.71 of Kiro Free's 50 monthly credits and 608.21 of the 4,000 Kiroween
credits, as Kiro's own `/usage` reported them.

## The second review

Before the demo went public, a second reviewer who had not read the briefs read the server, the store and the page the
way an attacker would. Its six findings were about the demo limits, how long demo shops last, the callback key, how a
menu session finds its shop, and one case of the text reader (`sold 45 3 bread` lost its item after the owner answered
the question). Kiro fixed all six in one run (brief 51), each with a test that failed first.

A second round read only that fix and found seven smaller gaps in the same areas, such as every IPv6 address counting as
a separate visitor, and a demo shop's start date being set to the date of its oldest record, so it expired about two
days early. Kiro closed all seven in brief 52, and a third round read that fix and found nothing left. The full suite,
run against a Postgres test database on 8 November 2026, passed 2,178 tests with none skipped.

## The briefs

The briefs we gave Kiro from 7 November 2026, the second build day, are in `docs/kiro-briefs/`, so you can read what
each run was asked to do. The first day's briefs (steering, the ledger core and the start of the text-message
spec) were not kept.
