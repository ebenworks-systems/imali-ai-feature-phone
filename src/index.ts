/**
 * Imali AI feature-phone ledger - package entry.
 *
 * The ledger core (money, records, queries, export) and the channels (SMS handler, model reader). Everything
 * the core exported before is still exported from here under the same names.
 */

export * from './core/index.js';
export * from './channels/index.js';
