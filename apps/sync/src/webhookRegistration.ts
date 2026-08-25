/**
 * Self-registering JobTread webhook: on startup the server makes sure a
 * webhook pointing at PUBLIC_URL/webhooks/jobtread/WEBHOOK_SECRET exists,
 * so task/job changes made inside JobTread (a PM completing a punch task
 * on the board) still trigger the automatic Punch Review status flip.
 * Other webhooks in the org (e.g. the portal's) are never touched.
 */

import { ORGANIZATION_ID } from "../../../packages/shared/src/jobtread";
import type { PaveClient } from "./pave";

export const WEBHOOK_EVENT_TYPES = ["taskCreated", "taskUpdated", "taskDeleted", "jobUpdated"];

export type WebhookRegistration = "created" | "exists" | "skipped";

export async function ensureWebhook(
  pave: PaveClient,
  publicUrl: string,
  webhookSecret: string,
): Promise<WebhookRegistration> {
  if (!publicUrl || !webhookSecret) return "skipped";
  const target = `${publicUrl.replace(/\/$/, "")}/webhooks/jobtread/${webhookSecret}`;
  const res = await pave.query<{
    organization: { webhooks: { nodes: Array<{ id: string; url: string }> } };
  }>({
    organization: {
      $: { id: ORGANIZATION_ID },
      webhooks: { $: { size: 50 }, nodes: { id: {}, url: {} } },
    },
  });
  if (res.organization.webhooks.nodes.some((w) => w.url === target)) return "exists";
  await pave.query({
    createWebhook: {
      $: { organizationId: ORGANIZATION_ID, url: target, eventTypes: WEBHOOK_EVENT_TYPES },
    },
  });
  return "created";
}
