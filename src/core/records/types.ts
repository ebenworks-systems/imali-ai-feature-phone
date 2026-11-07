// Record types and factories for the ledger

import { randomUUID } from 'node:crypto';

export type RecordKind = 'sale' | 'expense' | 'debt' | 'payment' | 'reversal';
export type Channel = 'ussd' | 'sms' | 'web';

export interface BaseRecord {
  id: string;
  shopId: string;
  kind: RecordKind;
  amount: number; // Integer cents
  createdAt: string; // UTC ISO 8601 string
  channel: Channel;
  originalWords: string; // What the owner typed
}

export interface SaleRecord extends BaseRecord {
  kind: 'sale';
  item?: string;
}

export interface ExpenseRecord extends BaseRecord {
  kind: 'expense';
  item?: string;
}

export interface DebtRecord extends BaseRecord {
  kind: 'debt';
  customerDisplayName: string; // Trimmed, inner spaces collapsed to one
  customerKey: string; // Lowercased for matching
  item?: string;
}

export interface PaymentRecord extends BaseRecord {
  kind: 'payment';
  customerDisplayName: string; // Trimmed, inner spaces collapsed to one
  customerKey: string; // Lowercased for matching
  item?: string;
}

export interface ReversalRecord extends BaseRecord {
  kind: 'reversal';
  reversesRecordId: string;
}

export type Record =
  | SaleRecord
  | ExpenseRecord
  | DebtRecord
  | PaymentRecord
  | ReversalRecord;

/**
 * Processes a customer name: trims and collapses inner spaces
 */
export function customerDisplayName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/**
 * Generates a customer key for matching: displayName lowercased
 */
export function customerKey(name: string): string {
  return customerDisplayName(name).toLowerCase();
}

/**
 * Creates a sale record
 */
export function createSaleRecord(
  shopId: string,
  params: {
    id?: string; // Optional. Without it a random id is made.
    amount: number;
    item?: string;
    channel: Channel;
    originalWords: string;
    now: Date;
  }
): SaleRecord {
  return {
    id: params.id ?? generateRecordId(),
    shopId,
    kind: 'sale',
    amount: params.amount,
    item: params.item,
    createdAt: params.now.toISOString(),
    channel: params.channel,
    originalWords: params.originalWords
  };
}

/**
 * Creates an expense record
 */
export function createExpenseRecord(
  shopId: string,
  params: {
    id?: string; // Optional. Without it a random id is made.
    amount: number;
    item?: string;
    channel: Channel;
    originalWords: string;
    now: Date;
  }
): ExpenseRecord {
  return {
    id: params.id ?? generateRecordId(),
    shopId,
    kind: 'expense',
    amount: params.amount,
    item: params.item,
    createdAt: params.now.toISOString(),
    channel: params.channel,
    originalWords: params.originalWords
  };
}

/**
 * Creates a debt record
 */
export function createDebtRecord(
  shopId: string,
  params: {
    id?: string; // Optional. Without it a random id is made.
    amount: number;
    customer: string;
    item?: string;
    channel: Channel;
    originalWords: string;
    now: Date;
  }
): DebtRecord {
  return {
    id: params.id ?? generateRecordId(),
    shopId,
    kind: 'debt',
    amount: params.amount,
    customerDisplayName: customerDisplayName(params.customer),
    customerKey: customerKey(params.customer),
    item: params.item,
    createdAt: params.now.toISOString(),
    channel: params.channel,
    originalWords: params.originalWords
  };
}

/**
 * Creates a payment record
 */
export function createPaymentRecord(
  shopId: string,
  params: {
    id?: string; // Optional. Without it a random id is made.
    amount: number;
    customer: string;
    item?: string;
    channel: Channel;
    originalWords: string;
    now: Date;
  }
): PaymentRecord {
  return {
    id: params.id ?? generateRecordId(),
    shopId,
    kind: 'payment',
    amount: params.amount,
    customerDisplayName: customerDisplayName(params.customer),
    customerKey: customerKey(params.customer),
    item: params.item,
    createdAt: params.now.toISOString(),
    channel: params.channel,
    originalWords: params.originalWords
  };
}

/**
 * Checks if a record can be reversed
 */
export function isReversible(record: Record): boolean {
  // All records except reversals can be reversed
  return record.kind !== 'reversal';
}

/**
 * Creates a reversal record that points to the record it cancels
 */
export function createReversal(
  record: Record,
  channel: Channel,
  originalWords: string,
  now: Date,
  id?: string
): ReversalRecord {
  return {
    id: id ?? generateRecordId(),
    shopId: record.shopId,
    kind: 'reversal',
    amount: 0, // Reversals have no amount
    reversesRecordId: record.id,
    createdAt: now.toISOString(),
    channel,
    originalWords
  };
}

/**
 * Generates a unique record ID
 */
function generateRecordId(): string {
  // A random UUID, so two serverless instances can never make the same id.
  return `rec_${randomUUID()}`;
}
