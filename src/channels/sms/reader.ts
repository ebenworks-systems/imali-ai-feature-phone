/**
 * SMS Reader - Parses text messages into action intents
 * 
 * Reads phrases using case-insensitive matching, ignores extra spaces.
 * Returns an Intent representing the owner's action.
 */

import { parseAmount, type Currency } from '../../core/index.js';

// ============================================================================
// Intent Types
// ============================================================================

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

// ============================================================================
// Normalizing Helper
// ============================================================================

/**
 * Normalize text for matching: lowercase, collapse whitespace
 */
function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Split text into words for parsing
 */
function words(text: string): string[] {
  return normalize(text).split(' ');
}

// ============================================================================
// Sale Intent Parsing
// ============================================================================

/**
 * Try to parse a sale intent from the message.
 * Patterns:
 * 1. "sold 3 bread 45" -> {quantity, item, amount}
 * 2. "sold bread 45" -> {item, amount}
 * 3. "sale 45" -> {amount}
 * 4. "45 bread" -> {amount, item}
 * 5. "sold 3 bread at 15" -> {quantity, item, unit_price}
 * 6. "3 bread @15" -> {quantity, item, @unit_price}
 * 7. "3 bread x15" -> {quantity, item, x_unit_price}
 */
function trySale(text: string, currency: Currency): SaleIntent | null {
  const w = words(text);

  // Pattern 5, 6, 7: with unit price (at, @, x)
  // Look for "at", "@", "x" as separate words OR @number, xnumber as single words
  // This must be checked FIRST before other patterns to avoid conflicts
  let unitPriceIdx = w.findIndex(word => word === 'at' || word === '@' || word === 'x');
  let unitPriceText: string | null = null;

  if (unitPriceIdx > 0 && unitPriceIdx + 1 < w.length) {
    // Pattern 5: "at 15" (two words)
    unitPriceText = w[unitPriceIdx + 1];
  } else if (unitPriceIdx === -1) {
    // Look for @number or xnumber patterns
    unitPriceIdx = w.findIndex(word => word.startsWith('@') || word.startsWith('x'));
    if (unitPriceIdx > 0) {
      // Extract the price from @15 or x15
      const word = w[unitPriceIdx];
      unitPriceText = word.slice(1); // Remove @ or x
    }
  }

  if (unitPriceIdx > 0 && unitPriceText) {
    const unitPriceResult = parseAmount(unitPriceText, currency);
    if (unitPriceResult.type === 'success') {
      // Words before the unit price marker
      const beforePrice = w.slice(0, unitPriceIdx);
      
      // For "sold 3 bread at 15", beforePrice = ['sold', '3', 'bread']
      // For "3 bread @15", beforePrice = ['3', 'bread']
      
      let qty: number | undefined;
      let item: string | undefined;
      
      if (beforePrice[0] === 'sold' && beforePrice.length >= 3) {
        // "sold 3 bread at 15"
        const qtyIdx = 1;
        const potentialQty = parseInt(beforePrice[qtyIdx], 10);
        if (!isNaN(potentialQty) && potentialQty > 0) {
          qty = potentialQty;
          item = beforePrice.slice(qtyIdx + 1).join(' ');
        }
      } else if (beforePrice.length >= 2) {
        // "3 bread @15"
        const potentialQty = parseInt(beforePrice[0], 10);
        if (!isNaN(potentialQty) && potentialQty > 0) {
          qty = potentialQty;
          item = beforePrice.slice(1).join(' ');
        }
      }
      
      if (qty !== undefined) {
        const totalCents = qty * unitPriceResult.amount.cents;
        return {
          kind: 'sale',
          cents: totalCents,
          item: item || undefined,
          quantity: qty
        };
      }
    }
  }

  // Pattern 1: "sold 3 bread 45"
  if (w[0] === 'sold' && w.length >= 3) {
    const potentialQty = parseInt(w[1], 10);
    if (!isNaN(potentialQty) && potentialQty > 0) {
      // Words from index 2 onwards are item + amount
      // Find where the amount starts (could be any numeric-like pattern)
      for (let i = 2; i < w.length; i++) {
        const amountText = w.slice(i).join(' ');
        const result = parseAmount(amountText, currency);
        if (result.type === 'success') {
          const item = w.slice(2, i).join(' ');
          return {
            kind: 'sale',
            cents: result.amount.cents,
            item: item || undefined,
            quantity: potentialQty
          };
        }
      }
    }
  }

  // Pattern 2: "sold bread 45"
  if (w[0] === 'sold' && w.length >= 2) {
    // Try from the end - find the first word that parses as an amount
    for (let i = w.length - 1; i >= 1; i--) {
      const amountText = w[i];
      const result = parseAmount(amountText, currency);
      if (result.type === 'success') {
        const item = w.slice(1, i).join(' ');
        return {
          kind: 'sale',
          cents: result.amount.cents,
          item: item || undefined
        };
      }
    }
  }

  // Pattern 3: "sale 45"
  if (w[0] === 'sale' && w.length >= 2) {
    const amountText = w.slice(1).join(' ');
    const result = parseAmount(amountText, currency);
    if (result.type === 'success') {
      return {
        kind: 'sale',
        cents: result.amount.cents
      };
    }
  }

  // Pattern 4: "45 bread"
  // First word is an amount, rest is item
  if (w.length >= 2) {
    const result = parseAmount(w[0], currency);
    if (result.type === 'success') {
      const item = w.slice(1).join(' ');
      return {
        kind: 'sale',
        cents: result.amount.cents,
        item: item || undefined
      };
    }
  }

  return null;
}

