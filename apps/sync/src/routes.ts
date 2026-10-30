/**
 * HTTP API behind DB Crew's Close Out tab. Plain node:http — no framework.
 *
 * Auth: one door. DB Crew's Apps Script verifies the person's Google sign-in
 * and role, then calls with `Authorization: Bearer <CREW_APP_SECRET>` plus
 * X-Acting-Email / X-Acting-Name (see actingUser). The retired Expo app's own
 * Google sign-in and session tokens were removed on 30 Oct 2026. The
 * JobTread webhook endpoint is separate and validated by its own secret in
 * the URL path.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { assertAllowedIdentity, type SessionUser } from "./auth";
import { PaveError, type PaveClient } from "./pave";
import { AREA_CHECKLISTS, isRoofingJob, PIPELINE_TASKS, STATUS, TASK_TYPES } from "../../../packages/shared/src/jobtread";
import type { CloseAreaInspectionRequest, CloseInspectionRequest, ProblemReport, QueueJob } from "../../../packages/shared/src/types";
import { CLOSEOUT_FORMS } from "../../../packages/shared/src/forms";
import {
  attachFileToComment,
  checklistItemTitle,
  clientRefMarker,
  closeAreaInspection,
  closeInspectionTask,
  completeTask,
  createReportTask,
  findCommentByRef,
  findingMessage,
  findPipelineTask,
  findTaskByRef,
  getJob,
  getJobBasics,
  postTaskMessage,
  postRepairDone,
  listAssignedWorkByJob,
  listJobsByIds,
  listPipelineJobs,
  listPipelineTasks,
  listSoldScope,
  uploadPhoto,
  type PhotoUpload,
  type VisitChecklists,
} from "./jt";
import { afterInspection, afterRepair, applyPipeline, areaInspectionTaskOf } from "./pipeline";
import { areaFormKey, areaInspectionName, fallbackRepairCrew, isAreaKey, jobAreas, lineArea, AREA_LABEL, type AreaKey } from "./areas";
import type { BoardClient } from "./board";
import { summarizeScope, transcribeNote, translateTexts, TRANSLATE_LIMITS } from "./translate";

export interface RouterDeps {
  pave: PaveClient;
  geminiApiKey: string;
  geminiModel: string;
  workspaceDomain: string;
  allowedEmails: string[];
  webhookSecret: string;
  /**
   * The shared secret DB Crew's Apps Script sends. With it, the request acts
   * for the person named in X-Acting-Email / X-Acting-Name — the Apps Script
   * has already verified that person's Google token and gates them by role,
   * the way the Production Board trusts the same deployment on its own
   * /api/crew routes. It is the only door: empty, every protected route
   * answers 401.
   */
  crewAppSecret: string;
  /**
   * The Production Board's close-out hook (board.ts). It moves the job's
   * Status — Close Out no longer does — and names each work area's
   * reviewer. Absent: fallback reviewers, and the board's hourly sweep.
   */
  board?: BoardClient | null;
}

/**
 * What this bundle was built from (scripts/build-api.mjs bakes it in):
 * `source` is the fingerprint of the server's source files, `on` says who
 * built it ("vercel" on a deploy, "local" for the committed copy) and
 * `commit` is Vercel's commit for a Vercel build. Run from source (tests,
 * `npm start`) there is no bundle, and it says so.
 */
declare const __CLOSEOUT_BUILD__: { source: string; on: string; commit: string | null } | undefined;
const BUILD = typeof __CLOSEOUT_BUILD__ !== "undefined" ? __CLOSEOUT_BUILD__ : { source: null, on: "source", commit: null };

