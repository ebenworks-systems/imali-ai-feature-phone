/** Limits, sentences and fixed values of the server. Every sentence is plain ASCII and under 100 characters. */

export const MAX_MENU_INPUT = 182; // also the dialled menu screen limit
export const MAX_SMS_TEXT = 480; // an incoming text
export const SMS_REPLY_LIMIT = 160;
export const MAX_BODY_BYTES = 8192;
export const RATE_LIMIT = 60; // requests per phone number on the browser routes
export const RATE_WINDOW_MS = 60_000;
export const MAX_RECORDS_PER_SHOP = 2000;
export const DEMO_SERVICE_CODE = '*384*46254#';
export const DEFAULT_SHORTCODE = '46254'; // the Africa's Talking sandbox short code

/** Every demo number starts with this: +27 00 000 and four more digits. Defined for the stores in store/demo.ts. */
export { DEMO_PHONE_PREFIX } from '../store/demo.js';
/** POST /api/phone/demo: calls per client address per hour. Kept in the store, so it holds across instances. */
export const DEMO_CREATES_PER_HOUR = 10;
export const DEMO_WINDOW_MS = 3_600_000;
/** Demo shops in all. */
export const MAX_DEMO_SHOPS = 5000;
/** Demo shops the whole site may make in 24 hours. Kept in the store. */
export const MAX_DEMO_SHOPS_PER_DAY = 1000;
/** Demo shops older than 7 days are removed, at most this many on each call to POST /api/phone/demo. */
export const DEMO_SWEEP_PER_CALL = 50;
/** Shops on any other number (Africa's Talking sign-ups) in all, counted in the store. */
export const MAX_OTHER_SHOPS = 2000;

/** Every browser route: requests per client address per minute, as well as RATE_LIMIT per phone number. */
export const ADDRESS_RATE_LIMIT = 120;
/** /ussd and /sms: requests per client address and per phone number per minute (one USSD key press is one request). */
export const AT_ADDRESS_RATE_LIMIT = 300;
export const AT_PHONE_RATE_LIMIT = 30;
/** Calls to the optional model reader, all callers together, per hour. Per instance. */
export const READER_CALLS_PER_HOUR = 200;
export const READER_WINDOW_MS = 3_600_000;

/**
 * The salt for hashing client addresses when ADDRESS_SALT is not set. It is the same in every instance, so every
 * instance counts alike. It is not a secret: set ADDRESS_SALT to a long random string to make the hashes unguessable.
 */
export const DEFAULT_ADDRESS_SALT = 'imali-ai-feature-phone/address/v1';
/** An Africa's Talking text id that is remembered: 1 to 100 letters, digits and _ . : - */
export const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,100}$/;

export const SENTENCES = {
  generic: 'Sorry, something went wrong. Please try again.',
  menuLong: 'That entry is too long. Please dial again.',
  smsLong: 'That message is too long. Please send a shorter one.',
  full: 'This shop book is full. Please start a new demo shop.',
  rate: 'Too many requests. Please wait a minute and try again.',
  notDemo: 'Use a demo number: +2700000 followed by 4 digits.',
  noShop: 'No demo shop for this number. Start a demo first.',
  taken: 'That demo number is already in use. Pick another.',
  noNumbers: 'No demo numbers are free right now. Please try again later.',
  badBody: 'Send JSON like {"phone":"+27000001234","text":"today"}.',
  tooBig: 'That request is too big.',
  missing: (field: string): string => `Missing field: ${field}.`,
  badPhone: 'That phone number does not look right.',
  notFound: 'Not found.',
  forbidden: 'Not allowed. Check the key in the callback address.',
  working: 'Got your message. Working on it.',
  demoRate: 'Too many demo shops from this address. Please try again later.',
  demoFull: 'The demo is full right now. Please try again later.',
  noDemoShop: 'No demo shop on this number. Press Start demo shop.',
  callbacksOff: 'This service is not set up yet. Please try again later.',
  shopsFull: 'Sorry, no new shops can be added right now. Please try again later.'
} as const;
