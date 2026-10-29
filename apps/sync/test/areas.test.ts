import { test } from "node:test";
import assert from "node:assert/strict";
import {
  areaInspectionName,
  areaOfInspectionName,
  areaOfPunch,
  areaOfReviewName,
  areaTagLine,
  fallbackRepairCrew,
  jobAreas,
  lineArea,
  reviewTaskName,
  usesRoofForm,
} from "../src/areas";
import { closeoutAreas, isCloseoutTask } from "../src/jt";
import { PUNCH_CREW, TASK_TYPES } from "../../../packages/shared/src/jobtread";
import type { PunchTask } from "../../../packages/shared/src/types";

// The names and tags here are the Production Board's (its lib/trades.ts) —
// both apps read what the other wrote, so a word out of place on either side
// files a repair under the wrong area.

test("a roofing job's work areas come off its Project Types, roof first", () => {
  assert.deepEqual(jobAreas({ jobType: "Roofing", projectTypes: ["R-Gutters", "R-Shingles", "R-Warranty"] }), ["shingle", "gutters"]);
  assert.deepEqual(jobAreas({ jobType: "Roofing", projectTypes: ["R-Commercial", "R-Low Slope"] }), ["flat"]);
  assert.deepEqual(jobAreas({ jobType: "Roofing", projectTypes: ["R-Repairs/Service"] }), [], "a service call is a repair, not an area");
  assert.deepEqual(jobAreas({ jobType: "Construction", projectTypes: ["R-Siding"] }), [], "construction is not this loop");
});

test("the template line is the first roof's — and on a job with no roof, the first area's", () => {
  assert.equal(lineArea(["shingle", "gutters"]), "shingle");
  assert.equal(lineArea(["metal", "siding"]), "metal");
  assert.equal(lineArea(["siding", "gutters"]), "siding");
  assert.equal(lineArea([]), null);
  assert.equal(usesRoofForm("shingle", "shingle"), true);
  assert.equal(usesRoofForm("gutters", "shingle"), false);
  assert.equal(usesRoofForm("siding", "siding"), false, "the eight roof checks are no way to inspect siding");
});

test("inspection and review names round-trip, word for word the board's", () => {
  assert.equal(areaInspectionName("shingle", "shingle"), "Final inspection");
  assert.equal(areaInspectionName("gutters", "shingle"), "Final inspection — Gutters");
  assert.equal(areaOfInspectionName("Final inspection — Low-slope roof"), "flat");
  assert.equal(areaOfInspectionName("Final inspection"), null);
  assert.equal(reviewTaskName("siding"), "PM review — Siding");
  assert.equal(areaOfReviewName(" PM review —  Gutters "), "gutters");
});

test("a repair is filed by its tag, then by the roof form, then by the job having one area", () => {
  const areas = ["shingle", "gutters"] as const;
  const t = (name: string, description: string | null = null) => ({ name, description });
  assert.equal(areaOfPunch(t("REPORT: x", `Loose\n\n${areaTagLine("gutters", "Yahir Gonzalez")}`), [...areas]), "gutters");
  assert.equal(areaOfPunch(t("Alberto and Yahir — Re-hang", "Re-hang\n\nPunch list · Gutters · asked by Carl"), [...areas]), "gutters");
  assert.equal(areaOfPunch(t("REPORT: nails", "Nails\n\nReported by: Yahir Gonzalez"), [...areas]), "shingle");
  assert.equal(areaOfPunch(t("Fix it", "typed in JobTread"), [...areas]), null);
  assert.equal(areaOfPunch(t("Fix it", "typed in JobTread"), ["metal"]), "metal");
});

test("with the board down, Alberto and Yahir get shingle-roof repairs only — and a service call keeps the service crew", () => {
  const crew = PUNCH_CREW.map((m) => m.membershipId);
  assert.deepEqual(fallbackRepairCrew("shingle", true), crew);
  assert.deepEqual(fallbackRepairCrew("metal", true), []);
  assert.deepEqual(fallbackRepairCrew("gutters", true), []);
  assert.deepEqual(fallbackRepairCrew(null, true), crew);
  assert.deepEqual(fallbackRepairCrew(null, false), []);
});

test("only close-out work makes a job theirs: repairs and final inspections, never a sales visit", () => {
  assert.equal(isCloseoutTask({ name: "REPORT: x", isToDo: true, taskType: { id: TASK_TYPES.punchList } }), true);
  assert.equal(isCloseoutTask({ name: "Final inspection — Gutters", taskType: { id: TASK_TYPES.inspection } }), true);
  assert.equal(isCloseoutTask({ name: "26-0921 Rob Gamble 567-259-9774", taskType: { id: TASK_TYPES.inspection } }), false);
  assert.equal(isCloseoutTask({ name: "Punch list", isToDo: false, taskType: { id: TASK_TYPES.punchList } }), false);
});

test("the job's areas, as the phone draws them", () => {
  const punch = (id: string, name: string, progress: number, description: string | null = null): PunchTask => ({
    id, name, description, progress, endDate: null, assignees: [], assigneeNames: [], mine: false,
  });
  const areas = closeoutAreas(
    { jobType: "Roofing", projectTypes: ["R-Shingles", "R-Gutters"] },
    [punch("a", "REPORT: boot", 0), punch("b", "REPORT: spout", 0, "Loose\n\nGutters · reported by Yahir"), punch("c", "REPORT: old", 1)],
    [
      { id: "fi", name: "Final inspection", progress: 0.5, description: "✔ Inspected by Yahir Gonzalez — via DB CheckOut", startDate: "2026-10-20", assignees: [] },
      { id: "fg", name: "Final inspection — Gutters", progress: 0, description: null, startDate: "2026-10-27", assignees: [{ name: "Yahir Gonzalez", email: "yahirgonzalez@deitemeyerbrothers.com" }] },
    ],
    { email: "YahirGonzalez@deitemeyerbrothers.com", name: "Yahir" },
  );
  assert.deepEqual(areas, [
    { key: "shingle", label: "Shingle roof", line: true, form: "roof", inspectionTaskId: "fi", inspectionDate: "2026-10-20", assigneeNames: [], mine: false, inspected: true, openRepairs: 1 },
    { key: "gutters", label: "Gutters", line: false, form: "gutters", inspectionTaskId: "fg", inspectionDate: "2026-10-27", assigneeNames: ["Yahir Gonzalez"], mine: true, inspected: false, openRepairs: 1 },
  ]);
  assert.deepEqual(closeoutAreas({ jobType: "Construction", projectTypes: ["C-Additions"] }, [], [], undefined), []);
});
