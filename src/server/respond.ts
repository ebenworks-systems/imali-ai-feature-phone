import type { Context } from 'hono';
import type { AppEnv } from './context.js';

type C = Context<AppEnv>;
type RefuseStatus = 400 | 403 | 404 | 409 | 413 | 429 | 500 | 503;

/** True for the paths that answer in JSON. */
export function isApiPath(path: string): boolean {
  return path.startsWith('/api/');
}

/**
 * Refuses with a plain sentence: `{ error }` as JSON under `/api/`, plain text everywhere else.
 * Nothing but the sentence goes into the body.
 */
export function refuse(c: C, status: RefuseStatus, sentence: string, headers?: Record<string, string>): Response {
  if (headers) {
    for (const [name, value] of Object.entries(headers)) c.header(name, value);
  }
  return isApiPath(c.req.path) ? c.json({ error: sentence }, status) : c.text(sentence, status);
}
