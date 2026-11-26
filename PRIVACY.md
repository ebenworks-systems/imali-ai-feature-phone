# Privacy and safety

This file is for anyone who runs the ledger as a live service (the operator) and for the shop owners who use it. It
says what the ledger stores, who can read it, how an owner gets a copy or has it erased, which laws an operator must
follow, and how the design keeps the service from being used to harm anyone.

## What the ledger stores

The ledger keeps five tables, defined in `sql/001_init.sql` and `sql/002_demo_quota.sql`. Without a database it keeps
the same data in memory, and a restart erases it.

| Table | What it holds | How long |
|---|---|---|
| `shops` | The shop name (1 to 24 characters), the owner's phone number, the currency, the time zone and when the shop was made | Until the operator erases it |
| `records` | Each sale, expense, debt, payment and reversal: the amount in whole cents, the item, the customer's name as the owner typed it, the channel, the owner's own words and the time | Until the operator erases the shop |
| `pending_questions` | A question the ledger asked about an unclear message, kept against the owner's phone number | 10 minutes |
| `processed_texts` | The network's message id and the reply sent, so a repeated callback is answered once and saved once | 48 hours |
| `demo_quota` | For the public demo: the SHA-256 of a server-side salt and the visitor's address, never the address itself | 24 hours |

Undo never deletes a record. It adds a reversal, so the owner's history stays whole. Demo shops (numbers `+2700000`
followed by four digits) are removed with all their records seven days after they are made.

The ledger stores no customer phone numbers, no contacts, no location and no device details. A customer appears in
the books as the name the owner typed, for example "Tendai" in `Tendai owes 20 sugar`.

## Who can read it

- The owner, through the menu screens and text replies on their own phone. Every reply goes to the number that sent the
  message, and the ledger never sends anything to another number.
- The operator, who runs the server and the database.
- The network gateway (Africa's Talking in this repository), which carries every message and reply between the
  owner's phone and the server.
- The optional model reader, when the operator switches it on. It receives the text of one message the rules could
  not read, and nothing else: no phone number, no shop name and no records. Its suggestion is kept only if the amount
  and the name appear in the owner's own words.

Error logs carry a masked phone number. The menu's error log carries the error's name and message.

## Getting a copy of the books

The export is one JSON file holding the shop and every record in the order it was made, reversals included. The format
is documented in `docs/export-format.md`. On the public demo, "Export records" downloads it in the browser. On a live
service, the operator makes the file for an owner with `generateExport(store, shop)` from `src/core`.

## Erasing a shop

An owner can ask the operator to erase their shop. On Postgres, run these statements in one transaction with the
owner's number as the ledger stores it (with the country code, for example `+263771234567`):

```sql
begin;
delete from pending_questions where phone = '+263771234567';
delete from processed_texts where phone = '+263771234567';
delete from records where shop_id = (select id from shops where phone = '+263771234567');
delete from shops where phone = '+263771234567';
commit;
```

They mirror the store's own clean-up of demo shops, and they leave every other shop untouched. A copy of the export
made before the erase is the owner's to keep. Backups of the database follow the operator's own backup schedule.

## Laws an operator must follow

The operator is responsible for the personal data the service holds: the owners' phone numbers and the customer names
they type. Each country the service runs in has its own data protection law. For the countries behind the seven
currencies the ledger supports, these are:

| Country | Law |
|---|---|
| Zimbabwe | Cyber and Data Protection Act [Chapter 12:07] |
| South Africa | Protection of Personal Information Act, 4 of 2013 (POPIA) |
| Kenya | Data Protection Act, 2019 |
| Nigeria | Nigeria Data Protection Act, 2023 |
| Ghana | Data Protection Act, 2012 (Act 843) |
| Zambia | Data Protection Act, No. 3 of 2021 |
| Botswana | Data Protection Act, 2024 |

Before running a live service, check the current law with a lawyer in each country, including whether the operator
must register with the national data protection authority.

## Do no harm

The ledger is built so it cannot be turned against the people it serves or anyone else.

- No contact between users. The ledger answers the number that wrote to it and nothing else, so it cannot be used to
  reach, spam or harass another person.
- Nothing is published. A shop's records are never shown to another user or posted anywhere.
- Free text is kept as the owner's own record, in the owner's own books.
- A debt cannot quietly vanish or appear. Undo adds a reversal instead of deleting, and a model's suggestion is
  refused unless its amount and name are in the owner's own words.
- Once the gateway is set up, the network routes `/ussd` and `/sms` refuse any call without the callback key (and
  answer 503 until the key is set), so a stranger cannot write into a shop's books.
- A repeated menu request or text callback saves once.
- The public demo limits how many demo shops one visitor can make and stores a salted hash of the visitor's address,
  never the address.

## Reporting a problem

Report a security or privacy problem to security@ebenworks.co. The contact details are also at
https://ebenworks.co/.well-known/security.txt.
