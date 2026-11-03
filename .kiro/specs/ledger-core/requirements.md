# Ledger Core - Requirements

## Scope
Pure TypeScript implementation of the ledger's core business logic in `src/core/` and the `LedgerStore` interface plus the in-memory store in `src/store/`. No HTTP, no USSD or SMS wording, no database, no model calls.

## Acceptance Criteria (EARS Notation)

### 1. Money Parsing

1.1 **WHEN** the owner types an amount  
**THE SYSTEM SHALL** parse it into integer cents, supporting all forms:
- `45`, `R45`, `45.00`, `45,50`, `1,200`, `1 200`, `R1 200.50`
- A comma followed by exactly one or two digits at the end of the number is a decimal comma (`45,50` = 4550 cents)
- A comma or space followed by exactly three digits is a thousands separator (`1,200` = 120000 cents, `1 200` = 120000 cents)
- Currency symbols: ZAR (`R`), USD (`$`), KES (`KSh`), NGN (`N`), GHS (`GHS`), ZMW (`K`), BWP (`P`)

1.2 **WHEN** the typed amount could honestly mean two different amounts (e.g., `sold 2 200` could be 2 items for 200 each or 1 sale of 2,200)  
**THE SYSTEM SHALL** return an "ask the owner" result, never guess

1.3 **WHEN** parsing any amount  
**THE SYSTEM SHALL** check that the resulting integer is a safe integer (`Number.isSafeInteger`)

### 2. Money Formatting

2.1 **WHEN** formatting cents for display  
**THE SYSTEM SHALL** produce:
- `R45` when cents are zero
- `R45.50` when cents are non-zero  
- `R1,240` with thousands comma (comma always, no locale dependency)
- Plain ASCII only (no emoji, curly quotes, em dashes)
- Correct currency symbols (ASCII: `R`, `$`, `KSh`, `N`, `GHS`, `K`, `P`)

### 3. Shop Management

3.1 **WHEN** creating a shop  
**THE SYSTEM SHALL** store:
- Unique ID
- Name (max 24 characters for display)
- Owner's phone number
- Currency (one of: ZAR, USD, KES, NGN, GHS, ZMW, BWP)
- Time zone (default `Africa/Johannesburg`)
- Created timestamp as UTC ISO 8601 string

### 4. Record Creation

4.1 **WHEN** recording a sale  
**THE SYSTEM SHALL**:
- Create a `sale` record with amount in cents, optional item, channel, original words, UTC ISO 8601 timestamp string
- Return the saved record and a figure object with kind 'salesToday' and the cents amount

4.2 **WHEN** recording an expense  
**THE SYSTEM SHALL**:
- Create an `expense` record with amount in cents, optional item, channel, original words, UTC ISO 8601 timestamp string
- Return the saved record and a figure object with kind 'expensesToday' and the cents amount

4.3 **WHEN** recording a debt (customer owes)  
**THE SYSTEM SHALL**:
- Create a `debt` record with amount in cents, customer display name, customer match key (lowercase, trimmed), optional item, channel, original words, UTC ISO 8601 timestamp string
- Return the saved record and a figure object with kind 'customerBalance', the cents amount, and customer name

4.4 **WHEN** recording a payment (customer pays back)  
**THE SYSTEM SHALL**:
- Create a `payment` record with amount in cents, customer display name, customer match key (lowercase, trimmed), optional item, channel, original words, UTC ISO 8601 timestamp string
- Return the saved record and a figure object with kind 'customerBalance', the cents amount (may be negative for credit), and customer name

4.5 **WHEN** any record is created  
**THE SYSTEM SHALL**:
- Validate amount > 0
- For amounts > 1,000,000.00 (100,000,000 cents), require confirmation (return "needs confirmation")
- Store amount as safe integer
- Generate unique record ID
- Store UTC ISO 8601 timestamp string

### 5. Customer Name Handling

5.1 **WHEN** processing a customer name  
**THE SYSTEM SHALL**:
- Generate a display name: trimmed, inner runs of spaces collapsed to one
- Generate a match key: display name lowercased
- Store both display name and match key in debt/payment records

5.2 **WHEN** matching customer names  
**THE SYSTEM SHALL** use the match key (lowercased name) for equality, but show the display name in screens and replies

### 6. Undo Operation

6.1 **WHEN** undoing the last record  
**THE SYSTEM SHALL**:
- Find the most recent record that is not already reversed and is not itself a reversal
- Create a `reversal` record that points to the original record
- Return the reversal record, which original record was reversed (kind, amount, item/customer), and the corrected figures

6.2 **WHEN** there is nothing to undo (no records, or all records are already reversed or are reversals)  
**THE SYSTEM SHALL** return an appropriate error

6.3 **WHEN** attempting to undo a record that is already reversed  
**THE SYSTEM SHALL** return an error (a record can be reversed once)

### 7. Record Validation

