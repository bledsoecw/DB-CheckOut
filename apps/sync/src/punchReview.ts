/**
 * The Punch Review auto-flip.
 *
 * Pipeline rule (docs/jobtread-setup.md): when the LAST punch task on a job
 * closes with its after photo, the job's Status moves from "Punch List" to
 * "Punch Review" automatically, putting it in the PM's review column.
 */

import type { PaveClient } from "./pave";
import { STATUS } from "../../../packages/shared/src/jobtread";
import type { PunchTask } from "../../../packages/shared/src/types";
import { getJob, setJobStatus } from "./jt";

/** Pure decision: flip only when there ARE punch tasks and every one is finished. */
export function shouldFlipToPunchReview(currentStatus: string, tasks: PunchTask[]): boolean {
  if (currentStatus !== STATUS.punchList) return false;
  if (tasks.length === 0) return false;
  return tasks.every((t) => t.progress >= 1);
}

/**
 * Re-evaluate a job after a task change. Returns the status it moved to,
 * or null if nothing changed.
 */
export async function applyPunchReviewFlip(pave: PaveClient, jobId: string): Promise<string | null> {
  const job = await getJob(pave, jobId);
  if (!shouldFlipToPunchReview(job.status, job.punchTasks)) return null;
  await setJobStatus(pave, jobId, STATUS.punchReview);
  return STATUS.punchReview;
}
