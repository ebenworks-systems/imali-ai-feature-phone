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

/** Every demo number starts with this: +27 00 000 and four more digits. */
export const DEMO_PHONE_PREFIX = '+2700000';
/** POST /api/phone/demo: calls per client address per hour. */
export const DEMO_CREATES_PER_HOUR = 10;
export const DEMO_WINDOW_MS = 3_600_000;
/** Demo shops in all. */
export const MAX_DEMO_SHOPS = 5000;
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
  demoFull: 'The demo is full right now. Please try again later.'
} as const;
