import { test } from "node:test";
import assert from "node:assert/strict";
import {
  afterInspection,
  afterRepair,
  applyPipeline,
  areaInspectionTaskOf,
  nextPipelineStatus,
  openProblemCount,
  punchFor,
  reviewerOf,
  type LinearInput,
} from "../src/pipeline";
import { findPipelineTask, pmReviewSummary, REVIEW_ASK, type PipelineTask } from "../src/jt";
import type { PaveClient, PaveQuery } from "../src/pave";
import type { BoardAnswer, BoardAsk, BoardClient } from "../src/board";
import { CUSTOM_FIELDS, PIPELINE_TASKS, PM_REVIEWER, STATUS, TASK_TYPES } from "../../../packages/shared/src/jobtread";
import type { PunchTask } from "../../../packages/shared/src/types";

function punch(progress: number, over: Partial<PunchTask> = {}): PunchTask {
  return {
    id: "t",
    name: "REPORT: rear slope",
    description: null,
    progress,
    endDate: null,
    assignees: [],
    assigneeNames: [],
    mine: false,
    ...over,
  };
}

test("openProblemCount takes the larger of what landed and what the app saw", () => {
  assert.equal(openProblemCount({ punchTasks: [punch(0), punch(0)], problemsReported: 1 }), 2);
  assert.equal(openProblemCount({ punchTasks: [punch(1)], problemsReported: 3 }), 3);
  assert.equal(openProblemCount({ punchTasks: [], problemsReported: 0 }), 0);
  // FIXED ON SITE records are created complete — they are not open problems.
  assert.equal(openProblemCount({ punchTasks: [punch(1), punch(1)], problemsReported: 0 }), 0);
});

// --------------------------------------------------------------------------
// A job with no work areas (a service call, construction): Close Out still
// moves it, by the rule it always had — the board's loop has nothing to work
// from there.
// --------------------------------------------------------------------------

function input(over: Partial<LinearInput> = {}): LinearInput {
  return {
    currentStatus: STATUS.finalInspection,
    inspectionDone: false,
    checkOffDone: false,
    punchTasks: [],
    problemsReported: 0,
    ...over,
  };
}

test("a finished inspection with open problems routes to Punch List", () => {
  const next = nextPipelineStatus(
    input({ inspectionDone: true, punchTasks: [punch(0)] }),
  );
  assert.equal(next, STATUS.punchList);
});

test("a clean finished inspection goes to PM Review for the PM, not to the customer", () => {
  assert.equal(nextPipelineStatus(input({ inspectionDone: true })), STATUS.pmReview);
});

test("an unfinished inspection moves nothing", () => {
  assert.equal(nextPipelineStatus(input({ punchTasks: [punch(0)] })), null);
});

/**
 * The trap: "FIXED ON SITE" reports are Punch List tasks created already
 * complete. Counting them as problems would send a job with nothing left to
 * do to Punch List — and the PM Review rule would then flip it straight on
 * to PM Review, skipping the PM's actual review of a clean pass.
 */
test("corrections the crew already made are not open problems", () => {
  const next = nextPipelineStatus(
    input({ inspectionDone: true, punchTasks: [punch(1), punch(1)] }),
  );
  assert.equal(next, STATUS.pmReview);
});

/**
 * The outbox flushes past a failing item, so a REPORT task can arrive after
 * the close. The app's own count has to be enough on its own.
 */
test("problems the app reports count even before their tasks reach JobTread", () => {
  const next = nextPipelineStatus(input({ inspectionDone: true, problemsReported: 2 }));
  assert.equal(next, STATUS.punchList);
});

// --------------------------------------------------------------------------
// Punch work finishes (the pre-existing rule, still in force)
// --------------------------------------------------------------------------

test("the last repair closing still flips Punch List to PM Review", () => {
  const next = nextPipelineStatus(
    input({ currentStatus: STATUS.punchList, punchTasks: [punch(1), punch(1)] }),
  );
  assert.equal(next, STATUS.pmReview);
});

test("an open repair holds the job at Punch List", () => {
  const next = nextPipelineStatus(
    input({ currentStatus: STATUS.punchList, punchTasks: [punch(1), punch(0.5)] }),
  );
  assert.equal(next, null);
});

// --------------------------------------------------------------------------
// The sales rep closes the job
// --------------------------------------------------------------------------

test("the final check-off closes the job from PM Review", () => {
  const next = nextPipelineStatus(
    input({ currentStatus: STATUS.pmReview, checkOffDone: true }),
  );
  assert.equal(next, STATUS.jobCompleted);
});

test("the final check-off does nothing from earlier rungs (no skipping the ladder)", () => {
  for (const status of [STATUS.finalInspection, STATUS.punchList, STATUS.production]) {
    assert.equal(nextPipelineStatus(input({ currentStatus: status, checkOffDone: true })), null);
  }
});

test("a job already completed is never moved again", () => {
  const next = nextPipelineStatus(
    input({ currentStatus: STATUS.jobCompleted, checkOffDone: true, inspectionDone: true }),
  );
  assert.equal(next, null);
});

/**
 * Every rule is guarded on the status it moves OUT of, so re-running the same
 * decision at the destination is a no-op. That is what makes a duplicate
 * delivery from the outbox harmless.
 */
