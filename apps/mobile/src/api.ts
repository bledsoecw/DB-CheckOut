/**
 * Client for the sync server, offline-first:
 * - GETs fall back to the last cached copy (and to demo data with no server).
 * - POSTs go into a persistent outbox and are flushed when a request succeeds
 *   again — nothing the crew does is ever lost to a dead spot.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChecklistSubmission, JobDetail, ProblemReport, QueueJob, ScopeSummary } from "@shared/types";
import { MOCK_JOBS, mockJobDetail } from "./mock";

/**
 * The web app is served by the same Vercel project as the sync server, so
 * requests are same-origin relative paths. A native build would set this to
 * the full https URL.
 */
export const SERVER_URL = "";

const SESSION_KEY = "db-checkout.session";
const LEGACY_TEAM_CODE_KEY = "db-checkout.teamCode";
const DEMO_KEY = "db-checkout.demoMode";
const OUTBOX_KEY = "db-checkout.outbox";
const CACHE_PREFIX = "db-checkout.cache.";

/**
 * Auth is Google Workspace sign-in: the gate screen exchanges a Google ID
 * token for the server's own long-lived session token, kept in local
 * storage — never baked into the served page. Demo mode browses sample
 * data with no server at all.
 */
interface Session {
  token: string;
  name: string;
  email: string;
}

let session: Session | null = null;
let demoMode = false;
let onUnauthorized: (() => void) | null = null;

export type AuthMode = "google" | "demo" | null;

export async function loadAuth(): Promise<AuthMode> {
  // The shared team code is retired; anyone still carrying one signs in again.
  await AsyncStorage.removeItem(LEGACY_TEAM_CODE_KEY);
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  session = raw ? (JSON.parse(raw) as Session) : null;
  demoMode = (await AsyncStorage.getItem(DEMO_KEY)) === "1";
  const storedOutbox = await AsyncStorage.getItem(OUTBOX_KEY).catch(() => null);
  if (storedOutbox) {
    try {
      const parsed = JSON.parse(storedOutbox) as Array<Partial<OutboxItem>>;
      outbox = parsed
        .filter((item) => typeof item.path === "string")
        .map((item, i) => ({
          id: item.id ?? `stored-${i}`,
          path: item.path as string,
          body: item.body,
          label: item.label ?? "Pendiente · Pending",
          queuedAt: item.queuedAt ?? new Date().toISOString(),
          status: item.status === "failed" ? "failed" : "pending",
          error: item.error,
        }));
    } catch {
      outbox = [];
    }
  }
  if (session) return "google";
  return demoMode ? "demo" : null;
}

/** The Google web client id, or null when the server isn't configured yet. */
export async function getAuthConfig(): Promise<string | null> {
  const res = await fetch(`${SERVER_URL}/auth/config`);
  if (!res.ok) throw new Error(`auth/config -> ${res.status}`);
  const body = (await res.json()) as { googleClientId: string | null };
  return body.googleClientId;
}

