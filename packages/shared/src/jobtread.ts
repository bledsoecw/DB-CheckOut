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
  projectManager: "22PC4DSTx7tg",
  salesRep: "22PBzhswJYd8",
} as const;

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

export const INSPECTION_FORM = {
  id: "22PdEQfPn8wQ",
  name: "DB Final Roofing Inspection",
  optionFields: [
    "22PdEQfPnVqh", // 1. Shingle field flat — no exposed fasteners or unaddressed damage
    "22PdEQfPnVqi", // 2. Starter, eave/rake edges & drip edge complete and secure
    "22PdEQfPnVqj", // 3. Ridge & hip caps seated; valleys clean; transitions shed water
    "22PdEQfPnVqk", // 4. Pipe boots, static vents & ridge ventilation installed and sealed
    "22PdEQfPnVqm", // 5. Step, headwall & sidewall flashing complete and integrated
    "22PdEQfPnVqn", // 6. Chimneys, skylights & penetrations flashed/reset as scoped
    "22PdEQfPnVqp", // 7. Sealant appropriate — not a substitute for flashing; roof surface clear
    "22PdEQfPnVqq", // 8. Attic / interior spot check — leak-prone areas inspected
  ],
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
  /** Optional: scheduling the inspection visit itself. */
  inspection: "22PNJDrm6TsA",
} as const;

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
