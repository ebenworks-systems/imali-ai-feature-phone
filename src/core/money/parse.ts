// Amount parsing for the ledger

import { getCurrencyInfo } from './currency.js';

const CONFIRMATION_THRESHOLD_CENTS = 100_000_000; // 1,000,000.00

export interface ParsedAmount {
  cents: number;
  requiresConfirmation: boolean;
}

export type ParseResult =
  | { type: 'success'; amount: ParsedAmount }
  | { type: 'ambiguous'; possibleAmounts: ParsedAmount[] }
  | { type: 'error'; reason: string };

/**
 * Internal result type from parseAmountString
 */
type AmountStringResult =
  | { type: 'error'; reason: string }
  | { type: 'ambiguous'; cents: number[] }
  | { type: 'success'; cents: number };

/**
 * Parses an amount string into cents.
 * Supports formats: 45, R45, 45.00, 45,50, 1,200, 1 200, R1 200.50
 * 
 * Decimal comma: comma followed by exactly 1-2 digits at end = decimal separator
 * Thousands separator: comma or space followed by exactly 3 digits = thousands separator
 * 
 * Ambiguous case: when input could be either "2 200" (2 items at 200 each) or "2,200" (one sale)
 * Only ambiguous if first part is >= 2
 * 
 * Rules:
 * - All inputs are treated as currency units (Rands), not cents
 * - Amounts are always multiplied by 100 to get cents
 * - Exception: decimal separator (. or , at end with 1-2 digits) is already included
 */
export function parseAmount(input: string, currency: string): ParseResult {
  const trimmed = input.trim();
  
  if (trimmed.length === 0) {
    return { type: 'error', reason: 'Empty amount' };
  }

  // Remove currency symbol at the start
  let withoutCurrency = trimmed;
  const currencyInfo = getCurrencyInfo(currency as any);
  
  if (trimmed.startsWith(currencyInfo.symbol)) {
    withoutCurrency = trimmed.slice(currencyInfo.symbol.length);
  }

  if (withoutCurrency.length === 0) {
    return { type: 'error', reason: 'Missing amount' };
 }

  // Parse the amount
  const result = parseAmountString(withoutCurrency);
  
  // Handle error case
  if (result.type === 'error') {
    return result;
  }
  
  // Handle ambiguous case
  if (result.type === 'ambiguous') {
    return {
      type: 'ambiguous',
      possibleAmounts: result.cents.map(c => ({
        cents: c,
        requiresConfirmation: c > CONFIRMATION_THRESHOLD_CENTS
      }))
    };
  }
  
  // success case - result.cents is a number here
  // Check safe integer
  if (!Number.isSafeInteger(result.cents)) {
    return { type: 'error', reason: 'Amount too large' };
  }

  return {
    type: 'success',
    amount: {
      cents: result.cents,
      requiresConfirmation: result.cents > CONFIRMATION_THRESHOLD_CENTS
    }
  };
}

/**
 * Parses an amount string (without currency symbol) into cents.
 * Returns {cents} or error.
 * 
 * Rules:
 * - If input has a decimal point: treat as Rands, multiply by 100
 * - If input has no decimal point and no thousands separator: treat as Rands, multiply by 100
 * - If input has thousands separator: treat as Rands, multiply by 100
 */
