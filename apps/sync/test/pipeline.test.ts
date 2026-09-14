import { test } from "node:test";
import assert from "node:assert/strict";
import { nextPipelineStatus, openProblemCount, type PipelineInput } from "../src/pipeline";
import { findPipelineTask, type PipelineTask } from "../src/jt";
import { PIPELINE_TASKS, STATUS, TASK_TYPES } from "../../../packages/shared/src/jobtread";
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

test("a clean finished inspection goes to Punch Review for the PM, not to the customer", () => {
  assert.equal(nextPipelineStatus(input({ inspectionDone: true })), STATUS.punchReview);
});

test("an unfinished inspection moves nothing", () => {
  assert.equal(nextPipelineStatus(input({ punchTasks: [punch(0)] })), null);
});

/**
 * The trap: "FIXED ON SITE" reports are Punch List tasks created already
 * complete. Counting them as problems would send a job with nothing left to
 * do to Punch List — and the punch-review rule would then flip it straight on
 * to Punch Review, skipping the PM's actual review of a clean pass.
 */
test("corrections the crew already made are not open problems", () => {
  const next = nextPipelineStatus(
    input({ inspectionDone: true, punchTasks: [punch(1), punch(1)] }),
  );
  assert.equal(next, STATUS.punchReview);
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

test("the last repair closing still flips Punch List to Punch Review", () => {
  const next = nextPipelineStatus(
    input({ currentStatus: STATUS.punchList, punchTasks: [punch(1), punch(1)] }),
  );
  assert.equal(next, STATUS.punchReview);
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

test("the final check-off closes the job from Punch Review", () => {
  const next = nextPipelineStatus(
    input({ currentStatus: STATUS.punchReview, checkOffDone: true }),
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
  return { id: `id-${name}`, name, progress, taskTypeId };
}

test("the inspection milestone is found by its type", () => {
  const tasks = [
    pipelineTask("Order materials", TASK_TYPES.preProduction),
    pipelineTask("Final inspection", TASK_TYPES.inspection),
    pipelineTask("Final check-off", TASK_TYPES.general),
  ];
  assert.equal(
    findPipelineTask(tasks, PIPELINE_TASKS.finalInspection)?.name,
    "Final inspection",
  );
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
