# SMS Channel Requirements

Plain text messages (SMS) to record sales, expenses, customer debts, payments, and see shop summaries. The ledger runs on rules alone; a language model may propose interpretations for messages the rules cannot read.

## EARS Acceptance Criteria

1. The reader parses "sold 3 bread 45" (quantity, item, amount) and returns intent {sale, 4500 cents, "bread", 3}.

2. The reader parses "sold bread 45" (item, amount) and returns {sale, 4500 cents, "bread"} with no quantity.

3. The reader parses "sale 45" (amount only) and returns {sale, 4500 cents} with no item.

4. The reader parses "45 bread" (amount, item) and returns {sale, 4500 cents, "bread"}.

5. The reader parses "sold 3 bread at 15" (quantity, item, unit price) and returns {sale, 4500 cents, "bread", 3}.

6. The reader parses "3 bread @15" (quantity, item, @unit price) and returns {sale, 4500 cents, "bread", 3}.

7. The reader parses "3 bread x15" (quantity, item, x unit price) and returns {sale, 4500 cents, "bread", 3}.

8. The reader parses "spent 120 transport" (expense, amount, item) and returns {expense, 12000 cents, "transport"}.

9. The reader parses "spend 120 on transport" (spend, amount, on, item) and returns {expense, 12000 cents, "transport"}.

10. The reader parses "expense 120 stock" and returns {expense, 12000 cents, "stock"}.

11. The reader parses "bought stock 500" (bought, item, amount) and returns {expense, 50000 cents, "stock"}.

12. The reader parses "paid 150 rent" (paid, amount, item, no customer name) and returns {expense, 15000 cents, "rent"}.

13. The reader parses "Tendai owes 20 sugar" (customer, owes, amount, item) and returns {debt, customer: "Tendai", 2000 cents, "sugar"}.

14. The reader parses "Tendai owes 20" (customer, owes, amount, no item) and returns {debt, customer: "Tendai", 2000 cents}.

15. The reader parses "credit Tendai 20 sugar" (credit, customer, amount, item) and returns {debt, customer: "Tendai", 2000 cents, "sugar"}.

16. The reader parses "Tendai took 20 on credit" and returns {debt, customer: "Tendai", 2000 cents}.

17. The reader parses "Tendai paid 10" (customer, paid, amount) and returns {payment, customer: "Tendai", 1000 cents}.

18. The reader parses "Tendai paid back 10" (customer, paid back, amount) and returns {payment, customer: "Tendai", 1000 cents}.

19. The reader parses "received 10 from Tendai" (received, amount, from, customer) and returns {payment, customer: "Tendai", 1000 cents}.

20. The reader parses "undo", "cancel", "oops" (case-insensitive, extra spaces) and returns {undo}.

21. The reader parses "today", "sales", "total" (case-insensitive) and returns {today}.

22. The reader parses "who owes", "debts", "owes", "owes 2" (page number) and returns {whoOwes, page: 1} or {whoOwes, page: 2}.

23. The reader parses "how much does Tendai owe", "Tendai?" and returns {balance, customer: "Tendai"}.

24. The reader parses "close", "summary", "end of day" and returns {close}.

25. The reader parses "help", "?", "menu" and returns {help}.

26. When text does not match any rule, the reader returns {unknown}.

27. When the owner types "sold 2 200" (ambiguous: 2 items at 200 or amount 2,200), a pending question is saved and the reply asks "Did you mean 1) R200 for 2 or 2) R2,200? Reply 1 or 2."

28. When the owner replies "1" or "2" to a pending question within 10 minutes, the answer resolves the ambiguity and processes the sale normally; any other message clears the pending question.

29. When a pending question expires (over 10 minutes), it is cleared and the next message is read normally.

30. When an amount is over 1,000,000.00 (100,000,000 cents), the reply asks "Reply yes to save sale R1,500,000." and waits for a yes/no confirmation.

31. A reply for a successful sale says "Saved: sale R45 (3 bread). Sales today R1,285. Reply undo to cancel." with amount, optional quantity and item, new sales total and count.

32. A reply for a successful expense says "Saved: spent R120 (transport). Spent today R300." with amount, optional item, new expense total.

33. A reply for a successful debt says "Saved: Tendai owes R20 (sugar). Tendai owes R50 in total." with customer, amount, optional item, customer's total debt.

34. A reply for a successful payment says "Saved: Tendai paid R10. Tendai owes R40 now." or "Saved: Tendai paid R10. Tendai has R5 credit now." when customer balance goes negative.

35. A reply for undo when there is a reversible record says "Undone: sale R45 (bread). Sales today R1,240." with what was undone and the new figure.

36. A reply for undo when there is nothing to undo says "Nothing to undo."

37. A today reply says "Today: sales R1,240 (12), spent R300, in hand R940." with totals and in-hand (sales + payments received - expenses).

38. A who owes reply when customers have debts says "Owes: Tendai R50, Rudo R30, ..." sorted by amount descending, ending "+3 more. Reply owes 2" when not all fit, or "Nobody owes you money." when empty.

39. A balance reply for a customer says "Tendai owes R40." or "Tendai has R5 credit." when negative.

40. A close reply says "Close Mon 3 Nov: sales R1,240 (12), spent R300, in hand R940, credit given R70, paid back R40, total owed R380." with day name, date, and totals.

41. A help and unknown reply says "Sorry, I did not get that. Try: sold 45 bread, spent 20 taxi, Tendai owes 30, today, who owes."

42. All replies are at most 160 characters and contain only plain ASCII (no emoji, curly quotes, em dashes, non-ASCII currency signs).

43. When a reply would exceed 160 characters, the sender drops the least useful part first: the hint (e.g., "Reply undo to cancel"), then the item name, in that order.

44. An unknown phone number (not in the shop ledger) receives "Welcome to the Imali AI shop ledger. Reply with your shop name to start."

45. The next message from an unknown phone number becomes the shop name (trimmed to max 24 characters), the shop is created with currency ZAR and time zone Africa/Johannesburg, and the reply is "Thandi's Spaza is ready. Try: sold 45 bread." (using the owner's shop name).

46. When the rule reader returns unknown and a language model reader is passed in, the handler calls the reader with the message text and waits for a Proposal or null.

47. When the model proposes an intent, the handler verifies that each substring in the Proposal (for amount and customer) occurs in the owner's message and parses correctly; if all checks pass, the intent is used; otherwise the unknown reply is sent.

48. The Gemini API reader (when GEMINI_API_KEY is set) calls the REST endpoint only once per message, with a 4-second timeout, and returns null on timeout or error.

49. All tests use a fake model reader; no test makes a network call to Gemini.

50. Every test checks that every reply is at most 160 characters and contains only ASCII characters.

51. The reader parses "sold 45 bread" (sold, amount, item) and returns {sale, 4500 cents, "bread"} with no quantity, so the example in the help reply (requirement 41) records what it says; "sold 45 bread and milk" keeps "bread and milk" as the item, "sold 45" has no item, and requirements 1 to 12 read as before.

52. When the owner types a sale as two plain numbers and then the item, with no word between the numbers and no
    amount after the item ("sold 45 3 bread"), the reader returns an ambiguous intent with both amounts, the first
    number as the money with the second as the count and the other way round (R45 for 3, R3 for 45), the same way
    "sold 2 200" asks (requirement 27), and never saves R3 with the item "45". A number written with a currency sign
    or decimals is never offered as a count. Every shape in requirement 51 and requirements 1 to 12 reads as before.
