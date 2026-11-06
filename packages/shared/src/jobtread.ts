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

/**
 * The template's own description of its "Final inspection" line, word for word
 * as the Production Board writes it on a line it has to create
 * (`FINAL_INSPECTION_NOTE` in the board's ids.ts). Close Out writes it too, on
 * the line it makes when an inspection arrives for a job that has none (DB
 * Crew audit D22, 2 Nov 2026): the answers must be recorded somewhere.
 */
export const FINAL_INSPECTION_NOTE =
  "Complete the quality inspection and document results and photos. If repairs " +
  "are needed, complete Punch list and PM punch review before Final check-off.";

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

/**
 * What the crew said about a checklist line rides on the line's NAME (DB Crew
 * T2.34, audit D33): a JobTread subtask is a name and a tick, nothing else.
 * The way the board's own site checks do it — " — n/a: <reason>" (a bare
 * " — n/a" when the phone gave none) and " — by: <who answered>", in that
 * order. The base is the template's text, which itself carries " — ", so
 * only these exact markers split it. An N/A line is written ticked, so
 * JobTread's progress can reach the end; the marker says it was never done.
 */
export const LINE_NA_MARK = " — n/a";
export const LINE_BY_MARK = " — by: ";
/** Words for a line's name: the markers taken out, one line, capped. */
export function cleanLineWords(text: unknown, max = 120): string {
  return String(text ?? "")
    .replace(/—\s*(?:n\/a|by|note)\b:?/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}
export function checklistLineName(base: string, parts: { na?: string | true | null; by?: string | null }): string {
  let name = base;
  if (parts.na) name += parts.na === true || !String(parts.na).trim() ? LINE_NA_MARK : `${LINE_NA_MARK}: ${parts.na}`;
  if (parts.by) name += `${LINE_BY_MARK}${parts.by}`;
  return name;
}
/** A line's name read back: its template base, its N/A (the reason, or true), who answered. */
export function checklistLineParts(name: string): { base: string; na?: string | true; by?: string } {
  const s = String(name ?? "");
  const marks: Array<{ kind: "na" | "by"; at: number; len: number }> = [];
  const by = s.indexOf(LINE_BY_MARK);
  if (by >= 0) marks.push({ kind: "by", at: by, len: LINE_BY_MARK.length });
  const na = / — n\/a(?=:|$| — )/.exec(s);
  if (na) marks.push({ kind: "na", at: na.index, len: LINE_NA_MARK.length });
  marks.sort((a, b) => a.at - b.at);
  // An older line could carry " · ⚠ REPORT — …" after its base: it is not the base.
  const out: { base: string; na?: string | true; by?: string } = {
    base: (marks.length ? s.slice(0, marks[0].at) : s).split(" · ⚠")[0].trim(),
  };
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].at : s.length;
    const v = s.slice(m.at + m.len, end).replace(/^:\s*/, "").trim();
    if (m.kind === "na") out.na = v || true;
    else if (v) out.by = v;
  });
  return out;
}

/**
 * A repair the crew could not finish (DB Crew T2.35, audit I10). The reason
 * rides one line in the punch to-do's DESCRIPTION — the Production Board's own
 * "⏳ Waiting on material" line, which a PM reading the to-do in JobTread
 * already knows, and the same family for the other reasons — so the board's
 * Close-out panel reads it with no new field. One waiting line at a time: a
 * new one replaces the old, and the board takes it off when the PM books the
 * repair again. The board reads these exact words (`waitingOf` in its
 * lib/trades.ts): change both together.
 */
export const WAITING_PREFIX = "⏳ Waiting";
export const WAITING_REASONS = ["material", "access", "weather", "decision", "other"] as const;
export type WaitingReason = (typeof WAITING_REASONS)[number];
export const WAITING_HEAD: Readonly<Record<WaitingReason, string>> = {
  material: "⏳ Waiting on material",
  access: "⏳ Waiting on access",
  weather: "⏳ Waiting on the weather",
  decision: "⏳ Waiting on a decision",
  other: "⏳ Waiting",
};
/** The reasons a crew must say more about: what is short, what needs deciding, what happened. */
export const WAITING_NEEDS_NOTE: ReadonlySet<WaitingReason> = new Set<WaitingReason>(["material", "decision", "other"]);
export function isWaitingReason(v: unknown): v is WaitingReason {
  return typeof v === "string" && (WAITING_REASONS as readonly string[]).includes(v);
}
/** The note on one line: its first paragraph (the English, when a translation follows), capped. */
export function waitingWords(note: unknown, max = 160): string {
  return String(note ?? "").split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim().slice(0, max).trim();
}
/** "⏳ Waiting on access — the gate was locked (Yahir Gonzalez, Nov 3)". */
export function waitingLine(reason: WaitingReason, note: unknown, by?: string | null, day?: string | null): string {
  const said = waitingWords(note);
  const who = [by?.trim(), day?.trim()].filter(Boolean).join(", ");
  const tail = [said, who ? `(${who})` : ""].filter(Boolean).join(" ");
  return tail ? `${WAITING_HEAD[reason]} — ${tail}` : WAITING_HEAD[reason];
}
/** The description's waiting line read back: the reason and what follows its " — ", or null. */
export function waitingOf(description: string | null | undefined): { reason: WaitingReason; note: string } | null {
  for (const raw of String(description ?? "").split("\n")) {
    const l = raw.trim();
    if (!l.startsWith(WAITING_PREFIX)) continue;
    const reason = (["material", "access", "weather", "decision"] as const).find((r) => l.startsWith(WAITING_HEAD[r])) ?? "other";
    const dash = l.indexOf(" — ");
    return { reason, note: dash >= 0 ? l.slice(dash + 3).trim() : "" };
  }
  return null;
}
/**
 * A service visit's record (DB Crew T2.41, audit I15): what the tech found, and
 * whether the work is covered by the warranty — Yes, No, or Ask the office —
 * on lines of their own in the repair to-do's DESCRIPTION, beside its waiting
 * line. The Production Board reads them (`warrantyOf` in its lib/warranty.ts:
 * change both together): a Yes or an Ask goes on its "Warranty to decide" list
 * for the job's sales manager (Shawn for roofing, Carl for construction —
 * Carl, 5 Nov 2026), whose answer the board writes on a line of its own,
 * "🛡 Warranty decided: …". A new answer replaces the tech's last one; the
 * board's decision line is never touched here.
 */
