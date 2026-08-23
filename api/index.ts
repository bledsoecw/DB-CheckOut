/**
 * Vercel serverless entry point for the sync server.
 *
 * vercel.json rewrites every path to this function; the router in
 * apps/sync/src/routes.ts sees the original URL and dispatches as usual.
 * Locally you can still run the plain Node server (apps/sync/src/index.ts).
 *
 * Required Vercel environment variables: JT_GRANT_KEY, APP_TOKEN.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv } from "../apps/sync/src/env.ts";
import { createPaveClient } from "../apps/sync/src/pave.ts";
import { createHandler } from "../apps/sync/src/routes.ts";

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

let handler: Handler | null = null;

export default function entry(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!handler) {
    const env = loadEnv();
    handler = createHandler({
      pave: createPaveClient(env.jtGrantKey),
      appToken: env.appToken,
    });
  }
  return handler(req, res);
}
