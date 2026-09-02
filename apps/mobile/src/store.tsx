/**
 * Local working state for a job visit (answers, notes, reports) persisted to
 * AsyncStorage so nothing is lost if the app is killed on the roof.
 * Held in a module-level store shared by every mounted screen, so the job
 * screen's counters update live as the checklist/report screens write.
 * Cleared when the visit is submitted.
 */

import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Answer } from "@shared/jobtread";
import type { ProblemReport } from "@shared/types";

export interface VisitState {
  inspection: Record<string, Answer>;
  cleanup: Record<string, Answer>;
  notes: Record<string, string>;
  reports: ProblemReport[];
  /** taskId -> true once the crew took the AFTER photo (photo upload lands in M2). */
  afterPhotos: Record<string, boolean>;
  /** Job-condition photos (data URIs), kept on the phone until Finish & send. */
  visitPhotos: string[];
  /** Photos staged for the problem report being written, until it's sent. */
  reportPhotos: string[];
  /** When this job's visit was last sent — survives the post-send clear. */
  lastSentAt: string | null;
}

const EMPTY: VisitState = {
  inspection: {},
  cleanup: {},
  notes: {},
  reports: [],
  afterPhotos: {},
  visitPhotos: [],
  reportPhotos: [],
  lastSentAt: null,
};
const key = (jobId: string) => `db-checkout.visit.${jobId}`;

const memory = new Map<string, VisitState>();
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

export function useVisit(jobId: string) {
  const [, bump] = useState(0);

  useEffect(() => {
    const listener = () => bump((n) => n + 1);
    listeners.add(listener);
    if (!memory.has(jobId)) {
      AsyncStorage.getItem(key(jobId)).then((raw) => {
        if (!memory.has(jobId)) {
          memory.set(jobId, raw ? { ...EMPTY, ...(JSON.parse(raw) as VisitState) } : EMPTY);
          notify();
        }
      });
    }
    return () => {
      listeners.delete(listener);
    };
  }, [jobId]);

  const update = useCallback(
    (patch: (prev: VisitState) => VisitState) => {
      const next = patch(memory.get(jobId) ?? EMPTY);
      memory.set(jobId, next);
      AsyncStorage.setItem(key(jobId), JSON.stringify(next)).catch(() => {});
      notify();
    },
    [jobId],
  );

  return {
    state: memory.get(jobId) ?? EMPTY,
    loaded: memory.has(jobId),
    setAnswer: (kind: "inspection" | "cleanup", fieldId: string, answer: Answer) =>
      update((prev) => ({ ...prev, [kind]: { ...prev[kind], [fieldId]: answer } })),
    setNote: (fieldId: string, text: string) =>
      update((prev) => ({ ...prev, notes: { ...prev.notes, [fieldId]: text } })),
    addReport: (report: ProblemReport) =>
      update((prev) => ({ ...prev, reports: [...prev.reports, report] })),
    addVisitPhoto: (uri: string) =>
      update((prev) => ({ ...prev, visitPhotos: [...prev.visitPhotos, uri] })),
    removeVisitPhoto: (index: number) =>
      update((prev) => ({ ...prev, visitPhotos: prev.visitPhotos.filter((_, i) => i !== index) })),
    addReportPhoto: (uri: string) =>
      update((prev) => ({ ...prev, reportPhotos: [...prev.reportPhotos, uri] })),
    removeReportPhoto: (index: number) =>
      update((prev) => ({ ...prev, reportPhotos: prev.reportPhotos.filter((_, i) => i !== index) })),
    clearReportPhotos: () => update((prev) => ({ ...prev, reportPhotos: [] })),
    setAfterPhoto: (taskId: string) =>
      update((prev) => ({ ...prev, afterPhotos: { ...prev.afterPhotos, [taskId]: true } })),
    clear: (sentAt?: string) => {
      const prev = memory.get(jobId) ?? EMPTY;
      const next = { ...EMPTY, lastSentAt: sentAt ?? prev.lastSentAt };
      memory.set(jobId, next);
      AsyncStorage.setItem(key(jobId), JSON.stringify(next)).catch(() => {});
      notify();
    },
  };
}
