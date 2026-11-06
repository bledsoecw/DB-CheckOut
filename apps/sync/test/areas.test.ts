import { test } from "node:test";
import assert from "node:assert/strict";
import {
  areaInspectionName,
  areaOfInspectionName,
  areaOfPunch,
  areaOfReviewName,
  areaTagLine,
  fallbackRepairCrew,
  isConstructionCloseout,
  jobAreas,
  lineArea,
  reviewTaskName,
  usesRoofForm,
} from "../src/areas";
import { closeoutAreas, constructionArea, getJob, isCloseoutTask } from "../src/jt";
import type { PaveClient, PaveQuery } from "../src/pave";
import { CUSTOM_FIELDS, PUNCH_CREW, TASK_TYPES } from "../../../packages/shared/src/jobtread";
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
  assert.equal(reviewTaskName("siding"), "PM punch review — Siding");
  // The names the board writes since 27 Oct 2026, and the old ones it still reads.
  assert.equal(areaOfReviewName("PM punch review — Gutters"), "gutters");
  assert.equal(areaOfReviewName("PM final inspection review — Siding"), "siding");
  assert.equal(areaOfReviewName(" PM review —  Gutters "), "gutters");
  assert.equal(areaOfReviewName("pm PUNCH review — gutters"), "gutters", "the board compares lowered");
  // The template's own line, bare, is the line's area — and nobody's when there is no line.
  assert.equal(areaOfReviewName("PM punch review", "shingle"), "shingle");
  assert.equal(areaOfReviewName("PM final inspection review", "metal"), "metal");
  assert.equal(areaOfReviewName("PM Review", "shingle"), "shingle");
  assert.equal(areaOfReviewName("PM punch review"), null);
  // Not review lines.
  assert.equal(areaOfReviewName("PM punch review — Patio"), null);
  assert.equal(areaOfReviewName("Final inspection — Gutters"), null);
  assert.equal(areaOfReviewName("PM reviewed the gutters"), null);
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

test("T2.40: a construction job's final inspection is one notes-and-photos area on its own Final inspection line", () => {
  const punch = (id: string, progress: number): PunchTask => ({
    id, name: `REPORT: ${id}`, description: null, progress, endDate: null, assignees: [], assigneeNames: [], mine: false,
  });
  const lines = [
    { id: "fi", name: "Final inspection", progress: 0, description: "Complete the quality inspection.", startDate: "2026-11-05",
      assignees: [{ name: "Justin Phillips", email: "justinphillips@deitemeyerbrothers.com" }, { name: "Neal Deitemeyer", email: "neal@deitemeyerbrothers.com" }] },
  ];
  const asNeal = { email: "Neal@DeitemeyerBrothers.com", name: "Neal Deitemeyer" };
  assert.deepEqual(constructionArea({ jobType: "Construction" }, [punch("a", 0), punch("b", 1)], lines, asNeal), {
    key: "construction", label: "Construction", line: false, form: "notes", inspectionTaskId: "fi", inspectionDate: "2026-11-05",
    assigneeNames: ["Justin Phillips", "Neal Deitemeyer"], mine: true, inspected: false, openRepairs: 1,
  });
  // No line yet: still the area, so the inspection can be sent (the close makes the line).
  const bare = constructionArea({ jobType: "Construction" }, [], [], undefined);
  assert.equal(bare?.inspectionTaskId, null);
  assert.equal(bare?.mine, false);
  // Inspected by the stamp, as every area is.
  assert.equal(constructionArea({ jobType: "Construction" }, [], [{ ...lines[0], description: "✔ Inspected by Justin Phillips — via DB CheckOut" }], undefined)?.inspected, true);
  // A gutters task beside it is not the construction line.
  assert.equal(constructionArea({ jobType: "Construction" }, [], [{ ...lines[0], name: "Final inspection — Gutters" }], undefined)?.inspectionTaskId, null);
  // Roofing never; the Job Type decides, whatever the project types say.
  assert.equal(constructionArea({ jobType: "Roofing" }, [], lines, undefined), null);
  assert.equal(constructionArea({ jobType: null }, [], lines, undefined), null);
  assert.equal(isConstructionCloseout({ jobType: "Construction" }), true);
  assert.equal(isConstructionCloseout({ jobType: "Roofing" }), false);
});

test("T2.40: the job detail of a construction job carries its inspection as that one area; a service call typed Roofing carries none", async () => {
  const fake = (jobType: string, projectTypes: string[]): PaveClient => ({
    async query<T>(q: PaveQuery): Promise<T> {
      const job = q["job"] as Record<string, unknown>;
      const text = JSON.stringify(q);
      if ("documents" in job) return { job: { documents: { nodes: [] } } } as T;
      if ("tasks" in job && text.includes("Final inspection%")) {
        return { job: { tasks: { nodes: [{ id: "fi", name: "Final inspection", progress: 0, description: null, startDate: null,
          assignedMemberships: { nodes: [{ user: { name: "Justin Phillips", emailAddress: "justinphillips@deitemeyerbrothers.com" } }] } }] } } } as T;
      }
      if ("tasks" in job) return { job: { tasks: { nodes: [] } } } as T;
      return { job: { id: "j1", number: "26-1347", name: "261347 Woodruff_Ceiling", location: null, customFieldValues: { nodes: [
        { value: "Final Inspection", customField: { id: CUSTOM_FIELDS.status } },
        { value: jobType, customField: { id: CUSTOM_FIELDS.jobType } },
        ...projectTypes.map((v) => ({ value: v, customField: { id: CUSTOM_FIELDS.projectType } })),
      ] } } } as T;
    },
  });
  const asJustin = { email: "justinphillips@deitemeyerbrothers.com", name: "Justin Phillips" };
  const built = await getJob(fake("Construction", ["C-Remodel/Interior"]), "j1", asJustin);
  assert.equal(built.areas.length, 1);
  assert.equal(built.areas[0].key, "construction");
  assert.equal(built.areas[0].form, "notes");
  assert.equal(built.areas[0].line, false);
  assert.equal(built.areas[0].inspectionTaskId, "fi");
  assert.equal(built.mine, true, "the inspection assigned to them makes the job theirs");
  assert.equal(built.jobForm, "roof", "the job-level form is untouched; the construction inspection is the area's");
  const service = await getJob(fake("Roofing", ["R-Repairs/Service"]), "j1", asJustin);
  assert.deepEqual(service.areas, []);
});
