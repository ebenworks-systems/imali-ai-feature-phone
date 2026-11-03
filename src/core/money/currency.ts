// Currency definitions for the ledger

export type Currency = 'ZAR' | 'USD' | 'KES' | 'NGN' | 'GHS' | 'ZMW' | 'BWP';

export interface CurrencyInfo {
  symbol: string;      // ASCII symbol: 'R', '$', 'KSh', 'N', 'GHS', 'K', 'P'
  decimals: 2;
}

const CURRENCY_INFO: Record<Currency, CurrencyInfo> = {
  ZAR: { symbol: 'R', decimals: 2 },
  USD: { symbol: '$', decimals: 2 },
  KES: { symbol: 'KSh', decimals: 2 },
  NGN: { symbol: 'N', decimals: 2 },
  GHS: { symbol: 'GHS', decimals: 2 },
  ZMW: { symbol: 'K', decimals: 2 },
  BWP: { symbol: 'P', decimals: 2 }
};

export function getCurrencyInfo(currency: Currency): CurrencyInfo {
  return CURRENCY_INFO[currency];
}
