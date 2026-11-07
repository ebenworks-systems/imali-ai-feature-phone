/**
 * The Vercel entry: the same app as `npm run dev`, as one Node function.
 * `vercel.json` sends /ussd, /sms, /health and /api/* here, and serves `public/` as static files.
 *
 * `hono/vercel`'s `handle` is deprecated in Hono 4 and removed in Hono 5. It is `(req) => app.fetch(req)`, so staying on
 * Hono 4 is safe, and moving later is a one-line change to `export default { fetch: app.fetch }`.
 */

import { handle } from 'hono/vercel';
import { createAppFromEnv } from '../src/server/bootstrap.js';

const { app, summary, warnings } = createAppFromEnv(process.env);

// Once per cold start. The line never holds the value of a variable.
console.log(`Imali AI feature-phone ledger: ${summary}`);
for (const warning of warnings) console.warn(`Warning: ${warning}`);

export const GET = handle(app);
export const POST = handle(app);
