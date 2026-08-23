/**
 * Vercel serverless entry point for the sync server.
 *
 * vercel.json rewrites every path to this function; the router in
 * apps/sync/src/routes.ts sees the original URL and dispatches as usual.
 * Locally you can still run the plain Node server (apps/sync/src/index.ts).
 *
 * Required Vercel environment variables: JT_GRANT_KEY, APP_TOKEN.
 *
 * Any startup/config error is returned as JSON (message + presence booleans,
 * never secret values) instead of Vercel's opaque crash page.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv } from "../apps/sync/src/env.ts";
import { createPaveClient } from "../apps/sync/src/pave.ts";
import { createHandler } from "../apps/sync/src/routes.ts";

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

let handler: Handler | null = null;

export default async function entry(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (!handler) {
      const env = loadEnv();
      handler = createHandler({
        pave: createPaveClient(env.jtGrantKey),
        appToken: env.appToken,
      });
    }
    await handler(req, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(500, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: message,
        diagnostics: {
          node: process.version,
          hasJtGrantKey: Boolean(process.env.JT_GRANT_KEY),
          hasAppToken: Boolean(process.env.APP_TOKEN),
        },
      }),
    );
  }
}
