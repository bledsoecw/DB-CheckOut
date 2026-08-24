/**
 * The API contract between the mobile app and the sync server.
 * The sync server is a thin translation layer — JobTread stays the
 * system of record; nothing here is stored anywhere else.
 */

import type { Answer } from "./jobtread";

/** A job in the crew queue (Status = Final Inspection, or with punch tasks assigned to the user). */
export interface QueueJob {
  id: string;
  number: string;
  /** JT job name, e.g. "26-0418 Hartman_Roof". */
  name: string;
  status: string;
  jobType: string | null;
  projectManager: string | null;
  salesRep: string | null;
  /** Street address when the JT job has a location; used for the directions link. */
  address: string | null;
  /** Open punch tasks assigned to the requesting user (punch crew view). */
  openPunchCount: number;
}

export interface PunchTask {
  id: string;
  name: string;
  description: string | null;
  /** 0..1 in JT; 1 means the crew finished it. */
  progress: number;
  endDate: string | null;
  assigneeNames: string[];
}

export interface JobDetail extends QueueJob {
  punchTasks: PunchTask[];
}

/** POST /jobs/:id/inspection and /jobs/:id/cleanup */
export interface ChecklistSubmission {
  /** Canonical answers keyed by JT form field id. */
  answers: Record<string, Answer>;
  /** Free-text field values keyed by JT form field id (notes, attic limitation). */
  texts?: Record<string, string>;
}

/**
 * POST /jobs/:id/reports — a problem report. Becomes an unassigned punch
 * task for the PM/Service Manager to assign, unless the crew corrected it
 * on the spot (fixedOnSite) — then the task is created already complete,
 * purely as documentation of the correction.
 */
export interface ProblemReport {
  /** Short location, e.g. "Rear slope — pipe boot". */
  location: string;
  /** Clean English note for the office (voice pipeline output or typed). */
  englishNote: string;
  /** What the crew actually said, verbatim, any language. Kept for the record. */
  heardText?: string;
  /** Reporter display name (until per-user auth lands). */
  reportedBy?: string;
  /** Crew corrected it during the visit ("correct it rather than report it"). */
  fixedOnSite?: boolean;
  /** Materials and time the on-site correction took. */
  materialsNote?: string;
  /** Who did the original work, when known — factual, for management review. */
  originalCrew?: string;
}

export interface ApiError {
  error: string;
}