function bearerToken(req: IncomingMessage): string {
  const header = req.headers["authorization"];
  if (typeof header !== "string") return "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

/**
 * The app's reference for this send (its outbox item id), so a re-send of
 * a write that already landed is recognised rather than repeated.
 */
const headerValue = (req: IncomingMessage, name: string): string => {
  const header = req.headers[name];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === "string" ? value.trim() : "";
};

/**
 * Who this request acts for: the person DB Crew's Apps Script names in its
 * headers, when the bearer is its shared secret. The named person still has
 * to pass the domain / allow-list gate, so the secret can never act for an
 * outsider; and a wrong secret is never a hint, it reads exactly like no
 * token at all. Anything else — no bearer, a wrong one, a session token from
 * the retired app — is nobody.
 */
export function actingUser(req: IncomingMessage, deps: Pick<RouterDeps, "crewAppSecret" | "workspaceDomain" | "allowedEmails">): SessionUser | null {
  const bearer = bearerToken(req);
  if (!bearer || !deps.crewAppSecret || bearer !== deps.crewAppSecret) return null;
  const email = headerValue(req, "x-acting-email").toLowerCase();
  if (!email) return null;
  try {
    return assertAllowedIdentity(
      { email, email_verified: true, name: headerValue(req, "x-acting-name") || undefined },
      deps.workspaceDomain,
      deps.allowedEmails,
    );
  } catch {
    return null;
  }
}

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
    notes: { inspection: notes["inspection"], attic: notes["attic"], cleanup: notes["cleanup"], final: notes["final"] },
    findings,
  };
}

const PHOTO_LABELS = new Set(["BEFORE", "AFTER", "REPAIR", "REPORT", "INSPECTION"]);

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

/**
 * Where a photo came from (DB Crew T2.9): `source: "phone"` when it was picked
 * from the phone's own photos, and `takenAt` the time it was taken, read from
 * the photo itself. A time that will not parse, or lies outside 2000 to a day
 * from now, is dropped rather than refused — a photo is never lost over its
 * date, it just says the time is unknown.
 */
export function photoOrigin(body: { source?: unknown; takenAt?: unknown }, now: Date = new Date()): { fromPhone: boolean; takenAt?: string } {
  const fromPhone = body.source === "phone";
  if (!fromPhone || typeof body.takenAt !== "string" || !body.takenAt) return { fromPhone };
  const t = new Date(body.takenAt).getTime();
  if (!Number.isFinite(t) || t < Date.UTC(2000, 0, 1) || t > now.getTime() + 86_400_000) return { fromPhone };
  return { fromPhone, takenAt: new Date(t).toISOString() };
}

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

/**
 * Statuses a job can carry while somebody still has close-out work on it.
 * The queue lists every job at Final Inspection, Punch List or PM Review;
 * past those three, a job is listed for a crew member only when a work
 * area's inspection or a repair is assigned to them — booked while the rest
 * of the job is still in production, or a punch list the PM put on after
 * the rep had it — and never once it is completed and billing.
 */
export const ASSIGNED_STATUSES: readonly string[] = [
  STATUS.preProduction,
  STATUS.production,
  STATUS.finalInspection,
  STATUS.punchList,
  STATUS.pmReview,
  STATUS.repReview,
];

/** A job's work area named in a body, when the job has it. */
function areaOf(value: unknown, areas: readonly AreaKey[]): AreaKey | null {
  return isAreaKey(value) && areas.includes(value) ? value : null;
}

