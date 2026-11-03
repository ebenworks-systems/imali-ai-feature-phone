---
inclusion: always
---

# Money and records

## Money is whole cents, always

- Every amount is stored, added and compared as an integer number of minor units (cents). A JavaScript `number` is
  fine as long as it is a safe integer; check `Number.isSafeInteger` at every boundary.
- Never parse money with `parseFloat`, `Number("45.5")` or any floating-point arithmetic. Parse the digits as a
  string and build the integer: `"45.50"` becomes `4550`.
- A shop has one currency for life, set when the shop is made. Supported: ZAR (`R`), USD (`$`), KES (`KSh`),
  NGN (`N`), GHS (`GHS`), ZMW (`K`), BWP (`P`). All use two decimal places. Screens must stay plain ASCII, so the
  naira sign is written `N` and the cedi `GHS`.
- Show money short: `R45` when the cents are zero, `R45.50` otherwise, and a comma for thousands (`R1,240`).
- An amount of zero or less is refused with a plain reason. An amount above 1,000,000.00 is not refused but needs
  the owner to confirm it, because a slip of the thumb adds zeros.

## Reading an amount the owner typed

The owner may type `45`, `R45`, `45.00`, `45,50`, `1,200`, `1 200` or `R1 200.50`.

- A comma followed by exactly one or two digits at the end of the number is a decimal comma (`45,50` is R45.50).
- A comma or a space followed by exactly three digits is a thousands separator (`1,200` and `1 200` are R1,200).
- When a message could honestly mean two different amounts (for example `sold 2 200` could be two items for 200 or
  one sale of 2,200), the ledger asks the owner which one they meant. It never guesses.

## Records are append-only

- A record has: an id, the shop, the kind (`sale`, `expense`, `debt`, `payment`, `reversal`), the amount in cents,
  an optional item (`bread`), an optional customer name (for `debt` and `payment`), the channel it came from
  (`ussd`, `sms`, `web`), the owner's original words, and the time it was made (UTC, ISO 8601).
- "Undo" never deletes. It adds a `reversal` record that points at the record it cancels. A record can be reversed
  once. Undo reverses the owner's most recent record that is not already reversed and is not itself a reversal.
- A customer's debt is the sum of their `debt` records minus their `payment` records, ignoring reversed records.
  Customer names match without regard to case or extra spaces (`tendai` and `Tendai ` are the same person).
- A payment larger than what the customer owes is recorded, and the reply says the customer now has credit.
- "Today" is the shop's local day. Each shop has a time zone (default `Africa/Johannesburg`).

## Closing the day

The closing summary for a day gives: sales total and count, expenses total, money in hand (sales plus payments
received minus expenses), new debts given today, payments received today, and the total all customers still owe.