test("each move is idempotent — re-deciding at the destination stays put", () => {
  const closed = input({ inspectionDone: true, problemsReported: 2 });
  assert.equal(nextPipelineStatus(closed), STATUS.punchList);
  assert.equal(
    nextPipelineStatus({ ...closed, currentStatus: STATUS.punchList, punchTasks: [punch(0)] }),
    null,
  );
});


// --------------------------------------------------------------------------
// Work areas: whose repair, whose inspection, whose review
// --------------------------------------------------------------------------

test("each repair is filed under its work area, the way the board files it", () => {
  const state = {
    areas: ["shingle", "gutters"] as const,
    punch: [
      punch(0, { id: "a", name: "REPORT: nails up" }),
      punch(0, { id: "b", name: "REPORT: downspout", description: "Loose\n\nGutters · reported by Yahir Gonzalez" }),
      punch(0, { id: "c", name: "Alberto and Yahir — Re-hang it", description: "Re-hang it\n\nPunch list · Gutters · asked by Carl" }),
      punch(0, { id: "d", name: "Fix it", description: "typed in JobTread" }),
    ],
  };
  const ids = (area: Parameters<typeof punchFor>[1]) => punchFor({ ...state, areas: [...state.areas] }, area).map((t) => t.id);
  assert.deepEqual(ids("shingle"), ["a"], "an untagged REPORT is the roof form's");
  assert.deepEqual(ids("gutters"), ["b", "c"]);
  assert.deepEqual(ids(null), ["d"], "a repair nobody can place is counted on its own");
  // On a job with one area, every repair nobody tagged elsewhere is that area's.
  assert.deepEqual(punchFor({ areas: ["shingle"], punch: state.punch }, "shingle").map((t) => t.id), ["a", "d"]);
});

test("an area's inspection is the template line for the roof, its own task otherwise", () => {
  const tasks: PipelineTask[] = [
    { id: "fi", name: "Final inspection", progress: 0, taskTypeId: TASK_TYPES.inspection, description: null, subtasks: [] },
    { id: "fg", name: "Final inspection — Gutters", progress: 0, taskTypeId: TASK_TYPES.inspection, description: null, subtasks: [] },
  ];
  assert.equal(areaInspectionTaskOf(tasks, "shingle", "shingle")?.id, "fi");
  assert.equal(areaInspectionTaskOf(tasks, null, "shingle")?.id, "fi");
  assert.equal(areaInspectionTaskOf(tasks, "gutters", "shingle")?.id, "fg");
  assert.equal(areaInspectionTaskOf(tasks, "siding", "shingle"), undefined);
  // A job with no roof: the gutters own the template line.
  assert.equal(areaInspectionTaskOf(tasks, "gutters", "gutters")?.id, "fi");
});

test("the reviewer is the board's answer, and the seed only when the board cannot be asked", () => {
  const answer: BoardAnswer = {
    status: "Production",
    moved: null,
    pm: { name: "Neal Deitemeyer", membershipId: "22PLUqZNCKaY" },
    areas: [
      { area: "shingle", label: "Shingle roof", line: true, inspectionName: "Final inspection", stage: "review", reviewer: { name: "Kyle Akerman", membershipId: "kyle" }, crew: [] },
      { area: "siding", label: "Siding", line: false, inspectionName: "Final inspection — Siding", stage: "installed", reviewer: null, crew: [] },
    ],
  };
  assert.equal(reviewerOf(answer, "shingle")?.name, "Kyle Akerman", "Operations' list beats the seed");
  assert.equal(reviewerOf(answer, "siding"), null, "the board named nobody: nobody is tagged");
  assert.equal(reviewerOf(answer, null)?.name, "Neal Deitemeyer", "a job with no areas is its PM's");
  assert.equal(reviewerOf(null, "shingle")?.membershipId, PM_REVIEWER.membershipId, "Dave reviews shingle roofs");
  assert.equal(reviewerOf(null, "gutters")?.name, "Neal Deitemeyer", "the gutters go to Neal");
  assert.equal(reviewerOf(null, null)?.name, "Dave Elick", "with no board, who it always went to");
});

test("the summaries send the PM to the board, not to a JobTread tick", () => {
  const text = pmReviewSummary([punch(1, { name: "REPORT: Gutter" })], 0, "Gutters");
  assert.match(text, /^🔍 READY FOR PM REVIEW — 1 repair finished\nWork area: Gutters\n1\. REPORT: Gutter/);
  assert.ok(text.endsWith(REVIEW_ASK));
  assert.match(REVIEW_ASK, /Production Board/);
  assert.doesNotMatch(text, /tick PM punch review/);
});

// --------------------------------------------------------------------------
// Finding the milestone on a job
// --------------------------------------------------------------------------

function pipelineTask(name: string, taskTypeId: string | null, progress = 0): PipelineTask {
  return { id: `id-${name}`, name, progress, taskTypeId, description: null, subtasks: [] };
}

test("the milestones are found by name", () => {
  const tasks = [
    pipelineTask("Order materials", TASK_TYPES.preProduction),
    pipelineTask("Final inspection", TASK_TYPES.inspection),
    pipelineTask("Punch list", TASK_TYPES.punchList),
    pipelineTask("Final check-off", TASK_TYPES.general),
  ];
  assert.equal(findPipelineTask(tasks, PIPELINE_TASKS.finalInspection)?.name, "Final inspection");
  assert.equal(findPipelineTask(tasks, PIPELINE_TASKS.punchList)?.name, "Punch list");
  assert.equal(findPipelineTask(tasks, PIPELINE_TASKS.finalCheckOff)?.name, "Final check-off");
  // Case and spacing don't matter — older manual tasks say "Final Inspection".
  assert.equal(findPipelineTask([pipelineTask(" final INSPECTION ", null)], PIPELINE_TASKS.finalInspection)?.name, " final INSPECTION ");
});

