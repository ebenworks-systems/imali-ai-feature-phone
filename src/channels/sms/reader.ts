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
  | 'whoOwes' | 'balance' | 'close' | 'help' | 'unknown' | 'ambiguous';

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

export interface AmbiguousIntent {
  kind: 'ambiguous';
  options: Array<{ cents: number; quantity?: number }>;
  base: { kind: 'sale' | 'expense' };
}

export interface SimpleIntent {
  kind: 'undo' | 'today' | 'close' | 'help' | 'unknown';
}

export type Intent =
  | SaleIntent | ExpenseIntent | DebtIntent | PaymentIntent
  | WhoOwesIntent | BalanceIntent | AmbiguousIntent | SimpleIntent;

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
 * Split text into words for parsing (normalized)
 */
function words(text: string): string[] {
  return normalize(text).split(' ');
}

/**
 * Split text into words preserving original case (but still collapsing spaces)
 */
function wordsPreserveCase(text: string): string[] {
  return text.trim().replace(/\s+/g, ' ').split(' ');
}

// ============================================================================
// Sale Intent Parsing
// ============================================================================

/**
 * Two numbers with no clear order, such as "sold 45 3 bread": either the first is the money and the second is
 * how many (R45 for 3), or the other way round (R3 for 45). A count must be a plain whole number, so a number
 * written "R45" or "45.50" never becomes a count.
 */
function askTwoNumbers(
  firstText: string,
  secondText: string,
  firstCents: number,
  secondCents: number
): AmbiguousIntent {
  const asCount = (text: string): { quantity?: number } => {
    const count = /^\d+$/.test(text) ? Number(text) : 0;
    return Number.isSafeInteger(count) && count > 0 ? { quantity: count } : {};
  };
  return {
    kind: 'ambiguous',
    options: [
      { cents: firstCents, ...asCount(secondText) },
      { cents: secondCents, ...asCount(firstText) }
    ],
    base: { kind: 'sale' }
  };
}

/**
 * Try to parse a sale intent from the message.
 * Patterns:
 * 1. "sold 3 bread 45" -> {quantity, item, amount}
 * 2. "sold bread 45" -> {item, amount}; "sold 45 bread" -> {amount, item}
 * 3. "sale 45" -> {amount}
 * 4. "45 bread" -> {amount, item}
 * 5. "sold 3 bread at 15" -> {quantity, item, unit_price}
 * 6. "3 bread @15" -> {quantity, item, @unit_price}
 * 7. "3 bread x15" -> {quantity, item, x_unit_price}
 */
