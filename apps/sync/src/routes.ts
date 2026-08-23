/**
 * HTTP API for the mobile app. Plain node:http — no framework.
 *
 * Auth: the app sends the shared secret as `x-app-token` (per-user JT
 * identity comes later; the crew is five people). The JobTread webhook
 * endpoint is separate and validated by its own secret in the URL path.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { PaveClient } from "./pave";
import {
  CLEANUP_FORM,
  INSPECTION_FORM,
  STATUS,
} from "../../../packages/shared/src/jobtread";
import type { ChecklistSubmission, ProblemReport } from "../../../packages/shared/src/types";
import {
  completeTask,
  createReportTask,
  getJob,
  listPipelineJobs,
  submitForm,
} from "./jt";
import { applyPunchReviewFlip } from "./punchReview";

export interface RouterDeps {
  pave: PaveClient;
  appToken: string;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
}

async function readBody(req: IncomingMessage, limit = 5_000_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("Body too large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function checklistValues(sub: ChecklistSubmission): Record<string, string> {
  return { ...sub.answers, ...(sub.texts ?? {}) };
}

export function createHandler(deps: RouterDeps) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, { ok: true });
      }

      // JobTread webhook: POST /webhooks/jobtread/<APP_TOKEN>
      // On any job/task event we re-evaluate the punch-review flip.
      if (req.method === "POST" && parts[0] === "webhooks" && parts[1] === "jobtread") {
        if (parts[2] !== deps.appToken) return json(res, 401, { error: "Bad webhook token" });
        const body = (await readBody(req)) as Record<string, unknown>;
        const jobId = extractJobId(body);
        let flipped: string | null = null;
        if (jobId) flipped = await applyPunchReviewFlip(deps.pave, jobId);
        return json(res, 200, { ok: true, flipped });
      }

      // Everything below requires the app token.
      if (req.headers["x-app-token"] !== deps.appToken) {
        return json(res, 401, { error: "Unauthorized" });
      }

      if (req.method === "GET" && url.pathname === "/queue") {
        return json(res, 200, await listPipelineJobs(deps.pave));
      }

      if (req.method === "GET" && parts[0] === "jobs" && parts.length === 2) {
        return json(res, 200, await getJob(deps.pave, parts[1]));
      }

      if (req.method === "POST" && parts[0] === "jobs" && parts.length === 3) {
        const jobId = parts[1];
        if (parts[2] === "inspection" || parts[2] === "cleanup") {
          const sub = (await readBody(req)) as ChecklistSubmission;
          const form = parts[2] === "inspection" ? INSPECTION_FORM : CLEANUP_FORM;
          const id = await submitForm(deps.pave, form.id, jobId, checklistValues(sub));
          return json(res, 200, { submissionId: id });
        }
        if (parts[2] === "reports") {
          const report = (await readBody(req)) as ProblemReport;
          if (!report.location || !report.englishNote) {
            return json(res, 400, { error: "location and englishNote are required" });
          }
          const id = await createReportTask(deps.pave, jobId, report);
          return json(res, 200, { taskId: id });
        }
      }

      // Crew finished a punch task -> mark complete, maybe flip to Punch Review.
      if (req.method === "POST" && parts[0] === "tasks" && parts[2] === "complete") {
        const body = (await readBody(req)) as { jobId?: string };
        await completeTask(deps.pave, parts[1]);
        const flipped = body.jobId ? await applyPunchReviewFlip(deps.pave, body.jobId) : null;
        return json(res, 200, { ok: true, flipped });
      }

      return json(res, 404, { error: `No route: ${req.method} ${url.pathname}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json(res, 500, { error: message });
    }
  };
}

/** Best-effort job id extraction from a JT webhook payload (shape varies by event). */
export function extractJobId(body: Record<string, unknown>): string | null {
  const direct = (body["jobId"] ?? (body["job"] as Record<string, unknown> | undefined)?.["id"]);
  if (typeof direct === "string") return direct;
  const task = body["task"] as Record<string, unknown> | undefined;
  const target = task?.["target"] as Record<string, unknown> | undefined;
  if (typeof target?.["id"] === "string" && target?.["type"] === "job") return target["id"] as string;
  return null;
}

export const _internal = { STATUS };
