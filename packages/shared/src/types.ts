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
  /** All Project Type values on the job (multi-value in JT). */
  projectTypes: string[];
  /** True when any Project Type marks this as a service call (R-Repairs/Service, R-Warranty). */
  isService: boolean;
  projectManager: string | null;
  salesRep: string | null;
  /** Street address when the JT job has a location; used for the directions link. */
  address: string | null;
  /**
   * Open punch tasks assigned to the requesting user. Falls back to every
   * open item when the caller has no identity (unauthenticated tooling).
   */
  openPunchCount: number;
}

/** Somebody a punch item is assigned to in JobTread. */
export interface Assignee {
  /** JT membership id — stable, and what the Production Board writes. */
  membershipId: string;
  name: string;
  /** JT account email. Subs are on personal addresses, staff on the domain. */
  email: string | null;
}

export interface PunchTask {
  id: string;
  name: string;
  description: string | null;
  /** 0..1 in JT; 1 means the crew finished it. */
  progress: number;
  endDate: string | null;
  assignees: Assignee[];
  assigneeNames: string[];
  /**
   * True when the signed-in crew member is one of the assignees. Decided on
   * the server, where the session is — the app never has to guess whether
   * "Alberto Gonzalez" in JT is the person holding the phone.
   */
  mine: boolean;
}

/** One line of an approved customer order (the record stays English). */
export interface ScopeLine {
  name: string;
  /** Quantity as sold; null when JT has it at 0/blank. */
  quantity: number | null;
  unit: string | null;
  description: string | null;
}

/** An approved customer-facing document: the original order or an approved change. */
export interface ScopeDocument {
  id: string;
  name: string;
  /** JT document number, e.g. Estimate #4. */
  number: number | null;
  issueDate: string | null;
  price: number;
  /** Deep link to review this document in JobTread. */
  jtUrl: string;
  lines: ScopeLine[];
}

/** GET /jobs/:id/scope-summary — crew-facing summary of the sold work. */
export interface ScopeSummary {
  en: string;
  es: string;
}

export interface JobDetail extends QueueJob {
  punchTasks: PunchTask[];
  /** Open punch items on this job, whoever they belong to. */
  openPunchTotal: number;
  /** Approved customer orders, oldest first — what was sold, changes included. */
  soldScope: ScopeDocument[];
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
  /** Photo of the problem (data URI, downscaled client-side); attached to the JT task. */
  photoBase64?: string;
}

export interface ApiError {
  error: string;
}
