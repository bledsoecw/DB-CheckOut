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

interface OutboxItem {
  path: string;
  body: unknown;
  queuedAt: string;
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
  return (await res.json()) as T;
}

async function cached<T>(key: string, fresh: () => Promise<T>, demo: T): Promise<T> {
  if (!connected()) return demo;
  try {
    const value = await fresh();
    // Cache best-effort: a full/blocked storage must not discard fresh data.
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value)).catch(() => {});
    void flushOutbox();
    return value;
  } catch {
    const stale = await AsyncStorage.getItem(CACHE_PREFIX + key);
    if (stale) return JSON.parse(stale) as T;
    return demo;
  }
}

export async function getQueue(): Promise<QueueJob[]> {
  return cached("queue", () => request<QueueJob[]>("GET", "/queue"), MOCK_JOBS);
}

export async function getJob(jobId: string): Promise<JobDetail> {
  return cached(`job.${jobId}`, () => request<JobDetail>("GET", `/jobs/${jobId}`), mockJobDetail(jobId));
}

/** Queue a write; try to deliver now, keep it if the network says no. */
export async function post(path: string, body: unknown): Promise<"sent" | "queued"> {
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
  const raw = await AsyncStorage.getItem(OUTBOX_KEY);
  const outbox: OutboxItem[] = raw ? JSON.parse(raw) : [];
  outbox.push({ path, body, queuedAt: new Date().toISOString() });
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  return "queued";
}

export async function outboxCount(): Promise<number> {
  const raw = await AsyncStorage.getItem(OUTBOX_KEY);
  return raw ? (JSON.parse(raw) as OutboxItem[]).length : 0;
}

export async function flushOutbox(): Promise<number> {
  if (!connected()) return 0;
  const raw = await AsyncStorage.getItem(OUTBOX_KEY);
  if (!raw) return 0;
  const outbox: OutboxItem[] = JSON.parse(raw);
  const remaining: OutboxItem[] = [];
  let sent = 0;
  for (const item of outbox) {
    try {
      await request("POST", item.path, item.body);
      sent += 1;
    } catch {
      remaining.push(item);
    }
  }
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(remaining));
  return sent;
}

// Typed helpers used by screens
export const submitInspection = (jobId: string, sub: ChecklistSubmission) =>
  post(`/jobs/${jobId}/inspection`, sub);
export const submitCleanup = (jobId: string, sub: ChecklistSubmission) =>
  post(`/jobs/${jobId}/cleanup`, sub);
export const sendReport = (jobId: string, report: ProblemReport) =>
  post(`/jobs/${jobId}/reports`, report);
export const completePunchTask = (taskId: string, jobId: string, note?: string) =>
  post(`/tasks/${taskId}/complete`, { jobId, ...(note?.trim() ? { note: note.trim() } : {}) });
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
) => post(`/jobs/${jobId}/photos`, { label, imageBase64, ...(taskId ? { taskId } : {}) });
