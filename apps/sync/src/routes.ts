/**
 * HTTP API for the mobile app. Plain node:http — no framework.
 *
 * Auth: Google Workspace sign-in. POST /auth/google exchanges a verified
 * Google ID token for a long-lived session token (see auth.ts); every
 * protected route requires it as `Authorization: Bearer <token>` and knows
 * who the signed-in person is. The JobTread webhook endpoint is separate
 * and validated by its own secret in the URL path.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  assertAllowedIdentity,
  mintSession,
  verifyGoogleCredential,
  verifySession,
  type SessionUser,
} from "./auth";
import { PaveError, type PaveClient } from "./pave";
import { PIPELINE_TASKS, STATUS } from "../../../packages/shared/src/jobtread";
import type { CloseInspectionRequest, ProblemReport } from "../../../packages/shared/src/types";
import {
  checklistItemTitle,
  clientRefMarker,
  closeInspectionTask,
  completeTask,
  createReportTask,
  findPipelineTask,
  findTaskByRef,
  getJob,
  listAssignedWorkByJob,
  listPipelineJobs,
  listPipelineTasks,
  listSoldScope,
  uploadPhoto,
  type PhotoUpload,
  type VisitChecklists,
} from "./jt";
import { applyPipeline } from "./pipeline";
import { summarizeScope, transcribeNote, translateToSpanish, TRANSLATE_LIMITS } from "./translate";

export interface RouterDeps {
  pave: PaveClient;
  sessionSecret: string;
  geminiApiKey: string;
  geminiModel: string;
  googleClientId: string;
  workspaceDomain: string;
  allowedEmails: string[];
  webhookSecret: string;
  /** Injectable for tests; defaults to the real Google JWKS verification. */
  verifyGoogle?: (credential: string, clientId: string) => Promise<Record<string, unknown>>;
}

function bearerToken(req: IncomingMessage): string {
  const header = req.headers["authorization"];
  if (typeof header !== "string") return "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

/**
 * The app's reference for this send (its outbox item id), so a re-send of
 * a write that already landed is recognised rather than repeated.
 */
function clientRef(req: IncomingMessage): string | undefined {
  const header = req.headers["x-client-ref"];
  const value = Array.isArray(header) ? header[0] : header;
  return value && clientRefMarker(value) ? value : undefined;
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

const stringMap = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
};

/**
 * The visit as the app sends it (CloseInspectionRequest). Builds shipped
 * before the checklists moved onto the task sent `answers` as one flat map of
 * inspection answers — still accepted, so an outbox that queued a close on
 * the old build delivers rather than fails.
 */
export function parseVisit(body: Partial<CloseInspectionRequest> & { answers?: unknown }): VisitChecklists {
  const answers = (body.answers ?? {}) as Record<string, unknown>;
  const nested = typeof answers["inspection"] === "object" || typeof answers["cleanup"] === "object";
  const notes = stringMap(body.notes);
  const findings = Array.isArray(body.findings)
    ? (body.findings as unknown[])
        .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === "object")
        .filter((f) => typeof f["itemKey"] === "string")
        .map((f) => ({
          itemKey: String(f["itemKey"]),
          fixedOnSite: f["fixedOnSite"] === true,
          location: typeof f["location"] === "string" ? f["location"] : "",
          note: typeof f["note"] === "string" ? f["note"] : "",
          photos: typeof f["photos"] === "number" && f["photos"] > 0 ? Math.floor(f["photos"]) : 0,
        }))
    : [];
  return {
    inspection: nested ? stringMap(answers["inspection"]) : stringMap(answers),
    cleanup: nested ? stringMap(answers["cleanup"]) : {},
    notes: { inspection: notes["inspection"], attic: notes["attic"], cleanup: notes["cleanup"] },
    findings,
  };
}

const PHOTO_LABELS = new Set(["BEFORE", "AFTER", "REPORT", "INSPECTION"]);

/**
 * Accepts a recording data URI; returns base64 + audio mime type, or a reason.
 * Browsers label recordings loosely — iOS Safari calls audio-only MP4
 * "video/mp4", some leave the type blank — so anything plausibly audio is
 * normalized to audio/* rather than rejected.
 */
