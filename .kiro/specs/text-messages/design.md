# SMS Channel Design

## Modules and Public Signatures

### src/channels/sms/reader.ts

Parses one SMS message into one action intent. Reads phrases using case-insensitive matching, ignores extra spaces.

```typescript
export type IntentKind = 
  | 'sale' | 'expense' | 'debt' | 'payment' | 'undo' | 'today' 
  | 'whoOwes' | 'balance' | 'close' | 'help' | 'unknown';

export interface SaleIntent {
  kind: 'sale';
  cents: number;
  item?: string;
  quantity?: number;
}

export interface ExpenseIntent {
  kind: 'expense';
  cents: number;
  item?: string;
}

export interface DebtIntent {
  kind: 'debt';
  customer: string;
  cents: number;
  item?: string;
}

export interface PaymentIntent {
  kind: 'payment';
  customer: string;
  cents: number;
}

export interface WhoOwesIntent {
  kind: 'whoOwes';
  page: number; // defaults to 1
}

export interface BalanceIntent {
  kind: 'balance';
  customer: string;
}

export interface SimpleIntent {
  kind: 'undo' | 'today' | 'close' | 'help' | 'unknown';
}

export type Intent = 
  | SaleIntent | ExpenseIntent | DebtIntent | PaymentIntent 
  | WhoOwesIntent | BalanceIntent | SimpleIntent;

export function readIntent(text: string, currency: Currency): Intent;
```

### src/channels/sms/replies.ts

Builds plain-ASCII replies at most 160 characters, trimming from the least useful part if needed.

```typescript
export interface ReplyContext {
  sale?: { amount: number; item?: string; qty?: number; todayTotal: number; todayCount: number };
  expense?: { amount: number; item?: string; todayTotal: number };
  debt?: { customer: string; amount: number; item?: string; customerTotal: number };
  payment?: { customer: string; amount: number; isCredit: boolean; balance: number };
  undo?: { kind: RecordKind; amount: number; item?: string; todayTotal?: number; todayCount?: number };
  today?: { sales: number; salesCount: number; spent: number; inHand: number };
  whoOwes?: { debtors: Array<{name: string; owed: number}>; hasMore: boolean; page: number };
  balance?: { customer: string; owed: number; isCredit: boolean };
  close?: DayCloseSummary;
}

export function buildReply(context: ReplyContext, maxLength?: number): string;
```

### src/channels/sms/pending.ts

PendingStore interface and in-memory implementation for storing ambiguous-amount and large-amount questions per phone number.

```typescript
export interface PendingQuestion {
  kind: 'ambiguous' | 'largeAmount';
  intent?: Intent;                 // for 'ambiguous': { kind: 'ambiguous', options, base, item? } - the item is kept for either answer
  possibleAmounts?: Array<{ cents: number; formatted: string }>;
  largeAmount?: number;
  createdAt: Date;
}

export interface PendingStore {
  get(phone: string): Promise<PendingQuestion | null>;
  set(phone: string, question: PendingQuestion): Promise<void>;
  clear(phone: string): Promise<void>;
}

export class InMemoryPendingStore implements PendingStore {
  private data = new Map<string, { question: PendingQuestion; expiresAt: Date }>();
  private readonly ttlMs = 10 * 60 * 1000; // 10 minutes

  async get(phone: string): Promise<PendingQuestion | null>;
  async set(phone: string, question: PendingQuestion): Promise<void>;
  async clear(phone: string): Promise<void>;
  private cleanupExpired(): void;
}
```

### src/ai/reader.ts

Optional model reader that proposes intents when rules return unknown.

```typescript
export interface Proposal {
  intent: Intent;
  amountSubstring: string; // Exact substring from owner's message
  customerSubstring?: string; // Exact substring from owner's message
}

export interface ModelReader {
  read(text: string): Promise<Proposal | null>;
}

export class GeminiReader implements ModelReader {
  constructor(apiKey: string, timeoutMs?: number);
  async read(text: string): Promise<Proposal | null>;
}
```

### src/channels/sms/handler.ts

Main entry point: processes one SMS message through rules, handles pending questions, optional model reader, and ledger operations.