export const FOUND_PREFIX = "🔍 Found:";
export const WARRANTY_PREFIX = "🛡 Warranty:";
export const WARRANTY_ANSWERS = ["yes", "no", "ask"] as const;
export type WarrantyAnswer = (typeof WARRANTY_ANSWERS)[number];
export const WARRANTY_WORDS: Readonly<Record<WarrantyAnswer, string>> = { yes: "Yes", no: "No", ask: "Ask the office" };
export function isWarrantyAnswer(v: unknown): v is WarrantyAnswer {
  return typeof v === "string" && (WARRANTY_ANSWERS as readonly string[]).includes(v);
}
/** "🔍 Found: the boot was cracked at the seam (Yahir Gonzalez, Nov 6)". */
export function foundLine(found: unknown, by?: string | null, day?: string | null): string | null {
  const said = waitingWords(found, 400);
  if (!said) return null;
  const who = [by?.trim(), day?.trim()].filter(Boolean).join(", ");
  return `${FOUND_PREFIX} ${said}${who ? ` (${who})` : ""}`;
}
/** "🛡 Warranty: Ask the office (Yahir Gonzalez, Nov 6)". */
export function warrantyLine(answer: WarrantyAnswer, by?: string | null, day?: string | null): string {
  const who = [by?.trim(), day?.trim()].filter(Boolean).join(", ");
  return `${WARRANTY_PREFIX} ${WARRANTY_WORDS[answer]}${who ? ` (${who})` : ""}`;
}
/** The tech's last warranty answer, read back, or null. */
export function warrantyOf(description: string | null | undefined): WarrantyAnswer | null {
  let found: WarrantyAnswer | null = null;
  for (const raw of String(description ?? "").split("\n")) {
    const l = raw.trim();
    if (!l.startsWith(WARRANTY_PREFIX)) continue;
    const rest = l.slice(WARRANTY_PREFIX.length).trim();
    found = rest.startsWith("Ask the office") ? "ask" : rest.startsWith("Yes") ? "yes" : rest.startsWith("No") ? "no" : found;
  }
  return found;
}
/**
 * Extra work to bill (DB Crew T2.42, Carl 6 Nov 2026: *"Add 'Extra work to
 * bill'"*): work on a service call the warranty or the repair does not cover —
 * rotted decking under a covered leak, a gutter the customer asked about while
 * the tech was there — written on a line of its own so the office invoices it.
 * The Production Board lists every one (its lib/extras.ts reads this prefix:
 * change both together) until somebody marks it billed there, which writes a
 * "💲 Billed — …" line this code never touches. A new answer replaces the
 * tech's last one.
 */
export const EXTRA_PREFIX = "💲 Extra work to bill:";
/** "💲 Extra work to bill: replaced two rotted deck boards (Yahir Gonzalez, Nov 6)". */
export function extraLine(extra: unknown, by?: string | null, day?: string | null): string | null {
  const said = waitingWords(extra, 400);
  if (!said) return null;
  const who = [by?.trim(), day?.trim()].filter(Boolean).join(", ");
  return `${EXTRA_PREFIX} ${said}${who ? ` (${who})` : ""}`;
}
/** The description with the tech's found, warranty and extra-work lines replaced by these (null leaves that one as it was). */
export function withServiceLines(
  description: string | null | undefined,
  found: string | null,
  warranty: string | null,
  extra: string | null = null,
): string {
  const lines = String(description ?? "").split("\n").filter((l) => {
    const t = l.trim();
    return (
      !(found && t.startsWith(FOUND_PREFIX)) &&
      !(warranty && t.startsWith(WARRANTY_PREFIX)) &&
      !(extra && t.startsWith(EXTRA_PREFIX))
    );
  });
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const add = [found, warranty, extra].filter((x): x is string => !!x);
  if (!add.length) return lines.join("\n");
  return lines.length ? `${lines.join("\n")}\n\n${add.join("\n")}` : add.join("\n");
}
/** The description with its waiting line taken off, or replaced by `line`. */
export function withWaitingLine(description: string | null | undefined, line: string | null): string {
  const lines = String(description ?? "").split("\n").filter((l) => !l.trim().startsWith(WAITING_PREFIX));
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!line) return lines.join("\n");
  return lines.length ? `${lines.join("\n")}\n\n${line}` : line;
}
