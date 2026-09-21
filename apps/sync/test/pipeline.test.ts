import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPipeline, nextPipelineStatus, openProblemCount, type PipelineInput } from "../src/pipeline";
import { findPipelineTask, type PipelineTask } from "../src/jt";
import type { PaveClient, PaveQuery } from "../src/pave";
import { CUSTOM_FIELDS, PIPELINE_TASKS, STATUS, TASK_TYPES } from "../../../packages/shared/src/jobtread";
import type { PunchTask } from "../../../packages/shared/src/types";

function punch(progress: number): PunchTask {
  return {
    id: "t",
    name: "REPORT: rear slope",
    description: null,
    progress,
    endDate: null,
    assignees: [],
    assigneeNames: [],
    mine: false,
  };
}

function input(over: Partial<PipelineInput> = {}): PipelineInput {
  return {
    currentStatus: STATUS.finalInspection,
    inspectionDone: false,
    checkOffDone: false,
    punchTasks: [],
    problemsReported: 0,
    ...over,
  };
}

// --------------------------------------------------------------------------
// Final inspection closes
// --------------------------------------------------------------------------

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

test("openProblemCount takes the larger of what landed and what the app saw", () => {
  assert.equal(openProblemCount({ punchTasks: [punch(0), punch(0)], problemsReported: 1 }), 2);
  assert.equal(openProblemCount({ punchTasks: [punch(1)], problemsReported: 3 }), 3);
  assert.equal(openProblemCount({ punchTasks: [], problemsReported: 0 }), 0);
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
// Finding the milestone on a job
// --------------------------------------------------------------------------

function pipelineTask(name: string, taskTypeId: string | null, progress = 0): PipelineTask {
  return { id: `id-${name}`, name, progress, taskTypeId, description: null, subtasks: [] };
}

test("the milestones are found by name", () => {
  const tasks = [
    pipelineTask("Order materials", TASK_TYPES.preProduction),
    pipelineTask("Final inspection", TASK_TYPES.inspection),
    pipelineTask("Punch list", TASK_TYPES.general),
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
// applyPipeline end to end, against a fake Pave
// --------------------------------------------------------------------------

interface FakeJob {
  status: string;
  punch: Array<{ id: string; name: string; progress: number | null; description?: string }>;
  milestones: Array<{ id: string; name: string; progress: number | null; typeId: string | null; description?: string; subtasks: Array<{ name: string; isComplete: boolean }> }>;
}

/** Answers the four query shapes applyPipeline uses and records every write. */
function fakeJobPave(job: FakeJob): { client: PaveClient; writes: PaveQuery[] } {
  const writes: PaveQuery[] = [];
  const client: PaveClient = {
    async query<T>(q: PaveQuery): Promise<T> {
      if ("updateTask" in q || "updateJob" in q) {
        writes.push(q);
        return {} as T;
      }
      const jobQ = q["job"] as Record<string, unknown>;
      if (!("tasks" in jobQ)) {
        return {
          job: { id: "job1", number: "26-0001", name: "x", customFieldValues: { nodes: [{ value: job.status, customField: { id: CUSTOM_FIELDS.status } }] } },
        } as T;
      }
      const wantsAssignees = JSON.stringify(jobQ).includes("assignedMemberships");
      if (wantsAssignees) {
        return {
          job: {
            tasks: {
              nodes: job.punch.map((t) => ({ ...t, description: t.description ?? null, endDate: null, taskType: { id: TASK_TYPES.punchList }, assignedMemberships: { nodes: [] } })),
            },
          },
        } as T;
      }
      return {
        job: { tasks: { nodes: job.milestones.map((m) => ({ id: m.id, name: m.name, progress: m.progress, taskType: m.typeId ? { id: m.typeId } : null, description: m.description ?? null, subtasks: m.subtasks })) } },
      } as T;
    },
  };
  return { client, writes };
}

const templateOn = (finalInspectionProgress: number | null, punchListSubtasks: Array<{ name: string; isComplete: boolean }> = []) => [
  { id: "fi", name: "Final inspection", progress: finalInspectionProgress, typeId: TASK_TYPES.inspection, subtasks: [] },
  { id: "pl", name: "Punch list", progress: null, typeId: TASK_TYPES.general, subtasks: punchListSubtasks },
  { id: "co", name: "Final check-off", progress: null, typeId: TASK_TYPES.general, subtasks: [] },
];

test("applyPipeline moves a finished inspection with problems to Punch List and mirrors them onto the Punch list task", async () => {
  const { client, writes } = fakeJobPave({
    status: STATUS.finalInspection,
    punch: [{ id: "r1", name: "REPORT: Rear slope — pipe boot", progress: null }],
    milestones: templateOn(1),
  });
  assert.equal(await applyPipeline(client, "job1", { problemsReported: 1 }), STATUS.punchList);
  const checklist = writes.find((w) => "updateTask" in w);
  const status = writes.find((w) => "updateJob" in w);
  assert.deepEqual(((checklist!["updateTask"] as Record<string, unknown>)["$"] as Record<string, unknown>)["subtasks"], [
    { name: "REPORT: Rear slope — pipe boot", isComplete: false },
  ]);
  assert.deepEqual(((status!["updateJob"] as Record<string, unknown>)["$"] as Record<string, unknown>)["customFieldValues"], {
    [CUSTOM_FIELDS.status]: STATUS.punchList,
  });
});

test("applyPipeline marks the Punch list step not required after a clean inspection and sends the job to PM Review", async () => {
  const fake = fakeJobPave({ status: STATUS.finalInspection, punch: [], milestones: templateOn(1) });
  // The not-required note reads the task description first.
  const base = fake.client.query.bind(fake.client);
  fake.client.query = async <T,>(q: PaveQuery): Promise<T> =>
    "task" in q ? ({ task: { description: null } } as T) : base<T>(q);
  assert.equal(await applyPipeline(fake.client, "job1"), STATUS.pmReview);
  const notRequired = fake.writes.find((w) => "updateTask" in w);
  const dollar = (notRequired!["updateTask"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.equal(dollar["id"], "pl");
  assert.equal(dollar["progress"], 1);
  assert.match(String(dollar["description"]), /Not required — clean inspection/);
});

test("applyPipeline writes nothing when a webhook replays a job whose checklist already matches", async () => {
  const { client, writes } = fakeJobPave({
    status: STATUS.punchList,
    punch: [{ id: "r1", name: "REPORT: Gutter", progress: 0 }],
    milestones: templateOn(1, [{ name: "REPORT: Gutter", isComplete: false }]),
  });
  assert.equal(await applyPipeline(client, "job1"), null);
  assert.equal(writes.length, 0);
});

test("applyPipeline closes the last repair: Punch list task completes and the job goes to PM Review", async () => {
  const { client, writes } = fakeJobPave({
    status: STATUS.punchList,
    punch: [{ id: "r1", name: "REPORT: Gutter", progress: 1 }],
    milestones: templateOn(1, [{ name: "REPORT: Gutter", isComplete: false }]),
  });
  assert.equal(await applyPipeline(client, "job1"), STATUS.pmReview);
  const task = writes.find((w) => "updateTask" in w);
  const dollar = (task!["updateTask"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.equal(dollar["progress"], 1);
  assert.deepEqual(dollar["subtasks"], [{ name: "REPORT: Gutter", isComplete: true }]);
});

test("applyPipeline leaves a job outside the pipeline alone after a single read", async () => {
  let reads = 0;
  const fake = fakeJobPave({ status: STATUS.production, punch: [], milestones: [] });
  const base = fake.client.query.bind(fake.client);
  fake.client.query = async <T,>(q: PaveQuery): Promise<T> => {
    reads += 1;
    return base<T>(q);
  };
  assert.equal(await applyPipeline(fake.client, "job1"), null);
  assert.equal(reads, 1);
});

test("applyPipeline treats a stamped inspection as closed even while reported lines keep its progress under 100%", async () => {
  const { client, writes } = fakeJobPave({
    status: STATUS.finalInspection,
    punch: [{ id: "r1", name: "REPORT: Attic", progress: null, description: "Leak\nDB CheckOut item: 8" }],
    milestones: [
      {
        id: "fi",
        name: "Final inspection",
        progress: 0.85,
        typeId: TASK_TYPES.inspection,
        description: "Template\n\n✔ Inspected by Carl Bledsoe — via DB CheckOut",
        subtasks: [{ name: "8. Attic / interior spot check — leak-prone areas inspected · ⚠ REPORT — Leak", isComplete: false }],
      },
      ...templateOn(0).slice(1),
    ],
  });
  assert.equal(await applyPipeline(client, "job1", { problemsReported: 1 }), STATUS.punchList);
  assert.ok(writes.some((w) => "updateJob" in w));
});

test("applyPipeline ticks the inspection line when its punch item closes", async () => {
  const { client, writes } = fakeJobPave({
    status: STATUS.punchList,
    punch: [{ id: "r1", name: "REPORT: Attic", progress: 1, description: "Leak\nDB CheckOut item: 8" }],
    milestones: [
      {
        id: "fi",
        name: "Final inspection",
        progress: 0.92,
        typeId: TASK_TYPES.inspection,
        description: "✔ Inspected by Carl Bledsoe — via DB CheckOut",
        subtasks: [{ name: "8. Attic / interior spot check — leak-prone areas inspected · ⚠ REPORT — Leak", isComplete: false }],
      },
      ...templateOn(0, [{ name: "REPORT: Attic — Leak", isComplete: false }]).slice(1),
    ],
  });
  assert.equal(await applyPipeline(client, "job1"), STATUS.pmReview);
  const inspectionWrite = writes.find((w) => "updateTask" in w && ((w["updateTask"] as Record<string, unknown>)["$"] as Record<string, unknown>)["id"] === "fi");
  assert.ok(inspectionWrite, "the Final inspection task was written");
  const subtasks = ((inspectionWrite!["updateTask"] as Record<string, unknown>)["$"] as Record<string, unknown>)["subtasks"] as Array<{ isComplete: boolean }>;
  assert.equal(subtasks[0].isComplete, true);
});
