import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldFlipToPunchReview } from "../src/punchReview";
import { STATUS } from "../../../packages/shared/src/jobtread";
import type { PunchTask } from "../../../packages/shared/src/types";

function task(progress: number): PunchTask {
  return {
    id: "t",
    name: "n",
    description: null,
    progress,
    endDate: null,
    assignees: [],
    assigneeNames: [],
    mine: false,
  };
}

test("flips when every punch task is finished and status is Punch List", () => {
  assert.equal(shouldFlipToPunchReview(STATUS.punchList, [task(1), task(1)]), true);
});

test("does not flip while any task is open", () => {
  assert.equal(shouldFlipToPunchReview(STATUS.punchList, [task(1), task(0.5)]), false);
});

test("does not flip with zero punch tasks (clean pass is a PM decision)", () => {
  assert.equal(shouldFlipToPunchReview(STATUS.punchList, []), false);
});

test("does not flip from other statuses (linear pipeline, no re-entry)", () => {
  assert.equal(shouldFlipToPunchReview(STATUS.finalInspection, [task(1)]), false);
  assert.equal(shouldFlipToPunchReview(STATUS.punchReview, [task(1)]), false);
  assert.equal(shouldFlipToPunchReview(STATUS.jobCompleted, [task(1)]), false);
});
