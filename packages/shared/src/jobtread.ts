/**
 * The JobTread contract for DB CheckOut.
 *
 * Every id below exists in the live Deitemeyer Brothers JobTread org and is
 * documented in docs/jobtread-setup.md. If something is renamed or recreated
 * in JT, update it here and there together — this file is the single source
 * the sync server and the mobile app build against.
 */

export const ORGANIZATION_ID = "22PBAjem8SSC";

// ---------------------------------------------------------------------------
// Job custom fields
// ---------------------------------------------------------------------------

export const CUSTOM_FIELDS = {
  status: "22PBAjfWVVv9",
  jobType: "22PBzhnUydgC",
  /** Multi-value: a job can carry several Project Types (e.g. R-Shingles + R-Metal). */
  projectType: "22PC7idvhRzp",
  projectManager: "22PC4DSTx7tg",
  salesRep: "22PBzhswJYd8",
} as const;

/**
 * Project Type values that mark a job as a service call (the service lane).
 * Job Type is the division only (Roofing | Construction) — since the
 * 2026-08-25 cleanup the retired "Service/Repair" Job Type is no longer
 * used; what kind of work it is lives on Project Type.
 */
export const SERVICE_PROJECT_TYPES: readonly string[] = ["R-Repairs/Service", "R-Warranty"];

/** Pipeline statuses DB CheckOut reads and writes (job Status field). */
export const STATUS = {
  production: "Production",
  finalInspection: "Final Inspection",
  punchList: "Punch List",
  /** Renamed in JT from "Punch Review" on 2026-09-16 — JT refuses the old value. */
  pmReview: "PM Review",
  jobCompleted: "Job Completed",
  pendingFinalPayment: "Pending Final Payment",
} as const;

export type PipelineStatus = (typeof STATUS)[keyof typeof STATUS];

// ---------------------------------------------------------------------------
// Checklists — they ride on the job's scheduled "Final inspection" task
// ---------------------------------------------------------------------------

/** Canonical stored option values for checklist answers (display differs by language). */
export const ANSWER = {
  ok: "OK",
  na: "N/A",
  action: "ACTION",
} as const;

export type Answer = (typeof ANSWER)[keyof typeof ANSWER];

/**
 * The crew checklists are the CHECKLIST on the job's scheduled "Final
 * inspection" task (copied from the task template below), not JT Forms — the
 * "DB Final Roofing Inspection" and "DB Site Cleanup" forms were retired on
 * 2026-09-21. Every item here is one subtask on that task. A subtask has no
 * id and is matched by NAME, so `subtask` must match the template word for
 * word; `key` is the app's own stable id for the item (local visit state and
 * the label table in i18n.ts) — the ids of the retired form fields, kept so
 * nothing saved on a phone is lost.
 *
 * Answers collapse to the subtask's two states: OK and N/A tick, ACTION does
 * not — an ACTION is what creates the REPORT: punch task, which is where that
 * finding actually lives.
 */
export const INSPECTION_ITEMS = [
  { key: "22PdEQfPnVqh", code: "1", subtask: "1. Shingle field flat — no exposed fasteners or unaddressed damage" },
  { key: "22PdEQfPnVqi", code: "2", subtask: "2. Starter, eave/rake edges & drip edge complete and secure" },
  { key: "22PdEQfPnVqj", code: "3", subtask: "3. Ridge & hip caps seated; valleys clean; transitions shed water" },
  { key: "22PdEQfPnVqk", code: "4", subtask: "4. Pipe boots, static vents & ridge ventilation installed and sealed" },
  { key: "22PdEQfPnVqm", code: "5", subtask: "5. Step, headwall & sidewall flashing complete and integrated" },
  { key: "22PdEQfPnVqn", code: "6", subtask: "6. Chimneys, skylights & penetrations flashed/reset as scoped" },
  { key: "22PdEQfPnVqp", code: "7", subtask: "7. Sealant appropriate — not a substitute for flashing; roof surface clear" },
  { key: "22PdEQfPnVqq", code: "8", subtask: "8. Attic / interior spot check — leak-prone areas inspected" },
] as const;

/**
 * The five cleanup checks. They go on the SAME task's checklist, after the
 * eight inspection items, so the PM sees the whole visit in one place; the
 * "Cleanup" prefix keeps them apart from the numbered inspection lines.
 */
export const CLEANUP_ITEMS = [
  { key: "22PdEQhB6rSR", code: "C1", subtask: "Cleanup 1. Driveway, walks & landscaping clean — magnet sweep completed" },
  { key: "22PdEQhB6rSS", code: "C2", subtask: "Cleanup 2. Unused materials, pallets, tarps & crew debris removed or staged" },
  { key: "22PdEQhB6rST", code: "C3", subtask: "Cleanup 3. Gutters & downspouts clear of debris and reconnected" },
  { key: "22PdEQhB6rSU", code: "C4", subtask: "Cleanup 4. No production damage — siding, windows, doors, AC, plants" },
  { key: "22PdEQhB6rSV", code: "C5", subtask: "Cleanup 5. General appearance — ready for the homeowner to view" },
] as const;

