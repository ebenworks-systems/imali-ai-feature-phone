# SMS Channel Implementation Tasks

## Core Reader Module

- [ ] Create `src/channels/sms/reader.ts` with Intent types and readIntent(text, currency) function; parse all sale shapes (requirements 1–7) and return SaleIntent with correct cents, item, quantity.

- [ ] Add expense patterns to readIntent() covering spent, spend, expense, bought, paid-as-expense shapes (requirements 8–12); return ExpenseIntent.

- [ ] Add debt patterns (owes, credit, took...on credit) to readIntent() (requirements 13–16); return DebtIntent with customer and optional item.

- [ ] Add payment patterns (customer paid, paid back, received from) to readIntent() (requirements 17–19); return PaymentIntent with customer.

- [ ] Add action patterns to readIntent(): undo/cancel/oops, today/sales/total, close/summary/end of day, help/?/menu (requirements 20–25); return SimpleIntent for each.

- [ ] Add who owes parsing to readIntent() supporting "who owes", "debts", "owes", "owes 2" (page number); return WhoOwesIntent with page (requirement 22).

- [ ] Add balance query parsing to readIntent() for "how much does Tendai owe" and "Tendai?"; return BalanceIntent with customer name (requirement 23).

- [ ] Update readIntent() to return {unknown} for unmatched text (requirement 26); write unit tests covering all patterns (requirements 1–26).

## Pending Store Module

- [ ] Create `src/channels/sms/pending.ts` with PendingStore interface, PendingQuestion type supporting 'ambiguous' and 'largeAmount' kinds.

- [ ] Implement InMemoryPendingStore with get(), set(), clear() methods and 10-minute TTL expiry (requirement 29); cleanup expired entries on get().

- [ ] Write unit tests for InMemoryPendingStore: set/get/clear, expiry detection, cleanup (test/channels/sms/pending.test.ts).

## Replies Module

- [ ] Create `src/channels/sms/replies.ts` with ReplyContext type and buildReply(context, maxLength?) function.

- [ ] Implement sale reply building: "Saved: sale R45 (3 bread). Sales today R1,285. Reply undo to cancel." (requirement 31); handle optional quantity and item trimming if needed.

- [ ] Implement expense reply building: "Saved: spent R120 (transport). Spent today R300." (requirement 32); handle optional item.

- [ ] Implement debt reply building: "Saved: Tendai owes R20 (sugar). Tendai owes R50 in total." (requirement 33); handle optional item.

- [ ] Implement payment reply building for normal and credit cases: "Saved: Tendai paid R10. Tendai owes R40 now." and credit variant (requirement 34).

- [ ] Implement undo reply building: "Undone: sale R45 (bread). Sales today R1,240." for successful undo and "Nothing to undo." for no reversible record (requirement 35–36).

- [ ] Implement today reply: "Today: sales R1,240 (12), spent R300, in hand R940." with totals (requirement 37).

- [ ] Implement who owes reply: "Owes: Tendai R50, Rudo R30, ..." sorted descending, "+N more. Reply owes 2" when needed, "Nobody owes you money." when empty (requirement 38).

- [ ] Implement balance reply: "Tendai owes R40." or "Tendai has R5 credit." when negative (requirement 39).

- [ ] Implement close reply: "Close Mon 3 Nov: sales R1,240 (12), spent R300, in hand R940, credit given R70, paid back R40, total owed R380." with day name and date (requirement 40).

- [ ] Implement help and unknown reply: "Sorry, I did not get that. Try: sold 45 bread, spent 20 taxi, Tendai owes 30, today, who owes." (requirement 41).

- [ ] Add trimming logic to buildReply(): drop hint first, then item, to stay within 160 characters (requirement 43); validate all replies are ASCII only (requirement 42).

- [ ] Write unit tests for buildReply() covering all operation types with exact wording, character limits, and ASCII validation (test/channels/sms/replies.test.ts).

## Model Reader Module

- [ ] Create `src/ai/reader.ts` with Proposal type (intent, amountSubstring, customerSubstring) and ModelReader interface.

- [ ] Implement GeminiReader class calling Gemini REST API with fetch, 4-second timeout; return Proposal or null (requirement 48).

- [ ] Add validation logic in GeminiReader: verify amount and customer substrings occur in the message and parse with parseAmount() (requirement 47).

- [ ] Write integration tests for GeminiReader with fake fetch mock covering success, timeout, and error cases (test/channels/sms/gemini.test.ts); ensure no real network calls (requirement 49).

## Handler Module

- [ ] Create `src/channels/sms/handler.ts` with HandleTextParams and HandleTextResult types.

- [ ] Implement handleText() entry point: call readIntent() on the input (requirement 26); handle unknown phone numbers by creating a new shop with name from message, ZAR currency, Africa/Johannesburg time zone (requirements 44–45).

- [ ] Add ambiguous-amount handling: when parseAmount returns ambiguous, store a PendingQuestion and return ambiguity reply "Did you mean 1) R200 for 2 or 2) R2,200? Reply 1 or 2." (requirement 27).

- [ ] Add large-amount handling: when parseAmount returns requiresConfirmation, store a PendingQuestion and ask "Reply yes to save sale R1,500,000." (requirement 30).

- [ ] Add pending-question resolution: check for pending questions in PendingStore; if pending exists and reply is "1" or "2" (ambiguous) or "yes" (large amount), resolve and process the intent (requirement 28).

- [ ] Clear pending question on non-matching reply, expiry, or successful operation (requirement 28).

- [ ] When readIntent() returns unknown and a ModelReader is passed, call reader.read() and validate the proposal (requirements 46–47).

- [ ] Add operation dispatch: process the resolved intent by calling ledger operations (recordSale, recordExpense, recordDebt, recordPayment, undoLastRecord) from src/core/index.ts and query methods (getTodaySummary, getWhoOwes, getCustomerBalance, getDayCloseSummary) to build reply context.

- [ ] Call buildReply() with the operation result context to produce the reply message (requirements 31–41).

- [ ] Write integration tests driving multi-message conversations covering new shop sign-up, ambiguous/large-amount questions, each intent type, undo, queries, close, and unknown messages (test/channels/sms/handler.test.ts).

- [ ] Add ASCII and 160-character validation to all test assertions (requirements 42, 50).

## Integration and Verification

- [ ] Run `npm test` to verify all SMS tests pass, including unit tests for reader, replies, pending store, and integration tests for handler and model reader.

- [ ] Verify no test makes a network call; use fake model reader in test suite (requirement 49).

- [ ] Check that all replies pass ASCII and 160-character limits in test suite (requirements 42, 50).

- [ ] Document the SMS module in src/channels/index.ts, exporting handleText and public types.
