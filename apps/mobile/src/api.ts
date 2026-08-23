/**
 * Client for the sync server, offline-first:
 * - GETs fall back to the last cached copy (and to demo data with no server).
 * - POSTs go into a persistent outbox and are flushed when a request succeeds
 *   again — nothing the crew does is ever lost to a dead spot.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChecklistSubmission, JobDetail, ProblemReport, QueueJob } from "@shared/types";
import { MOCK_JOBS, mockJobDetail } from "./mock";

/** Set to the deployed sync server URL; empty string = demo mode with sample data. */
export const SERVER_URL = "";
export const APP_TOKEN = "";

const OUTBOX_KEY = "db-checkout.outbox";
const CACHE_PREFIX = "db-checkout.cache.";

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
      "x-app-token": APP_TOKEN,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

async function cached<T>(key: string, fresh: () => Promise<T>, demo: T): Promise<T> {
  if (!SERVER_URL) return demo;
  try {
    const value = await fresh();
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
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
  if (SERVER_URL) {
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
  if (!SERVER_URL) return 0;
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
export const completePunchTask = (taskId: string, jobId: string) =>
  post(`/tasks/${taskId}/complete`, { jobId });
