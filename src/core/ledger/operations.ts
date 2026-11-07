// Business logic operations for the ledger

import type { LedgerStore } from '../../store/interface.js';
import type { ParsedAmount } from '../money/parse.js';
import type { Shop } from '../shops/types.js';
import type {
  Record,
  SaleRecord,
  ExpenseRecord,
  DebtRecord,
  PaymentRecord,
  ReversalRecord,
  Channel
} from '../records/types.js';
import {
  createSaleRecord,
  createExpenseRecord,
  createDebtRecord,
  createPaymentRecord,
  createReversal
} from '../records/types.js';
import { activeRecords } from '../records/active.js';

// Result types for operations

export interface Figure {
  kind: 'salesToday' | 'expensesToday' | 'customerBalance';
  cents: number;
  customer?: string;
}

export interface OperationSuccess<T> {
  success: true;
  data: T;
  figure: Figure;
}

export interface OperationError {
  success: false;
  error: string;
}

export interface NeedsConfirmation {
  needsConfirmation: true;
  amount: ParsedAmount;
  reason: string;
}

export type OperationResult<T> = OperationSuccess<T> | OperationError;
export type RecordResult = OperationResult<SaleRecord | ExpenseRecord | DebtRecord | PaymentRecord> | NeedsConfirmation;

export interface UndoResult {
  reversal: ReversalRecord;
  reversedRecord: {
    kind: string;
    amount: number;
    item?: string;
    customer?: string;
  };
}

/**
 * Records a sale
 */
export async function recordSale(
  store: LedgerStore,
  shop: Shop,
  params: {
    id?: string; // Optional record id. Without it a random one is made.
    amount: ParsedAmount;
    item?: string;
    channel: Channel;
    originalWords: string;
    now: Date;
  }
): Promise<RecordResult> {
  // Check if confirmation is needed
  if (params.amount.requiresConfirmation) {
    return {
      needsConfirmation: true,
      amount: params.amount,
      reason: `Amount ${params.amount.cents} cents is very large, please confirm`
    };
  }

  // Create and save the record
  const record = createSaleRecord(shop.id, {
    id: params.id,
    amount: params.amount.cents,
    item: params.item,
    channel: params.channel,
    originalWords: params.originalWords,
    now: params.now
  });

  await store.appendRecord(record);

  return {
    success: true,
    data: record,
    figure: {
      kind: 'salesToday',
      cents: params.amount.cents
    }
  };
}

/**
 * Records an expense
 */
export async function recordExpense(
  store: LedgerStore,
  shop: Shop,
  params: {
    id?: string; // Optional record id. Without it a random one is made.
    amount: ParsedAmount;
    item?: string;
    channel: Channel;
    originalWords: string;
    now: Date;
  }
): Promise<RecordResult> {
  // Check if confirmation is needed
  if (params.amount.requiresConfirmation) {
    return {
      needsConfirmation: true,
      amount: params.amount,
      reason: `Amount ${params.amount.cents} cents is very large, please confirm`
    };
  }

  // Create and save the record
  const record = createExpenseRecord(shop.id, {
    id: params.id,
    amount: params.amount.cents,
    item: params.item,
    channel: params.channel,
    originalWords: params.originalWords,
    now: params.now
  });

  await store.appendRecord(record);

  return {
    success: true,
    data: record,
    figure: {
      kind: 'expensesToday',
      cents: params.amount.cents
    }
  };
}

/**
 * Records a debt (customer owes)
 */
export async function recordDebt(
  store: LedgerStore,
  shop: Shop,
  params: {
    id?: string; // Optional record id. Without it a random one is made.
    amount: ParsedAmount;
    customer: string;
    item?: string;
    channel: Channel;
    originalWords: string;
    now: Date;
  }
): Promise<RecordResult> {
  // Check if confirmation is needed
  if (params.amount.requiresConfirmation) {
    return {
      needsConfirmation: true,
      amount: params.amount,
      reason: `Amount ${params.amount.cents} cents is very large, please confirm`
    };
  }

  // Create and save the record
  const record = createDebtRecord(shop.id, {
    id: params.id,
    amount: params.amount.cents,
    customer: params.customer,
    item: params.item,
    channel: params.channel,
    originalWords: params.originalWords,
    now: params.now
  });

  await store.appendRecord(record);

  return {
    success: true,
    data: record,
    figure: {
      kind: 'customerBalance',
      cents: params.amount.cents,
      customer: record.customerDisplayName
    }
  };
}

