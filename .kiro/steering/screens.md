---
inclusion: always
---

# Screens: the dialled menu and text replies

A feature phone shows very little. Every screen the ledger produces must pass these rules, and the tests check
every screen with the longest realistic data (a 24-character shop name, a 20-character customer name, amounts of
R999,999.99).

## Hard limits

| Channel | Limit | Why |
|---|---|---|
| Dialled menu (USSD) screen | 182 characters of text after the `CON ` or `END ` prefix | GSM USSD shows at most 182 characters |
| Text message (SMS) reply | 160 characters | one GSM-7 SMS; a longer reply is split and costs the owner twice |

- Plain ASCII only on both channels: no emoji, no curly quotes, no em dashes, no currency signs outside ASCII.
- A USSD response starts with `CON ` when the session continues and `END ` when it ends (Africa's Talking's
  format). The 182-character limit applies to the text after the prefix.
- When a list (such as who owes) does not fit, show the first items that fit and a numbered "More" option, never a
  cut-off line.

## The main menu

```
<Shop name>
Today: sales R1,240
1 Sale
2 Expense
3 Owes (credit)
4 Paid back
5 Today
6 Who owes
7 Undo last
8 Close day
```

- Option numbers stay the same everywhere so owners learn them by thumb.
- `0` goes back one screen and `00` goes to the main menu, from any screen.
- A record is saved only after a confirm screen (`1 Yes  2 No`). The confirm screen repeats the amount and item.
- After saving, end the session with what was saved and the new figure, for example
  `END Saved: sale R45 bread. Sales today R1,285.`

## Text replies

- Start with what happened: `Saved: sale R45 (3 bread). Sales today R1,285. Reply undo to cancel.`
- A message the ledger cannot read gets one short example back, never an error code:
  `Sorry, I did not get that. Try: sold 45 bread, spent 20 taxi, Tendai owes 30, today, who owes.`
- Keep every reply within 160 characters; drop the least useful part first (the hint, then the item).