export function decodeAudio(
  audioBase64: unknown,
): { mimeType: string; base64: string } | { error: string } {
  if (typeof audioBase64 !== "string" || !audioBase64) {
    return { error: "audioBase64 must be a data URI string" };
  }
  const dataUri = /^data:([\w/+.;=-]*);base64,(.*)$/s.exec(audioBase64);
  if (!dataUri) return { error: `expected a base64 data URI (got "${audioBase64.slice(0, 40)}…")` };
  const bare = dataUri[1].split(";")[0].toLowerCase();
  const mimeType = bare.startsWith("audio/")
    ? bare
    : bare === "video/webm"
      ? "audio/webm"
      : bare === "video/mp4" || bare === "" || bare === "application/octet-stream"
        ? "audio/mp4"
        : null;
  if (!mimeType) return { error: `expected an audio recording (got "${bare}")` };
  if (dataUri[2].length === 0) return { error: "the recording is empty" };
  // base64 inflates by ~4/3; cap the encoded size to keep the decoded audio under ~4MB.
  if (dataUri[2].length > 5_600_000) return { error: "the recording is too long to send (~4MB max)" };
  return { mimeType, base64: dataUri[2] };
}
const MAX_PHOTO_BYTES = 4_000_000;

const oneLineTitle = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
};

/** Accepts a data URI or bare base64; returns bytes + content type or null. */
export function decodePhoto(imageBase64: unknown): { data: Buffer; contentType: string } | null {
  if (typeof imageBase64 !== "string" || !imageBase64) return null;
  let contentType = "image/jpeg";
  let b64 = imageBase64;
  const dataUri = /^data:([\w/+.-]+);base64,(.*)$/s.exec(imageBase64);
  if (dataUri) {
    contentType = dataUri[1];
    b64 = dataUri[2];
  }
  if (!contentType.startsWith("image/")) return null;
  try {
    const data = Buffer.from(b64, "base64");
    if (data.length === 0 || data.length > MAX_PHOTO_BYTES) return null;
    return { data, contentType };
  } catch {
    return null;
  }
}

