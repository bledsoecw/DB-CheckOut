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
  punchReview: "Punch Review",
  jobCompleted: "Job Completed",
  pendingFinalPayment: "Pending Final Payment",
} as const;

export type PipelineStatus = (typeof STATUS)[keyof typeof STATUS];

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

/** Canonical stored option values for checklist answers (display differs by language). */
export const ANSWER = {
  ok: "OK",
  na: "N/A",
  action: "ACTION",
} as const;

export type Answer = (typeof ANSWER)[keyof typeof ANSWER];

/**
 * The eight inspection checks, in the order the crew works them.
 *
 * Each one is BOTH a form field (the reviewable record) and a subtask on the
 * job's "Final inspection" task (what the PM sees on the Gantt). `subtask`
 * is the exact subtask name written into JobTread — it must match the task
 * template `22PeHi4zyTkx`, because a subtask has no id and is matched by name.
 */
export const INSPECTION_ITEMS = [
  { fieldId: "22PdEQfPnVqh", subtask: "1. Shingle field flat — no exposed fasteners or unaddressed damage" },
  { fieldId: "22PdEQfPnVqi", subtask: "2. Starter, eave/rake edges & drip edge complete and secure" },
  { fieldId: "22PdEQfPnVqj", subtask: "3. Ridge & hip caps seated; valleys clean; transitions shed water" },
  { fieldId: "22PdEQfPnVqk", subtask: "4. Pipe boots, static vents & ridge ventilation installed and sealed" },
  { fieldId: "22PdEQfPnVqm", subtask: "5. Step, headwall & sidewall flashing complete and integrated" },
  { fieldId: "22PdEQfPnVqn", subtask: "6. Chimneys, skylights & penetrations flashed/reset as scoped" },
  { fieldId: "22PdEQfPnVqp", subtask: "7. Sealant appropriate — not a substitute for flashing; roof surface clear" },
  { fieldId: "22PdEQfPnVqq", subtask: "8. Attic / interior spot check — leak-prone areas inspected" },
] as const;

export const INSPECTION_FORM = {
  id: "22PdEQfPn8wQ",
  name: "DB Final Roofing Inspection",
  /** Derived from INSPECTION_ITEMS so the fields and the subtasks can never drift apart. */
  optionFields: INSPECTION_ITEMS.map((i) => i.fieldId) as readonly string[],
  atticNotesField: "22PdEQfPnVqr",
  notesField: "22PdEQfPnVqs",
} as const;

export const CLEANUP_FORM = {
  id: "22PdEQhB67dq",
  name: "DB Site Cleanup",
  optionFields: [
    "22PdEQhB6rSR", // 1. Driveway, walks & landscaping clean — magnet sweep completed
    "22PdEQhB6rSS", // 2. Unused materials, pallets, tarps & crew debris removed or staged
    "22PdEQhB6rST", // 3. Gutters & downspouts clear of debris and reconnected
    "22PdEQhB6rSU", // 4. No production damage — siding, windows, doors, AC, plants
    "22PdEQhB6rSV", // 5. General appearance — ready for the homeowner to view
  ],
  notesField: "22PdEQhB6rSW",
} as const;

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
 *   Punch Review flip would never fire again, anywhere.
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
 * The two pipeline tasks whose completion moves the job on.
 *
 * `typeId` is the primary match because a PM can rename a task in JT but
 * rarely retypes one; `name` disambiguates when a job carries more than one
 * task of that type (an Inspection-typed visit task alongside the pipeline
 * milestone) and is the only marker for the General-typed ones.
 */
export const PIPELINE_TASKS = {
  /** Crew ticks the checklist here; completing it ends the inspection. */
  finalInspection: { name: "Final inspection", typeId: TASK_TYPES.inspection },
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
