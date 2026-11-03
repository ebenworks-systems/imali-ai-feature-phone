# Ledger Core - Design

## Architecture Overview

The ledger core is organized into pure TypeScript modules with no I/O dependencies. All storage is abstracted behind the `LedgerStore` interface.

```
src/core/
├── clock.ts        # Time source abstraction (systemClock, mockable)
├── money/          # Amount parsing and formatting
├── shops/          # Shop type and validation
├── records/        # Record types and validation
├── ledger/         # Business logic operations
├── queries/        # Query operations (today, who owes, etc.)
├── export/         # Export format generation
└── index.ts        # Public API

src/store/
├── interface.ts    # LedgerStore interface
└── memory/         # In-memory implementation
```

## Type Definitions

### Money Types
```typescript
type Currency = 'ZAR' | 'USD' | 'KES' | 'NGN' | 'GHS' | 'ZMW' | 'BWP';

interface CurrencyInfo {
  symbol: string;      // ASCII symbol: 'R', '$', 'KSh', 'N', 'GHS', 'K', 'P'
  decimals: 2;
  // Thousands separator is always comma, no locale dependency
}

interface ParsedAmount {
  cents: number;       // Integer number of minor units
  requiresConfirmation: boolean;  // true if cents > 100,000,000
}

type ParseResult = 
  | { type: 'success'; amount: ParsedAmount }
  | { type: 'ambiguous'; possibleAmounts: ParsedAmount[] }
  | { type: 'error'; reason: string };
```

### Shop Type
```typescript
interface Shop {
  id: string;
  name: string;          // Max 24 characters
  phone: string;         // E.164 format
  currency: Currency;
  timeZone: string;      // IANA time zone, default 'Africa/Johannesburg'
  createdAt: string;     // UTC ISO 8601 string
}
```

### Record Types
```typescript
type RecordKind = 'sale' | 'expense' | 'debt' | 'payment' | 'reversal';
type Channel = 'ussd' | 'sms' | 'web';

interface BaseRecord {
  id: string;
  shopId: string;
  kind: RecordKind;
  amount: number;        // Integer cents
  createdAt: string;     // UTC ISO 8601 string
  channel: Channel;
  originalWords: string; // What the owner typed
}

interface SaleRecord extends BaseRecord {
  kind: 'sale';
  item?: string;         // Optional description
}

interface ExpenseRecord extends BaseRecord {
  kind: 'expense';
  item?: string;
}

interface DebtRecord extends BaseRecord {
  kind: 'debt';
  customerDisplayName: string;  // Trimmed, inner spaces collapsed to one
  customerKey: string;          // Lowercased for matching
  item?: string;
}

interface PaymentRecord extends BaseRecord {
  kind: 'payment';
  customerDisplayName: string;  // Trimmed, inner spaces collapsed to one
  customerKey: string;          // Lowercased for matching
  item?: string;
}

interface ReversalRecord extends BaseRecord {
  kind: 'reversal';
  reversesRecordId: string;
}

type Record = SaleRecord | ExpenseRecord | DebtRecord | PaymentRecord | ReversalRecord;
```

### Figure Types for Operation Results
```typescript
type FigureKind = 'salesToday' | 'expensesToday' | 'customerBalance';

interface Figure {
  kind: FigureKind;
  cents: number;
  customer?: string;  // For customerBalance
}

interface OperationSuccess<T> {
  success: true;
  data: T;
  figure: Figure;     // Figure data, not formatted text
}

interface OperationError {
  success: false;
  error: string;      // Plain reason for owner
}

type OperationResult<T> = OperationSuccess<T> | OperationError;

// For operations that need confirmation
interface NeedsConfirmation {
  needsConfirmation: true;
  amount: ParsedAmount;
  reason: string;
}

type RecordResult = OperationResult<Record> | NeedsConfirmation;

// Undo result includes which record was reversed
interface UndoResult {
  reversal: ReversalRecord;
  reversedRecord: {
    kind: RecordKind;
    amount: number;
    item?: string;
    customer?: string;
  };
  figure: Figure;
}
```

### clock.ts (Time Abstraction)
```typescript
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date()
};
```

### money/parse.ts
```typescript
export function parseAmount(
  input: string,
  currency: Currency
): ParseResult;

export function requiresConfirmation(cents: number): boolean;  // cents > 100,000,000
export function isSafeInteger(cents: number): boolean;
```

### money/format.ts
```typescript
export function formatCents(
  cents: number,
  currency: Currency,
  options?: {
    alwaysShowDecimals?: boolean;
  }
): string;

export function getCurrencyInfo(currency: Currency): CurrencyInfo;
```