export function createHandler(deps: RouterDeps) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, {
          ok: true,
          signIn: Boolean(deps.googleClientId && deps.sessionSecret),
          gemini: Boolean(deps.geminiApiKey),
          webhook: Boolean(deps.webhookSecret),
        });
      }

      // Which sign-in method the app should offer (the client id is public).
      if (req.method === "GET" && url.pathname === "/auth/config") {
        return json(res, 200, { googleClientId: deps.googleClientId || null });
      }

      // Google ID token -> our own long-lived session token.
      if (req.method === "POST" && url.pathname === "/auth/google") {
        if (!deps.googleClientId || !deps.sessionSecret) {
          return json(res, 501, { error: "Google sign-in is not configured on the server" });
        }
        const body = (await readBody(req)) as { credential?: unknown };
        if (typeof body.credential !== "string" || !body.credential) {
          return json(res, 400, { error: "credential is required" });
        }
        try {
          const verify = deps.verifyGoogle ?? verifyGoogleCredential;
          const payload = await verify(body.credential, deps.googleClientId);
          const user = assertAllowedIdentity(payload, deps.workspaceDomain, deps.allowedEmails);
          const token = mintSession(deps.sessionSecret, user);
          return json(res, 200, { token, name: user.name, email: user.email });
        } catch {
          return json(res, 401, { error: "This Google account is not allowed" });
        }
      }

      // JobTread webhook: POST /webhooks/jobtread/<WEBHOOK_SECRET>
      // On any job/task event we re-evaluate the PM Review flip.
      if (req.method === "POST" && parts[0] === "webhooks" && parts[1] === "jobtread") {
        if (!deps.webhookSecret || parts[2] !== deps.webhookSecret) {
          return json(res, 401, { error: "Bad webhook token" });
        }
        const body = (await readBody(req)) as Record<string, unknown>;
        const jobId = extractJobId(body);
        let flipped: string | null = null;
        if (jobId) {
          // Best-effort: a failed check must answer 200, or JobTread retries
          // the delivery and a JT hiccup turns into a 5xx retry storm.
          try {
            flipped = await applyPipeline(deps.pave, jobId);
          } catch (err) {
            console.warn(
              `pipeline check skipped for ${jobId}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        return json(res, 200, { ok: true, flipped });
      }

      // Everything below requires a signed-in session.
      const session: SessionUser | null = deps.sessionSecret
        ? verifySession(deps.sessionSecret, bearerToken(req))
        : null;
      if (!session) return json(res, 401, { error: "Unauthorized" });

      // Dictated field note -> verbatim transcription + clean English note.
      if (req.method === "POST" && url.pathname === "/transcribe") {
        if (!deps.geminiApiKey) return json(res, 501, { error: "Transcription is not configured" });
        const body = (await readBody(req, 6_000_000)) as { audioBase64?: unknown };
        const audio = decodeAudio(body.audioBase64);
        if ("error" in audio) return json(res, 400, { error: audio.error });
        return json(res, 200, await transcribeNote(audio, deps));
      }

      // ES translation of JobTread text (scope lines, punch work orders).
      if (req.method === "POST" && url.pathname === "/translate") {
        if (!deps.geminiApiKey) return json(res, 501, { error: "Translation is not configured" });
        const body = (await readBody(req)) as { texts?: unknown };
        const texts = Array.isArray(body.texts)
          ? body.texts.filter((t): t is string => typeof t === "string" && t.length > 0)
          : [];
        if (
          texts.length === 0 ||
          texts.length > TRANSLATE_LIMITS.maxTexts ||
          texts.some((t) => t.length > TRANSLATE_LIMITS.maxTextLength)
        ) {
          return json(res, 400, { error: "texts must be 1-100 strings, each under 4000 chars" });
        }
        const translations = await translateToSpanish(texts, deps);
        return json(res, 200, { translations });
      }

      if (req.method === "GET" && url.pathname === "/queue") {
        // The pipeline list and the viewer's org-wide assigned work run in
        // parallel; the second marks which jobs are "theirs" (Assigned tab)
        // and puts the real number on the REPAIRS badge.
        const [jobs, assigned] = await Promise.all([
          listPipelineJobs(deps.pave),
          listAssignedWorkByJob(deps.pave, session),
        ]);
        for (const job of jobs) {
          const work = assigned.get(job.id);
          if (work) {
            job.mine = work.any;
            job.openPunchCount = work.punchOpen;
          }
        }
        return json(res, 200, jobs);
      }

      if (req.method === "GET" && parts[0] === "jobs" && parts.length === 2) {
        // The session decides which punch items come back marked as theirs.
        return json(res, 200, await getJob(deps.pave, parts[1], session ?? undefined));
      }

      // Bilingual crew summary of the sold scope (Gemini; cached per content).
      if (req.method === "GET" && parts[0] === "jobs" && parts[2] === "scope-summary") {
        if (!deps.geminiApiKey) return json(res, 501, { error: "Summaries are not configured" });
        const scope = await listSoldScope(deps.pave, parts[1]);
        if (scope.length === 0) return json(res, 200, { en: "", es: "" });
        const scopeText = scope
          .map((d) => {
            const lines = d.lines.slice(0, 40);
            const extra = d.lines.length - lines.length;
            return (
              `${d.name}${d.number ? ` #${d.number}` : ""} (${d.issueDate ?? "no date"}):\n` +
              lines
                .map((l) => `- ${l.name}${l.quantity ? ` (${l.quantity} ${l.unit ?? ""})` : ""}`)
                .join("\n") +
              (extra > 0 ? `\n- (+${extra} more items)` : "")
            );
          })
          .join("\n\n");
        try {
          return json(res, 200, await summarizeScope(scopeText, deps));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return json(res, 502, { error: `summary generation: ${message}` });
        }
      }

      if (req.method === "POST" && parts[0] === "jobs" && parts.length === 3) {
        const jobId = parts[1];
        if (parts[2] === "inspection" || parts[2] === "cleanup") {
          // Retired 2026-09-21: the JT forms these submitted no longer exist.
          // The checklists ride on the job's scheduled "Final inspection"
          // task and arrive through close-inspection below.
          return json(res, 410, {
            error: "Checklist forms were retired — the visit is sent through close-inspection",
          });
        }
        // The crew has finished the visit: write both checklists onto the
        // job's scheduled "Final inspection" task with the notes, complete
        // it, and let the pipeline decide where the job goes. Called LAST in
        // the send, after the problem reports — and it carries its own
        // problem count anyway, because the outbox can deliver those after
        // this (see PipelineInput).
        if (parts[2] === "close-inspection") {
          const body = (await readBody(req)) as Partial<CloseInspectionRequest> & { answers?: unknown };
          const problemsReported =
            typeof body.problemsReported === "number" && body.problemsReported > 0
              ? Math.floor(body.problemsReported)
              : 0;
          const milestones = await listPipelineTasks(deps.pave, jobId);
          const task = findPipelineTask(milestones, PIPELINE_TASKS.finalInspection);
          // No task means the job never got the template — nothing to
          // complete, and the pipeline will leave the status alone. The PM
          // advances it from the board exactly as they did before.
          if (task) {
            await closeInspectionTask(deps.pave, task.id, parseVisit(body), session.name);
          }
          const flipped = await applyPipeline(deps.pave, jobId, { problemsReported });
          return json(res, 200, { completedTaskId: task?.id ?? null, flipped });
        }

        if (parts[2] === "reports") {
          const report = (await readBody(req)) as ProblemReport;
          if (!report.location || !report.englishNote) {
            return json(res, 400, { error: "location and englishNote are required" });
          }
          const ref = clientRef(req);
          const id = await createReportTask(deps.pave, jobId, { ...report, reportedBy: session.name }, ref);
          // Photos inlined with the report (older app builds' outboxes; the
          // app now sends them one per request with `reportRef`). The report
          // must never be lost to a photo hiccup — best-effort.
          const sources = [
            ...(Array.isArray(report.photosBase64) ? report.photosBase64 : []),
            report.photoBase64,
          ];
          let photosUploaded = 0;
          for (const [i, source] of sources.entries()) {
            const photo = decodePhoto(source);
            if (!photo) continue;
            try {
              await uploadPhoto(deps.pave, jobId, {
                label: "REPORT",
                ...photo,
                taskId: id || undefined,
                byName: session.name,
                clientRef: ref ? `${ref}.p${i}` : undefined,
              });
              photosUploaded += 1;
            } catch {
              // keep going — the remaining photos still get their chance
            }
          }
          return json(res, 200, { taskId: id, photosUploaded, photoUploaded: photosUploaded > 0 });
        }

        if (parts[2] === "photos") {
          const body = (await readBody(req)) as {
            label?: unknown;
            taskId?: unknown;
            /** The client reference of the report this photo belongs to. */
            reportRef?: unknown;
            /** The checklist item the report came from, and where it is. */
            itemKey?: unknown;
            location?: unknown;
            imageBase64?: unknown;
          };
          const label = typeof body.label === "string" ? body.label.toUpperCase() : "";
          if (!PHOTO_LABELS.has(label)) {
            return json(res, 400, { error: "label must be BEFORE, AFTER, REPORT or INSPECTION" });
          }
          const photo = decodePhoto(body.imageBase64);
          if (!photo) return json(res, 400, { error: "imageBase64 must be an image under 4MB" });
          const ref = clientRef(req);
          let taskId = typeof body.taskId === "string" && body.taskId ? body.taskId : undefined;
          if (!taskId && typeof body.reportRef === "string" && clientRefMarker(body.reportRef)) {
            // The photo belongs to a report the app sent as its own item. The
            // outbox delivers in order but keeps going past a failure, so the
            // report can still be on its way: 409 keeps this photo pending
            // (the app never gives up on a 409) instead of failing it.
            taskId = (await findTaskByRef(deps.pave, jobId, body.reportRef)) ?? undefined;
            if (!taskId) return json(res, 409, { error: "The report this photo belongs to has not reached JobTread yet" });
          }
          // "8. Attic… — REPORT" / "Cleanup 4… — REPORT": the item leads the file name.
          const itemTitle = checklistItemTitle(typeof body.itemKey === "string" ? body.itemKey : undefined);
          const where = typeof body.location === "string" && body.location.trim() ? body.location.trim() : undefined;
          const title = itemTitle ? `${itemTitle} — ${label}` : where ? `${oneLineTitle(where)} — ${label}` : undefined;

          // Inspection photos and the report's photos both belong with the
          // inspection: a visit photo lands on the "Final inspection" task
          // instead of the bare job, and a report photo is attached there
          // too, next to the checklist line it documents — as well as on the
          // punch to-do, where the crew and the PM work it.
          let inspectionTaskId: string | undefined;
          if (label === "INSPECTION" || label === "REPORT") {
            try {
              inspectionTaskId = findPipelineTask(await listPipelineTasks(deps.pave, jobId), PIPELINE_TASKS.finalInspection)?.id;
            } catch {
              // no template on the job, or JT hiccup — the primary upload below still happens
            }
          }
          const primaryTaskId = taskId ?? (label === "INSPECTION" ? inspectionTaskId : undefined);
          const upload: PhotoUpload = {
            label: label as PhotoUpload["label"],
            ...photo,
            taskId: primaryTaskId,
            byName: session.name,
            clientRef: ref,
            title,
          };
          const fileId = await uploadPhoto(deps.pave, jobId, upload);
          let inspectionFileId: string | null = null;
          if (label === "REPORT" && inspectionTaskId && inspectionTaskId !== primaryTaskId) {
            try {
              inspectionFileId = await uploadPhoto(deps.pave, jobId, {
                ...upload,
                taskId: inspectionTaskId,
                clientRef: ref ? `${ref}.fi` : undefined,
              });
            } catch {
              // best-effort: the photo is on the punch to-do already
            }
          }
          return json(res, 200, { fileId, inspectionFileId });
        }
      }

      // Crew finished a punch task -> mark complete, maybe flip to PM Review.
      if (req.method === "POST" && parts[0] === "tasks" && parts[2] === "complete") {
        const body = (await readBody(req)) as { jobId?: string; note?: string };
        const note = body.note?.trim() ? `${body.note.trim()} — ${session.name}` : session.name;
        await completeTask(deps.pave, parts[1], note);
        const flipped = body.jobId ? await applyPipeline(deps.pave, body.jobId) : null;
        return json(res, 200, { ok: true, flipped });
      }

      return json(res, 404, { error: `No route: ${req.method} ${url.pathname}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Upstream JobTread trouble is a 502, not our 500 — monitoring should
      // tell "JT is struggling" apart from "our code crashed".
      return json(res, err instanceof PaveError ? 502 : 500, { error: message });
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