function parseAmountString(input: string): AmountStringResult {
  const trimmed = input.trim();
  
  if (trimmed.length === 0) {
    return { type: 'error', reason: 'Empty amount' };
  }

  // First check: decimal point (e.g., 1,200.50 or 1200.50)
  // This pattern matches: digits, optional thousands separators (comma or space), decimal point, 1-2 digits
  const decimalPointRegex = /^(\d+(?:[,\s]\d{3})*?)\.(\d{1,2})$/;
  const decimalPointMatch = trimmed.match(decimalPointRegex);
  
  if (decimalPointMatch) {
    const wholePart = decimalPointMatch[1].replace(/[,\s]/g, '');
    const decimalPart = decimalPointMatch[2].padEnd(2, '0');
    const randsCents = parseInt(wholePart + decimalPart, 10);
    // Input is in Rands, convert to cents by multiplying by 100
    return { type: 'success', cents: randsCents };
  }

  // Check for decimal comma pattern: digits, comma, 1-2 digits at end
  // This should come after decimal point check to avoid conflict
  const decimalCommaRegex = /^(\d+(?:[,\s]\d{3})*),(\d{1,2})$/;
  const decimalCommaMatch = trimmed.match(decimalCommaRegex);
  
  if (decimalCommaMatch) {
    const wholePart = decimalCommaMatch[1].replace(/[,\s]/g, '');
    const decimalPart = decimalCommaMatch[2].padEnd(2, '0');
    const randsCents = parseInt(wholePart + decimalPart, 10);
    return { type: 'success', cents: randsCents };
  }

  // Check for potential ambiguity: digits, space, exactly 3 digits
  // This could be "2 200" meaning 2200 OR "2 items for 200 each"
  // Only ambiguous if first part >= 2
  const potentialAmbiguousRegex = /^(\d+)\s+(\d{3})$/;
  const potentialAmbiguousMatch = trimmed.match(potentialAmbiguousRegex);
  
  if (potentialAmbiguousMatch) {
    const firstPart = parseInt(potentialAmbiguousMatch[1], 10);
    const secondPart = parseInt(potentialAmbiguousMatch[2], 10);
    
    // If first part is 1, treat as thousands separator (1,200 = 1200 Rands = 120000 cents)
    // If first part >= 2, it's ambiguous (2 items at 200 each = 400, or 2,200 = 2200)
    if (firstPart >= 2) {
      return {
        type: 'ambiguous',
        cents: [
          firstPart * 1000 + secondPart,  // one sale of X,200
          firstPart * secondPart          // firstPart items at secondPart each
        ]
      };
    }
    
    // firstPart is 1, treat as thousands separator (Rands, multiply by 100)
    const rands = firstPart * 1000 + secondPart;
    return { type: 'success', cents: rands * 100 };
  }

  // Check for thousands separator with multiple groups (e.g., 1,000,000)
  // Pattern: 1-3 initial digits, then one or more groups of (separator + exactly 3 digits)
  // When thousands separator is present, treat as Rands (multiply by 100)
  const thousandsMultiRegex = /^\d{1,3}(?:[,\s]\d{3})+$/;
  const thousandsMultiMatch = trimmed.match(thousandsMultiRegex);
  
  if (thousandsMultiMatch) {
    const clean = trimmed.replace(/[,\s]/g, '');
    const rands = parseInt(clean, 10);
    return { type: 'success', cents: rands * 100 };
  }

  // Check for single thousands separator (e.g., "1,200" or "1 200")
  // Pattern: digits, comma/space, exactly 3 digits
  // When thousands separator is present, treat as Rands (multiply by 100)
  const thousandsSingleRegex = /^\d+[,\s]\d{3}$/;
  const thousandsSingleMatch = trimmed.match(thousandsSingleRegex);
  
  if (thousandsSingleMatch) {
    const clean = trimmed.replace(/[,\s]/g, '');
    const rands = parseInt(clean, 10);
    return { type: 'success', cents: rands * 100 };
  }

  // Plain integer (treat as Rands, multiply by 100)
  const plainRegex = /^\d+$/;
  if (plainRegex.test(trimmed)) {
    const rands = parseInt(trimmed, 10);
    return { type: 'success', cents: rands * 100 };
  }

  return { type: 'error', reason: 'Invalid amount format' };
}

export function requiresConfirmation(cents: number): boolean {
  return cents > CONFIRMATION_THRESHOLD_CENTS;
}

export function isSafeInteger(cents: number): boolean {
  return Number.isSafeInteger(cents);
}