```typescript
export interface HandleTextParams {
  phone: string;
  text: string;
  now: Date;
  store: LedgerStore;
  pending: PendingStore;
  reader?: ModelReader; // Optional AI reader
}

export interface HandleTextResult {
  reply: string;
}

export async function handleText(params: HandleTextParams): Promise<HandleTextResult>;
```

## State Management

**PendingStore (in-memory):** Tracks one ambiguous-amount or large-amount question per phone number with a 10-minute TTL. Cleanup runs on every get() call; expired entries are removed.

**LedgerStore:** Unchanged from core. Handler calls its create methods (createShop, recordSale, recordExpense, recordDebt, recordPayment, undoLastRecord) and query methods (getTodaySummary, getWhoOwes, getCustomerBalance, getDayCloseSummary).

## Error Handling

- **Invalid amount:** parseAmount returns an error; readIntent returns {unknown}.
- **Ambiguous amount:** parseAmount returns {ambiguous}; handler stores a PendingQuestion and returns the ambiguity reply.
- **Large amount:** parseAmount returns {requiresConfirmation: true}; handler stores a PendingQuestion and returns the confirmation reply.
- **Pending question replied with non-numeric:** PendingQuestion is cleared and text is read normally.
- **Pending question expired:** PendingStore cleanup removes it; text is read normally.
- **Model reader timeout/error:** Returns null; fallback to unknown reply.
- **Model proposal check fails:** If amount or customer substring is not found in the message, or does not parse correctly, the unknown reply is sent.
- **Shop does not exist (unknown phone):** Create new shop with name from first message; return welcome-ready reply.

## Test Structure

### test/channels/sms/reader.test.ts

Unit tests for readIntent() covering all shape patterns (criteria 1–26), case and space variations, ambiguous and large amounts (criteria 27–30).

### test/channels/sms/replies.test.ts

Unit tests for buildReply() checking exact wording for each operation (criteria 31–41), character limit (criteria 42–43), ASCII validation, and trimming logic.

### test/channels/sms/pending.test.ts

Unit tests for InMemoryPendingStore: set/get/clear, TTL expiry (criteria 29), cleanup logic.

### test/channels/sms/handler.test.ts

Integration tests driving SMS conversations message by message:
- New shop sign-up (criteria 44–45).
- Ambiguous and large-amount questions with reply resolution (criteria 27–28, 30).
- Each intent type (sale, expense, debt, payment, undo, today, whoOwes, balance, close, help) with current and historical data (criteria 31–41).
- Unknown message (criteria 26, 41).
- Model reader accepted and rejected proposals (criteria 46–47).
- ASCII and character-limit validation on all replies (criteria 42, 50).

### test/channels/sms/gemini.test.ts

Integration tests for GeminiReader using a fake fetch mock:
- Calls Gemini API once per message with correct timeout (criteria 48).
- Returns Proposal or null correctly.
- Timeout and network errors return null (criteria 48).

## Dependencies

- `src/core/index.ts` – currency, money parsing, record factories, ledger operations, queries.
- `src/store/interface.ts` – LedgerStore interface.
- No external packages beyond Node standard library and Hono (for HTTP layer, separate from this handler).
- Tests use Vitest with a fake model reader; no Gemini API calls in test suite.

## Key Design Decisions

1. **PendingStore is injected:** Handler does not own it; caller provides an implementation (in-memory for tests, could be Redis or similar in production).

2. **ModelReader is optional:** Handler works fully on rules alone. When reader is passed and rules return unknown, the handler calls it; if it returns null or its proposal fails validation, fallback to unknown reply.

3. **Validation of proposals:** Each Proposal substring must be found in the original message and parse correctly with the ledger's parseAmount. This prevents the model from inventing amounts or customers that were not in the owner's words.

4. **Trimming strategy:** Replies trim from least useful part first (hint before item). This preserves what was recorded while staying within 160 characters.

5. **Replies are pure functions:** buildReply() takes a context object and returns a string. No I/O, no ledger calls. This makes testing simple and replies are deterministic.

6. **UTC timestamps in ledger, shop time zone for display:** Handlers convert display times (e.g., "Mon 3 Nov") using the shop's time zone when building replies.
