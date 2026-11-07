import { describe, it, expect } from 'vitest';
import { readIntent, type Intent } from '@/channels/sms/reader.ts';

describe('readIntent', () => {
  const currency = 'ZAR' as const;

  describe('Sale patterns', () => {
    it('criterion 1: parses "sold 3 bread 45"', () => {
      const intent = readIntent('sold 3 bread 45', currency);
      expect(intent).toEqual({
        kind: 'sale',
        cents: 4500,
        item: 'bread',
        quantity: 3
      });
    });

    it('criterion 2: parses "sold bread 45"', () => {
      const intent = readIntent('sold bread 45', currency);
      expect(intent).toEqual({
        kind: 'sale',
        cents: 4500,
        item: 'bread'
      });
    });

    it('criterion 3: parses "sale 45"', () => {
      const intent = readIntent('sale 45', currency);
      expect(intent).toEqual({
        kind: 'sale',
        cents: 4500
      });
    });

    it('criterion 4: parses "45 bread"', () => {
      const intent = readIntent('45 bread', currency);
      expect(intent).toEqual({
        kind: 'sale',
        cents: 4500,
        item: 'bread'
      });
    });

    it('criterion 5: parses "sold 3 bread at 15"', () => {
      const intent = readIntent('sold 3 bread at 15', currency);
      expect(intent).toEqual({
        kind: 'sale',
        cents: 4500,
        item: 'bread',
        quantity: 3
      });
    });

    it('criterion 6: parses "3 bread @15"', () => {
      const intent = readIntent('3 bread @15', currency);
      expect(intent).toEqual({
        kind: 'sale',
        cents: 4500,
        item: 'bread',
        quantity: 3
      });
    });

    it('criterion 7: parses "3 bread x15"', () => {
      const intent = readIntent('3 bread x15', currency);
      expect(intent).toEqual({
        kind: 'sale',
        cents: 4500,
        item: 'bread',
        quantity: 3
      });
    });

    it('handles case insensitivity in sale', () => {
      const intent = readIntent('SOLD 3 BREAD 45', currency);
      expect(intent).toEqual({
        kind: 'sale',
        cents: 4500,
        item: 'bread',
        quantity: 3
      });
    });

    it('handles extra spaces in sale', () => {
      const intent = readIntent('sold  3   bread   45', currency);
      expect(intent).toEqual({
        kind: 'sale',
        cents: 4500,
        item: 'bread',
        quantity: 3
      });
    });
  });

  describe('Expense patterns', () => {
    it('criterion 8: parses "spent 120 transport"', () => {
      const intent = readIntent('spent 120 transport', currency);
      expect(intent).toEqual({
        kind: 'expense',
        cents: 12000,
        item: 'transport'
      });
    });

    it('criterion 9: parses "spend 120 on transport"', () => {
      const intent = readIntent('spend 120 on transport', currency);
      expect(intent).toEqual({
        kind: 'expense',
        cents: 12000,
        item: 'transport'
      });
    });

    it('criterion 10: parses "expense 120 stock"', () => {
      const intent = readIntent('expense 120 stock', currency);
      expect(intent).toEqual({
        kind: 'expense',
        cents: 12000,
        item: 'stock'
      });
    });

    it('criterion 11: parses "bought stock 500"', () => {
      const intent = readIntent('bought stock 500', currency);
      expect(intent).toEqual({
        kind: 'expense',
        cents: 50000,
        item: 'stock'
      });
    });

    it('criterion 12: parses "paid 150 rent" (expense, no customer)', () => {
      const intent = readIntent('paid 150 rent', currency);
      expect(intent).toEqual({
        kind: 'expense',
        cents: 15000,
        item: 'rent'
      });
    });

    it('handles case insensitivity in expense', () => {
      const intent = readIntent('SPENT 120 TRANSPORT', currency);
      expect(intent).toEqual({
        kind: 'expense',
        cents: 12000,
        item: 'transport'
      });
    });
  });

  describe('Debt patterns', () => {
    it('criterion 13: parses "Tendai owes 20 sugar"', () => {
      const intent = readIntent('Tendai owes 20 sugar', currency);
      expect(intent).toEqual({
        kind: 'debt',
        customer: 'Tendai',
        cents: 2000,
        item: 'sugar'
      });
    });

    it('criterion 14: parses "Tendai owes 20"', () => {
      const intent = readIntent('Tendai owes 20', currency);
      expect(intent).toEqual({
        kind: 'debt',
        customer: 'Tendai',
        cents: 2000
      });
    });

    it('criterion 15: parses "credit Tendai 20 sugar"', () => {
      const intent = readIntent('credit Tendai 20 sugar', currency);
      expect(intent).toEqual({
        kind: 'debt',
        customer: 'Tendai',
        cents: 2000,
        item: 'sugar'
      });
    });

    it('criterion 16: parses "Tendai took 20 on credit"', () => {
      const intent = readIntent('Tendai took 20 on credit', currency);
      expect(intent).toEqual({
        kind: 'debt',
        customer: 'Tendai',
        cents: 2000
      });
    });

    it('handles case insensitivity in debt', () => {
      const intent = readIntent('TENDAI OWES 20 SUGAR', currency);
      expect(intent).toEqual({
        kind: 'debt',
        customer: 'TENDAI',
        cents: 2000,
        item: 'sugar'
      });
    });
  });

  describe('Payment patterns', () => {
    it('criterion 17: parses "Tendai paid 10"', () => {
      const intent = readIntent('Tendai paid 10', currency);
      expect(intent).toEqual({
        kind: 'payment',
        customer: 'Tendai',
        cents: 1000
      });
    });

    it('criterion 18: parses "Tendai paid back 10"', () => {
      const intent = readIntent('Tendai paid back 10', currency);
      expect(intent).toEqual({
        kind: 'payment',
        customer: 'Tendai',
        cents: 1000
      });
    });

    it('criterion 19: parses "received 10 from Tendai"', () => {
      const intent = readIntent('received 10 from Tendai', currency);
      expect(intent).toEqual({
        kind: 'payment',
        customer: 'Tendai',
        cents: 1000
      });
    });

    it('handles case insensitivity in payment', () => {
      const intent = readIntent('TENDAI PAID 10', currency);
      expect(intent).toEqual({
        kind: 'payment',
        customer: 'TENDAI',
        cents: 1000
      });
    });
  });

  describe('Simple actions', () => {
    it('criterion 20: parses "undo"', () => {
      const intent = readIntent('undo', currency);
      expect(intent).toEqual({ kind: 'undo' });
    });

    it('criterion 20: parses "cancel"', () => {
      const intent = readIntent('cancel', currency);
      expect(intent).toEqual({ kind: 'undo' });
    });

    it('criterion 20: parses "oops"', () => {
      const intent = readIntent('oops', currency);
      expect(intent).toEqual({ kind: 'undo' });
    });

    it('criterion 21: parses "today"', () => {
      const intent = readIntent('today', currency);
      expect(intent).toEqual({ kind: 'today' });
    });

    it('criterion 21: parses "sales"', () => {
      const intent = readIntent('sales', currency);
      expect(intent).toEqual({ kind: 'today' });
    });

    it('criterion 21: parses "total"', () => {
      const intent = readIntent('total', currency);
      expect(intent).toEqual({ kind: 'today' });
    });

    it('criterion 24: parses "close"', () => {
      const intent = readIntent('close', currency);
      expect(intent).toEqual({ kind: 'close' });
    });

    it('criterion 24: parses "summary"', () => {
      const intent = readIntent('summary', currency);
      expect(intent).toEqual({ kind: 'close' });
    });

    it('criterion 24: parses "end of day"', () => {
      const intent = readIntent('end of day', currency);
      expect(intent).toEqual({ kind: 'close' });
    });

    it('criterion 25: parses "help"', () => {
      const intent = readIntent('help', currency);
      expect(intent).toEqual({ kind: 'help' });
    });

    it('criterion 25: parses "?"', () => {
      const intent = readIntent('?', currency);
      expect(intent).toEqual({ kind: 'help' });
    });

    it('criterion 25: parses "menu"', () => {
      const intent = readIntent('menu', currency);
      expect(intent).toEqual({ kind: 'help' });
    });

    it('handles case insensitivity', () => {
      const intent = readIntent('UNDO', currency);
      expect(intent).toEqual({ kind: 'undo' });
    });

    it('handles extra spaces', () => {
      const intent = readIntent('  undo  ', currency);
      expect(intent).toEqual({ kind: 'undo' });
    });
  });

  describe('Who owes patterns', () => {
    it('criterion 22: parses "who owes"', () => {
      const intent = readIntent('who owes', currency);
      expect(intent).toEqual({
        kind: 'whoOwes',
        page: 1
      });
    });

    it('criterion 22: parses "debts"', () => {
      const intent = readIntent('debts', currency);
      expect(intent).toEqual({
        kind: 'whoOwes',
        page: 1
      });
    });

    it('criterion 22: parses "owes"', () => {
      const intent = readIntent('owes', currency);
      expect(intent).toEqual({
        kind: 'whoOwes',
        page: 1
      });
    });

    it('criterion 22: parses "owes 2" (page number)', () => {
      const intent = readIntent('owes 2', currency);
      expect(intent).toEqual({
        kind: 'whoOwes',
        page: 2
      });
    });
  });

  describe('Balance patterns', () => {
    it('criterion 23: parses "how much does Tendai owe"', () => {
      const intent = readIntent('how much does Tendai owe', currency);
      expect(intent).toEqual({
        kind: 'balance',
        customer: 'Tendai'
      });
    });

    it('criterion 23: parses "Tendai?"', () => {
      const intent = readIntent('Tendai?', currency);
      expect(intent).toEqual({
        kind: 'balance',
        customer: 'Tendai'
      });
    });

    it('handles case insensitivity in balance', () => {
      const intent = readIntent('how much does TENDAI owe', currency);
      expect(intent).toEqual({
        kind: 'balance',
        customer: 'TENDAI'
      });
    });
  });

  describe('Unknown patterns', () => {
    it('criterion 26: returns unknown for unmatched text', () => {
      const intent = readIntent('gibberish nonsense blah', currency);
      expect(intent).toEqual({ kind: 'unknown' });
    });

    it('returns unknown for empty intent', () => {
      const intent = readIntent('xyz abc def', currency);
      expect(intent).toEqual({ kind: 'unknown' });
    });
  });

  describe('Sale with the amount first and a word after it', () => {
    it('reads "sold 45 bread" (the help reply example) as R45 of bread', () => {
      expect(readIntent('sold 45 bread', currency)).toEqual({ kind: 'sale', cents: 4500, item: 'bread' });
    });

    it('keeps every word after the amount as the item', () => {
      expect(readIntent('sold 45 bread and milk', currency)).toEqual({
        kind: 'sale',
        cents: 4500,
        item: 'bread and milk'
      });
    });

    it('ignores case and extra spaces', () => {
      expect(readIntent('  Sold   R45   Bread ', currency)).toEqual({ kind: 'sale', cents: 4500, item: 'bread' });
    });

    it('reads "sold 45" with no item', () => {
      expect(readIntent('sold 45', currency)).toEqual({ kind: 'sale', cents: 4500 });
    });

    it('still reads "spent 20 taxi" as an expense for taxi', () => {
      expect(readIntent('spent 20 taxi', currency)).toEqual({ kind: 'expense', cents: 2000, item: 'taxi' });
    });

    it('does not change the shapes that already worked', () => {
      expect(readIntent('sold 3 bread 45', currency)).toEqual({ kind: 'sale', cents: 4500, item: 'bread', quantity: 3 });
      expect(readIntent('sold bread 45', currency)).toEqual({ kind: 'sale', cents: 4500, item: 'bread' });
      expect(readIntent('45 bread', currency)).toEqual({ kind: 'sale', cents: 4500, item: 'bread' });
      expect(readIntent('3 bread @15', currency)).toEqual({ kind: 'sale', cents: 4500, item: 'bread', quantity: 3 });
    });
  });

  describe('Bug fixes', () => {
    it('bug 1: parses "Sold  Bread R45.50" with case/spaces and currency prefix', () => {
      const intent = readIntent('Sold  Bread R45.50', currency);
      expect(intent).toEqual({
        kind: 'sale',
        cents: 4550,
        item: 'bread'
      });
    });

    it('bug 2: handles ambiguous "sold 2 200"', () => {
      const intent = readIntent('sold 2 200', currency);
      expect(intent).toEqual({
        kind: 'ambiguous',
        base: { kind: 'sale' },
        options: [
          { cents: 20000, quantity: 2 },
          { cents: 220000 }
        ]
      });
    });

    it('bug 2b: handles ambiguous "spent 2 200"', () => {
      const intent = readIntent('spent 2 200', currency);
      expect(intent).toEqual({
        kind: 'ambiguous',
        base: { kind: 'expense' },
        options: [
          { cents: 20000, quantity: 2 },
          { cents: 220000 }
        ]
      });
    });

    it('bug 3: returns customer name as typed "Mai Rudo" not lowercased', () => {
      const intent = readIntent('Mai Rudo owes 20 sugar', currency);
      expect(intent).toEqual({
        kind: 'debt',
        customer: 'Mai Rudo',
        cents: 2000,
        item: 'sugar'
      });
    });

    it('bug 3: works with "how much does Mai Rudo owe"', () => {
      const intent = readIntent('how much does Mai Rudo owe', currency);
      expect(intent).toEqual({
        kind: 'balance',
        customer: 'Mai Rudo'
      });
    });

    it('bug 4: handles multi-word customer names in "Mai Rudo owes 20 sugar"', () => {
      const intent = readIntent('Mai Rudo owes 20 sugar', currency);
      expect(intent).toEqual({
        kind: 'debt',
        customer: 'Mai Rudo',
        cents: 2000,
        item: 'sugar'
      });
    });

    it('bug 5: parses "spent 1 200 stock" with thousands group', () => {
      const intent = readIntent('spent 1 200 stock', currency);
      expect(intent).toEqual({
        kind: 'expense',
        cents: 120000,
        item: 'stock'
      });
    });
  });
});
