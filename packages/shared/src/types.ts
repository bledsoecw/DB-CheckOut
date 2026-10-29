/**
 * The API contract between the mobile app and the sync server.
 * The sync server is a thin translation layer — JobTread stays the
 * system of record; nothing here is stored anywhere else.
 */

import type { Answer } from "./jobtread";

/**
 * A job in the crew queue: every job at Final Inspection, Punch List or PM
 * Review, plus — whatever its Status — any job with close-out work assigned
 * to the requesting user (a work area's inspection or a repair booked while
 * the rest of the job is still in production).
 */
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
  /**
   * True when any open punch/inspection task on this job names the
   * requesting user. Drives the Assigned / All tabs on the queue.
   */
  mine: boolean;
  /**
   * The days the requesting user's open close-out work on this job is booked
   * for — a final inspection's day, a repair day — oldest first. Empty when
   * none of it has a day yet; absent on a job that is not theirs, and from a
   * server older than the field. The phone groups the Assigned list by these
   * and draws the day strip off them, so the card itself never grows.
   */
  booked?: BookedDay[];
}

/** One booked stretch of close-out work, as JobTread dates it (YYYY-MM-DD). */
export interface BookedDay {
  start: string;
  /** The same as start on a one-day booking, which is nearly all of them. */
  end: string;
  kind: "inspection" | "repair";
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
  /**
   * When the repair was asked for (ISO). DB Crew refuses an AFTER photo picked
   * from the phone that was taken before this — it cannot show the fix.
   * Optional: a server older than this field simply sends none.
   */
  createdAt?: string | null;
  assignees: Assignee[];
  assigneeNames: string[];
  /**
   * True when the signed-in crew member is one of the assignees. Decided on
   * the server, where the session is — the app never has to guess whether
   * "Alberto Gonzalez" in JT is the person holding the phone.
   */
  mine: boolean;
  /**
   * The work area the repair is filed against (CloseoutArea.key), read off
   * its tag line; null when no area claims it. Only GET /jobs/:id sets it.
   */
  area?: string | null;
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

/**
 * One work area of a roofing job (Carl, 23 Oct 2026) — the roof, the
 * siding, the gutters — inspected, repaired and approved on its own.
 */
export interface CloseoutArea {
  /** "shingle" | "metal" | "flat" | "siding" | "gutters". */
  key: string;
  /** "Shingle roof", "Gutters". */
  label: string;
  /** This area owns the template's "Final inspection" line. */
  line: boolean;
  /**
   * How the crew inspects it: "roof" is the eight roof checks plus cleanup,
   * sent through close-inspection; "gutters" and "siding" are those areas'
   * own checklists (DB Crew T2.27), and "notes" is notes and photos — both
   * sent through close-area-inspection.
   */
  form: "roof" | "gutters" | "siding" | "notes";
  /** Its inspection task in JobTread, when the PM has booked one. */
  inspectionTaskId: string | null;
  /** The day it is booked for. */
  inspectionDate: string | null;
  /** Who is on it. */
  assigneeNames: string[];
  /** The signed-in crew member is one of them. */
  mine: boolean;
  /** Close Out's "Inspected by" stamp is on it, or it is complete. */
  inspected: boolean;
  /** Open repairs filed against this area. */
  openRepairs: number;
}

/** A Close Out form, as data (forms.ts): sections of items answered OK · N/A · Fix. */
export interface CloseoutFormItem {
  /** The stable id an answer is stored under. */
  key: string;
  /** The short code written into a REPORT task ("1", "C3"). */
  n: string;
  es: string;
  en: string;
}
export interface CloseoutFormSection {
  /** "inspection", "cleanup" — what the answers and the note are keyed by. */
  key: string;
  label: { es: string; en: string };
  items: CloseoutFormItem[];
}
export interface CloseoutForm {
  key: string;
  sections: CloseoutFormSection[];
}

export interface JobDetail extends QueueJob {
  punchTasks: PunchTask[];
  /** The forms this job's inspection draws (T2.25) — the phone draws these, not its own copy. */
  forms: Record<string, CloseoutForm>;
  /** Which of `forms` the crew inspection uses. */
  jobForm: string;
  /** The job's work areas, in order — empty on a job that is not roofing. */
  areas: CloseoutArea[];
  /** Open punch items on this job, whoever they belong to. */
  openPunchTotal: number;
  /** Approved customer orders, oldest first — what was sold, changes included. */
  soldScope: ScopeDocument[];
}

/**
 * POST /jobs/:id/close-inspection — the whole visit, sent LAST after the
 * problem reports. The answers become the checklist on the job's scheduled
 * "Final inspection" task (eight inspection items, then the five cleanup
 * items) and the notes go into that task's description; completing the task
 * is what moves the job on.
 */
export interface CloseInspectionRequest {
  /** The form the answers are for (T2.25); absent reads as "roof". */
  form?: string;
  /** Canonical answers keyed by checklist item key (INSPECTION_ITEMS / CLEANUP_ITEMS). */
  answers: {
    inspection: Record<string, Answer>;
    cleanup: Record<string, Answer>;
  };
  notes?: {
    /** Inspector notes (English). */
    inspection?: string;
    /** Attic access limitation / existing conditions. */
    attic?: string;
    /** Cleanup notes (English). */
    cleanup?: string;
  };
  /**
   * What the crew found on the checklist lines they marked ACTION, one per
   * report that came from a line. Sent inline (without photos) because the
   * REPORT tasks are their own sends and may land after this: the item's
   * note goes into its checklist entry and the task description, and a
   * fixed-on-site item is ticked.
   */
  findings?: ChecklistFinding[];
  /**
   * Problems the crew recorded THIS visit that still need a return trip.
   * Carried here because the outbox can deliver the REPORT tasks after this.
   */
  problemsReported: number;
}

export interface ChecklistFinding {
  itemKey: string;
  fixedOnSite: boolean;
  location: string;
  /** The English note for the office. */
  note: string;
  /** How many photos the crew took for it (they arrive as their own sends). */
  photos: number;
}

/**
 * POST /jobs/:id/close-area-inspection — a work area inspected with notes
 * and photos rather than the roof checklist (Carl, 23 Oct 2026: gutter and
 * siding inspections are "notes and photos for now"). The photos are their
 * own sends (POST /jobs/:id/photos, label INSPECTION, with the same `area`);
 * findings are their own reports, with `area` set.
 */
export interface CloseAreaInspectionRequest {
  area: string;
  /** What the inspector saw, or their final notes on a checklist area (English). */
  notes?: string;
  /** Findings this visit still needing a return trip — the reports can land after this. */
  problemsReported: number;
  /** The area's checklist (DB Crew T2.27): which form, its answers by section, each section's note. */
  form?: string;
  answers?: Record<string, Record<string, string>>;
  sectionNotes?: Record<string, string>;
  findings?: Array<{ itemKey: string; fixedOnSite?: boolean; location?: string; note?: string; photos?: number }>;
}

/**
 * POST /jobs/:id/reports — a problem report. Becomes a punch to-do filed
 * against its work area, assigned to whoever that area's repairs go to,
 * unless the crew corrected it on the spot (fixedOnSite) — then the task is
 * created already complete, purely as documentation of the correction.
 */
export interface ProblemReport {
  /** The checklist item (INSPECTION_ITEMS / CLEANUP_ITEMS key) this came from, when it did. */
  itemKey?: string;
  /**
   * The work area it is about (CloseoutArea.key). Absent: the template
   * line's — what every build before work areas sent.
   */
  area?: string;
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
  /** Several problem photos (data URIs); each is attached to the JT task. */
  photosBase64?: string[];
}

export interface ApiError {
  error: string;
}
