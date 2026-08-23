/**
 * Local working state for a job visit (answers, notes, reports) persisted to
 * AsyncStorage so nothing is lost if the app is killed on the roof.
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
}

const EMPTY: VisitState = { inspection: {}, cleanup: {}, notes: {}, reports: [], afterPhotos: {} };
const key = (jobId: string) => `db-checkout.visit.${jobId}`;

export function useVisit(jobId: string) {
  const [state, setState] = useState<VisitState>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(key(jobId)).then((raw) => {
      if (!alive) return;
      setState(raw ? { ...EMPTY, ...(JSON.parse(raw) as VisitState) } : EMPTY);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [jobId]);

  const update = useCallback(
    (patch: (prev: VisitState) => VisitState) => {
      setState((prev) => {
        const next = patch(prev);
        AsyncStorage.setItem(key(jobId), JSON.stringify(next)).catch(() => {});
        return next;
      });
    },
    [jobId],
  );

  return {
    state,
    loaded,
    setAnswer: (kind: "inspection" | "cleanup", fieldId: string, answer: Answer) =>
      update((prev) => ({ ...prev, [kind]: { ...prev[kind], [fieldId]: answer } })),
    setNote: (fieldId: string, text: string) =>
      update((prev) => ({ ...prev, notes: { ...prev.notes, [fieldId]: text } })),
    addReport: (report: ProblemReport) =>
      update((prev) => ({ ...prev, reports: [...prev.reports, report] })),
    setAfterPhoto: (taskId: string) =>
      update((prev) => ({ ...prev, afterPhotos: { ...prev.afterPhotos, [taskId]: true } })),
    clear: () => {
      AsyncStorage.removeItem(key(jobId)).catch(() => {});
      setState(EMPTY);
    },
  };
}
