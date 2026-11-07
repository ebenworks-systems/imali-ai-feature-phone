/**
 * The Node entry's app: the same app as on Vercel, plus the files in `public/` for every GET that matches no route.
 * On Vercel the platform serves `public/` itself, so `createApp` has no static code.
 */

import { serveStatic } from '@hono/node-server/serve-static';
import { createAppFromEnv, type Started } from './bootstrap.js';

export function createNodeApp(
  env: Record<string, string | undefined>,
  options: { publicDir?: string; now?: () => Date; fetch?: typeof fetch } = {}
): Started {
  const started = createAppFromEnv(env, {
    ...(options.now ? { now: options.now } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {})
  });
  // Registered after the routes, so an API route wins over a file of the same name. `serveStatic` calls next() when
  // the file does not exist, so an unknown GET reaches the 404 handler. `/` gives index.html.
  started.app.get('*', serveStatic({ root: options.publicDir ?? './public' }));
  return started;
}
