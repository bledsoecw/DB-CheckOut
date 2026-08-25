import { createServer } from "node:http";
import { loadEnv } from "./env";
import { createPaveClient } from "./pave";
import { createHandler } from "./routes";

const env = loadEnv();
const pave = createPaveClient(env.jtGrantKey);
const handler = createHandler({
  pave,
  sessionSecret: env.sessionSecret,
  googleClientId: env.googleClientId,
  workspaceDomain: env.workspaceDomain,
  allowedEmails: env.allowedEmails,
  webhookSecret: env.webhookSecret,
});

const server = createServer((req, res) => {
  void handler(req, res);
});

server.listen(env.port, () => {
  console.log(`DB CheckOut sync listening on :${env.port}`);
  console.log(`Webhook URL path: /webhooks/jobtread/<WEBHOOK_SECRET>`);
});