export function createHandler(deps: RouterDeps) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, {
          ok: true,
          gemini: Boolean(deps.geminiApiKey),
          webhook: Boolean(deps.webhookSecret),
          crewApp: Boolean(deps.crewAppSecret),
          board: Boolean(deps.board),
          build: BUILD,
          deployed: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || null,
        });
      }


      // JobTread webhook: POST /webhooks/jobtread/<WEBHOOK_SECRET>
      // On any job/task event the checklists are kept in step and a work
      // area whose last repair closed in JobTread gets its summary. The
      // Status is the Production Board's; `flipped` stays in the answer, null.
      if (req.method === "POST" && parts[0] === "webhooks" && parts[1] === "jobtread") {
        if (!deps.webhookSecret || parts[2] !== deps.webhookSecret) {
          return json(res, 401, { error: "Bad webhook token" });
        }
        const body = (await readBody(req)) as Record<string, unknown>;
        const jobId = extractJobId(body);
        // One line per delivery: what JT sent and what we made of it. The
        // payload shape is not documented anywhere we can read, and a wrong
        // guess here is a silent no-op forever.
        console.log(`jobtread webhook ${describeWebhook(body)} jobId=${jobId ?? "-"}`);
        let flipped: string | null = null;
        if (jobId) {
          // Best-effort: a failed check must answer 200, or JobTread retries
          // the delivery and a JT hiccup turns into a 5xx retry storm.
          try {
            flipped = await applyPipeline(deps.pave, jobId, deps.board);
          } catch (err) {
            console.warn(
              `pipeline check skipped for ${jobId}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        return json(res, 200, { ok: true, flipped });
      }

      // Everything below acts for a person: DB Crew's, through its shared
      // secret (see actingUser).
      const session: SessionUser | null = actingUser(req, deps);
      if (!session) return json(res, 401, { error: "Unauthorized" });

      // Dictated field note -> verbatim transcription + clean English note.
      if (req.method === "POST" && url.pathname === "/transcribe") {
        if (!deps.geminiApiKey) return json(res, 501, { error: "Transcription is not configured" });
        const body = (await readBody(req, 6_000_000)) as { audioBase64?: unknown };
        const audio = decodeAudio(body.audioBase64);
        if ("error" in audio) return json(res, 400, { error: audio.error });
        return json(res, 200, await transcribeNote(audio, deps));
      }

      // Translation: JobTread text into Spanish for the crew (the default),
      // or a crew member's Spanish note into English for the office (`to: "en"`,
      // which is how DB Crew's Close Out makes the English note a dictated
      // report carries).
      if (req.method === "POST" && url.pathname === "/translate") {
        if (!deps.geminiApiKey) return json(res, 501, { error: "Translation is not configured" });
        const body = (await readBody(req)) as { texts?: unknown; to?: unknown };
        const to = body.to === "en" ? "en" : "es";
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
        const translations = await translateTexts(texts, to, deps);
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
            job.booked = work.booked;
          }
        }
        // Close-out work assigned to them on a job outside those three
        // statuses — a work area inspected or repaired while the rest of the
        // job is still in production. Best-effort: the queue never fails
        // over the extra rows.
        const listed = new Set(jobs.map((j) => j.id));
        const others = [...assigned.entries()].filter(([id, w]) => w.any && !listed.has(id)).map(([id]) => id);
        let extra: QueueJob[] = [];
        if (others.length) {
          try {
            extra = (await listJobsByIds(deps.pave, others.slice(0, 30)))
              .filter((j) => ASSIGNED_STATUSES.includes(j.status))
              .map((j) => ({
                ...j,
                mine: true,
                openPunchCount: assigned.get(j.id)?.punchOpen ?? 0,
                booked: assigned.get(j.id)?.booked ?? [],
              }));
          } catch (err) {
            console.warn(`assigned jobs outside the pipeline not listed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return json(res, 200, [...jobs, ...extra].sort((a, b) => a.number.localeCompare(b.number)));
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
          // A form this server cannot write yet is refused, never written as
          // the roof's (T2.25): the phone draws any form it is sent.
          if (body.form != null && !Object.prototype.hasOwnProperty.call(CLOSEOUT_FORMS, String(body.form))) {
            return json(res, 400, { error: `The ${String(body.form)} form is not written to JobTread yet — ask the office.` });
          }
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
            await closeInspectionTask(deps.pave, task.id, parseVisit(body), session.name, clientRef(req));
          }
          // The board moves the Status (told how many problems the phone
          // found, so the REPORTs still on their way count) and the area's
          // reviewer is told what the inspection found.
          const outcome = await afterInspection(deps.pave, deps.board, { jobId, area: null, problemsReported, actor: session.name });
          return json(res, 200, { completedTaskId: task?.id ?? null, flipped: outcome.flipped, sentTo: outcome.reviewer });
        }

        // A work area inspected with notes and photos instead of the roof
        // checklist — the gutters, the siding (Carl, 23 Oct 2026: "notes and
        // photos for now"). Sent LAST, after its findings and photos, like
        // close-inspection. The area's inspection is the task the PM booked
        // on the board; with none booked, one is made so the visit is on
        // record rather than lost.
        if (parts[2] === "close-area-inspection") {
          const body = (await readBody(req)) as Partial<CloseAreaInspectionRequest>;
          const basics = await getJobBasics(deps.pave, jobId);
          if (!basics) return json(res, 404, { error: "JobTread has no job with that id" });
          const areas = jobAreas(basics);
          const area = areaOf(body.area, areas);
          if (!area) {
            return json(res, 400, {
              error: `area must be one of this job's work areas (${areas.length ? areas.join(", ") : "it has none"})`,
            });
          }
          const problemsReported =
            typeof body.problemsReported === "number" && body.problemsReported > 0 ? Math.floor(body.problemsReported) : 0;
          const notes = typeof body.notes === "string" ? body.notes.slice(0, 4000) : undefined;
          const line = lineArea(areas);
          const ref = clientRef(req);
          // The area's own checklist (DB Crew T2.27), when the phone sends one
          // and it is the form this area draws; an older phone's notes and
          // photos are written exactly as before.
          const formKey = typeof body.form === "string" ? body.form : null;
          if (formKey && formKey !== areaFormKey(area, line)) {
            return json(res, 400, { error: `The ${area} inspection is not the ${formKey} form` });
          }
          const items = formKey && formKey in AREA_CHECKLISTS ? AREA_CHECKLISTS[formKey as keyof typeof AREA_CHECKLISTS] : null;
          const checklist = items
            ? { items, visit: parseVisit({ answers: body.answers ?? {}, notes: body.sectionNotes ?? {}, findings: body.findings ?? [] } as never) }
            : undefined;
          let taskId = areaInspectionTaskOf(await listPipelineTasks(deps.pave, jobId), area, line)?.id;
          if (!taskId) taskId = await createAreaInspection(deps.pave, jobId, area, line, ref);
          await closeAreaInspection(deps.pave, taskId, notes, session.name, ref, checklist);
          const outcome = await afterInspection(deps.pave, deps.board, { jobId, area, problemsReported, actor: session.name });
          return json(res, 200, { completedTaskId: taskId, flipped: outcome.flipped, sentTo: outcome.reviewer });
        }

        if (parts[2] === "reports") {
          const report = (await readBody(req)) as ProblemReport;
          if (!report.location || !report.englishNote) {
            return json(res, 400, { error: "location and englishNote are required" });
          }
          const ref = clientRef(req);
          // Which work area it is about (the template line's when the phone
          // does not say), and who its repairs go to: the board's answer for
          // that area — Alberto and Yahir on a shingle roof, nobody else by
          // default — or the same rule from areas.ts when the board cannot be
          // asked. A correction already made (FIXED ON SITE) is documentation,
          // nobody's.
          let basics: QueueJob | null = null;
          try {
            basics = await getJobBasics(deps.pave, jobId);
          } catch {
            // unknown job: filed against the line, left for the PM to assign
          }
          const areas = basics ? jobAreas(basics) : [];
          const line = lineArea(areas);
          const area = areaOf(report.area, areas) ?? line;
          let assignTo: readonly string[] = [];
          if (report.fixedOnSite !== true) {
            // A finding on a job already past Punch List brings it back: the
            // board's one allowed move backwards. Otherwise the close moves it.
            const back = basics?.status === STATUS.pmReview || basics?.status === STATUS.repReview;
            // A job with no work areas is not the board's loop: nothing to ask.
            const answer =
              deps.board && areas.length
                ? await deps.board.closeout({ jobId, move: back, repairs: true, problemsReported: 1, area, actor: session.name })
                : null;
            const fromBoard = answer?.areas.find((a) => a.area === area);
            assignTo = fromBoard ? fromBoard.crew : fallbackRepairCrew(area, basics ? isRoofingJob(basics) : false);
          }
          // Tagged with its area when that is not the line's — an untagged
          // REPORT has always meant the roof's form.
          const id = await createReportTask(
            deps.pave,
            jobId,
            { ...report, reportedBy: session.name },
            ref,
            assignTo,
            area && area !== line ? area : null,
          );
          // The finding is a MESSAGE on its area's inspection task naming the
          // checklist line it is about; its photos get linked to that message
          // as they arrive. Best-effort: the to-do is the record.
          let commentId: string | null = null;
          try {
            const inspection = areaInspectionTaskOf(await listPipelineTasks(deps.pave, jobId), area, line);
            if (inspection) {
              commentId = await postTaskMessage(deps.pave, inspection.id, findingMessage(report, session.name), ref);
            }
          } catch (err) {
            console.warn(`finding message not posted for ${jobId}: ${err instanceof Error ? err.message : String(err)}`);
          }
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
          return json(res, 200, { taskId: id, commentId, photosUploaded, photoUploaded: photosUploaded > 0 });
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
            /** "phone" when picked from the phone's own photos (DB Crew T2.9). */
            source?: unknown;
            /** When that photo was taken (ISO 8601), read from the photo. */
            takenAt?: unknown;
            /** The work area an INSPECTION or REPORT photo belongs to; absent, the line's. */
            area?: unknown;
          };
          const label = typeof body.label === "string" ? body.label.toUpperCase() : "";
          if (!PHOTO_LABELS.has(label)) {
            return json(res, 400, { error: "label must be BEFORE, AFTER, REPAIR, REPORT or INSPECTION" });
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

          // A visit photo lands on the "Final inspection" task instead of the
          // bare job. A report photo lands on the punch to-do and is then
          // LINKED to the finding's message on the "Final inspection" task —
          // one upload, shown in both places.
          let inspectionTaskId: string | undefined;
          if (label === "INSPECTION" || label === "REPORT") {
            try {
              const milestones = await listPipelineTasks(deps.pave, jobId);
              let area: AreaKey | null = null;
              let line: AreaKey | null = null;
              if (isAreaKey(body.area)) {
                const basics = await getJobBasics(deps.pave, jobId);
                const areas = basics ? jobAreas(basics) : [];
                area = areaOf(body.area, areas);
                line = lineArea(areas);
              }
              inspectionTaskId = areaInspectionTaskOf(milestones, area, line)?.id;
            } catch {
              // no template on the job, or JT hiccup — the upload below still happens
            }
          }
          const upload: PhotoUpload = {
            label: label as PhotoUpload["label"],
            ...photo,
            taskId: taskId ?? (label === "INSPECTION" ? inspectionTaskId : undefined),
            byName: session.name,
            clientRef: ref,
            title,
            ...photoOrigin(body),
          };
          const fileId = await uploadPhoto(deps.pave, jobId, upload);
          let commentId: string | null = null;
          if (label === "REPORT" && inspectionTaskId && typeof body.reportRef === "string" && fileId) {
            try {
              commentId = await findCommentByRef(deps.pave, inspectionTaskId, body.reportRef);
              if (commentId) await attachFileToComment(deps.pave, commentId, fileId);
            } catch (err) {
              console.warn(`photo not linked to the finding message on ${jobId}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          return json(res, 200, { fileId, commentId });
        }
      }

      // Crew finished a punch task -> mark complete; the board moves the job
      // on when it was the last, and the area's reviewer is told.
      if (req.method === "POST" && parts[0] === "tasks" && parts[2] === "complete") {
        const body = (await readBody(req)) as { jobId?: string; note?: string };
        const note = body.note?.trim() ? `${body.note.trim()} — ${session.name}` : session.name;
        await completeTask(deps.pave, parts[1], note);
        // The finish note as a message on the repair's own to-do, its photos
        // linked (Carl, 13 Oct 2026). Never fails the completion: the repair
        // is done, and the description line above already says so.
        try {
          await postRepairDone(deps.pave, parts[1], body.note, session.name, clientRef(req));
        } catch (err) {
          console.warn(`repair message not posted on ${parts[1]}: ${err instanceof Error ? err.message : String(err)}`);
        }
        const outcome = body.jobId
          ? await afterRepair(deps.pave, deps.board, { jobId: body.jobId, actor: session.name })
          : { flipped: null, reviewer: null };
        return json(res, 200, { ok: true, flipped: outcome.flipped, sentTo: outcome.reviewer });
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

/**
 * A work area's inspection task, made by the crew's close when the PM never
 * booked one — named and typed exactly as the board makes it, so both apps
 * find it. A re-sent close finds the one it made by the send's reference.
 */
async function createAreaInspection(
  pave: PaveClient,
  jobId: string,
  area: AreaKey,
  line: AreaKey | null,
  ref: string | undefined,
): Promise<string> {
  const marker = ref ? clientRefMarker(`${ref}.task`) : null;
  if (marker && ref) {
    const existing = await findTaskByRef(pave, jobId, `${ref}.task`);
    if (existing) return existing;
  }
  const description = [
    `Final inspection of the ${AREA_LABEL[area].toLowerCase()} — inspected in Close Out with nobody booked on the board.`,
    ...(marker ? [marker] : []),
  ].join("\n\n");
  const res = await pave.query<{ createTask: { createdTask?: { id: string } } }>({
    createTask: {
      $: {
        targetType: "job",
        targetId: jobId,
        taskTypeId: TASK_TYPES.inspection,
        isToDo: true,
        name: areaInspectionName(area, line),
        description,
      },
      createdTask: { id: {} },
    },
  });
  const id = res.createTask.createdTask?.id;
  if (!id) throw new Error("JobTread did not create the inspection task");
  return id;
}

const asObject = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
const asId = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * The job a JobTread webhook delivery is about.
 *
 * JT's real shape (seen live 2026-09-21): `{ _type: "root", createdEvent:
 * { _type: "event", data: { next: <record>, previous?: <record> }, job?,
 * account?, comment?, … } }`. On a task event the record carries `jobId`
 * (and `targetType: "job"` + `targetId`); on a job event the record is the
 * job itself. The older guesses (a bare `jobId`, `job.id`, `task.target`)
 * stay so hand-made payloads keep working.
 */
export function extractJobId(body: Record<string, unknown>): string | null {
  const direct = asId(body["jobId"]) ?? asId(asObject(body["job"])?.["id"]);
  if (direct) return direct;
  const target = asObject(asObject(body["task"])?.["target"]);
  if (target?.["type"] === "job" && asId(target["id"])) return target["id"] as string;

  const event = asObject(body["createdEvent"]) ?? asObject(body["event"]);
  if (!event) return null;
  const related = asId(asObject(event["job"])?.["id"]);
  if (related) return related;
  const data = asObject(event["data"]);
  for (const record of [asObject(data?.["next"]), asObject(data?.["previous"])]) {
    if (!record) continue;
    const viaTask = asId(record["jobId"]) ?? (record["targetType"] === "job" ? asId(record["targetId"]) : null);
    if (viaTask) return viaTask;
    // The record is the job itself (jobUpdated): it has a number, never a jobId.
    if (asId(record["number"]) && asId(record["id"])) return record["id"] as string;
  }
  return null;
}

/** One compact line per delivery: enough to see the shape without logging the record. */
export function describeWebhook(body: Record<string, unknown>): string {
  const event = asObject(body["createdEvent"]) ?? asObject(body["event"]);
  if (!event) return `keys=${Object.keys(body).join(",")}`;
  const data = asObject(event["data"]);
  const next = asObject(data?.["next"]);
  const kind =
    asId(event["type"]) ??
    asId(event["eventType"]) ??
    (next ? (asId(next["jobId"]) ? "task" : asId(next["number"]) ? "job" : "record") : "?");
  return `event=${kind} eventKeys=${Object.keys(event).join(",")} next=${next ? Object.keys(next).slice(0, 12).join(",") : "-"}`;
}

export const _internal = { STATUS };