/**
 * The org uses the Inspection type for every sales rep's inspection visit.
 * A job at Final Inspection without the template has exactly one
 * Inspection-typed task — the rep's visit — and closing the crew's checklist
 * onto it would rewrite that visit. The type alone must never match.
 */
test("a lone Inspection-typed sales visit is not the milestone", () => {
  const tasks = [
    pipelineTask("26-0921 Rob Gamble 567-259-9774", TASK_TYPES.inspection),
    pipelineTask("Order materials", TASK_TYPES.preProduction),
  ];
  assert.equal(findPipelineTask(tasks, PIPELINE_TASKS.finalInspection), undefined);
});

test("older template copies with no task types still match by name", () => {
  const tasks = [
    pipelineTask("Final inspection", TASK_TYPES.inspection),
    pipelineTask("Punch list", null),
    pipelineTask("PM punch review", null),
    pipelineTask("Final check-off", null),
  ];
  assert.equal(findPipelineTask(tasks, PIPELINE_TASKS.finalCheckOff)?.id, "id-Final check-off");
  assert.equal(findPipelineTask(tasks, PIPELINE_TASKS.punchList)?.id, "id-Punch list");
});

test("when two tasks share the name, the one with the milestone's type wins", () => {
  const tasks = [
    pipelineTask("Final inspection", TASK_TYPES.general),
    pipelineTask("Final inspection", TASK_TYPES.inspection),
  ];
  assert.equal(findPipelineTask(tasks, PIPELINE_TASKS.finalInspection)?.taskTypeId, TASK_TYPES.inspection);
});

test("the name separates milestones that share the General type", () => {
  const tasks = [
    pipelineTask("Punch list", TASK_TYPES.general),
    pipelineTask("PM punch review", TASK_TYPES.general),
    pipelineTask("Final check-off", TASK_TYPES.general),
  ];
  assert.equal(findPipelineTask(tasks, PIPELINE_TASKS.finalCheckOff)?.name, "Final check-off");
});

test("a second Inspection-typed task does not steal the milestone", () => {
  const tasks = [
    pipelineTask("Inspection visit — Alberto", TASK_TYPES.inspection),
    pipelineTask("Final inspection", TASK_TYPES.inspection),
  ];
  assert.equal(
    findPipelineTask(tasks, PIPELINE_TASKS.finalInspection)?.id,
    "id-Final inspection",
  );
});

test("a job without the template has no milestone, and that is not an error", () => {
  assert.equal(findPipelineTask([], PIPELINE_TASKS.finalInspection), undefined);
  assert.equal(
    findPipelineTask([pipelineTask("REPORT: gutter", TASK_TYPES.punchList)], PIPELINE_TASKS.finalCheckOff),
    undefined,
  );
});

// --------------------------------------------------------------------------
// End to end, against a fake Pave and a fake board
// --------------------------------------------------------------------------

interface FakeJob {
  status: string;
  jobType?: string;
  projectTypes?: string[];
  punch: Array<{ id: string; name: string; progress: number | null; description?: string; createdAt?: string }>;
  milestones: Array<{ id: string; name: string; progress: number | null; typeId: string | null; description?: string; subtasks: Array<{ name: string; isComplete: boolean }> }>;
  /** Comments already on a task or the job, by id — what a reference lookup finds. */
  comments?: Record<string, string[]>;
  /** When each of those comments was posted, by id, in the same order (absent = not known). */
  commentTimes?: Record<string, string[]>;
  files?: Record<string, Array<{ id: string; name: string; description: string }>>;
}

interface Fake {
  client: PaveClient;
  writes: PaveQuery[];
  posted: Array<Record<string, unknown>>;
  linked: unknown[];
  reads: string[];
}

