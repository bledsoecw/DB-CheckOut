/**
 * The closeout pipeline: which JobTread task completing moves the job on.
 *
 * Two milestones on the "Roofing Schedule - Phase I" task template drive the
 * job's Status, and between them sit two people:
 *
 *   Final Inspection ──(crew finishes the inspection task)──┐
 *                                                           ├─ problems? ──> Punch List
 *                                                           └─ clean?    ──> PM Review
 *   Punch List ──────(last punch task closes)──────────────────────────────> PM Review
 *   PM Review ───────(PM reviews, then the sales rep speaks to the customer
 *                     and ticks "Final check-off")──────────────────────────> Job Completed
 *
 * The PM's own "PM punch review" tick is a human gate with no status of its
 * own — the job waits at PM Review through both of those check-offs, and
 * only the sales rep's final one closes it. That is deliberate: Job Completed
 * fires the final 10% payment milestone, so a person talks to the customer
 * before any of this touches money.
 *
 * The pipeline is strictly linear and no status is ever re-entered
 * (docs/jobtread-setup.md), which is also what makes every rule here
 * idempotent: each one is guarded on the status it moves OUT of, so running
 * the same decision twice is a no-op.
 */

import type { PaveClient } from "./pave";
import { PIPELINE_TASKS, STATUS } from "../../../packages/shared/src/jobtread";
import type { PunchTask } from "../../../packages/shared/src/types";
import {
  findPipelineTask,
  getJobStatusValue,
  listPipelineTasks,
  listPunchTasks,
  setJobStatus,
  type PipelineTask,
} from "./jt";
import { shouldFlipToPmReview } from "./pmReview";

export interface PipelineInput {
  currentStatus: string;
  /** The job's "Final inspection" task is complete. */
  inspectionDone: boolean;
  /** The job's "Final check-off" task is complete. */
  checkOffDone: boolean;
  /** Every Punch List typed task on the job. */
  punchTasks: PunchTask[];
  /**
   * Problems the crew recorded during THIS visit.
   *
   * Load-bearing, and not redundant with `punchTasks`. The mobile outbox
   * flushes past a failing item rather than stopping, so a `REPORT:` task
   * can reach JobTread AFTER the close that is supposed to notice it. The
   * app therefore tells us what it found, and we take the larger of the two
   * counts — the decision then never depends on write ordering.
   */
  problemsReported: number;
}

/** Open problems = still-unfinished punch tasks, or what the app just told us. */
export function openProblemCount(input: Pick<PipelineInput, "punchTasks" | "problemsReported">): number {
  const open = input.punchTasks.filter((t) => t.progress < 1).length;
  return Math.max(open, input.problemsReported);
}

/**
 * Pure decision: the status this job should move to, or null to stay put.
 * Ordered most-advanced-first so a job can only ever move one rung.
 */
export function nextPipelineStatus(input: PipelineInput): string | null {
  // The sales rep has spoken to the customer and ticked the last box.
  if (input.currentStatus === STATUS.pmReview && input.checkOffDone) {
    return STATUS.jobCompleted;
  }

  // Every repair is done — back to the PM to review (the pre-existing rule).
  if (shouldFlipToPmReview(input.currentStatus, input.punchTasks)) {
    return STATUS.pmReview;
  }

  // The crew has finished the inspection: problems decide which way it goes.
  if (input.currentStatus === STATUS.finalInspection && input.inspectionDone) {
    return openProblemCount(input) > 0 ? STATUS.punchList : STATUS.pmReview;
  }

  return null;
}

const isDone = (task: PipelineTask | undefined): boolean => (task?.progress ?? 0) >= 1;

/**
 * Re-evaluate a job and move it if a milestone says so. Returns the status it
 * moved to, or null.
 *
 * This runs on every org-wide webhook event, so it reads the status first and
 * only fetches what the job's CURRENT rung actually needs — a job in none of
 * the three pipeline statuses costs exactly one query.
 */
export async function applyPipeline(
  pave: PaveClient,
  jobId: string,
  opts: { problemsReported?: number } = {},
): Promise<string | null> {
  const currentStatus = await getJobStatusValue(pave, jobId);
  const needsPunch = currentStatus === STATUS.punchList || currentStatus === STATUS.finalInspection;
  const needsMilestones =
    currentStatus === STATUS.finalInspection || currentStatus === STATUS.pmReview;
  if (!needsPunch && !needsMilestones) return null;

  const [punchTasks, milestones] = await Promise.all([
    needsPunch ? listPunchTasks(pave, jobId) : Promise.resolve<PunchTask[]>([]),
    needsMilestones ? listPipelineTasks(pave, jobId) : Promise.resolve<PipelineTask[]>([]),
  ]);

  const next = nextPipelineStatus({
    currentStatus,
    inspectionDone: isDone(findPipelineTask(milestones, PIPELINE_TASKS.finalInspection)),
    checkOffDone: isDone(findPipelineTask(milestones, PIPELINE_TASKS.finalCheckOff)),
    punchTasks,
    problemsReported: opts.problemsReported ?? 0,
  });
  if (!next) return null;
  await setJobStatus(pave, jobId, next);
  return next;
}
