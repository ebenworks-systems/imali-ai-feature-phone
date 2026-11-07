# Dialled Menu (USSD) - Requirements

## Scope

The owner dials a short code and works through numbered screens on any phone. The phone network (Africa's Talking)
calls us with the form fields `sessionId`, `serviceCode`, `phoneNumber` and `text`. `text` is everything the owner has
typed in this session, joined by `*` (empty on the first request; `1*45*1` after choosing 1, typing 45, choosing 1).
We answer with text that starts `CON ` (the session continues) or `END ` (the session ends).

This spec covers `handleUssd` and everything under `src/channels/ussd/`, plus the small shared and test pieces it
needs: screen-limit checks, phone-number normalisation, a phone test helper, the `check:screens` script, and three
backwards-compatible changes to the ledger core and the store (a caller-supplied record id, a caller-supplied shop id,
and typed "duplicate" errors) that the repeated-request guarantee needs.

Out of scope: the Hono route for `POST /ussd` (form parsing, `text/plain` header, checking that the call really comes
from Africa's Talking), the Postgres store, the browser phone, and the text-message handler. The text-message handler
belongs to the `text-messages` spec and is finished (`handleText`, its replies and `src/channels/index.ts` exist).
Requirements 44 and 49 use it, and this spec changes it only if it does not find the shop by the normalised phone
number. One small change reaches into the core: money below zero is written with the sign before the symbol
(requirement 53), which also changes the text replies.

Terms used below: a **choice screen** is one where the owner picks a number from a list. A **typed screen** is one
where the owner types an amount, a name or an item. The **path** is the list of inputs in `text`. The **notice** is
an optional first line on a screen that tells the owner what went wrong, such as `Choose a number from the list.`

## Acceptance Criteria (EARS Notation)

### Screens and limits

1. **WHEN** the network calls `handleUssd` with a `sessionId`, `serviceCode`, `phoneNumber` and `text`
   **THE SYSTEM SHALL** return `{ response }` where `response` starts with `CON ` when the session continues and
   `END ` when it ends.

2. **WHEN** any response is built
   **THE SYSTEM SHALL** keep the text after the `CON ` or `END ` prefix to at most 182 characters and use only plain
   ASCII (characters 32 to 126, plus the newline between lines).

3. **WHEN** a screen would be longer than 182 characters because a figure is unusually large
   **THE SYSTEM SHALL** drop the notice first, then (on the closing summary only) the date line, then the counts in
   brackets, and **WHEN** it still does not fit **THE SYSTEM SHALL** return `END These numbers are too big to show
   here.` It never returns a response over the limit. The hint line of requirement 52 is not part of this ladder: it
   is added last, only when it fits, and is never the reason anything else is dropped. **WHEN** a total on a screen
   is not a safe whole number of cents **THE SYSTEM SHALL** return the same too-big screen instead of a wrong figure,
   and **WHEN** saving a record would make a total on the saved screen unsafe **THE SYSTEM SHALL** save nothing and
   return the not-saved screen of requirement 42.

4. **WHEN** a shop name, customer name or item that was stored earlier (possibly by text message) is put on a screen
   **THE SYSTEM SHALL** replace every character outside printable ASCII with `?` and clip a shop name to 24
   characters and a customer name or item to 20 characters.

5. **WHEN** the `sessionId` is empty, is longer than 100 characters or holds a character other than letters, digits,
   `_`, `-` and `.`, **OR** the `phoneNumber` cannot be normalised, **OR** `text` is longer than 500 characters or
   holds more than 30 inputs
   **THE SYSTEM SHALL** return `END Sorry, something went wrong. Please dial again.` without reading or writing the
   store.

6. **WHEN** an unexpected error happens (for example the store is unreachable)
   **THE SYSTEM SHALL** return the same `END Sorry, something went wrong. Please dial again.` instead of throwing, and
   log only the error name and message, never the phone number, the text or any name.

### Reading the path

7. **WHEN** a request arrives
   **THE SYSTEM SHALL** compute the screen only from the phone number, the shop's records and the whole `text` path,
   and keep nothing in memory between requests.

8. **WHEN** `text` is not empty
   **THE SYSTEM SHALL** split it on `*` and read the inputs one by one, in order, through a state machine that starts
   on the first screen, so that the last input decides the screen shown.

9. **WHEN** an input is `0`
   **THE SYSTEM SHALL** go back one screen, keeping what the owner typed on the earlier screens, and stay on the main
   menu without a notice when already there.

10. **WHEN** an input is `00`
    **THE SYSTEM SHALL** go to the main menu from any screen and drop the half-made entry (during sign-up it goes to
    the first sign-up screen, because there is no menu yet).

11. **WHEN** an input on a choice screen is not one of the numbers offered, **OR** is empty
    **THE SYSTEM SHALL** show the same screen again with `Choose a number from the list.` as its first line and keep
    the session open (`CON`).

12. **WHEN** a typed screen refuses an input
    **THE SYSTEM SHALL** show the same screen again with the plain reason as its first line and keep the session open.

13. **WHEN** an input that was refused is not the last input of the path
    **THE SYSTEM SHALL** treat it as if it had not been typed, so the screen and the notice depend only on the last
    input.

14. **WHEN** the path reaches a screen that ends the session before the last input (for example a repeated request)
    **THE SYSTEM SHALL** ignore the inputs after it and return that ending screen.

15. **WHEN** the owner types spaces around a choice or around an amount
    **THE SYSTEM SHALL** ignore the spaces.

### Sign-up

(Sign-up screens carry no hint line: there is no menu yet, and `0` and `00` only return to the shop-name screen.)

16. **WHEN** the phone number has no shop and `text` is empty
    **THE SYSTEM SHALL** return `CON Welcome to the Imali AI ledger. Your shop name?`

17. **WHEN** the owner types a shop name
    **THE SYSTEM SHALL** trim it, collapse inner runs of spaces, accept it only when `validateShopName` accepts it (1
    to 24 characters) and it is printable ASCII, and otherwise show the name screen again with a plain reason.

18. **WHEN** the shop name is accepted
    **THE SYSTEM SHALL** show the currency choice: `1 R South Africa`, `2 $ US dollar`, `3 KSh Kenya`,
    `4 N Nigeria`, `5 GHS Ghana`, `6 K Zambia`, `7 P Botswana`.

19. **WHEN** the owner chooses a currency
    **THE SYSTEM SHALL** make the shop with `createShop` (the normalised phone number, the chosen currency and the time
    zone of the chosen country; US dollar uses `Africa/Johannesburg`) and then show the main menu.

20. **WHEN** the shop was made earlier in this same session (its id was derived from the `sessionId`)
    **THE SYSTEM SHALL** still read the sign-up inputs at the start of the path, so that inputs after them go to the
    main menu.

21. **WHEN** the sign-up request is repeated, **OR** two copies of it arrive together, **OR** another session already
    made the shop
    **THE SYSTEM SHALL** make no second shop for that phone number and carry on with the shop that exists.

### Main menu

22. **WHEN** the phone number has a shop and `text` is empty
    **THE SYSTEM SHALL** return the main menu as a `CON` screen.

23. **WHEN** the main menu is shown
    **THE SYSTEM SHALL** show the shop name, `Today: sales ` and today's sales total in the shop's currency, then
    `1 Sale`, `2 Expense`, `3 Owes (credit)`, `4 Paid back`, `5 Today`, `6 Who owes`, `7 Undo last` and `8 Close day`,
    on separate lines, with the same numbers on every request.

### Entering records

24. **WHEN** the owner chooses `1 Sale`
    **THE SYSTEM SHALL** ask for the amount, then ask `What was sold? 1 to skip`, then show the confirm screen
    `Save sale R45 bread? 1 Yes 2 No` that repeats the amount and the item.

25. **WHEN** the owner chooses `2 Expense`
    **THE SYSTEM SHALL** ask for the amount, then ask what it was for (`1 to skip`), then show the confirm screen.

26. **WHEN** the owner chooses `3 Owes (credit)`
    **THE SYSTEM SHALL** ask for the customer name, then the amount, then the item (`1 to skip`), then show the confirm
    screen that repeats the customer, the amount and the item.

27. **WHEN** the owner chooses `4 Paid back` and at least one customer owes money
    **THE SYSTEM SHALL** show the customers who owe, largest first, as a numbered list (`1 Tendai R50`) with `8 Other
    name` and, when the list does not fit on one screen, `9 More`; at most 7 customers per screen so that 8 and 9 stay
    free; then ask for the amount, then show the confirm screen that repeats the customer name and the amount.

28. **WHEN** the owner chooses `8 Other name` on the paid-back list, **OR** chooses `4 Paid back` and nobody owes
    money
    **THE SYSTEM SHALL** ask for the customer name by typing, and **WHEN** the owner chooses `9 More` **THE SYSTEM
    SHALL** show the next screen of customers. The pages do not change when a notice is shown.

29. **WHEN** the owner types a customer name or an item
    **THE SYSTEM SHALL** trim it and collapse inner spaces, accept a customer name only when it has 1 to 20 printable
    ASCII characters and at least one letter, accept an item only when it has 1 to 20 printable ASCII characters,
    treat the input `1` on an item screen as "skip", and otherwise show the screen again with a plain reason.

30. **WHEN** the owner chooses `1 Yes` on a confirm screen
    **THE SYSTEM SHALL** save the record, and **WHEN** the owner chooses `2 No` **THE SYSTEM SHALL** save nothing and
    show the main menu with `Not saved.` as its first line. Nothing is saved before the confirm screen.

31. **WHEN** a record is saved
    **THE SYSTEM SHALL** end the session with what was saved and the new figure, worked out from the records after the
    save (not from the amount just saved): `END Saved: sale R45 bread. Sales today R1,285.`,
    `END Saved: spent R20 taxi. Spent today R300.`, `END Saved: Tendai owes R20 sugar. Tendai owes R50 in total.`,
    `END Saved: Tendai paid R10. Tendai owes R40 now.`; leaving out the item when there is none.

32. **WHEN** a payment leaves the customer owing nothing or holding credit
    **THE SYSTEM SHALL** say `Tendai owes nothing now.` or `Tendai has R5 credit now.`

### Amounts

33. **WHEN** the owner types an amount
    **THE SYSTEM SHALL** read it with `parseAmount` in the shop's currency, and **WHEN** `parseAmount` reports two
    possible amounts (a space followed by three digits, such as `2 200`) **THE SYSTEM SHALL** use the larger one, the
    thousands reading, because the menu has no quantity (`2 200` is R2,200; `2,200` is R2,200; `45,50` is R45.50).

34. **WHEN** the amount is zero, negative, words, or too large to store
    **THE SYSTEM SHALL** show the amount screen again with one of these first lines: `The amount must be more than
    zero.`, `Type the amount in numbers, like 45.`, or `That amount is too big.`

35. **WHEN** an amount is above 1,000,000.00 and the owner chooses `1 Yes` on the confirm screen
    **THE SYSTEM SHALL** show a second confirm screen, `That is a big amount: R1,500,000. 1 Yes, save 2 No`, and save
    only after `1`; the amount passed to the ledger is marked as confirmed so that the ledger saves it.

### Looking things up and undoing

36. **WHEN** the owner chooses `5 Today`
    **THE SYSTEM SHALL** end the session with today's sales total and count, what was spent, and money in hand.

37. **WHEN** the owner chooses `6 Who owes`
    **THE SYSTEM SHALL** show the customers who owe, largest first, with the total owed on the first line; **WHEN**
    the list does not fit **THE SYSTEM SHALL** show the first customers that fit and `9 More` (a `CON` screen);
    **WHEN** the screen is the last one **THE SYSTEM SHALL** end the session; and **WHEN** nobody owes money **THE
    SYSTEM SHALL** end with `Nobody owes you money.`

38. **WHEN** the owner chooses `7 Undo last` and a record can be undone
    **THE SYSTEM SHALL** show the record `undoLastRecord` would reverse as `Undo sale R45 bread? 1 Yes 2 No`; **WHEN**
    the owner chooses `1 Yes` **THE SYSTEM SHALL** call `undoLastRecord` and end with
    `Undone: sale R45 bread. Sales today R1,240.` naming the record that was actually undone; **WHEN** the owner
    chooses `2 No` **THE SYSTEM SHALL** show the main menu with `Not undone.` as its first line; and **WHEN** there
    is nothing to undo **THE SYSTEM SHALL** end with `Nothing to undo.`

39. **WHEN** the owner chooses `8 Close day`
    **THE SYSTEM SHALL** end the session with the closing summary from `getDayCloseSummary`: the day, sales and count,
    spent, money in hand, credit given, paid back and the total all customers still owe, within 182 characters.

### Repeated requests

40. **WHEN** a record is saved or undone
    **THE SYSTEM SHALL** give it an id derived from the `sessionId` and the number of inputs read up to and including
    the confirming input (`rec_ussd_<sessionId>_<n>`), so the same request always produces the same id.

41. **WHEN** the store is asked to append a record whose id it already holds
    **THE SYSTEM SHALL** refuse it with a typed `DuplicateRecordError` before any other check, and the menu SHALL
    treat that error as "this was already saved".

42. **WHEN** the network repeats a saving request for the same `sessionId` (one copy after another, or two copies at
    the same time)
    **THE SYSTEM SHALL** save one record only and return the same `Saved:` screen each time, after checking that the
    record already held has the same shop, kind, amount, customer and item; **WHEN** it does not match **THE SYSTEM
    SHALL** save nothing and return `END Sorry, that was not saved. Please try again.`

43. **WHEN** the network repeats a request that undoes a record
    **THE SYSTEM SHALL** add one reversal only and return the same `Undone:` screen each time, and never reverse a
    second record.

### Shared with the text messages

44. **WHEN** the menu and the text messages serve the same owner
    **THE SYSTEM SHALL** use the same ledger operations, the same store and the same money rules, and find the shop by
    the same normalised phone number, so a sale saved by text shows in the menu's Today figure and the reverse.

45. **WHEN** the menu saves a record
    **THE SYSTEM SHALL** mark its channel `ussd` and keep the owner's typed path (inputs joined by `*`, up to the
    confirming input) as the original words.

### Tests and checks

46. **WHEN** a test drives the menu
    **THE SYSTEM SHALL** provide a phone helper that sends the empty text first and then each key press with the whole
    path so far (`""`, `"1"`, `"1*45"`, ...) against the in-memory store, and can send the last request again.

47. **WHEN** the phone helper receives a response
    **THE SYSTEM SHALL** check the `CON `/`END ` prefix, plain ASCII and the 182-character limit, so every screen in
    every test is checked.

48. **WHEN** tests and the screen check run
    **THE SYSTEM SHALL** use the longest realistic data: a 24-character shop name, 20-character customer names, 20-character
    items, amounts of 999,999.99, and every one of the seven currencies, including the two widest symbols (`GHS` and
    `KSh`).

49. **WHEN** `npm run check:screens` runs
    **THE SYSTEM SHALL** render every menu screen (checked against the list of screen ids, so a screen nobody renders
    fails the check) and every text reply with that longest data, print each failure, and exit with a non-zero code
    if any is over its limit (182 for the menu, 160 for a text) or not ASCII.

### Public surface and safety

50. **WHEN** other code uses the menu
    **THE SYSTEM SHALL** expose one function, `handleUssd({ sessionId, serviceCode, phoneNumber, text, now, store }):
    Promise<{ response: string }>`, in `src/channels/ussd/` and exported from `src/channels/index.ts`, take the time
    from `now` and never read the clock, add no new dependency, and make no network call.

51. **WHEN** the core and the store are changed for this spec
    **THE SYSTEM SHALL** keep every existing call working: the new record id and shop id are optional, a record or shop
    made without them gets a generated id as before, and all existing tests pass unchanged, except the two that pinned
    the old wording of a negative amount (`R-45.50` in `format.test.ts` and `R-50` in `replies.test.ts`), which change
    as requirement 53 says.

### The back-and-menu hint

52. **WHEN** a screen is a typed screen (amount, item or customer name), a `CON` list screen (the paid-back list and
    the who-owes list that has `9 More`) or a confirm screen (save, big amount, undo)
    **THE SYSTEM SHALL** end it with the line `0 Back 00 Menu` as its last line, **BUT ONLY WHEN** the whole response,
    hint included, is at most 182 characters after the prefix; **WHEN** it is longer **THE SYSTEM SHALL** leave the hint
    out and keep every other line exactly as it would be without the hint (the notice, the rows and the `8` and `9`
    lines are never dropped, shortened or moved to make room for it). The hint is never on the main menu, the
    sign-up screens or any `END` screen. List pages hold the same rows whether or not the hint is shown.

### Negative amounts

53. **WHEN** an amount below zero is written on either channel (for example money in hand after spending more than was
    sold)
    **THE SYSTEM SHALL** write the minus sign before the currency symbol, `-R60` and `-KSh1,200.50`, never `R-60`, in
    every currency, by changing `formatCents` in `src/core/money/format.ts` so that both channels get it.