/** Answers every query shape the pipeline uses and records every write. */
function fakePave(job: FakeJob): Fake {
  const writes: PaveQuery[] = [];
  const posted: Array<Record<string, unknown>> = [];
  const linked: unknown[] = [];
  const reads: string[] = [];
  /** The comments a `like` lookup finds, with what a review-summary lookup asks for. */
  const matching = (id: string, where: unknown) => {
    const marker = /%(.+)%/.exec(JSON.stringify(where))?.[1];
    return (job.comments?.[id] ?? [])
      .map((message, i) => ({ id: `existing-${i}`, message, createdAt: job.commentTimes?.[id]?.[i] ?? null }))
      .filter((c) => marker && c.message.includes(marker));
  };
  const client: PaveClient = {
    async query<T>(q: PaveQuery): Promise<T> {
      if ("updateTask" in q || "updateJob" in q) {
        writes.push(q);
        return {} as T;
      }
      if ("createComment" in q) {
        posted.push((q["createComment"] as Record<string, unknown>)["$"] as Record<string, unknown>);
        return { createComment: { createdComment: { id: `c${posted.length}` } } } as T;
      }
      if ("comment" in q) return { comment: { files: { nodes: [] } } } as T;
      if ("updateComment" in q) {
        linked.push(((q["updateComment"] as Record<string, unknown>)["$"] as Record<string, unknown>)["files"]);
        return {} as T;
      }
      const task = q["task"] as Record<string, unknown> | undefined;
      if (task) {
        const id = (task["$"] as Record<string, unknown>)["id"] as string;
        if ("files" in task) {
          reads.push(`files:${id}`);
          return { task: { files: { nodes: (job.files?.[id] ?? []).map((f) => ({ ...f, createdAt: null })) } } } as T;
        }
        if ("comments" in task) {
          const c = task["comments"] as Record<string, unknown>;
          const where = (c["$"] as Record<string, unknown>)["where"];
          if (where) return { task: { comments: { nodes: matching(id, where) } } } as T;
          return { task: { comments: { nodes: (job.comments?.[id] ?? []).map((message) => ({ message })) } } } as T;
        }
        return { task: { description: null } } as T;
      }
      const jobQ = q["job"] as Record<string, unknown>;
      if ("comments" in jobQ) {
        const where = ((jobQ["comments"] as Record<string, unknown>)["$"] as Record<string, unknown>)["where"];
        return { job: { comments: { nodes: matching("job1", where) } } } as T;
      }
      if (!("tasks" in jobQ)) {
        reads.push("basics");
        const cf = [
          { value: job.status, customField: { id: CUSTOM_FIELDS.status } },
          ...(job.jobType ? [{ value: job.jobType, customField: { id: CUSTOM_FIELDS.jobType } }] : []),
          ...(job.projectTypes ?? []).map((v) => ({ value: v, customField: { id: CUSTOM_FIELDS.projectType } })),
        ];
        return { job: { id: "job1", number: "26-0001", name: "x", customFieldValues: { nodes: cf } } } as T;
      }
      if (JSON.stringify(jobQ).includes("assignedMemberships")) {
        reads.push("punch");
        return {
          job: {
            tasks: {
              nodes: job.punch.map((t) => ({ ...t, description: t.description ?? null, endDate: null, isToDo: true, taskType: { id: TASK_TYPES.punchList }, assignedMemberships: { nodes: [] } })),
            },
          },
        } as T;
      }
      reads.push("milestones");
      return {
        job: { tasks: { nodes: job.milestones.map((m) => ({ id: m.id, name: m.name, progress: m.progress, taskType: m.typeId ? { id: m.typeId } : null, description: m.description ?? null, subtasks: m.subtasks })) } },
      } as T;
    },
  };
  return { client, writes, posted, linked, reads };
}

/** A board that answers with these areas and records what it was asked. */
function fakeBoard(answer: Partial<BoardAnswer> = {}): BoardClient & { asks: BoardAsk[] } {
  const asks: BoardAsk[] = [];
  return {
    asks,
    async closeout(ask) {
      asks.push(ask);
      return { status: null, moved: null, areas: [], pm: null, ...answer };
    },
  };
}

const DAVE = { name: "Dave Elick", membershipId: PM_REVIEWER.membershipId };
const roofArea = (reviewer: { name: string; membershipId: string | null } = DAVE) => ({
  area: "shingle" as const, label: "Shingle roof", line: true, inspectionName: "Final inspection", stage: "review", reviewer, crew: ["22PdPUpWzpHy", "22PdPTwMdkzj"],
});
const guttersArea = (reviewer: { name: string; membershipId: string | null } | null = { name: "Neal Deitemeyer", membershipId: "22PLUqZNCKaY" }) => ({
  area: "gutters" as const, label: "Gutters", line: false, inspectionName: "Final inspection — Gutters", stage: "installed", reviewer, crew: [],
});

const template = (inspection: { progress: number | null; description?: string }, punchListSubtasks: Array<{ name: string; isComplete: boolean }> = []) => [
  { id: "fi", name: "Final inspection", progress: inspection.progress, typeId: TASK_TYPES.inspection, description: inspection.description, subtasks: [] },
  { id: "pl", name: "Punch list", progress: null, typeId: TASK_TYPES.punchList, subtasks: punchListSubtasks },
  { id: "co", name: "Final check-off", progress: null, typeId: TASK_TYPES.general, subtasks: [] },
  { id: "pmr", name: "PM punch review", progress: null, typeId: TASK_TYPES.general, subtasks: [] },
];
const INSPECTED = "Walk the job.\n\n✔ Inspected by Yahir Gonzalez — via DB CheckOut";
const ROOF = { jobType: "Roofing", projectTypes: ["R-Shingles"] };
const quiet = async <T,>(fn: () => Promise<T>): Promise<T> => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = warn;
  }
};
const statusWrites = (f: Fake) => f.writes.filter((w) => "updateJob" in w);
const dollar = (q: PaveQuery | undefined, key: string) => (q![key] as Record<string, unknown>)["$"] as Record<string, unknown>;

test("the webhook keeps the checklists in step and never touches the Status", async () => {
  const fake = fakePave({
    ...ROOF,
    status: STATUS.finalInspection,
    punch: [{ id: "r1", name: "REPORT: Rear slope — pipe boot", progress: null }],
    milestones: template({ progress: 1, description: INSPECTED }),
  });
  const board = fakeBoard();
  assert.equal(await applyPipeline(fake.client, "job1", board), null);
  const checklist = fake.writes.find((w) => "updateTask" in w);
  assert.deepEqual(((checklist!["updateTask"] as Record<string, unknown>)["$"] as Record<string, unknown>)["subtasks"], [
    { name: "REPORT: Rear slope — pipe boot", isComplete: false },
  ]);
  assert.equal(statusWrites(fake).length, 0, "Close Out writes no Status");
  assert.equal(fake.posted.length, 0, "an open repair is nothing to review");
  assert.equal(board.asks.length, 0, "and the board need not be asked");
});