/** Every checklist item, in JT order. `code` is the short id written into a REPORT task ("DB CheckOut item: 8"). */
export const CHECKLIST_ITEMS: ReadonlyArray<{ key: string; code: string; subtask: string }> = [
  ...INSPECTION_ITEMS,
  ...CLEANUP_ITEMS,
];

export function checklistItemByKey(key: string | undefined): { key: string; code: string; subtask: string } | undefined {
  return key ? CHECKLIST_ITEMS.find((item) => item.key === key) : undefined;
}

export function checklistItemByCode(code: string | undefined): { key: string; code: string; subtask: string } | undefined {
  return code ? CHECKLIST_ITEMS.find((item) => item.code === code) : undefined;
}

export const INSPECTION_CHECKLIST = {
  /** Item keys in crew order; derived so the app and the subtasks can never drift apart. */
  keys: INSPECTION_ITEMS.map((i) => i.key) as readonly string[],
  /** Free text: attic access limitation / existing conditions. */
  atticKey: "22PdEQfPnVqr",
  /** Free text: inspector notes (English). */
  notesKey: "22PdEQfPnVqs",
} as const;

export const CLEANUP_CHECKLIST = {
  keys: CLEANUP_ITEMS.map((i) => i.key) as readonly string[],
  /** Free text: cleanup notes (English). */
  notesKey: "22PdEQhB6rSW",
} as const;

/** The sales-rep form at the Final Inspection milestone — still a JT Form, not used by the crew app. */
export const WALKTHROUGH_FORM = {
  id: "22PdEpi4SNW3",
  name: "DB Customer Walkthrough",
} as const;

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const TASK_TYPES = {
  /** Punch/repair items created from crew reports. */
  punchList: "22PLePTbJVrQ",
  /** The "Final inspection" pipeline task, and inspection visits generally. */
  inspection: "22PNJDrm6TsA",
  /** Planning bars that are not crew bookings ("Order materials", "Roof install"). */
  preProduction: "22PDM6m8Vdqw",
  /** The remaining pipeline milestones — deliberately NOT Punch List (see below). */
  general: "22PBAjfWNQrT",
} as const;

/**
 * The task template copied onto every roofing job. Its six tasks ARE the
 * pipeline, and completing two of them is what moves the job's Status.
 *
 * Every task carries a type on purpose, and two of those choices are
 * load-bearing:
 *
 * - "Punch list" is typed **General, never Punch List**. `listPunchTasks`
 *   filters on task type alone, so a permanently-open phase task typed
 *   Punch List would count as an unfinished punch item on every job and the
 *   PM Review flip would never fire again, anywhere.
 * - "Order materials" and "Roof install" are typed **Pre-Production, not
 *   Install or Roofing**. The DB Production Board's task sweep accepts
 *   Install, Roofing AND untyped tasks and then resolves a crew from the
 *   assignees — so an untyped "Roof install" with a crew on it renders on
 *   the board as a phantom crew visit. Pre-Production is invisible to it.
 *
 * JobTread does NOT set `taskTemplate` on the copies (verified live), so a
 * copied task has no back-reference to this template. The task TYPE plus the
 * name below is the only durable marker there is.
 */
export const TASK_TEMPLATES = {
  roofingPhaseOne: "22PeHi4zyTkx",
} as const;

/**
 * The pipeline tasks the sync server writes to.
 *
 * Matched by NAME first, with `typeId` only breaking ties: the org uses the
 * Inspection type for every sales rep's inspection visit, so a lone
 * Inspection-typed task on a job is usually NOT the milestone, and older
 * template copies carry no task types at all.
 */
export const PIPELINE_TASKS = {
  /** Crew ticks the checklist here; completing it ends the inspection. */
  finalInspection: { name: "Final inspection", typeId: TASK_TYPES.inspection },
  /** Its checklist mirrors the job's punch to-dos; it completes when the last one closes. */
  punchList: { name: "Punch list", typeId: TASK_TYPES.general },
  /** Sales rep has spoken to the customer; completing it closes the job. */
  finalCheckOff: { name: "Final check-off", typeId: TASK_TYPES.general },
} as const;

export type PipelineTaskKey = keyof typeof PIPELINE_TASKS;

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const ROLES = {
  admin: "22PBAjexsjjX",
  crew: "22PEWdLwFuDb",
  siteManager: "22PEWeBJqFr4",
  roofingPM: "22PT7gAjFxyX",
  constructionPM: "22PEWd9dRa5k",
  salesTeam: "22PEWdJcCip7",
  salesTeamManager: "22PWktxywW8z",
  frontOffice: "22PEWd4hUQ2j",
  accountsManager: "22PQcyVsGZTt",
} as const;
