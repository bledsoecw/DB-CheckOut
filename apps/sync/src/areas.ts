/**
 * Work areas: a roofing job closed out one trade at a time (Carl, 23 Oct
 * 2026). "If a job is getting roofing work and other work like gutters,
 * siding … that is done by a different crew", each of those is its own work
 * area with its own inspection, its own repairs and its own PM's approval —
 * the roof can be on its second repair while the gutters are being hung.
 *
 * The Production Board owns the model and the Status (its `lib/trades.ts`);
 * this is the slice Close Out needs to file what the crew sends against the
 * right area, word for word the same names and tags, so a task either side
 * writes reads back the same on the other:
 *
 *   "Final inspection"            the template line — the first roof's, and
 *                                 the eight roof checks are on it
 *   "Final inspection — Gutters"  every other area's own inspection
 *   "PM review — Gutters"         the area's PM approved it (ticked)
 *   "… · Gutters · asked by Carl" a repair the board put on the area
 *   "Gutters · reported by Yahir" a finding Close Out filed against it
 *
 * Pure: no Pave, no I/O.
 */

import { PM_REVIEWER, PUNCH_CREW } from "../../../packages/shared/src/jobtread";

export type AreaKey = "shingle" | "metal" | "flat" | "siding" | "gutters";

/** The order an area list reads in — the roof first, gutters last, as on site. */
export const AREA_ORDER: readonly AreaKey[] = ["shingle", "metal", "flat", "siding", "gutters"];

export const AREA_LABEL: Record<AreaKey, string> = {
  shingle: "Shingle roof",
  metal: "Metal roof",
  flat: "Low-slope roof",
  siding: "Siding",
  gutters: "Gutters",
};

/** Project Types that name an area. Service and warranty are repairs, not areas. */
const PTYPE_AREA: Record<string, AreaKey> = {
  "R-Shingles": "shingle",
  "R-Metal": "metal",
  "R-Low Slope": "flat",
  "R-Commercial": "flat",
  "R-Siding": "siding",
  "R-Gutters": "gutters",
};

const ROOFS: readonly AreaKey[] = ["shingle", "metal", "flat"];

export function isAreaKey(v: unknown): v is AreaKey {
  return typeof v === "string" && (AREA_ORDER as readonly string[]).includes(v);
}

/** A job's work areas, in order. Roofing Job Type only — construction is not this loop. */
export function jobAreas(job: { jobType: string | null; projectTypes: readonly string[] }): AreaKey[] {
  if (job.jobType !== "Roofing") return [];
  const found = new Set<AreaKey>();
  for (const p of job.projectTypes) {
    const a = PTYPE_AREA[p];
    if (a) found.add(a);
  }
  return AREA_ORDER.filter((a) => found.has(a));
}

/** Whose is the template's "Final inspection" line: the first roof, else the first area. */
export function lineArea(areas: readonly AreaKey[]): AreaKey | null {
  return areas.find((a) => ROOFS.includes(a)) ?? areas[0] ?? null;
}

/** Is this area's inspection Close Out's roof form (the template line's eight checks)? */
export function usesRoofForm(area: AreaKey, line: AreaKey | null): boolean {
  return area === line && ROOFS.includes(area);
}

/**
 * Which form an area's crew inspection draws: the roof's eight checks on the
 * line roof, the gutters' and the siding's own checklists (DB Crew T2.27) on
 * theirs, and notes and photos on a second roof — a metal or low-slope roof
 * that is not the line's.
 */
export function areaFormKey(area: AreaKey, line: AreaKey | null): "roof" | "gutters" | "siding" | "notes" {
  if (usesRoofForm(area, line)) return "roof";
  if (area === "gutters" || area === "siding") return area;
  return "notes";
}

/** "Final inspection" for the line's area, "Final inspection — Gutters" for the rest. */
export function areaInspectionName(area: AreaKey, line: AreaKey | null): string {
  return area === line ? "Final inspection" : `Final inspection — ${AREA_LABEL[area]}`;
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

/** The area a per-area inspection task is for, off its name. */
export function areaOfInspectionName(name: string): AreaKey | null {
  const m = /^Final inspection — (.+)$/.exec(flat(name));
  return m ? (AREA_ORDER.find((a) => AREA_LABEL[a] === m[1].trim()) ?? null) : null;
}

/** "PM review — Gutters": the reviewing PM's own to-do, written by the board. */
export function reviewTaskName(area: AreaKey): string {
  return `PM review — ${AREA_LABEL[area]}`;
}

export function areaOfReviewName(name: string): AreaKey | null {
  const m = /^PM review — (.+)$/.exec(flat(name));
  return m ? (AREA_ORDER.find((a) => AREA_LABEL[a] === m[1].trim()) ?? null) : null;
}

/** The line a finding carries in its description so both apps file it under its area. */
export function areaTagLine(area: AreaKey, byName: string): string {
  return `${AREA_LABEL[area]} · reported by ${byName}`;
}

/**
 * The area a punch to-do belongs to: the tag the board or Close Out wrote,
 * else an untagged REPORT / FIXED ON SITE — Close Out's roof form on the
 * template line — is the line's, else (on a job with one area) that area.
 * null is a repair nobody can place, typed by hand in JobTread.
 */
export function areaOfPunch(task: { name: string; description: string | null }, areas: readonly AreaKey[]): AreaKey | null {
  const text = task.description ?? "";
  for (const a of AREA_ORDER) {
    if (new RegExp(`(^|·)\\s*${AREA_LABEL[a]}\\s*·\\s*(asked|reported) by`, "im").test(text)) return a;
  }
  if (/^(REPORT|FIXED ON SITE):/i.test(task.name.trim())) return lineArea(areas);
  return areas.length === 1 ? areas[0] : null;
}

/** A PM a summary is tagged to. `membershipId` null: named, but nobody JobTread can notify. */
export interface Reviewer {
  name: string;
  membershipId: string | null;
}

/**
 * Who reviews an area when the Production Board cannot be asked — its own
 * seed (Carl, 23 Oct 2026: "Dave is only the reviewer for shingle roofs",
 * the gutters go to Neal), and Dave for anything else, which is who every
 * summary went to before areas existed. Operations' list on the board is the
 * real answer; this keeps a summary landing on somebody when it is down.
 */
export function fallbackReviewer(area: AreaKey | null): Reviewer {
  if (area === "gutters") return { name: "Neal Deitemeyer", membershipId: "22PLUqZNCKaY" };
  return { name: PM_REVIEWER.name, membershipId: PM_REVIEWER.membershipId };
}

/**
 * Who a finding's repair goes to when the board cannot be asked: Alberto and
 * Yahir on a shingle roof and nobody on any other area ("Yahir and Alberto
 * only inspect, repair, punch list, final cleaning for shingle roofs"). A
 * roofing job with no area at all (a service call) keeps the old rule — the
 * service crew.
 */
export function fallbackRepairCrew(area: AreaKey | null, roofingJob: boolean): string[] {
  if (area === "shingle" || (area === null && roofingJob)) return PUNCH_CREW.map((m) => m.membershipId);
  return [];
}
