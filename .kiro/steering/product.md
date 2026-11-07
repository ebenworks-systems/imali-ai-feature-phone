---
inclusion: always
---

# Product: a shop ledger on any phone

This repository is the Imali AI feature-phone ledger: a bookkeeping ledger for small shop owners that works on any
phone, including a basic phone with no data bundle. The owner uses it two ways:

1. **A dialled menu (USSD).** The owner dials a short code such as `*384*1234#` and moves through numbered screens:
   record a sale, an expense, a debt or a payment, see today's takings, see who owes money, undo the last entry and
   close the day.
2. **Plain text messages (SMS).** The owner texts a line such as `sold 3 bread 45`, `spent 120 transport`,
   `Tendai owes 20 sugar`, `Tendai paid 10`, `undo`, `today`, `who owes` or `close`. The ledger replies with what it
   recorded and the new figure.

Both channels call one handler and one ledger. A message that fixed rules cannot read may be passed to a small
language model, but the model only proposes; rules check every amount it proposes against the owner's own words,
and nothing is recorded that the owner did not type.

## Who the owner is

A spaza shop, tuck shop, kiosk or market stall owner in Africa. Busy, standing behind a counter, often typing with
one thumb on a keypad phone. English may be a second or third language. The ledger must:

- answer in short, plain words a 12-year-old would understand;
- never use jargon (no "transaction", "ledger entry", "balance sheet", "debit", "credit");
- say exactly what it recorded, with the amount in the shop's currency, so the owner can catch a mistake;
- forgive typing: extra spaces, capital letters, `R45`, `45.00`, `45,00` and `1 200` all mean what the owner meant;
- never lose a record. "Undo" adds a reversing record; nothing is ever deleted.

## The words we use on screen

| Owner action | Word on screen |
|---|---|
| money in from a customer | Sale |
| money out of the till | Expense ("Spent") |
| a customer takes goods and pays later | Owes |
| a customer pays back what they owe | Paid |
| reverse the last record | Undo |
| end-of-day summary | Close |

## Handing over to Imali AI

When an owner moves to a smartphone, the ledger exports every record in an open, documented JSON format
(`docs/export-format.md`), so the books go with the owner. No version of Imali AI imports that file today, so no text
in this repository says it can. Always write the name as "Imali AI", never "Imali".

## Demo data is invented

The demo shop, its owner, its customers, phone numbers and every figure are invented. Never use a real person's
name, number or a real shop. Demo phone numbers use the fiction range `+27 00 000 xxxx`.