function trySale(text: string, currency: Currency): SaleIntent | AmbiguousIntent | null {
  const w = words(text);
  const wPreserve = wordsPreserveCase(text);

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
          item = wPreserve.slice(qtyIdx + 1, unitPriceIdx).join(' ');
        }
      } else if (beforePrice.length >= 2) {
        // "3 bread @15"
        const potentialQty = parseInt(beforePrice[0], 10);
        if (!isNaN(potentialQty) && potentialQty > 0) {
          qty = potentialQty;
          item = wPreserve.slice(1, unitPriceIdx).join(' ');
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
      // Check if the rest could be ambiguous when interpreted as a standalone amount
      // For "sold 2 200", check if "2 200" is ambiguous
      if (w.length === 3) {
        const wholeAmountText = wPreserve.slice(1).join(' ');
        const result = parseAmount(wholeAmountText, currency);
        if (result.type === 'ambiguous') {
          // This is genuinely ambiguous - could be qty+amount or a single amount
          // parseAmount returns [qty*amount, single_amount], so add qty info to first option
          return {
            kind: 'ambiguous',
            options: [
              { cents: result.possibleAmounts[0].cents, quantity: potentialQty },  // qty items for total amount
              { cents: result.possibleAmounts[1].cents }  // single amount
            ],
            base: { kind: 'sale' }
          };
        }
      }

      // Words from index 2 onwards are item + amount
      // Find where the amount starts (could be any numeric-like pattern)
      for (let i = 2; i < w.length; i++) {
        const amountText = wPreserve.slice(i).join(' ');
        const result = parseAmount(amountText, currency);
        if (result.type === 'success') {
          const itemPart = w.slice(2, i).join(' '); // Use normalized (lowercase) for item
          return {
            kind: 'sale',
            cents: result.amount.cents,
            item: itemPart || undefined,
            quantity: potentialQty
          };
        } else if (result.type === 'ambiguous') {
          // Ambiguous amount with item - return as ambiguous intent
          return {
            kind: 'ambiguous',
            options: result.possibleAmounts.map(amt => ({
              cents: amt.cents,
              quantity: potentialQty
            })),
            base: { kind: 'sale' }
          };
        }
      }
    }
  }

  // Pattern 2: "sold bread 45"
  if (w[0] === 'sold' && w.length >= 2) {
    // Try from the end - find the first word that parses as an amount
    for (let i = w.length - 1; i >= 1; i--) {
      const amountText = wPreserve[i]; // Use preserved case for parseAmount
      const result = parseAmount(amountText, currency);
      if (result.type === 'success') {
        // "sold 45 3 bread": two numbers in a row, then the item. Which one is the money and which one is
        // the count? Nothing says, so ask instead of saving R3 with the item "45".
        if (i === 2 && i < w.length - 1) {
          const first = parseAmount(wPreserve[1], currency);
          if (first.type === 'success') {
            return askTwoNumbers(wPreserve[1], wPreserve[2], first.amount.cents, result.amount.cents);
          }
        }
        // "sold bread 45": the item is before the amount.
        // "sold 45 bread": nothing before the amount, so the words after it are the item.
        const itemPart = i > 1 ? w.slice(1, i).join(' ') : w.slice(i + 1).join(' '); // normalized (lowercase)
        return {
          kind: 'sale',
          cents: result.amount.cents,
          item: itemPart || undefined
        };
      }
    }
  }

  // Pattern 3: "sale 45"
  if (w[0] === 'sale' && w.length >= 2) {
    const amountText = wPreserve.slice(1).join(' ');
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
    const result = parseAmount(wPreserve[0], currency);
    if (result.type === 'success') {
      const itemPart = w.slice(1).join(' '); // Use normalized (lowercase) for item
      return {
        kind: 'sale',
        cents: result.amount.cents,
        item: itemPart || undefined
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
function tryExpense(text: string, currency: Currency): ExpenseIntent | AmbiguousIntent | null {
  const w = words(text);
  const wPreserve = wordsPreserveCase(text);

  // Pattern 9: "spend 120 on transport"
  // Check this before pattern 8 to avoid conflicts
  if (w[0] === 'spend' && w.length >= 4 && w[2] === 'on') {
    const amountText = wPreserve[1];
    const result = parseAmount(amountText, currency);
    if (result.type === 'success') {
      const itemPart = w.slice(3).join(' '); // Use normalized (lowercase) for item
      return {
        kind: 'expense',
        cents: result.amount.cents,
        item: itemPart || undefined
      };
    }
  }

  // Pattern 8: "spent 120 transport" or "spent 1 200 stock" or "spent 2 200"
  if ((w[0] === 'spent' || w[0] === 'spend') && w.length >= 2) {
    // Try from index 1 onwards, starting with longer sequences
    for (let i = w.length - 1; i >= 1; i--) {
      const amountText = wPreserve.slice(1, i + 1).join(' ');
      const result = parseAmount(amountText, currency);
      if (result.type === 'success') {
        const itemPart = w.slice(i + 1).join(' '); // Use normalized (lowercase) for item
        return {
          kind: 'expense',
          cents: result.amount.cents,
          item: itemPart || undefined
        };
      } else if (result.type === 'ambiguous') {
        // Check if there's an item part
        const hasItem = i + 1 < w.length;
        
        if (hasItem) {
          // For ambiguous amounts with an item, take the first (longer) interpretation
          const itemPart = w.slice(i + 1).join(' ');
          return {
            kind: 'expense',
            cents: result.possibleAmounts[0].cents,
            item: itemPart || undefined
          };
        } else {
          // No item, so it's ambiguous
          // Check if we can extract quantity from the amount string for annotation
          const amountWords = amountText.split(/\s+/);
          if (amountWords.length >= 2 && /^\d+$/.test(amountWords[0])) {
            const potentialQty = parseInt(amountWords[0], 10);
            if (potentialQty >= 2) {
              return {
                kind: 'ambiguous',
                options: [
                  { cents: result.possibleAmounts[0].cents, quantity: potentialQty },
                  { cents: result.possibleAmounts[1].cents }
                ],
                base: { kind: 'expense' }
              };
            }
          }
          return {
            kind: 'ambiguous',
            options: result.possibleAmounts.map(amt => ({ cents: amt.cents })),
            base: { kind: 'expense' }
          };
        }
      }
    }
  }

  // Pattern 10: "expense 120 stock"
  if (w[0] === 'expense' && w.length >= 2) {
    const amountText = wPreserve[1];
    const result = parseAmount(amountText, currency);
    if (result.type === 'success') {
      const itemPart = w.slice(2).join(' '); // Use normalized (lowercase) for item
      return {
        kind: 'expense',
        cents: result.amount.cents,
        item: itemPart || undefined
      };
    }
  }

  // Pattern 11: "bought stock 500"
  if (w[0] === 'bought' && w.length >= 2) {
    // Try from the end - find the first word that parses as an amount
    for (let i = w.length - 1; i >= 1; i--) {
      const amountText = wPreserve[i];
      const result = parseAmount(amountText, currency);
      if (result.type === 'success') {
        const itemPart = w.slice(1, i).join(' '); // Use normalized (lowercase) for item
        return {
          kind: 'expense',
          cents: result.amount.cents,
          item: itemPart || undefined
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
    const amountText = wPreserve[1];
    const result = parseAmount(amountText, currency);
    if (result.type === 'success') {
      const itemPart = w.slice(2).join(' '); // Use normalized (lowercase) for item
      return {
        kind: 'expense',
        cents: result.amount.cents,
        item: itemPart || undefined
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
 * Multi-word names: "Mai Rudo owes 20 sugar"
 */
function tryDebt(text: string, currency: Currency): DebtIntent | null {
  const w = words(text);
  const wPreserve = wordsPreserveCase(text);

  // Pattern 13: "Tendai owes 20 sugar" or "Mai Rudo owes 20 sugar"
  const owesIdx = w.indexOf('owes');
  if (owesIdx > 0 && owesIdx + 1 < w.length) {
    const customer = wPreserve.slice(0, owesIdx).join(' ');
    const amountText = wPreserve[owesIdx + 1];
    const result = parseAmount(amountText, currency);
    if (result.type === 'success') {
      const itemPart = w.slice(owesIdx + 2).join(' '); // Use normalized (lowercase) for item
      return {
        kind: 'debt',
        customer,
        cents: result.amount.cents,
        item: itemPart || undefined
      };
    }
  }

  // Pattern 15: "credit Tendai 20 sugar" or "credit Mai Rudo 20 sugar"
  if (w[0] === 'credit' && w.length >= 3) {
    // Find the amount - it's the first thing that parses as an amount starting from index 1
    for (let i = 1; i < w.length; i++) {
      const amountText = wPreserve[i];
      const result = parseAmount(amountText, currency);
      if (result.type === 'success') {
        const customer = wPreserve.slice(1, i).join(' ');
        const itemPart = w.slice(i + 1).join(' '); // Use normalized (lowercase) for item
        return {
          kind: 'debt',
          customer,
          cents: result.amount.cents,
          item: itemPart || undefined
        };
      }
    }
  }

  // Pattern 16: "Tendai took 20 on credit"
  const tookIdx = w.indexOf('took');
  if (tookIdx > 0 && tookIdx + 1 < w.length) {
    const amountText = wPreserve[tookIdx + 1];
    const result = parseAmount(amountText, currency);
    if (result.type === 'success' && w[tookIdx + 2] === 'on' && w[tookIdx + 3] === 'credit') {
      const customer = wPreserve.slice(0, tookIdx).join(' ');
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
 * Multi-word names: "Mai Rudo paid 10", "received 10 from Mai Rudo"
 */
function tryPayment(text: string, currency: Currency): PaymentIntent | null {
  const w = words(text);
  const wPreserve = wordsPreserveCase(text);

  // Pattern 17: "Tendai paid 10" or "Mai Rudo paid 10"
  const paidIdx = w.indexOf('paid');
  if (paidIdx > 0 && paidIdx + 1 < w.length) {
    // Check if "back" follows "paid"
    if (w[paidIdx + 1] === 'back' && paidIdx + 2 < w.length) {
      // Pattern 18: "Tendai paid back 10"
      const customer = wPreserve.slice(0, paidIdx).join(' ');
      const amountText = wPreserve.slice(paidIdx + 2).join(' ');
      const result = parseAmount(amountText, currency);
      if (result.type === 'success') {
        return {
          kind: 'payment',
          customer,
          cents: result.amount.cents
        };
      }
    } else {
      // Pattern 17: "Tendai paid 10"
      const customer = wPreserve.slice(0, paidIdx).join(' ');
      const amountText = wPreserve.slice(paidIdx + 1).join(' ');
      const result = parseAmount(amountText, currency);
      if (result.type === 'success') {
        return {
          kind: 'payment',
          customer,
          cents: result.amount.cents
        };
      }
    }
  }

  // Pattern 19: "received 10 from Tendai" or "received 10 from Mai Rudo"
  if (w[0] === 'received' && w.length >= 3) {
    const amountText = wPreserve[1];
    const result = parseAmount(amountText, currency);
    if (result.type === 'success' && w[2] === 'from') {
      const customer = wPreserve.slice(3).join(' ');
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
 * 23. "how much does Tendai owe", "how much does Mai Rudo owe", "Tendai?"
 */
function tryBalance(text: string): BalanceIntent | null {
  const w = words(text);
  const wPreserve = wordsPreserveCase(text);

  // "how much does Tendai owe" or "how much does Mai Rudo owe"
  if (w[0] === 'how' && w[1] === 'much' && w[2] === 'does' && w[w.length - 1] === 'owe') {
    const customer = wPreserve.slice(3, -1).join(' ');
    return { kind: 'balance', customer };
  }

  // "Tendai?" - single word ending with ?
  if (w.length === 1 && w[0].endsWith('?')) {
    const customer = wPreserve[0].replace('?', '');
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