### shops/types.ts
```typescript
export function createShop(
  params: Omit<Shop, 'id' | 'createdAt'>
): Shop;

export function validateShopName(name: string): boolean; // ≤24 chars
export function normalizePhone(phone: string): string;
```

### records/types.ts
```typescript
export function createRecord<T extends RecordKind>(
  params: RecordCreationParams<T>
): Record;

export function isReversible(record: Record): boolean;
export function createReversal(
  record: Record,
  channel: Channel,
  originalWords: string,
  now: Date
): ReversalRecord;

// Customer name utilities
export function customerDisplayName(name: string): string;  // trimmed, inner spaces collapsed
export function customerKey(name: string): string;         // displayName lowercased
```

### ledger/operations.ts
```typescript
export async function recordSale(
  store: LedgerStore,
  shopId: string,
  params: {
    amount: ParsedAmount,
    item?: string,
    channel: Channel,
    originalWords: string,
    now: Date  // Time injected
  }
): Promise<RecordResult>;

export async function recordExpense(
  store: LedgerStore,
  shopId: string,
  params: {
    amount: ParsedAmount,
    item?: string,
    channel: Channel,
    originalWords: string,
    now: Date
  }
): Promise<RecordResult>;

export async function recordDebt(
  store: LedgerStore,
  shopId: string,
  params: {
    amount: ParsedAmount,
    customer: string,  // Owner's typed name
    item?: string,
    channel: Channel,
    originalWords: string,
    now: Date
  }
): Promise<RecordResult>;

export async function recordPayment(
  store: LedgerStore,
  shopId: string,
  params: {
    amount: ParsedAmount,
    customer: string,  // Owner's typed name
    item?: string,
    channel: Channel,
    originalWords: string,
    now: Date
  }
): Promise<RecordResult>;

export async function undoLastRecord(
  store: LedgerStore,
  shopId: string,
  params: {
    channel: Channel,
    originalWords: string,
    now: Date
  }
): Promise<OperationResult<UndoResult>>;
```

### queries/today.ts
```typescript
export interface TodaySummary {
  sales: {
    total: number;      // cents
    count: number;
  };
  expenses: {
    total: number;      // cents
  };
  moneyInHand: number;  // cents (sales + payments - expenses)
  newDebts: number;     // cents given today
  paymentsReceived: number; // cents received today
  totalOwed: number;    // cents all customers still owe (positive balances only)
}

export async function getTodaySummary(
  store: LedgerStore,
  shopId: string,
  now: Date  // Time injected
): Promise<TodaySummary>;
```

### queries/customers.ts
```typescript
export interface CustomerBalance {
  displayName: string;  // Original display name
  balance: number;      // cents (positive = owes, negative = credit)
}

export async function getWhoOwes(
  store: LedgerStore,
  shopId: string
): Promise<CustomerBalance[]>;  // Only customers with positive balance

export async function getCustomerBalance(
  store: LedgerStore,
  shopId: string,
  customerName: string  // Any form, will be normalized to key
): Promise<number>; // cents
```

### queries/dayClose.ts
```typescript
export interface DayCloseSummary extends TodaySummary {
  date: string;         // YYYY-MM-DD in shop's time zone
  shopId: string;
}

export async function getDayCloseSummary(
  store: LedgerStore,
  shopId: string,
  params: {
    date?: string,  // YYYY-MM-DD, defaults to TODAY in shop's time zone
    now: Date      // Time injected
  }
): Promise<DayCloseSummary>;
```

### export/generator.ts
```typescript
export interface ExportData {
  format: 'imali-ai-ledger-export';
  version: 1;
  exportedAt: string;   // ISO 8601 UTC
  shop: Shop;
  records: Record[];
}

export async function generateExport(
  store: LedgerStore,
  shopId: string
): Promise<ExportData>;
```

## LedgerStore Interface
```typescript
interface LedgerStore {
  // Shop operations (minimal)
  createShop(shop: Shop): Promise<void>;
  findShopById(id: string): Promise<Shop | null>;
  findShopByPhone(phone: string): Promise<Shop | null>;
  
  // Record operations (minimal, business logic kept in core)
  appendRecord(record: Record): Promise<void>;
  findRecordById(id: string): Promise<Record | null>;
  findReversalOf(recordId: string): Promise<ReversalRecord | null>;
  
  // Record listing (simple, for core to compute queries)
  listRecords(
    shopId: string,
    options?: {
      since?: string;  // UTC ISO 8601 timestamp
    }
  ): Promise<Record[]>;
}

// Store-specific errors
class RecordAlreadyReversedError extends Error {
  constructor(recordId: string) {
    super(`Record ${recordId} is already reversed`);
  }
}

// The store enforces "reversed once" via unique index on reversed record id
// appendRecord for a second reversal of the same record throws RecordAlreadyReversedError
```

## Time Zone Handling

