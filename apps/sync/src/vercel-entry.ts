/**
 * Vercel serverless entry point for the sync server.
 *
 * vercel.json rewrites every path to this function; the router in
 * apps/sync/src/routes.ts sees the original URL and dispatches as usual.
 * Locally you can still run the plain Node server (apps/sync/src/index.ts).
 *
 * Required Vercel environment variables: JT_GRANT_KEY, SESSION_SECRET,
 * GOOGLE_CLIENT_ID. Optional: GOOGLE_WORKSPACE_DOMAIN (defaults to
 * deitemeyerbrothers.com), GOOGLE_ALLOWED_EMAILS, WEBHOOK_SECRET.
 *
 * Any startup/config error is returned as JSON (message + presence booleans,
 * never secret values) instead of Vercel's opaque crash page.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv } from "./env";
import { createPaveClient } from "./pave";
import { createHandler } from "./routes";
import { ensureWebhook } from "./webhookRegistration";

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

let handler: Handler | null = null;

export default async function entry(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (!handler) {
      const env = loadEnv();
      const pave = createPaveClient(env.jtGrantKey);
      // Fire-and-forget: retried on the next cold start if it doesn't land.
      void ensureWebhook(pave, env.publicUrl, env.webhookSecret).catch(() => {});
      handler = createHandler({
        pave,
        sessionSecret: env.sessionSecret,
        googleClientId: env.googleClientId,
        workspaceDomain: env.workspaceDomain,
        allowedEmails: env.allowedEmails,
        webhookSecret: env.webhookSecret,
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
          hasSessionSecret: Boolean(process.env.SESSION_SECRET),
          hasGoogleClientId: Boolean(process.env.GOOGLE_CLIENT_ID),
        },
      }),
    );
  }
}