/** Exchange a Google ID token for our session; stores it only on success. */
export async function signInWithGoogle(credential: string): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_URL}/auth/google`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential }),
    });
    if (!res.ok) return false;
    session = (await res.json()) as Session;
  } catch {
    return false;
  }
  demoMode = false;
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
  await AsyncStorage.removeItem(DEMO_KEY);
  return true;
}

/** Display name of the signed-in person (null in demo / signed out). */
export function currentUserName(): string | null {
  return session?.name ?? null;
}

/** Called when the server rejects our session (expired or revoked). */
export function setOnUnauthorized(listener: (() => void) | null): void {
  onUnauthorized = listener;
}

export async function enterDemoMode(): Promise<void> {
  demoMode = true;
  session = null;
  await AsyncStorage.setItem(DEMO_KEY, "1");
  await AsyncStorage.removeItem(SESSION_KEY);
}

/** Sign out: forget the stored session. */
export async function clearAuth(): Promise<void> {
  session = null;
  demoMode = false;
  await AsyncStorage.removeItem(SESSION_KEY);
  await AsyncStorage.removeItem(DEMO_KEY);
}

const connected = () => session != null;

export interface OutboxItem {
  id: string;
  path: string;
  body: unknown;
  /** Human description, e.g. "Inspección — 261357 Lininger". */
  label: string;
  queuedAt: string;
  status: "pending" | "failed";
  /** Server-reported reason when a send failed for good. */
  error?: string;
}

/**
 * The outbox lives in memory (authoritative) and mirrors to storage
 * best-effort — a full/blocked storage must never silently lose a send.
 */
let outbox: OutboxItem[] = [];
const outboxListeners = new Set<() => void>();

function notifyOutbox(): void {
  void AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox)).catch(() => {});
  for (const listener of outboxListeners) listener();
}

export function subscribeOutbox(listener: () => void): () => void {
  outboxListeners.add(listener);
  return () => outboxListeners.delete(listener);
}

export function outboxItems(): OutboxItem[] {
  return outbox;
}

export function discardOutboxItem(id: string): void {
  outbox = outbox.filter((item) => item.id !== id);
  notifyOutbox();
}

/** Re-try the whole outbox when connectivity returns or the app resurfaces. */
export function initAutoFlush(): void {
  const g = globalThis as Record<string, any>;
  if (typeof g.addEventListener !== "function") return;
  g.addEventListener("online", () => void flushOutbox());
  g.document?.addEventListener?.("visibilitychange", () => {
    if (g.document.visibilityState === "visible") void flushOutbox();
  });
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session?.token ?? ""}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && session) {
    // Session expired (monthly) or was revoked — back to the sign-in gate.
    await clearAuth();
    onUnauthorized?.();
  }
  if (!res.ok) {
    let reason = "";
    try {
      reason = String(((await res.json()) as { error?: string }).error ?? "");
    } catch {
      // non-JSON error body
    }
    throw new Error(reason || `${method} ${path} -> ${res.status}`);
  }
  if (method === "GET" && path === "/queue") lastFreshQueueAt = Date.now();
  return (await res.json()) as T;
}

/**
 * Fresh from the server -> cached copy -> (demo data only in demo mode).
 * A signed-in user must never see sample data: with no connection and no
 * cached copy this throws, and the screen shows an offline state.
 */
async function cached<T>(key: string, fresh: () => Promise<T>, demo: T): Promise<T> {
  if (demoMode) return demo;
  if (!connected()) throw new Error("offline");
  try {
    const value = await fresh();
    // Cache best-effort: a full/blocked storage must not discard fresh data.
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value)).catch(() => {});
    void flushOutbox();
    return value;
  } catch (err) {
    const stale = await AsyncStorage.getItem(CACHE_PREFIX + key).catch(() => null);
    if (stale) return JSON.parse(stale) as T;
    throw err;
  }
}

export interface QueueResult {
  jobs: QueueJob[];
  /** True when the server was unreachable (jobs may be a stale copy or empty). */
  offline: boolean;
}

export async function getQueue(): Promise<QueueResult> {
  try {
    const jobs = await cached("queue", () => request<QueueJob[]>("GET", "/queue"), MOCK_JOBS);
    const offline = !demoMode && !(await freshQueueSucceeded());
    if (!offline) void prefetchJobs(jobs);
    return { jobs, offline };
  } catch {
    return { jobs: [], offline: true };
  }
}

// cached() can return stale data without telling us; track the last fresh hit.
let lastFreshQueueAt = 0;
async function freshQueueSucceeded(): Promise<boolean> {
  return Date.now() - lastFreshQueueAt < 5_000;
}

/**
 * Warm the on-device cache for every queued job while there is signal, so
 * the job screen still opens on a roof with none.
 */
async function prefetchJobs(jobs: QueueJob[]): Promise<void> {
  for (const job of jobs) {
    await getJob(job.id).catch(() => {});
  }
}

export async function getJob(jobId: string): Promise<JobDetail> {
  return cached(`job.${jobId}`, () => request<JobDetail>("GET", `/jobs/${jobId}`), mockJobDetail(jobId));
}

/** Queue a write; try to deliver now, keep it (visibly) if the network says no. */
export async function post(path: string, body: unknown, label = "Pendiente"): Promise<"sent" | "queued"> {
  if (demoMode) return "sent";
  if (connected()) {
    try {
      await request("POST", path, body);
      void flushOutbox();
      return "sent";
    } catch {
      // fall through to outbox
    }
  }
  outbox.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    path,
    body,
    label,
    queuedAt: new Date().toISOString(),
    status: "pending",
  });
  notifyOutbox();
  return "queued";
}

export function outboxCount(): number {
  return outbox.length;
}

/** A 4xx (other than auth/rate-limit) will never succeed on retry. */
const PERMANENT = (status: number) => status >= 400 && status < 500 && ![401, 408, 425, 429].includes(status);

export async function flushOutbox(): Promise<number> {
  if (!connected() || outbox.length === 0) return 0;
  let sent = 0;
  let changed = false;
  for (const item of [...outbox]) {
    if (item.status === "failed") continue;
    try {
      await request("POST", item.path, item.body);
      outbox = outbox.filter((o) => o.id !== item.id);
      sent += 1;
      changed = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = Number(/-> (\d{3})$/.exec(message)?.[1] ?? 0);
      if (status && PERMANENT(status)) {
        item.status = "failed";
        item.error = message;
        changed = true;
      }
      // network errors / 5xx stay pending for the next flush
    }
  }
  if (changed) notifyOutbox();
  return sent;
}

// Typed helpers used by screens. `label` names the item in the outbox.
export const submitInspection = (jobId: string, sub: ChecklistSubmission, label?: string) =>
  post(`/jobs/${jobId}/inspection`, sub, label ?? "Inspección · Inspection");
export const submitCleanup = (jobId: string, sub: ChecklistSubmission, label?: string) =>
  post(`/jobs/${jobId}/cleanup`, sub, label ?? "Limpieza · Cleanup");
export const sendReport = (jobId: string, report: ProblemReport, label?: string) =>
  post(`/jobs/${jobId}/reports`, report, label ?? "Reporte · Report");
export const completePunchTask = (taskId: string, jobId: string, note?: string, label?: string) =>
  post(
    `/tasks/${taskId}/complete`,
    { jobId, ...(note?.trim() ? { note: note.trim() } : {}) },
    label ?? "Reparación terminada · Repair done",
  );

/** Dictated note -> { original, en } from the server; throws when unavailable. */
export async function transcribeNote(audioBase64: string): Promise<{ original: string; en: string }> {
  if (demoMode) return { original: "(demo)", en: "Demo transcription — sign in for the real thing." };
  return request<{ original: string; en: string }>("POST", "/transcribe", { audioBase64 });
}
const DEMO_SUMMARY: ScopeSummary = {
  en: "Full tear-off and re-shingle with OC Duration architectural shingles (32 SQ), new synthetic underlayment and three pipe boots, haul-off included. A change order added 148 LF of 5\" seamless gutters with downspouts.",
  es: "Retiro completo y reinstalación de tejas arquitectónicas OC Duration (32 SQ), con membrana sintética nueva y tres botas de tubo; incluye acarreo de escombro. Una orden de cambio agregó 148 pies lineales de canales sin costura de 5\" con bajantes.",
};

export interface ScopeSummaryResult {
  summary: ScopeSummary | null;
  /** Server-reported reason when generation failed (surfaced in the UI). */
  error?: string;
}

/** Bilingual sold-scope summary; error carries the server's reason. */
export async function getScopeSummary(jobId: string): Promise<ScopeSummaryResult> {
  if (demoMode) return { summary: DEMO_SUMMARY };
  if (!connected()) return { summary: null };
  const key = `${CACHE_PREFIX}scopeSummary.${jobId}`;
  try {
    const body = await request<ScopeSummary>("GET", `/jobs/${jobId}/scope-summary`);
    if (!body.en && !body.es) return { summary: null };
    const summary = { en: body.en, es: body.es };
    await AsyncStorage.setItem(key, JSON.stringify(summary)).catch(() => {});
    return { summary };
  } catch (err) {
    const stale = await AsyncStorage.getItem(key).catch(() => null);
    if (stale) return { summary: JSON.parse(stale) as ScopeSummary };
    return { summary: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Spanish translations for JT text; null when unavailable (offline/unconfigured/demo). */
export async function translateBatch(texts: string[]): Promise<string[] | null> {
  if (demoMode || !connected() || texts.length === 0) return null;
  try {
    const res = await request<{ translations: string[] }>("POST", "/translate", { texts });
    return res.translations;
  } catch {
    return null;
  }
}

export const uploadJobPhoto = (
  jobId: string,
  label: "BEFORE" | "AFTER" | "REPORT" | "INSPECTION",
  imageBase64: string,
  taskId?: string,
) =>
  post(
    `/jobs/${jobId}/photos`,
    { label, imageBase64, ...(taskId ? { taskId } : {}) },
    `Foto ${label} · Photo`,
  );