### Day Computation with Time Injection
```typescript
function getShopLocalDate(shop: Shop, date: Date): string {
  // Use Intl.DateTimeFormat to convert UTC to shop's time zone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: shop.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date); // Returns YYYY-MM-DD
}

function getShopDayBounds(
  shop: Shop,
  date: string, // YYYY-MM-DD in shop's time zone
  timeZone: string = shop.timeZone
): { start: Date; end: Date } {
  // Convert shop's local date to UTC start and end
  // Using Intl.DateTimeFormat and Date.UTC
}

// All time-dependent functions accept explicit now parameter
function isTodayInShopTimeZone(shop: Shop, timestamp: string, now: Date): boolean {
  const recordDate = getShopLocalDate(shop, new Date(timestamp));
  const today = getShopLocalDate(shop, now);
  return recordDate === today;
}
```

## Error Handling Strategy

### Owner Mistakes
Use `OperationResult<T>` pattern for all owner-facing operations:
- `success: true` with data and figure object for successful operations
- `success: false` with plain error message for owner mistakes
- `needsConfirmation: true` for amounts > 1,000,000.00 (cents > 100,000,000)

### System Errors
Throw exceptions for:
- Store failures (connection issues, etc.)
- Invalid state (corrupted data)
- Programming errors (invalid arguments)
- `RecordAlreadyReversedError` from store when undoing already reversed record

### Undo Error Handling
```typescript
// When undo finds a record that's already reversed
// The store throws RecordAlreadyReversedError, which core catches
// and converts to OperationError with plain message for owner
```

## Testing Approach

### Unit Tests (Vitest)
- Every public function in `src/core/` has unit tests
- Test all parsing formats and edge cases
- Test all formatting scenarios (comma always for thousands)
- Test business logic with mocked store
- Test time injection with mock clocks

### Property Tests (fast-check)
```typescript
// Parse/format round-trip property
test.prop([fc.integer({ min: 1, max: 100000000 })])(
  'format then parse returns same amount',
  (cents) => {
    const formatted = formatCents(cents, 'ZAR');
    const parsed = parseAmount(formatted, 'ZAR');
    expect(parsed).toEqual({
      type: 'success',
      amount: { cents, requiresConfirmation: cents > 100_000_000 }
    });
  }
);

// Balance invariance property
test.prop([fc.array(recordArbitrary)])(
  'balance unchanged after record and reversal',
  (records) => {
    // For any sequence of records, adding a record then its reversal
    // should leave the balance unchanged
  }
);

// Customer name normalization properties
test.prop([fc.string()])(
  'customerKey is lowercase of displayName',
  (name) => {
    const display = customerDisplayName(name);
    const key = customerKey(name);
    expect(key).toBe(display.toLowerCase());
  }
);
```

### Integration Tests
- Test in-memory store implementation with minimal interface
- Test full operation flows with time injection
- Test time zone edge cases (day boundaries, DST)
- Test "who owes" excludes zero and credit balances
- Test undo returns which record was reversed

## Export JSON Schema
```typescript
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Imali AI Ledger Export",
  "description": "Export format for shop ledger data",
  "type": "object",
  "properties": {
    "format": {
      "type": "string",
      "const": "imali-ai-ledger-export"
    },
    "version": {
      "type": "integer",
      "const": 1
    },
    "exportedAt": {
      "type": "string",
      "format": "date-time"
    },
    "shop": {
      "$ref": "#/definitions/Shop"
    },
    "records": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/Record"
      },
      "description": "Records in chronological order (order they were made), including reversals"
    }
  },
  "required": ["format", "version", "exportedAt", "shop", "records"],
  "definitions": {
    "Shop": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "name": { "type": "string", "maxLength": 24 },
        "phone": { "type": "string" },
        "currency": { "type": "string", "enum": ["ZAR", "USD", "KES", "NGN", "GHS", "ZMW", "BWP"] },
        "timeZone": { "type": "string" },
        "createdAt": { "type": "string", "format": "date-time" }
      },
      "required": ["id", "name", "phone", "currency", "timeZone", "createdAt"]
    },
    // Record definitions with string timestamps and customer name handling
  }
}
```

## Security Considerations
1. **Integer Safety**: All money amounts checked with `Number.isSafeInteger`
2. **Input Validation**: All user input validated before processing
3. **Customer Name Handling**: Store display name (trimmed, inner spaces collapsed) and match key (lowercased) separately
4. **Time Zone**: Use Intl APIs, never manual offset calculations
5. **No Floating Point**: Never use floating point for money arithmetic
6. **Time Injection**: All time-dependent operations accept explicit `now` parameter for testability
7. **Confirmation Threshold**: Correct confirmation threshold is 100,000,000 cents (1,000,000.00)