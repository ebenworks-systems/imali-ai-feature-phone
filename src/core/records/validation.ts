// Record validation for the ledger

/**
 * Validates that an amount is valid (positive and safe integer)
 */
export function validateAmount(cents: number): { valid: boolean; reason?: string } {
  if (!Number.isSafeInteger(cents)) {
    return { valid: false, reason: 'Amount is not a safe integer' };
  }

  if (cents <= 0) {
    return { valid: false, reason: 'Amount must be greater than zero' };
  }

  return { valid: true };
}