7.1 **WHEN** validating a record amount  
**THE SYSTEM SHALL**:
- Reject zero or negative amounts with a plain reason
- Flag amounts > 1,000,000.00 as needing confirmation (cents > 100,000,000)
- Check amount is a safe integer

### 8. Queries

8.1 **WHEN** querying today's totals for a shop  
**THE SYSTEM SHALL**:
- Use the shop's time zone to determine "today"
- Compute from records in the store, not via store query methods
- Return sales total and count, expenses total, money in hand (sales + payments - expenses)
- Return new debts given today, payments received today
- Return total all customers still owe

8.2 **WHEN** querying who owes what  
**THE SYSTEM SHALL**:
- Return customers with positive balances (greater than zero) only
- Customers with zero or credit balances (negative) excluded
- Sort by amount, largest first
- Return customer display name and balance for each

8.3 **WHEN** querying one customer's balance  
**THE SYSTEM SHALL**:
- Return sum of their debt records minus payment records
- Ignore reversed records
- Handle case-insensitive name matching using match keys

### 9. Day Boundary Handling

9.1 **WHEN** computing "today"  
**THE SYSTEM SHALL**:
- Use the shop's time zone (default `Africa/Johannesburg`)
- Handle daylight saving time changes correctly
- Use `Intl` APIs, no external date library
- Accept an explicit `now: Date` parameter instead of reading system clock in core logic

### 10. Time Dependency Injection

10.1 **WHEN** any ledger operation requires the current time  
**THE SYSTEM SHALL** accept a `now: Date` parameter (or Clock passed in context object) instead of reading the system clock inside core

10.2 **WHEN** tests need to control time  
**THE SYSTEM SHALL** use a mockable time source via dependency injection

### 11. Export Format

11.1 **WHEN** exporting a shop and its records  
**THE SYSTEM SHALL** produce JSON with:
- `"format": "imali-ai-ledger-export"`
- `"version": 1`
- Shop details (id, name, phone, currency, time zone, createdAt)
- All records in chronological order (order they were made)
- Include reversal records in the export
- Every field documented in `docs/export-format.md`

### 12. LedgerStore Interface

12.1 **WHEN** implementing the data store interface  
**THE SYSTEM SHALL** provide async methods for:
- Shop operations: createShop, findShopById, findShopByPhone
- Record operations: appendRecord, findRecordById, findReversalOf(recordId)
- Record listing: listRecords(shopId, { since?: string })

12.2 **WHEN** implementing the in-memory store  
**THE SYSTEM SHALL**:
- Implement the minimal LedgerStore interface without business logic
- Store data only in memory (no persistence)
- Be suitable for tests and local runs

12.3 **WHEN** storing records  
**THE SYSTEM SHALL** enforce "reversed once" constraint with unique index on reversed record id
- appendRecord for a second reversal of the same record must fail with typed error

12.4 **WHEN** query operations are needed  
**THE SYSTEM SHALL** compute them in src/core from listed records, not implement getTodaySummary, getCustomerBalances, getCustomerTransactions or getLatestRecord in the store

### 13. Closing Summary

13.1 **WHEN** getting day close summary  
**THE SYSTEM SHALL** default to TODAY in the shop's time zone, not yesterday

13.2 **WHEN** owner closes the day in the evening  
**THE SYSTEM SHALL** show today's totals, not yesterday's

### 14. Operation Results

14.1 **WHEN** any operation returns a figure  
**THE SYSTEM SHALL** return it as data, not text: `{ kind: 'salesToday' | 'expensesToday' | 'customerBalance'; cents: number; customer?: string }`

14.2 **WHEN** formatting for display  
**THE SYSTEM SHALL** be the channel's job (USSD/SMS/web), not core's

### 15. Error Handling

15.1 **WHEN** any operation fails due to owner mistake (invalid amount, etc.)  
**THE SYSTEM SHALL** return typed results, not throw errors

15.2 **WHEN** any operation fails due to system error  
**THE SYSTEM SHALL** throw appropriate errors

### 16. Type Safety

16.1 **WHEN** writing TypeScript code  
**THE SYSTEM SHALL**:
- Use strict mode
- Avoid `any` without a comment saying why
- Provide complete type definitions for all public interfaces
- Use `string` for timestamps (UTC ISO 8601) in types, not `Date`, for consistent export/stores/tests

## Non-Functional Requirements
1. **Performance**: All core operations should be O(1) or O(n) with reasonable n
2. **Memory**: In-memory store should handle at least 10,000 records per shop
3. **Testability**: Every module in `src/core` must have unit tests
4. **Property Tests**: Use fast-check for parse/format round trips and balance invariance tests
5. **No Dependencies**: Core should have minimal dependencies (no HTTP, no database drivers)
6. **Currency Support**: All 7 currencies must be properly supported with 2 decimal places
7. **Time Zone Support**: Must handle shop's local time zone correctly using Intl APIs