// ============================================================================
// Expense Intent Parsing
// ============================================================================

/**
 * Try to parse an expense intent from the message.
 * Patterns:
 * 8. "spent 120 transport"
 * 9. "spend 120 on transport"
 * 10. "expense 120 stock"
 * 11. "bought stock 500"
 * 12. "paid 150 rent" (when no customer name before "paid")
 */
function tryExpense(text: string, currency: Currency): ExpenseIntent | null {
  const w = words(text);

  // Pattern 9: "spend 120 on transport"
  // Check this before pattern 8 to avoid conflicts
  if (w[0] === 'spend' && w.length >= 4 && w[2] === 'on') {
    const amountText = w[1];
    const result = parseAmount(amountText, currency);
    if (result.type === 'success') {
      const item = w.slice(3).join(' ');
      return {
        kind: 'expense',
        cents: result.amount.cents,
        item: item || undefined
      };
    }
  }

  // Pattern 8: "spent 120 transport"
  if ((w[0] === 'spent' || w[0] === 'spend') && w.length >= 2) {
    const amountText = w[1];
    const result = parseAmount(amountText, currency);
    if (result.type === 'success') {
      const item = w.slice(2).join(' ');
      return {
        kind: 'expense',
        cents: result.amount.cents,
        item: item || undefined
      };
    }
  }

  // Pattern 10: "expense 120 stock"
  if (w[0] === 'expense' && w.length >= 2) {
    const amountText = w[1];
    const result = parseAmount(amountText, currency);
    if (result.type === 'success') {
      const item = w.slice(2).join(' ');
      return {
        kind: 'expense',
        cents: result.amount.cents,
        item: item || undefined
      };
    }
  }

  // Pattern 11: "bought stock 500"
  if (w[0] === 'bought' && w.length >= 2) {
    // Try from the end - find the first word that parses as an amount
    for (let i = w.length - 1; i >= 1; i--) {
      const amountText = w[i];
      const result = parseAmount(amountText, currency);
      if (result.type === 'success') {
        const item = w.slice(1, i).join(' ');
        return {
          kind: 'expense',
          cents: result.amount.cents,
          item: item || undefined
        };
      }
    }
  }

  // Pattern 12: "paid 150 rent" (no customer name before "paid")
  // This is tricky - we need to distinguish from payment patterns
  // A payment has the format: CustomerName paid Amount
  // An expense has: paid Amount Item
  // We'll handle this by checking if it starts with "paid" at position 0
  if (w[0] === 'paid' && w.length >= 2) {
    const amountText = w[1];
    const result = parseAmount(amountText, currency);
    if (result.type === 'success') {
      const item = w.slice(2).join(' ');
      return {
        kind: 'expense',
        cents: result.amount.cents,
        item: item || undefined
      };
    }
  }

  return null;
}

// ============================================================================
// Debt Intent Parsing
// ============================================================================

/**
 * Try to parse a debt intent from the message.
 * Patterns:
 * 13. "Tendai owes 20 sugar"
 * 14. "Tendai owes 20"
 * 15. "credit Tendai 20 sugar"
 * 16. "Tendai took 20 on credit"
 */
function tryDebt(text: string, currency: Currency): DebtIntent | null {
  const w = words(text);

  // Pattern 13: "Tendai owes 20 sugar"
  if (w.length >= 3 && w[1] === 'owes') {
    const customer = w[0];
    const amountText = w[2];
    const result = parseAmount(amountText, currency);
    if (result.type === 'success') {
      const item = w.slice(3).join(' ');
      return {
        kind: 'debt',
        customer,
        cents: result.amount.cents,
        item: item || undefined
      };
    }
  }

  // Pattern 15: "credit Tendai 20 sugar"
  if (w[0] === 'credit' && w.length >= 3) {
    const customer = w[1];
    const amountText = w[2];
    const result = parseAmount(amountText, currency);
    if (result.type === 'success') {
      const item = w.slice(3).join(' ');
      return {
        kind: 'debt',
        customer,
        cents: result.amount.cents,
        item: item || undefined
      };
    }
  }

  // Pattern 16: "Tendai took 20 on credit"
  if (w.length >= 4 && w[1] === 'took' && w[3] === 'on' && w[4] === 'credit') {
    const customer = w[0];
    const amountText = w[2];
    const result = parseAmount(amountText, currency);
    if (result.type === 'success') {
      return {
        kind: 'debt',
        customer,
        cents: result.amount.cents
      };
    }
  }

  return null;
}

// ============================================================================
// Payment Intent Parsing
// ============================================================================

