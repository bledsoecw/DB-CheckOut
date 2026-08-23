import { createServer } from "node:http";
import { loadEnv } from "./env.ts";
import { createPaveClient } from "./pave.ts";
import { createHandler } from "./routes.ts";

const env = loadEnv();
const pave = createPaveClient(env.jtGrantKey);
const handler = createHandler({ pave, appToken: env.appToken });

const server = createServer((req, res) => {
  void handler(req, res);
});

server.listen(env.port, () => {
  console.log(`DB CheckOut sync listening on :${env.port}`);
  console.log(`Webhook URL path: /webhooks/jobtread/<APP_TOKEN>`);
});