test("a job outside Final Inspection and Punch List costs the webhook one read", async () => {
  for (const status of [STATUS.production, STATUS.pmReview, STATUS.jobCompleted]) {
    const fake = fakePave({ ...ROOF, status, punch: [], milestones: [] });
    assert.equal(await applyPipeline(fake.client, "job1"), null);
    assert.deepEqual(fake.reads, ["basics"], status);
  }
});

test("a webhook replay of a job whose checklist already matches writes nothing", async () => {
  const fake = fakePave({
    ...ROOF,
    status: STATUS.punchList,
    punch: [{ id: "r1", name: "REPORT: Gutter", progress: 0 }],
    milestones: template({ progress: 1, description: INSPECTED }, [{ name: "REPORT: Gutter", isComplete: false }]),
  });
  await applyPipeline(fake.client, "job1");
  assert.equal(fake.writes.length, 0);
  assert.equal(fake.posted.length, 0);
});

test("the last repair closing in JobTread: the Punch list task completes, the area's reviewer is told, the Status is left to the board", async () => {
  const fake = fakePave({
    ...ROOF,
    status: STATUS.punchList,
    punch: [
      { id: "r1", name: "Alberto and Yahir — Reseal the pipe boot", progress: 1, description: "Reseal\n\n✔ Done — New boot — Yahir Gonzalez" },
      { id: "r2", name: "REPORT: Gutter", progress: 1, description: "Gutter\n\n✔ Done — Yahir Gonzalez" },
    ],
    milestones: template({ progress: 1, description: INSPECTED }, [{ name: "Alberto and Yahir — Reseal the pipe boot", isComplete: true }, { name: "REPORT: Gutter", isComplete: false }]),
    files: {
      r1: [{ id: "a1", name: "AFTER 2026-10-13 19:38 — Yahir", description: "x" }, { id: "b1", name: "BEFORE 2026-10-13 19:37 — Yahir", description: "x" }],
      r2: [{ id: "a2", name: "AFTER 2026-10-13 19:40 — Yahir", description: "x" }],
    },
  });
  const board = fakeBoard({ areas: [roofArea({ name: "Kyle Akerman", membershipId: "kyle" })] });
  await applyPipeline(fake.client, "job1", board);
  const completed = fake.writes.find((w) => ((w["updateTask"] as Record<string, unknown>)?.["$"] as Record<string, unknown>)?.["id"] === "pl");
  assert.equal(((completed!["updateTask"] as Record<string, unknown>)["$"] as Record<string, unknown>)["progress"], 1);
  assert.equal(statusWrites(fake).length, 0);
  assert.equal(fake.posted.length, 1);
  assert.equal(fake.posted[0]["targetId"], "pmr");
  assert.deepEqual(fake.posted[0]["assignees"], [{ membershipId: "kyle" }], "Operations' reviewer, off the board");
  assert.match(String(fake.posted[0]["message"]), /^🔍 READY FOR PM REVIEW — 2 repairs finished\n1\. Alberto and Yahir — Reseal the pipe boot — New boot — Yahir Gonzalez\n2\. REPORT: Gutter — Yahir Gonzalez\n/);
  assert.match(String(fake.posted[0]["message"]), /DB CheckOut ref: pmr-[0-9a-f]{8}$/);
  assert.deepEqual(fake.linked, [[{ _type: "file", id: "a1" }], [{ _type: "file", id: "a2" }]], "the after photos, not the before");
  assert.deepEqual(board.asks.map((a) => a.move), [false], "asked who reviews it, never to move anything");
});

test("a replay of the same finished repairs costs one lookup: no files read, no board asked, nothing posted", async () => {
  const done = [{ id: "r1", name: "REPORT: Gutter", progress: 1 }];
  const first = fakePave({ ...ROOF, status: STATUS.punchList, punch: done, milestones: template({ progress: 1, description: INSPECTED }, [{ name: "REPORT: Gutter", isComplete: true }]) });
  await applyPipeline(first.client, "job1", fakeBoard());
  const message = String(first.posted[0]["message"]);
  const again = fakePave({
    ...ROOF,
    status: STATUS.punchList,
    punch: done,
    milestones: template({ progress: 1, description: INSPECTED }, [{ name: "REPORT: Gutter", isComplete: true }]),
    comments: { pmr: [message] },
  });
  const board = fakeBoard();
  await applyPipeline(again.client, "job1", board);
  assert.equal(again.posted.length, 0);
  assert.ok(!again.reads.some((r) => r.startsWith("files:")), "no repair's files read");
  assert.equal(board.asks.length, 0);
});

