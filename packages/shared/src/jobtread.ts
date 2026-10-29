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

/**
 * Job Status values DB CheckOut reads. On a roofing job with work areas it
 * writes none of them: the Production Board moves the Status from the
 * areas (Carl, 23 Oct 2026), and Close Out tells it what happened. A job
 * with no work areas (a service call, construction) is still moved here,
 * by the old rule (pipeline.ts `applyLinear`).
 */
export const STATUS = {
  preProduction: "Pre-Production",
  production: "Production",
  finalInspection: "Final Inspection",
  punchList: "Punch List",
  /** Renamed in JT from "Punch Review" on 2026-09-16 — JT refuses the old value. */
  pmReview: "PM Review",
  /** Every work area approved: the sales rep calls the customer, then sets Job Completed by hand. */
  repReview: "Sales Rep > Cust Final Contact",
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

/**
 * The gutters' and the siding's own final inspections (DB Crew T2.27, Carl
 * 29 Oct 2026: "create check lists for gutter and siding final
 * inspections"). Drafted off the roof's form and the trades' own close-out
 * points; rewording one is a change here and a deploy, never an app release.
 * The keys are this server's own — no JobTread form carries them — and the
 * code rides a REPORT task ("DB CheckOut item: G3") as the roof's do. Each
 * is written as the checklist of the area's own inspection task, "Final
 * inspection — Gutters", the one the board books.
 */
export const GUTTER_ITEMS = [
  { key: "gut-pitch", code: "G1", subtask: "G1. Gutters straight and pitched to the downspouts — no standing water" },
  { key: "gut-hang", code: "G2", subtask: "G2. Hangers tight, about every 2 feet — nothing sagging or pulling off the fascia" },
  { key: "gut-seal", code: "G3", subtask: "G3. Seams, end caps and miters sealed — no drips" },
  { key: "gut-edge", code: "G4", subtask: "G4. Water lands in the gutter — drip edge over it, nothing running behind" },
  { key: "gut-down", code: "G5", subtask: "G5. Downspouts strapped, elbows and extensions on — water carried away from the house" },
  { key: "gut-guard", code: "G6", subtask: "G6. Gutter guards in and secure, if sold" },
  { key: "gut-look", code: "G7", subtask: "G7. No dents or scratches; color matches the order" },
  { key: "gut-water", code: "G8", subtask: "G8. Water test — hose run, flows to every downspout, no leaks" },
] as const;
export const GUTTER_CLEANUP_ITEMS = [
  { key: "gut-c-scrap", code: "GC1", subtask: "Gutter cleanup 1. Old gutters, cut-offs and screws picked up and hauled off" },
  { key: "gut-c-mag", code: "GC2", subtask: "Gutter cleanup 2. Magnet sweep — driveway, beds and lawn" },
  { key: "gut-c-dmg", code: "GC3", subtask: "Gutter cleanup 3. No ladder marks or damage — siding, plants, lawn" },
] as const;
export const SIDING_ITEMS = [
  { key: "sid-lock", code: "S1", subtask: "S1. Panels level and locked in — no waves, gaps or buckling" },
  { key: "sid-nail", code: "S2", subtask: "S2. Nailed in the slot, not tight — panels move side to side" },
  { key: "sid-start", code: "S3", subtask: "S3. Starter and bottom course straight" },
  { key: "sid-trim", code: "S4", subtask: "S4. Corners, J-channel and window and door trim tight and sealed" },
  { key: "sid-block", code: "S5", subtask: "S5. Lights, outlets, faucets and vents on mounting blocks, trimmed out" },
  { key: "sid-soffit", code: "S6", subtask: "S6. Soffit and fascia secure; vented soffit where it should be" },
  { key: "sid-caulk", code: "S7", subtask: "S7. Caulk neat and complete — no open joints" },
  { key: "sid-look", code: "S8", subtask: "S8. No cracks, dents or scratches; color matches the order" },
] as const;
export const SIDING_CLEANUP_ITEMS = [
  { key: "sid-c-scrap", code: "SC1", subtask: "Siding cleanup 1. Old siding, cut-offs and nails picked up and hauled off" },
  { key: "sid-c-mag", code: "SC2", subtask: "Siding cleanup 2. Magnet sweep — driveway, beds and lawn" },
  { key: "sid-c-clean", code: "SC3", subtask: "Siding cleanup 3. Windows, doors and walls wiped down — ready for the homeowner" },
] as const;

/** Each area checklist in JobTread order: the inspection items, then its cleanup. */
export const AREA_CHECKLISTS: Readonly<Record<"gutters" | "siding", ReadonlyArray<{ key: string; code: string; subtask: string }>>> = {
  gutters: [...GUTTER_ITEMS, ...GUTTER_CLEANUP_ITEMS],
  siding: [...SIDING_ITEMS, ...SIDING_CLEANUP_ITEMS],
};

/** Every item on every form — what a REPORT, a photo's name or a finding is looked up in. */
const ALL_CHECKLIST_ITEMS: ReadonlyArray<{ key: string; code: string; subtask: string }> = [
  ...CHECKLIST_ITEMS,
  ...AREA_CHECKLISTS.gutters,
  ...AREA_CHECKLISTS.siding,
];

export function checklistItemByKey(key: string | undefined): { key: string; code: string; subtask: string } | undefined {
  return key ? ALL_CHECKLIST_ITEMS.find((item) => item.key === key) : undefined;
}

export function checklistItemByCode(code: string | undefined): { key: string; code: string; subtask: string } | undefined {
  return code ? ALL_CHECKLIST_ITEMS.find((item) => item.code === code) : undefined;
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
 * - "Punch list" is typed **Punch List** (since 2026-09-21) but it is a
 *   SCHEDULED task, never a to-do. Punch items are the Punch List-typed
 *   TO-DOs the app creates; `listPunchTasks` filters on type AND `isToDo`,
 *   so the phase task never counts as an unfinished punch item.
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
  punchList: { name: "Punch list", typeId: TASK_TYPES.punchList },
  /** Sales rep has spoken to the customer; completing it closes the job. */
  finalCheckOff: { name: "Final check-off", typeId: TASK_TYPES.general },
  /**
   * The PM ticks it after checking the punch work. A human gate with no
   * status of its own — the summary of every finished repair is posted here
   * when the last one moves the job to PM Review (Carl, 13 Oct 2026).
   */
  pmPunchReview: { name: "PM punch review", typeId: TASK_TYPES.general },
} as const;

export type PipelineTaskKey = keyof typeof PIPELINE_TASKS;

// ---------------------------------------------------------------------------
// The punch crew
// ---------------------------------------------------------------------------

/**
 * Who a REPORT: to-do is assigned to as it is created, on roofing jobs: the
 * service crew's JobTread STAFF memberships (company-domain accounts — not
 * the vendor entry "Alberto/Jorge Gonzalez", which the app cannot match to
 * a signed-in person).
 */
export const PUNCH_CREW = [
  { name: "Alberto Gonzalez", membershipId: "22PdPUpWzpHy" },
  { name: "Yahir Gonzalez", membershipId: "22PdPTwMdkzj" },
] as const;

/**
 * Who is tagged on the summaries the closeout pipeline posts, so JobTread
 * notifies him (Carl, 13 Oct 2026): when a job reaches PM Review (he has a
 * review), and when an inspection sends it to Punch List (he schedules the
 * punch crew). His internal STAFF membership, verified live 2026-10-13
 * (role: Roofing Production Manager). A tag is an `assignee` on the comment,
 * written flat: `{ membershipId }`.
 */
export const PM_REVIEWER = { name: "Dave Elick", membershipId: "22PLtDsn6f4P" } as const;

/** Roofing work: Job Type Roofing, or any R- Project Type (service calls included). */
export function isRoofingJob(job: { jobType: string | null; projectTypes: readonly string[] }): boolean {
  return job.jobType === "Roofing" || job.projectTypes.some((t) => t.startsWith("R-"));
}

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
