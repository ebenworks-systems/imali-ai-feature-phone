/**
 * Reads the environment into a plain object. The only place besides `main.ts` that knows the variable names.
 * A value that is unset, empty or only spaces counts as not set. Warnings never contain a value.
 */

import { DEFAULT_SHORTCODE } from './constants.js';

export interface ServerConfig {
  databaseUrl?: string;
  geminiApiKey?: string;
  /** GEMINI_MODEL. Used only when `geminiApiKey` is set. */
  geminiModel?: string;
  /** GEMINI_VERTEX_PROJECT. Used only when `geminiApiKey` is set: ask Gemini on Vertex AI in this Google Cloud project. */
  geminiVertexProject?: string;
  at?: { username: string; apiKey: string; shortcode: string };
  /** AT_CALLBACK_KEY: when set, POST /ussd and POST /sms need `?k=<this>`. */
  callbackKey?: string;
  /**
   * True when the Africa's Talking sender is set (AT_USERNAME and AT_API_KEY) and AT_CALLBACK_KEY is not. Then
   * POST /ussd and POST /sms are refused with 503: open callbacks would let anyone read and write the ledger of any
   * number and make the server send texts from the account. With no sender (a local run) they stay open.
   */
  callbacksMissingKey?: true;
  /** ADDRESS_SALT: the salt client addresses are hashed with. Unset: the fixed built-in salt (`salt=default`). */
  addressSalt?: string;
  /** VERCEL is set. */
  onVercel: boolean;
  warnings: string[];
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function readConfig(env: Env): ServerConfig {
  const databaseUrl = clean(env.DATABASE_URL);
  const geminiApiKey = clean(env.GEMINI_API_KEY);
  const geminiModel = clean(env.GEMINI_MODEL);
  const geminiVertexProject = clean(env.GEMINI_VERTEX_PROJECT);
  const username = clean(env.AT_USERNAME);
  const apiKey = clean(env.AT_API_KEY);
  const shortcode = clean(env.AT_SHORTCODE) ?? DEFAULT_SHORTCODE;
  const callbackKey = clean(env.AT_CALLBACK_KEY);
  const addressSalt = clean(env.ADDRESS_SALT);
  const onVercel = clean(env.VERCEL) !== undefined;
  const warnings: string[] = [];

  if (username && !apiKey) warnings.push('AT_API_KEY is missing, so replies are not sent as texts');
  if (apiKey && !username) warnings.push('AT_USERNAME is missing, so replies are not sent as texts');
  const callbacksMissingKey = Boolean(username && apiKey && !callbackKey);
  if (callbacksMissingKey) {
    warnings.push('AT_CALLBACK_KEY is not set, so /ussd and /sms answer 503 until it is (the browser phone still works)');
  }
  if (onVercel && !databaseUrl) warnings.push('DATABASE_URL is not set, so records are not kept between calls');
  // The built-in salt is in the public repository, so on the live site anyone who can read the demo_quota table could
  // hash every IPv4 address and recover the addresses. A local run keeps the default without a warning.
  if (onVercel && !addressSalt) {
    warnings.push('ADDRESS_SALT is not set, so stored address hashes use the public default salt');
  }

  return {
    ...(databaseUrl ? { databaseUrl } : {}),
    ...(geminiApiKey ? { geminiApiKey } : {}),
    ...(geminiModel ? { geminiModel } : {}),
    ...(geminiVertexProject ? { geminiVertexProject } : {}),
    ...(username && apiKey ? { at: { username, apiKey, shortcode } } : {}),
    ...(callbackKey ? { callbackKey } : {}),
    ...(callbacksMissingKey ? { callbacksMissingKey: true as const } : {}),
    ...(addressSalt ? { addressSalt } : {}),
    onVercel,
    warnings
  };
}

/** PORT, default 3000. Throws a ConfigError that names PORT unless it is a whole number from 1 to 65535. */
export function readPort(env: Env): number {
  const raw = clean(env.PORT);
  if (raw === undefined) return 3000;
  const port = /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError('PORT must be a whole number from 1 to 65535');
  }
  return port;
}