/**
 * Try to parse a payment intent from the message.
 * Patterns:
 * 17. "Tendai paid 10"
 * 18. "Tendai paid back 10"
 * 19. "received 10 from Tendai"
 */
function tryPayment(text: string, currency: Currency): PaymentIntent | null {
  const w = words(text);

  // Pattern 17: "Tendai paid 10"
  if (w.length >= 3 && w[1] === 'paid') {
    const customer = w[0];
    const amountText = w.slice(2).join(' ');
    const result = parseAmount(amountText, currency);
    if (result.type === 'success') {
      return {
        kind: 'payment',
        customer,
        cents: result.amount.cents
      };
    }
  }

  // Pattern 18: "Tendai paid back 10"
  if (w.length >= 4 && w[1] === 'paid' && w[2] === 'back') {
    const customer = w[0];
    const amountText = w.slice(3).join(' ');
    const result = parseAmount(amountText, currency);
    if (result.type === 'success') {
      return {
        kind: 'payment',
        customer,
        cents: result.amount.cents
      };
    }
  }

  // Pattern 19: "received 10 from Tendai"
  if (w[0] === 'received' && w.length >= 3) {
    const amountText = w[1];
    const result = parseAmount(amountText, currency);
    if (result.type === 'success' && w[2] === 'from') {
      const customer = w.slice(3).join(' ');
      return {
        kind: 'payment',
        customer,
        cents: result.amount.cents
      };
    }
  }

  return null;
}

// ============================================================================
// Simple Action Intent Parsing
// ============================================================================

/**
 * Try to parse simple action intents.
 * Patterns:
 * 20. "undo", "cancel", "oops"
 * 21. "today", "sales", "total"
 * 24. "close", "summary", "end of day"
 * 25. "help", "?", "menu"
 */
function trySimpleAction(text: string): SimpleIntent | null {
  const normalized = normalize(text);

  // Pattern 20: undo
  if (normalized === 'undo' || normalized === 'cancel' || normalized === 'oops') {
    return { kind: 'undo' };
  }

  // Pattern 21: today
  if (normalized === 'today' || normalized === 'sales' || normalized === 'total') {
    return { kind: 'today' };
  }

  // Pattern 24: close
  if (normalized === 'close' || normalized === 'summary' || normalized === 'end of day') {
    return { kind: 'close' };
  }

  // Pattern 25: help
  if (normalized === 'help' || normalized === '?' || normalized === 'menu') {
    return { kind: 'help' };
  }

  return null;
}

// ============================================================================
// Who Owes Intent Parsing
// ============================================================================

/**
 * Try to parse "who owes" intent.
 * Patterns:
 * 22. "who owes", "debts", "owes", "owes 2"
 */
function tryWhoOwes(text: string): WhoOwesIntent | null {
  const w = words(text);

  // "who owes"
  if (w.length >= 2 && w[0] === 'who' && w[1] === 'owes') {
    return { kind: 'whoOwes', page: 1 };
  }

  // "debts"
  if (w.length === 1 && w[0] === 'debts') {
    return { kind: 'whoOwes', page: 1 };
  }

  // "owes" or "owes 2"
  if (w[0] === 'owes') {
    if (w.length === 1) {
      return { kind: 'whoOwes', page: 1 };
    }
    if (w.length === 2) {
      const page = parseInt(w[1], 10);
      if (!isNaN(page) && page > 0) {
        return { kind: 'whoOwes', page };
      }
    }
  }

  return null;
}

// ============================================================================
// Balance Intent Parsing
// ============================================================================

/**
 * Try to parse "balance" (how much does X owe) intent.
 * Patterns:
 * 23. "how much does Tendai owe", "Tendai?"
 */
function tryBalance(text: string): BalanceIntent | null {
  const w = words(text);

  // "how much does Tendai owe"
  if (w[0] === 'how' && w[1] === 'much' && w[2] === 'does' && w[4] === 'owe') {
    const customer = w[3];
    return { kind: 'balance', customer };
  }

  // "Tendai?" - single word ending with ?
  if (w.length === 1 && w[0].endsWith('?')) {
    const customer = w[0].replace('?', '');
    if (customer.length > 0) {
      return { kind: 'balance', customer };
    }
  }

  return null;
}

// ============================================================================
// Main Reader Function
// ============================================================================

/**
 * Parse a text message into an Intent.
 * Returns an Intent representing the owner's action.
 */
export function readIntent(text: string, currency: Currency): Intent {
  // Try each pattern in order
  let intent: Intent | null;

  // Try simple actions first (they're case-insensitive and straightforward)
  intent = trySimpleAction(text);
  if (intent) return intent;

  // Try complex intents that need amount parsing
  intent = tryWhoOwes(text);
  if (intent) return intent;

  intent = tryBalance(text);
  if (intent) return intent;

  intent = trySale(text, currency);
  if (intent) return intent;

  intent = tryExpense(text, currency);
  if (intent) return intent;

  intent = tryDebt(text, currency);
  if (intent) return intent;

  intent = tryPayment(text, currency);
  if (intent) return intent;

  // Default to unknown
  return { kind: 'unknown' };
}
