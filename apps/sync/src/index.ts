import { createServer } from "node:http";
import { loadEnv } from "./env";
import { createPaveClient } from "./pave";
import { createHandler } from "./routes";
import { ensureWebhook } from "./webhookRegistration";

const env = loadEnv();
const pave = createPaveClient(env.jtGrantKey);
const handler = createHandler({
  pave,
  sessionSecret: env.sessionSecret,
  geminiApiKey: env.geminiApiKey,
  geminiModel: env.geminiModel,
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
  void ensureWebhook(pave, env.publicUrl, env.webhookSecret)
    .then((r) => console.log(`JobTread webhook: ${r}`))
    .catch((err) => console.log(`JobTread webhook registration failed: ${err}`));
});
