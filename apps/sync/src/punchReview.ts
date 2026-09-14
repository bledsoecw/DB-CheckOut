/**
 * One rule of the closeout pipeline: the Punch Review flip.
 *
 * When the LAST punch task on a job closes with its after photo, the job's
 * Status moves from "Punch List" to "Punch Review", putting it in the PM's
 * review column (docs/jobtread-setup.md).
 *
 * The decision lives here on its own because it is the one rung that depends
 * purely on the punch tasks; `pipeline.ts` composes it with the two task
 * milestones and owns the reading and writing.
 */

import { STATUS } from "../../../packages/shared/src/jobtread";
import type { PunchTask } from "../../../packages/shared/src/types";

/** Pure decision: flip only when there ARE punch tasks and every one is finished. */
export function shouldFlipToPunchReview(currentStatus: string, tasks: PunchTask[]): boolean {
  if (currentStatus !== STATUS.punchList) return false;
  if (tasks.length === 0) return false;
  return tasks.every((t) => t.progress >= 1);
}
