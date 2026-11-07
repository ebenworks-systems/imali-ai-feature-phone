/**
 * Starts the server on Node: `npm run dev` or `npm start`, from the repository root (the static folder is `./public`).
 * Not imported by any test; `node.ts` carries the testable part.
 */

import { serve } from '@hono/node-server';
import { ConfigError, readPort } from './config.js';
import { createNodeApp } from './node.js';

let port: number;
try {
  port = readPort(process.env);
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : 'PORT is not valid');
  process.exit(1);
}

const started = createNodeApp(process.env);
console.log(`Imali AI feature-phone ledger: ${started.summary}`);
for (const warning of started.warnings) console.warn(`Warning: ${warning}`);

// Local only: this server is for running the demo on your own machine. Vercel serves the live one.
const server = serve({ fetch: started.app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
});

async function stop(): Promise<void> {
  server.close();
  await started.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
