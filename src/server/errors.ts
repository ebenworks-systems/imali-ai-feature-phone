import { SENTENCES } from './constants.js';
import { maskPhone } from './phone.js';

/** The sentence an owner may see for an error. Never the message of the error itself. */
export function ownerSentence(error: unknown): string {
  if (error instanceof Error && error.name === 'RecordLimitError') return SENTENCES.full;
  if (error instanceof Error && error.name === 'ShopLimitError') return SENTENCES.shopsFull;
  return SENTENCES.generic;
}

/**
 * Writes one JSON line to the log with the route, the error name, message and stack, and a masked phone number.
 * The log is for the person running the server; nothing here goes into a response.
 */
export function logError(route: string, error: unknown, phone?: string): void {
  const e = error instanceof Error ? error : new Error(String(error));
  console.error(
    JSON.stringify({
      level: 'error',
      route,
      name: e.name,
      message: e.message,
      stack: e.stack,
      ...(phone ? { phone: maskPhone(phone) } : {})
    })
  );
}