test("a second punch round: the summary lists only the new repairs, says how many were reviewed before, and links only their photos", async () => {
  // 25-0001 on 26 Oct 2026: sixteen repairs reviewed, a clean re-inspection
  // summary at 18:20:55, then the PM put the gutters on a punch list and the
  // crew cleared them. The summary that went out listed all seventeen.
  const earlier = "🔍 READY FOR PM REVIEW — final inspection passed, no repairs needed\n\nDB CheckOut ref: pmi-70dd90df";
  const fake = fakePave({
    ...ROOF,
    status: STATUS.punchList,
    punch: [
      { id: "r1", name: "REPORT: Gutter", progress: 1, createdAt: "2026-10-13T17:03:48Z" },
      { id: "r2", name: "Carl Test — Fix 1", progress: 1, createdAt: "2026-10-13T17:03:49Z" },
      { id: "r3", name: "Carl Test — The gutters are still clogged", progress: 1, createdAt: "2026-10-26T18:25:05Z", description: "Clear them\n\n✔ Done — Cleared — Carl Bledsoe" },
    ],
    milestones: template({ progress: 1, description: INSPECTED }, [{ name: "REPORT: Gutter", isComplete: true }]),
    comments: { pmr: [earlier] },
    commentTimes: { pmr: ["2026-10-26T18:20:55Z"] },
    files: {
      r1: [{ id: "a1", name: "AFTER 2026-10-13 19:38 — Yahir", description: "x" }],
      r3: [{ id: "a3", name: "AFTER 2026-10-26 18:26 — Carl", description: "x" }],
    },
  });
  await applyPipeline(fake.client, "job1", fakeBoard());
  assert.equal(fake.posted.length, 1);
  assert.match(
    String(fake.posted[0]["message"]),
    /^🔍 READY FOR PM REVIEW — 1 repair finished\n2 repairs from earlier rounds already reviewed — not repeated here\.\n1\. Carl Test — The gutters are still clogged — Cleared — Carl Bledsoe\n/,
  );
  assert.deepEqual(fake.linked, [[{ _type: "file", id: "a3" }]], "this round's after photo only");
  assert.ok(!fake.reads.includes("files:r1") && !fake.reads.includes("files:r2"), "an earlier round's files are not even read");
});

test("a replay of a second round finds its own summary: nothing posted twice", async () => {
  const punch = [
    { id: "r1", name: "REPORT: Gutter", progress: 1, createdAt: "2026-10-13T17:03:48Z" },
    { id: "r3", name: "Carl Test — The gutters", progress: 1, createdAt: "2026-10-26T18:25:05Z" },
  ];
  const milestones = template({ progress: 1, description: INSPECTED }, [{ name: "REPORT: Gutter", isComplete: true }]);
  const earlier = "🔍 READY FOR PM REVIEW — 1 repair finished\n1. REPORT: Gutter\n\nDB CheckOut ref: pmr-0000aaaa";
  const first = fakePave({ ...ROOF, status: STATUS.punchList, punch, milestones, comments: { pmr: [earlier] }, commentTimes: { pmr: ["2026-10-14T12:00:00Z"] } });
  await applyPipeline(first.client, "job1", fakeBoard());
  const posted = String(first.posted[0]["message"]);
  const again = fakePave({
    ...ROOF,
    status: STATUS.punchList,
    punch,
    milestones,
    comments: { pmr: [posted, earlier] },
    commentTimes: { pmr: ["2026-10-26T18:26:49Z", "2026-10-14T12:00:00Z"] },
  });
  await applyPipeline(again.client, "job1", fakeBoard());
  assert.equal(again.posted.length, 0);
  assert.ok(!again.reads.some((r) => r.startsWith("files:")), "no repair's files read");
});

test("an approved area is not told again, and an untagged repair on one area is that area's", async () => {
  const fake = fakePave({
    ...ROOF,
    status: STATUS.punchList,
    punch: [{ id: "r1", name: "Reseal the boot", progress: 1, description: "typed in JobTread" }],
    milestones: [
      ...template({ progress: 1, description: INSPECTED }),
      { id: "rev", name: "PM review — Shingle roof", progress: 1, typeId: TASK_TYPES.general, subtasks: [] },
    ],
  });
  await applyPipeline(fake.client, "job1", fakeBoard());
  assert.equal(fake.posted.length, 0);
});

test("an inspection that finds problems: the board is told how many, the reviewer gets the punch list to book", async () => {
  const fake = fakePave({
    ...ROOF,
    status: STATUS.finalInspection,
    punch: [{ id: "r1", name: "REPORT: Rear slope — pipe boot", progress: null, description: "Pipe boot cracked, replace it\n\nReported by: Yahir Gonzalez" }],
    milestones: template({ progress: 0.9, description: INSPECTED }),
    files: { r1: [{ id: "p1", name: "REPORT 2026-10-13 14:02 — Yahir Gonzalez", description: "x" }] },
  });
  const board = fakeBoard({ moved: { from: "Final Inspection", to: "Punch List" }, areas: [roofArea()] });
  const outcome = await afterInspection(fake.client, board, { jobId: "job1", area: null, problemsReported: 2, actor: "Yahir Gonzalez" });
  assert.deepEqual(outcome, { flipped: "Punch List", reviewer: "Dave Elick" });
  assert.deepEqual(board.asks, [{ jobId: "job1", move: true, problemsReported: 2, area: "shingle", actor: "Yahir Gonzalez" }]);
  assert.equal(statusWrites(fake).length, 0, "the board moved it, not Close Out");
  assert.equal(fake.posted.length, 1);
  assert.equal(fake.posted[0]["targetId"], "pl", "on the Punch list task");
  assert.deepEqual(fake.posted[0]["assignees"], [{ membershipId: PM_REVIEWER.membershipId }]);
  const message = String(fake.posted[0]["message"]);
  assert.match(message, /^🛠 PUNCH LIST TO SCHEDULE — the final inspection found 2 things to repair\nInspected by Yahir Gonzalez\n\n1\. Rear slope — pipe boot — Pipe boot cracked, replace it — nobody assigned yet\n1 more reported on the phone is still on the way/);
  assert.match(message, /Book the repair day on the Production Board/);
  assert.match(message, /DB CheckOut ref: pls-[0-9a-f]{8}$/);
  assert.deepEqual(fake.linked, [[{ _type: "file", id: "p1" }]]);
});