/**
 * Records a payment (customer pays back)
 */
export async function recordPayment(
  store: LedgerStore,
  shop: Shop,
  params: {
    id?: string; // Optional record id. Without it a random one is made.
    amount: ParsedAmount;
    customer: string;
    item?: string;
    channel: Channel;
    originalWords: string;
    now: Date;
  }
): Promise<RecordResult> {
  // Check if confirmation is needed
  if (params.amount.requiresConfirmation) {
    return {
      needsConfirmation: true,
      amount: params.amount,
      reason: `Amount ${params.amount.cents} cents is very large, please confirm`
    };
  }

  // Create and save the record
  const record = createPaymentRecord(shop.id, {
    id: params.id,
    amount: params.amount.cents,
    customer: params.customer,
    item: params.item,
    channel: params.channel,
    originalWords: params.originalWords,
    now: params.now
  });

  await store.appendRecord(record);

  return {
    success: true,
    data: record,
    figure: {
      kind: 'customerBalance',
      cents: params.amount.cents,
      customer: record.customerDisplayName
    }
  };
}

/**
 * Undoes the last record
 * Finds the most recent record that is not already reversed and is not itself a reversal
 * Creates a reversal record that points to the original record
 * Returns the reversal record and which record was reversed
 */
export async function undoLastRecord(
  store: LedgerStore,
  shop: Shop,
  params: {
    id?: string; // Optional id for the reversal record. Without it a random one is made.
    channel: Channel;
    originalWords: string;
    now: Date;
  }
): Promise<OperationResult<UndoResult>> {
  // Get all records for this shop
  const allRecords = await store.listRecords(shop.id);

  // Filter to only active (non-reversed) records
  const { active: activeList } = activeRecords(allRecords);

  // Find the most recent reversible record (iterate from newest to oldest)
  let recordToReverse: Record | null = null;

  for (let i = activeList.length - 1; i >= 0; i--) {
    recordToReverse = activeList[i];
    break;
  }

  // If no record found to undo
  if (!recordToReverse) {
    return {
      success: false,
      error: 'Nothing to undo'
    };
  }

  // Create the reversal record
  const reversalRecord = createReversal(
    recordToReverse,
    params.channel,
    params.originalWords,
    params.now,
    params.id
  );

  // Try to save the reversal
  try {
    await store.appendRecord(reversalRecord);
  } catch (error) {
    // Check if it's RecordAlreadyReversedError
    if (error instanceof Error && error.name === 'RecordAlreadyReversedError') {
      return {
        success: false,
        error: 'This record is already reversed'
      };
    }
    throw error;
  }

  // Build the info about what was reversed
  const reversedInfo: UndoResult['reversedRecord'] = {
    kind: recordToReverse.kind,
    amount: recordToReverse.amount
  };

  if (recordToReverse.kind === 'sale' || recordToReverse.kind === 'expense') {
    if ('item' in recordToReverse && recordToReverse.item) {
      reversedInfo.item = recordToReverse.item;
    }
  }

  if (recordToReverse.kind === 'debt' || recordToReverse.kind === 'payment') {
    if ('customerDisplayName' in recordToReverse && recordToReverse.customerDisplayName) {
      reversedInfo.customer = recordToReverse.customerDisplayName;
    }
    if ('item' in recordToReverse && recordToReverse.item) {
      reversedInfo.item = recordToReverse.item;
    }
  }

  return {
    success: true,
    data: {
      reversal: reversalRecord,
      reversedRecord: reversedInfo
    },
    figure: {
      kind: recordToReverse.kind === 'debt' ? 'customerBalance' : 
             recordToReverse.kind === 'payment' ? 'customerBalance' :
             recordToReverse.kind === 'sale' ? 'salesToday' : 'expensesToday',
      cents: recordToReverse.amount,
      customer: recordToReverse.kind === 'debt' || recordToReverse.kind === 'payment' 
        ? recordToReverse.customerDisplayName
        : undefined
    }
  };
}
