# Ledger Core - Tasks

## Project Setup
- [x] 1. **Initialize project structure**
  - Files: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`
  - Criteria: 16.1
  - Create basic project structure with TypeScript strict mode, ES modules
  - Add scripts: `build`, `typecheck`, `test`, `check:screens` (placeholder)

- [x] 2. **Configure testing framework**
  - Files: `package.json`, `vitest.config.ts`
  - Criteria: NF3 (Testability)
  - Set up Vitest with TypeScript support
  - Configure coverage reporting
  - Add fast-check as dev dependency for property testing

- [x] 3. **Set up development environment**
  - Files: `.gitignore`, `.env.example`
  - Criteria: Tech stack setup
  - Configure git to ignore `node_modules`, `dist`, `.env` files
  - Create `.env.example` with empty environment variable placeholders

## Core Money Module
- [x] 4. **Implement currency types and info**
  - Files: `src/core/money/currency.ts`
  - Criteria: 2.1, NF6
  - Define `Currency` type and `CurrencyInfo` interface (no thousandsSeparator field)
  - Implement `getCurrencyInfo()` for all 7 currencies
  - Test currency symbol mapping (ASCII only)

- [x] 5. **Implement amount parsing**
  - Files: `src/core/money/parse.ts`, `test/core/money/parse.test.ts`
  - Criteria: 1.1, 1.2, 1.3, 7.1
  - Implement `parseAmount()` supporting all input forms
  - Handle decimal commas (`45,50`), thousands separators (`1,200`, `1 200`)
  - Implement ambiguous case detection (e.g., `2 200`)
  - Add unit tests for all parsing scenarios
  - Implement `requiresConfirmation(cents)` checking cents > 100,000,000

- [x] 6. **Implement amount formatting**
  - Files: `src/core/money/format.ts`, `test/core/money/format.test.ts`
  - Criteria: 2.1
  - Implement `formatCents()` with proper formatting rules
  - Show `R45` when cents zero, `R45.50` when non-zero
  - Add thousands comma formatting (comma always, no locale dependency)
  - Test all currency symbols and edge cases

- [x] 7. **Add property tests for money operations**
  - Files: `test/core/money/property.test.ts`
  - Criteria: NF4
  - Implement fast-check property tests for parse/format round trips
  - Test parse ambiguity detection properties

## Time Abstraction
- [x] 8. **Implement clock abstraction**
  - Files: `src/core/clock.ts`, `test/core/clock.test.ts`
  - Criteria: 10.1, 10.2
  - Define `Clock` interface with `now()` method
  - Implement `systemClock` using `new Date()`
  - Test mockable clock for tests

## Shop and Record Types
- [x] 9. **Define shop type and validation**
  - Files: `src/core/shops/types.ts`, `test/core/shops/types.test.ts`
  - Criteria: 3.1, 16.1
  - Define `Shop` interface with `createdAt` as string (UTC ISO 8601)
  - Implement `createShop()` factory function
  - Add validation for shop name (≤24 characters)
  - Test shop creation and validation

- [x] 10. **Define record types and factories**
  - Files: `src/core/records/types.ts`, `test/core/records/types.test.ts`
  - Criteria: 4.1, 4.2, 4.3, 4.4, 5.1, 16.1
  - Define all record types with `createdAt` as string (UTC ISO 8601)
  - Implement factory functions for each record type
  - Add `isReversible()` and `createReversal()` functions
  - Implement `customerDisplayName()` and `customerKey()` functions
  - Debt/payment records store both `customerDisplayName` and `customerKey`

- [x] 11. **Implement record validation**
  - Files: `src/core/records/validation.ts`, `test/core/records/validation.test.ts`
  - Criteria: 4.5, 7.1
  - Validate amount > 0, reject zero/negative amounts
  - Check `Number.isSafeInteger()` for all amounts
  - Test amount validation with correct confirmation threshold (100,000,000 cents)

## LedgerStore Interface
- [x] 12. **Define minimal LedgerStore interface**
  - Files: `src/store/interface.ts`
  - Criteria: 12.1, 12.4
  - Define async interface with minimal methods: createShop, findShopById, findShopByPhone, appendRecord, findRecordById, findReversalOf, listRecords
  - Define `RecordAlreadyReversedError` class
  - No business logic methods (getTodaySummary, getCustomerBalances, etc.)

- [x] 13. **Implement in-memory store**
  - Files: `src/store/memory/store.ts`, `test/store/memory/store.test.ts`
  - Criteria: 12.2, 12.3
  - Implement minimal LedgerStore interface with in-memory data structures
  - Enforce "reversed once" with unique index simulation
  - Throw `RecordAlreadyReversedError` for second reversal of same record
  - Test store operations and error cases

## Time Zone Handling
- [x] 14. **Implement time zone utilities with time injection**
  - Files: `src/core/timezone/utils.ts`, `test/core/timezone/utils.test.ts`
  - Criteria: 8.1, 9.1, 13.1, NF7
  - Implement `getShopLocalDate(shop, date)` using Intl.DateTimeFormat
  - Implement `getShopDayBounds()` for UTC conversion
  - Implement `isTodayInShopTimeZone(shop, timestamp, now)`
  - Handle default time zone `Africa/Johannesburg`
  - Test day boundary calculations with different time zones
  - All functions accept explicit `now` parameter

## Business Logic Operations
- [x] 15. **Implement sale recording**
  - Files: `src/core/ledger/operations.ts`, `test/core/ledger/operations.test.ts`
  - Criteria: 4.1, 4.5, 14.1, 15.1
  - Implement `recordSale()` with proper error handling and time injection
  - Return `OperationResult` with record and figure object (kind: 'salesToday')
  - Handle confirmation requirement for large amounts (> 100,000,000 cents)
  - Test all success and error scenarios

- [x] 16. **Implement expense recording**
  - Files: `src/core/ledger/operations.ts`
  - Criteria: 4.2, 4.5, 14.1, 15.1
  - Implement `recordExpense()` following same pattern with time injection
  - Return figure object (kind: 'expensesToday')
  - Test expense recording

- [x] 17. **Implement debt and payment recording**
  - Files: `src/core/ledger/operations.ts`
  - Criteria: 4.3, 4.4, 4.5, 5.1, 5.2, 14.1, 15.1
  - Implement `recordDebt()` and `recordPayment()` with time injection
  - Handle customer name processing (displayName and key)
  - Return figure object (kind: 'customerBalance' with customer)
  - Test customer matching using keys and display name preservation

- [x] 18. **Implement undo operation**
  - Files: `src/core/ledger/operations.ts`
  - Criteria: 6.1, 6.2, 6.3, 12.3, 14.1, 15.1, 15.2
  - Implement `undoLastRecord()` finding most recent reversible record
  - Create reversal record pointing to original
  - Return `UndoResult` with which record was reversed (kind, amount, item/customer)
  - Handle `RecordAlreadyReversedError` from store, convert to owner error
  - Test undo scenarios and edge cases

## Query Operations
- [x] 19. **Implement today's summary query from records**
  - Files: `src/core/queries/today.ts`, `test/core/queries/today.test.ts`
  - Criteria: 8.1, 12.4
  - Implement `getTodaySummary()` using shop's time zone and time injection
  - Compute from `listRecords()` results, not store query methods
  - Calculate sales total/count, expenses, money in hand
  - Calculate new debts and payments for today
  - Test with different time zones and day boundaries

- [x] 20. **Implement customer balance queries from records**
  - Files: `src/core/queries/customers.ts`, `test/core/queries/customers.test.ts`
  - Criteria: 8.2, 8.3, 12.4
  - Implement `getWhoOwes()` from records, sorted by amount (largest first)
  - Return only customers with positive balances (greater than zero)
  - Exclude customers with zero or credit balances (negative)
  - Implement `getCustomerBalance()` with name normalization using keys
  - Test balance calculations with multiple transactions

- [x] 21. **Implement day close summary**
  - Files: `src/core/queries/dayClose.ts`, `test/core/queries/dayClose.test.ts`
  - Criteria: 13.1, 13.2
  - Implement `getDayCloseSummary()` extending today's summary
  - Add date field in shop's local time zone
  - Defaults to TODAY in shop's time zone, not yesterday
  - Test closing summary calculations for today

## Export Functionality
- [x] 22. **Implement export data generation**
  - Files: `src/core/export/generator.ts`, `test/core/export/generator.test.ts`
  - Criteria: 11.1
  - Implement `generateExport()` with correct JSON structure
  - Include `format: "imali-ai-ledger-export"` and `version: 1`
  - Export all shop data and records in chronological order (order they were made)
  - Include reversal records in the export
  - Use string timestamps (UTC ISO 8601) consistently
  - Test export generation with sample data including reversals

- [x] 23. **Create export format documentation**
  - Files: `docs/export-format.md`
  - Criteria: 11.1
  - Document every field in the export JSON format
  - Include examples and schema definition
  - Document versioning strategy
  - Note that records include reversals and are in chronological order

## Integration and Property Testing
- [x] 24. **Add comprehensive property tests**
  - Files: `test/core/property.test.ts`
  - Criteria: NF4
  - Implement property test for "balance unchanged after record and reversal"
  - Test customer name normalization properties
  - Test ledger operation invariants
  - Test time zone calculation properties
  - Test "who owes" excludes zero and credit balances

- [x] 25. **Add integration tests for core flows**
  - Files: `test/integration/core.test.ts`
  - Criteria: NF3
  - Test complete flows: record → query → undo → query
  - Test day boundary scenarios with time injection
  - Test export generation workflow including reversals
  - Test customer name display/key separation
  - Test undo returns which record was reversed

## Finalization
- [x] 26. **Create public API index**
  - Files: `src/core/index.ts`
  - Criteria: 16.1
  - Export all public functions and types
  - Add comprehensive documentation
  - Ensure no internal implementation details are exposed

- [x] 27. **Set up build and type checking**
  - Files: `package.json` scripts
  - Criteria: Build process
  - Configure TypeScript compilation to `dist/`
  - Add `typecheck` script for CI
  - Test build process works correctly

- [x] 28. **Add check:screens placeholder**
  - Files: `package.json`
  - Criteria: Screen validation placeholder
  - Add `check:screens` script that echoes "Not implemented yet"
  - This will be implemented in a later spec for USSD/SMS channels

- [x] 29. **Verify all requirements are met**
  - Review all tasks against acceptance criteria
  - Run full test suite: `npm test`
  - Run type checking: `npm run typecheck`
  - Test build: `npm run build`
  - Verify no linting errors (if linter added later)

## Fixes

- [x] 30. **Make the day bounds exact to the millisecond**
  - Files: `src/core/timezone/utils.ts`, `test/core/timezone/utils.test.ts`
  - Criteria: 9.2
  - `getShopDayBounds` stopped its search at 1 second and returned the late side, so the start of the day could be up to 1 second late (0.4 s for a 1.4 s step) and a record in the first second of the day fell out of that day's figures. The search now runs to 1 ms, and the end is the start of the next local day.
  - Tests at 00:00:00.000 and 23:59:59.999 local time for all six supported zones, plus one millisecond either side.

## Success Criteria
1. All 29 tasks completed and checked with correct criteria references
2. All unit tests pass (100% coverage for core modules)
3. Property tests validate key invariants including customer name handling
4. TypeScript compilation with strict mode passes, string timestamps used consistently
5. Export format documented in `docs/export-format.md`, includes reversals in chronological order
6. In-memory store implements minimal LedgerStore interface without business logic
7. All money parsing/formatting rules implemented with correct confirmation threshold (100,000,000 cents)
8. Customer names handled with display name and match key separation
9. Time injection implemented for all time-dependent operations
10. "Who owes" excludes customers with zero or credit balances
11. Undo returns which record was reversed (kind, amount, item/customer)
12. Day close summary defaults to TODAY, not yesterday
13. All error cases handled with typed results (no thrown errors for owner mistakes)