test("a clean inspection: the Punch list step is not required, the reviewer is told it is ready to approve", async () => {
  const fake = fakePave({
    ...ROOF,
    status: STATUS.finalInspection,
    punch: [],
    milestones: [
      { id: "fi", name: "Final inspection", progress: 1, typeId: TASK_TYPES.inspection, description: INSPECTED, subtasks: [{ name: "1. Shingle field flat", isComplete: true }, { name: "Cleanup 1. Driveway clean", isComplete: true }] },
      ...template({ progress: 1 }).slice(1),
    ],
    files: {
      fi: [
        { id: "v1", name: "INSPECTION 2026-10-06 12:51 — Yahir Gonzalez", description: "x" },
        { id: "r9", name: "Cleanup 1. Driveway clean — REPORT 2026-10-06 12:40 — Yahir", description: "x" },
      ],
    },
  });
  const outcome = await afterInspection(fake.client, null, { jobId: "job1", area: null, problemsReported: 0, actor: "Yahir Gonzalez" });
  assert.deepEqual(outcome, { flipped: null, reviewer: "Dave Elick" }, "no board: Dave, as before, and the sweep moves the Status");
  const notRequired = fake.writes.find((w) => ((w["updateTask"] as Record<string, unknown>)["$"] as Record<string, unknown>)["id"] === "pl");
  assert.match(String(((notRequired!["updateTask"] as Record<string, unknown>)["$"] as Record<string, unknown>)["description"]), /Not required — clean inspection/);
  assert.equal(fake.posted.length, 1);
  assert.equal(fake.posted[0]["targetId"], "pmr");
  assert.match(String(fake.posted[0]["message"]), /^🔍 READY FOR PM REVIEW — final inspection passed, no repairs needed\nInspected by Yahir Gonzalez\nAll 2 checks passed\n/);
  assert.match(String(fake.posted[0]["message"]), /DB CheckOut ref: pmi-[0-9a-f]{8}$/);
  assert.deepEqual(fake.linked, [[{ _type: "file", id: "v1" }]], "the visit photos, not a report photo");
  assert.equal(statusWrites(fake).length, 0);
});

test("a gutters inspection is reported on the job, to the gutters' reviewer, and leaves the roof's Punch list step alone", async () => {
  const fake = fakePave({
    jobType: "Roofing",
    projectTypes: ["R-Shingles", "R-Gutters"],
    status: STATUS.production,
    punch: [],
    milestones: [
      ...template({ progress: 0 }),
      { id: "fg", name: "Final inspection — Gutters", progress: 1, typeId: TASK_TYPES.inspection, description: "✔ Inspected by Yahir Gonzalez — via DB CheckOut", subtasks: [] },
    ],
    comments: { fg: ["Inspector notes: downspouts strapped, all running clear.\n— Yahir Gonzalez via DB CheckOut"] },
  });
  const board = fakeBoard({ areas: [roofArea(), guttersArea()] });
  const outcome = await afterInspection(fake.client, board, { jobId: "job1", area: "gutters", problemsReported: 0, actor: "Yahir Gonzalez" });
  assert.equal(outcome.reviewer, "Neal Deitemeyer");
  assert.equal(board.asks[0].area, "gutters");
  assert.equal(fake.posted.length, 1);
  assert.equal(fake.posted[0]["targetType"], "job");
  assert.equal(fake.posted[0]["targetId"], "job1");
  assert.deepEqual(fake.posted[0]["assignees"], [{ membershipId: "22PLUqZNCKaY" }]);
  assert.match(String(fake.posted[0]["message"]), /^🔍 READY FOR PM REVIEW — final inspection passed, no repairs needed\nWork area: Gutters\nInspected by Yahir Gonzalez\n/);
  assert.match(String(fake.posted[0]["message"]), /Crew notes:\nInspector notes: downspouts strapped/);
  assert.ok(!fake.writes.some((w) => ((w["updateTask"] as Record<string, unknown>)?.["$"] as Record<string, unknown>)?.["id"] === "pl"), "the roof's Punch list step is untouched");
});

