/**
 * Imali AI Ledger Core - Public API
 * 
 * A feature-phone shop ledger system for recording sales, expenses, customer debts,
 * and payments. This module provides all the core functionality: money parsing/formatting,
 * record management, time zone handling, and business logic operations.
 * 
 * The ledger operates on a minimal `LedgerStore` interface, allowing different storage
 * backends (in-memory for testing, PostgreSQL for production).
 * 
 * All money is stored as integers representing the smallest currency unit (cents).
 * All timestamps are UTC ISO 8601 strings. Customer names are matched using lowercase keys
 * while preserving the owner's original capitalization for display.
 */

// ============================================================================
// Currency and Money Handling
// ============================================================================

export type { Currency } from './money/currency.js';
export { getCurrencyInfo } from './money/currency.js';

export type { ParsedAmount, ParseResult } from './money/parse.js';
export {
  parseAmount,
  requiresConfirmation,
  isSafeInteger
} from './money/parse.js';

export { formatCents } from './money/format.js';

// ============================================================================
// Shop Management
// ============================================================================

export type { Shop } from './shops/types.js';
export {
  createShop,
  validateShopName
} from './shops/types.js';

// ============================================================================
// Record Types and Management
// ============================================================================

export type {
  RecordKind,
  Channel,
  BaseRecord,
  SaleRecord,
  ExpenseRecord,
  DebtRecord,
  PaymentRecord,
  ReversalRecord,
  Record
} from './records/types.js';

export {
  customerDisplayName,
  customerKey,
  createSaleRecord,
  createExpenseRecord,
  createDebtRecord,
  createPaymentRecord,
  isReversible,
  createReversal
} from './records/types.js';

// ============================================================================
// Record Validation
// ============================================================================

export {
  validateAmount
} from './records/validation.js';

// ============================================================================
// Active Records (Handles Reversals)
// ============================================================================

export type { ActiveRecordsResult } from './records/active.js';
export { activeRecords } from './records/active.js';

// ============================================================================
// Time Zone Utilities
// ============================================================================

export {
  getShopLocalDate,
  getShopDayBounds,
  isTodayInShopTimeZone
} from './timezone/utils.js';

// ============================================================================
// Business Logic Operations
// ============================================================================

export type {
  Figure,
  OperationSuccess,
  OperationError,
  NeedsConfirmation,
  OperationResult,
  RecordResult,
  UndoResult
} from './ledger/operations.js';

export {
  recordSale,
  recordExpense,
  recordDebt,
  recordPayment,
  undoLastRecord
} from './ledger/operations.js';

// ============================================================================
// Query Operations
// ============================================================================

export type { TodaySummary } from './queries/today.js';
export { getTodaySummary } from './queries/today.js';

export type { CustomerBalance } from './queries/customers.js';
export {
  getWhoOwes,
  getCustomerBalance
} from './queries/customers.js';

export type { DayCloseSummary } from './queries/dayClose.js';
export { getDayCloseSummary } from './queries/dayClose.js';

// ============================================================================
// Export Functionality
// ============================================================================

export type { ExportData } from './export/generator.js';
export { generateExport } from './export/generator.js';

// ============================================================================
// Storage Interface (for implementing different backends)
// ============================================================================

export type {
  LedgerStore
} from '../store/interface.js';

export {
  RecordAlreadyReversedError
} from '../store/interface.js';

// ============================================================================
// Clock Abstraction (for testability with time injection)
// ============================================================================

export type { Clock } from './clock.js';
export { systemClock } from './clock.js';
