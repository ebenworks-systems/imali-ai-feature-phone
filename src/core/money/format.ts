// Amount formatting for the ledger

import { getCurrencyInfo, type Currency } from './currency.js';

/**
 * Formats cents into a human-readable string with currency symbol.
 * 
 * Rules:
 * - Show R45 when cents are zero (no .00)
 * - Show R45.50 when cents are non-zero (with .50)
 * - Add thousands comma separator (always, no locale)
 * - A negative amount has its minus sign before the currency symbol: -R60, never R-60
 * - Plain ASCII only
 * 
 * @param cents - Integer number of cents
 * @param currency - Currency code
 * @param options - Formatting options
 * @returns Formatted string like 'R1,240.50' or '-R60'
 */
export function formatCents(
  cents: number,
  currency: Currency,
  options?: {
    alwaysShowDecimals?: boolean;
  }
): string {
  const info = getCurrencyInfo(currency);
  
  // The sign goes before the symbol. Zero (and -0) never gets one.
  const sign = cents < 0 ? '-' : '';
  const absCents = Math.abs(cents);
  
  // Extract whole and decimal parts
  const whole = Math.floor(absCents / 100);
  const decimal = absCents % 100;
  
  // Format whole part with thousands separator (comma always, no locale)
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  
  // Format decimal part - show if non-zero or option enabled
  const showDecimals = options?.alwaysShowDecimals ?? decimal !== 0;
  
  if (showDecimals) {
    const decimalStr = decimal.toString().padStart(2, '0');
    return `${sign}${info.symbol}${wholeStr}.${decimalStr}`;
  }
  
  return `${sign}${info.symbol}${wholeStr}`;
}

export { getCurrencyInfo };