test("a repair finishing tells only the area it finished: the roof's reviewer, while the gutters' repair is still open", async () => {
  const fake = fakePave({
    jobType: "Roofing",
    projectTypes: ["R-Shingles", "R-Gutters"],
    status: STATUS.punchList,
    punch: [
      { id: "r1", name: "REPORT: Boot", progress: 1, description: "Boot\n\n✔ Done — Yahir Gonzalez" },
      { id: "g1", name: "REPORT: Downspout", progress: 0, description: "Loose\n\nGutters · reported by Yahir Gonzalez" },
    ],
    milestones: template({ progress: 1, description: INSPECTED }),
  });
  const board = fakeBoard({ moved: null, areas: [roofArea(), guttersArea()] });
  const outcome = await afterRepair(fake.client, board, { jobId: "job1", actor: "Yahir Gonzalez" });
  assert.deepEqual(outcome, { flipped: null, reviewer: "Dave Elick" });
  assert.deepEqual(board.asks, [{ jobId: "job1", move: true, actor: "Yahir Gonzalez" }]);
  assert.equal(fake.posted.length, 1);
  assert.equal(fake.posted[0]["targetId"], "pmr");
  assert.match(String(fake.posted[0]["message"]), /^🔍 READY FOR PM REVIEW — 1 repair finished\nWork area: Shingle roof\n1\. REPORT: Boot/);
});

test("a job with no work areas (construction) is its own PM's to review", async () => {
  const fake = fakePave({
    jobType: "Construction",
    projectTypes: ["C-Additions"],
    status: STATUS.punchList,
    punch: [{ id: "r1", name: "REPORT: Back door trim", progress: 1 }],
    milestones: template({ progress: 1, description: INSPECTED }).filter((m) => m.id !== "pmr"),
  });
  const board = fakeBoard({ pm: { name: "Neal Deitemeyer", membershipId: "22PLUqZNCKaY" } });
  await afterRepair(fake.client, board, { jobId: "job1", actor: "Zac" });
  assert.equal(fake.posted.length, 1);
  assert.equal(fake.posted[0]["targetId"], "fi", "a template with no PM punch review step: the summary goes on Final inspection");
  assert.deepEqual(fake.posted[0]["assignees"], [{ membershipId: "22PLUqZNCKaY" }]);
});

test("a summary that fails does not fail what the crew sent", async () => {
  const fake = fakePave({
    ...ROOF,
    status: STATUS.punchList,
    punch: [{ id: "r1", name: "REPORT: Gutter", progress: 1 }],
    milestones: template({ progress: 1, description: INSPECTED }),
  });
  const base = fake.client.query.bind(fake.client);
  fake.client.query = async <T,>(q: PaveQuery): Promise<T> => {
    if ("task" in q || "createComment" in q) throw new Error("Request Entity Too Large");
    return base<T>(q);
  };
  const outcome = await quiet(() => afterRepair(fake.client, fakeBoard({ moved: { from: "Punch List", to: "PM Review" } }), { jobId: "job1", actor: "Yahir" }));
  assert.deepEqual(outcome, { flipped: "PM Review", reviewer: null });
});

test("a service call is still moved by Close Out: a close with problems goes to Punch List, the checklist mirrored", async () => {
  const fake = fakePave({
    jobType: "Roofing",
    projectTypes: ["R-Repairs/Service"],
    status: STATUS.finalInspection,
    punch: [{ id: "r1", name: "REPORT: Rear slope — pipe boot", progress: null }],
    milestones: template({ progress: 1, description: INSPECTED }),
  });
  const board = fakeBoard({ pm: { name: "Dave Elick", membershipId: PM_REVIEWER.membershipId } });
  const outcome = await afterInspection(fake.client, board, { jobId: "job1", area: null, problemsReported: 1, actor: "Yahir Gonzalez" });
  assert.equal(outcome.flipped, STATUS.punchList);
  assert.deepEqual(dollar(statusWrites(fake)[0], "updateJob")["customFieldValues"], { [CUSTOM_FIELDS.status]: STATUS.punchList });
  const checklist = fake.writes.find((w) => "updateTask" in w);
  assert.deepEqual(dollar(checklist, "updateTask")["subtasks"], [{ name: "REPORT: Rear slope — pipe boot", isComplete: false }]);
  assert.equal(fake.posted[0]["targetId"], "pl");
  assert.deepEqual(board.asks.map((a) => a.move), [false], "the board is asked who, never to move it");
});

test("a service call's last repair moves it to PM Review, and the rep's Final check-off closes it", async () => {
  const service = { jobType: "Roofing", projectTypes: ["R-Warranty"] };
  const fake = fakePave({
    ...service,
    status: STATUS.punchList,
    punch: [{ id: "r1", name: "REPORT: Gutter", progress: 1 }],
    milestones: template({ progress: 1, description: INSPECTED }, [{ name: "REPORT: Gutter", isComplete: false }]),
  });
  assert.equal(await applyPipeline(fake.client, "job1"), STATUS.pmReview);
  assert.equal(fake.posted[0]["targetId"], "pmr");
  assert.deepEqual(fake.posted[0]["assignees"], [{ membershipId: PM_REVIEWER.membershipId }], "no board: Dave, as before");

  const done = fakePave({
    ...service,
    status: STATUS.pmReview,
    punch: [],
    milestones: template({ progress: 1, description: INSPECTED }).map((m) => (m.id === "co" ? { ...m, progress: 1 } : m)),
  });
  assert.equal(await applyPipeline(done.client, "job1"), STATUS.jobCompleted);
});

test("a roofing job with work areas is never moved by Close Out, even at PM Review with the check-off ticked", async () => {
  const fake = fakePave({
    ...ROOF,
    status: STATUS.pmReview,
    punch: [],
    milestones: template({ progress: 1, description: INSPECTED }).map((m) => (m.id === "co" ? { ...m, progress: 1 } : m)),
  });
  assert.equal(await applyPipeline(fake.client, "job1"), null);
  assert.equal(statusWrites(fake).length, 0);
});
