/**
 * The close-out, as Close Out sees it, now that the Production Board owns
 * the job's Status (Carl, 23 Oct 2026: "the board sets the Status, Close
 * Out stops").
 *
 * A roofing job is closed out one WORK AREA at a time — the roof, the
 * siding, the gutters (areas.ts). Each is inspected, repaired and approved
 * on its own; the job's Status follows the area furthest behind, and the
 * board works that out by its own rule (forward only) every time it is told
 * something happened:
 *
 *   an inspection closed      close-inspection / close-area-inspection
 *   a finding reported        reports (only when the job is already past
 *                             Punch List — the one move back the board allows)
 *   a repair finished         tasks/:id/complete
 *
 * What stays here is what only Close Out knows, and what it owes the PM:
 *
 * - the checklists JobTread shows (the "Punch list" task mirrors the punch
 *   to-dos; a closed REPORT ticks its inspection line), kept in step on
 *   every event, as before;
 * - the summaries: a closed inspection tells the area's reviewer what was
 *   found (repairs to book, or nothing — ready to approve), and an area
 *   whose last repair closes tells him it is ready to look at again. Tagged
 *   to the PM Operations names for that area on the board, not to a name in
 *   this code, and posted where he reads it: the template's "PM punch
 *   review" / "Punch list" tasks for the roof's line, the job itself for any
 *   other area.
 *
 * Summaries used to ride the Status flip, which made them once-only for
 * free. Without the flip each one carries a reference made from what it is
 * about — the inspection task, or the exact set of finished repairs — and is
 * looked up before anything else, so a replay costs one read and posts
 * nothing.
 *
 * **A job with no work areas is not the board's loop** — a service call
 * (R-Repairs/Service, R-Warranty), a construction job, a roofing job with
 * no Project Type. The board's rule has nothing to work from on those, so
 * Close Out keeps moving them by the rule it always had (`nextPipelineStatus`,
 * `applyLinear`): Final Inspection → Punch List or PM Review on the close,
 * Punch List → PM Review on the last repair, PM Review → Job Completed on
 * the rep's "Final check-off". Leaving them to nobody would strand every
 * service call at Final Inspection.
 */

import type { PaveClient } from "./pave";
import { PIPELINE_TASKS, STATUS } from "../../../packages/shared/src/jobtread";
import type { PunchTask, QueueJob } from "../../../packages/shared/src/types";
import {
  findPipelineTask,
  getJobBasics,
  setJobStatus,
  isInspectionClosed,
  listPipelineTasks,
  listPunchTasks,
  postInspectionReviewSummary,
  postPmReviewSummary,
  postPunchListSummary,
  punchTarget,
  reviewTarget,
  syncInspectionChecklist,
  syncPunchListTask,
  type MessageTarget,
  type PipelineTask,
} from "./jt";
import {
  AREA_LABEL,
  areaOfInspectionName,
  areaOfPunch,
  areaOfReviewName,
  fallbackReviewer,
  jobAreas,
  lineArea,
  type AreaKey,
  type Reviewer,
} from "./areas";
import type { BoardAnswer, BoardClient } from "./board";
import { shouldFlipToPmReview } from "./pmReview";

export interface PipelineInput {
  /** Every Punch List typed to-do on the job (or the area). */
  punchTasks: PunchTask[];
  /**
   * Problems the crew recorded during THIS visit.
   *
   * Load-bearing, and not redundant with `punchTasks`. The phone's outbox
   * flushes past a failing item rather than stopping, so a `REPORT:` task
   * can reach JobTread AFTER the close that is supposed to notice it. The
   * app therefore tells us what it found, and we take the larger of the two
   * counts — the summary then never depends on write ordering, and the board
   * is told the same number so the Status cannot jump past Punch List.
   */
  problemsReported: number;
}

/** Open problems = still-unfinished punch tasks, or what the app just told us. */
export function openProblemCount(input: PipelineInput): number {
  const open = input.punchTasks.filter((t) => t.progress < 1).length;
  return Math.max(open, input.problemsReported);
}

/* ---- Jobs outside the work-area loop: the rule Close Out always had ------- */

export interface LinearInput extends PipelineInput {
  currentStatus: string;
  /** The crew closed the inspection on the job's "Final inspection" task (see isInspectionClosed). */
  inspectionDone: boolean;
  /** The job's "Final check-off" task is complete. */
  checkOffDone: boolean;
}

/**
 * Pure decision for a job with no work areas: the status it should move to,
 * or null to stay put. Ordered most-advanced-first so a job can only ever
 * move one rung, and guarded on the status it moves OUT of, so running the
 * same decision twice is a no-op.
 */
export function nextPipelineStatus(input: LinearInput): string | null {
  // The sales rep has spoken to the customer and ticked the last box.
  if (input.currentStatus === STATUS.pmReview && input.checkOffDone) return STATUS.jobCompleted;
  // Every repair is done — back to the PM to review.
  if (shouldFlipToPmReview(input.currentStatus, input.punchTasks)) return STATUS.pmReview;
  // The crew has finished the inspection: problems decide which way it goes.
  if (input.currentStatus === STATUS.finalInspection && input.inspectionDone) {
    return openProblemCount(input) > 0 ? STATUS.punchList : STATUS.pmReview;
  }
  return null;
}

/**
 * The whole handling of a job with no work areas — the pipeline exactly as
 * it was before work areas, the reviewer aside: summaries are tagged to the
 * job's own PM when the board can say who that is (Dave otherwise, as
 * before). Outside Final Inspection, Punch List and PM Review it costs no
 * read beyond the job's basics.
 */
export async function applyLinear(
  pave: PaveClient,
  basics: QueueJob,
  board: BoardClient | null | undefined,
  opts: { problemsReported?: number; actor?: string } = {},
): Promise<CloseoutOutcome> {
  const jobId = basics.id;
  const currentStatus = basics.status;
  const inPipeline =
    currentStatus === STATUS.finalInspection || currentStatus === STATUS.punchList || currentStatus === STATUS.pmReview;
  if (!inPipeline) return { flipped: null, reviewer: null };
  // PM Review only waits on the sales rep's check-off; the punch to-dos are done.
  const needsPunch = currentStatus !== STATUS.pmReview;
  const [punchTasks, milestones] = await Promise.all([
    needsPunch ? listPunchTasks(pave, jobId) : Promise.resolve<PunchTask[]>([]),
    listPipelineTasks(pave, jobId),
  ]);
  const problemsReported = opts.problemsReported ?? 0;
  const inspection = findPipelineTask(milestones, PIPELINE_TASKS.finalInspection);
  const input: LinearInput = {
    currentStatus,
    inspectionDone: isInspectionClosed(inspection),
    checkOffDone: (findPipelineTask(milestones, PIPELINE_TASKS.finalCheckOff)?.progress ?? 0) >= 1,
    punchTasks,
    problemsReported,
  };
  const next = nextPipelineStatus(input);
  if (needsPunch) {
    await syncChecklists(
      pave,
      { jobId, basics, areas: [], line: null, punch: punchTasks, milestones },
      problemsReported,
      currentStatus === STATUS.finalInspection && input.inspectionDone,
    );
  }
  if (!next) return { flipped: null, reviewer: null };
  await setJobStatus(pave, jobId, next);
  // Best-effort: the status is the decision, and a summary that fails must not undo it.
  let reviewer: Reviewer | null = null;
  try {
    const answer = board ? await board.closeout({ jobId, move: false, actor: opts.actor }) : null;
    reviewer = reviewerOf(answer, null);
    const review = reviewTarget(milestones);
    const asTask = (t: PipelineTask | undefined): MessageTarget | undefined => (t ? { type: "task", id: t.id } : undefined);
    if (next === STATUS.pmReview && currentStatus === STATUS.punchList) {
      await postPmReviewSummary(pave, punchTasks, asTask(review), reviewer);
    } else if (next === STATUS.pmReview && currentStatus === STATUS.finalInspection) {
      await postInspectionReviewSummary(pave, inspection, asTask(review), reviewer);
    } else if (next === STATUS.punchList) {
      const open = punchTasks.filter((t) => t.progress < 1);
      await postPunchListSummary(pave, inspection, open, problemsReported, asTask(punchTarget(milestones)), reviewer);
    }
  } catch (err) {
    console.warn(`PM summary not posted on ${jobId}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { flipped: next, reviewer: reviewer?.name ?? null };
}

/* ---- Jobs with work areas: the board's loop -------------------------------- */

/** The job as the close-out reads it: its areas, its punch to-dos, its tasks. */
export interface CloseoutState {
  jobId: string;
  basics: QueueJob;
  areas: AreaKey[];
  /** The area that owns the template's "Final inspection" line. */
  line: AreaKey | null;
  punch: PunchTask[];
  milestones: PipelineTask[];
}

/** Read the job once. null when JobTread has no such job. */
export async function readCloseoutState(pave: PaveClient, jobId: string, basics?: QueueJob | null): Promise<CloseoutState | null> {
  const job = basics ?? (await getJobBasics(pave, jobId));
  if (!job) return null;
  const [punch, milestones] = await Promise.all([listPunchTasks(pave, jobId), listPipelineTasks(pave, jobId)]);
  const areas = jobAreas(job);
  return { jobId, basics: job, areas, line: lineArea(areas), punch, milestones };
}

/** An area's punch to-dos. `null` is the repairs no area claims — on a job with no areas, all of them. */
export function punchFor(state: Pick<CloseoutState, "areas" | "punch">, area: AreaKey | null): PunchTask[] {
  return state.punch.filter((t) => areaOfPunch(t, state.areas) === area);
}

/** An area's inspection task: the template line for the line's area, its own "Final inspection — X" otherwise. */
export function areaInspectionTaskOf(
  milestones: PipelineTask[],
  area: AreaKey | null,
  line: AreaKey | null,
): PipelineTask | undefined {
  if (area === null || area === line) return findPipelineTask(milestones, PIPELINE_TASKS.finalInspection);
  return milestones.find((t) => areaOfInspectionName(t.name) === area);
}

/**
 * Where an area's summaries go. The roof's line (and a job with no areas)
 * keeps the template's own steps, where the PM has always read them; any
 * other area has no task of its own to carry a summary — its inspection
 * task's messages are the crew's notes, which the board's review sheet
 * reads — so its summaries go on the job.
 */
export function summaryTargets(
  state: Pick<CloseoutState, "jobId" | "line" | "milestones">,
  area: AreaKey | null,
): { review: MessageTarget | undefined; punch: MessageTarget | undefined } {
  if (area === null || area === state.line) {
    const asTask = (t: PipelineTask | undefined): MessageTarget | undefined => (t ? { type: "task", id: t.id } : undefined);
    return { review: asTask(reviewTarget(state.milestones)), punch: asTask(punchTarget(state.milestones)) };
  }
  const job: MessageTarget = { type: "job", id: state.jobId };
  return { review: job, punch: job };
}

/**
 * The area's reviewer: the board's answer (Operations' list), else the
 * fallback seed. A job with no areas (construction, a service call) is its
 * own PM's to review.
 */
export function reviewerOf(answer: BoardAnswer | null, area: AreaKey | null): Reviewer | null {
  const found = answer?.areas.find((a) => a.area === area);
  if (found) return found.reviewer;
  if (area === null && answer?.pm) return answer.pm;
  return fallbackReviewer(area);
}

/** "Work area: Gutters" belongs on a summary only when the job has more than one. */
const areaLabel = (state: Pick<CloseoutState, "areas">, area: AreaKey | null): string | null =>
  state.areas.length > 1 && area ? AREA_LABEL[area] : null;

/** The area's PM has approved it — the board's "PM review — X" to-do is ticked. */
export function areaApproved(milestones: PipelineTask[], area: AreaKey | null): boolean {
  return area !== null && milestones.some((t) => areaOfReviewName(t.name) === area && t.progress >= 1);
}

/**
 * Keep the checklists JobTread shows in step with the punch to-dos.
 * Best-effort: a checklist write must never fail what the crew sent.
 */
export async function syncChecklists(
  pave: PaveClient,
  state: CloseoutState,
  problemsReported = 0,
  /** The inspection is closed for the purpose of marking "Punch list" not required (the default reads the stamp). */
  closed?: boolean,
): Promise<void> {
  const inspection = findPipelineTask(state.milestones, PIPELINE_TASKS.finalInspection);
  try {
    await syncPunchListTask(pave, findPipelineTask(state.milestones, PIPELINE_TASKS.punchList), state.punch, {
      // Only on a one-area job: a clean roof says nothing about gutters still to hang.
      cleanInspection:
        state.areas.length <= 1 &&
        (closed ?? isInspectionClosed(inspection)) &&
        openProblemCount({ punchTasks: state.punch, problemsReported }) === 0,
    });
    // A closed punch item ticks the inspection line it came from.
    await syncInspectionChecklist(pave, inspection, state.punch);
  } catch (err) {
    console.warn(`checklists not updated for ${state.jobId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Tell the area's reviewer about every area whose repairs are all finished
 * and that he has not approved yet — once per set of finished repairs (the
 * reference). `reviewer` is asked lazily: on a replay nothing is posted, and
 * the board need not be asked who it would have gone to.
 */
export async function postRepairSummaries(
  pave: PaveClient,
  state: CloseoutState,
  reviewer: (area: AreaKey | null) => Promise<Reviewer | null>,
): Promise<string[]> {
  const posted: string[] = [];
  const groups: Array<AreaKey | null> = [...state.areas, null];
  for (const area of groups) {
    const tasks = punchFor(state, area);
    if (tasks.length === 0 || tasks.some((t) => t.progress < 1)) continue;
    // A repair no area claims, on a job WITH areas, is the line's to look at.
    const who = area ?? state.line;
    if (areaApproved(state.milestones, who)) continue;
    try {
      const id = await postPmReviewSummary(
        pave,
        tasks,
        summaryTargets(state, who).review,
        () => reviewer(who),
        areaLabel(state, area),
      );
      if (id) posted.push(id);
    } catch (err) {
      console.warn(`repair summary not posted on ${state.jobId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return posted;
}

/** One board answer per handling, asked at most once. */
function boardOnce(board: BoardClient | null | undefined, jobId: string, actor?: string) {
  let pending: Promise<BoardAnswer | null> | null = null;
  return () => (pending ??= board ? board.closeout({ jobId, move: false, actor }) : Promise.resolve(null));
}

/**
 * Every org-wide webhook event. A job outside Final Inspection and Punch
 * List costs exactly one read; inside them the checklists are kept in step
 * and an area whose last repair was closed in JobTread itself gets its
 * summary. It never moves the Status of a job with work areas — the board
 * does that, on its own writes, on Close Out's calls and on its hourly
 * sweep. A job with none is moved here, by the old rule (`applyLinear`).
 */
export async function applyPipeline(
  pave: PaveClient,
  jobId: string,
  board?: BoardClient | null,
): Promise<string | null> {
  const basics = await getJobBasics(pave, jobId);
  if (!basics) return null;
  // Not the board's loop: Close Out moves it, as it always did.
  if (jobAreas(basics).length === 0) return (await applyLinear(pave, basics, board)).flipped;
  if (basics.status !== STATUS.finalInspection && basics.status !== STATUS.punchList) return null;
  const state = await readCloseoutState(pave, jobId, basics);
  if (!state) return null;
  await syncChecklists(pave, state);
  const ask = boardOnce(board, jobId);
  await postRepairSummaries(pave, state, async (area) => reviewerOf(await ask(), area));
  return null;
}

export interface CloseoutOutcome {
  /** The Status the board moved the job to, or null — what the phone's receipt says. */
  flipped: string | null;
  /** Who the summary was tagged to, when one was posted. */
  reviewer: string | null;
}

/**
 * An area's inspection has just closed. Keep the checklists in step, tell
 * the board (with what the phone found, so a close that outruns its own
 * REPORTs cannot send the job past Punch List), and post the summary the
 * area's reviewer acts on: the repairs to book, or nothing — ready to
 * approve.
 */
export async function afterInspection(
  pave: PaveClient,
  board: BoardClient | null | undefined,
  args: { jobId: string; area: AreaKey | null; problemsReported: number; actor: string },
): Promise<CloseoutOutcome> {
  const basics = await getJobBasics(pave, args.jobId);
  if (!basics) return { flipped: null, reviewer: null };
  if (jobAreas(basics).length === 0) {
    return applyLinear(pave, basics, board, { problemsReported: args.problemsReported, actor: args.actor });
  }
  const state = await readCloseoutState(pave, args.jobId, basics);
  if (!state) return { flipped: null, reviewer: null };
  const area = args.area ?? state.line;
  await syncChecklists(pave, state, area === state.line ? args.problemsReported : 0);
  const answer = board
    ? await board.closeout({ jobId: args.jobId, move: true, problemsReported: args.problemsReported, area, actor: args.actor })
    : null;
  const reviewer = reviewerOf(answer, area);
  const inspection = areaInspectionTaskOf(state.milestones, area, state.line);
  const open = punchFor(state, area).filter((t) => t.progress < 1);
  const targets = summaryTargets(state, area);
  const label = areaLabel(state, area);
  let posted: string | null = null;
  try {
    posted =
      openProblemCount({ punchTasks: open, problemsReported: args.problemsReported }) > 0
        ? await postPunchListSummary(pave, inspection, open, args.problemsReported, targets.punch, reviewer, label)
        : await postInspectionReviewSummary(pave, inspection, targets.review, reviewer, label);
  } catch (err) {
    console.warn(`inspection summary not posted on ${args.jobId}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { flipped: answer?.moved?.to ?? null, reviewer: posted ? (reviewer?.name ?? null) : null };
}

/**
 * A repair has just been finished on the phone. Keep the checklists in
 * step, tell the board (the last repair on the last open area is what moves
 * a job on to PM Review), and tell the reviewer of any area whose repairs
 * are now all done.
 */
export async function afterRepair(
  pave: PaveClient,
  board: BoardClient | null | undefined,
  args: { jobId: string; actor: string },
): Promise<CloseoutOutcome> {
  const basics = await getJobBasics(pave, args.jobId);
  if (!basics) return { flipped: null, reviewer: null };
  if (jobAreas(basics).length === 0) return applyLinear(pave, basics, board, { actor: args.actor });
  const state = await readCloseoutState(pave, args.jobId, basics);
  if (!state) return { flipped: null, reviewer: null };
  await syncChecklists(pave, state);
  const answer = board ? await board.closeout({ jobId: args.jobId, move: true, actor: args.actor }) : null;
  const names: string[] = [];
  const posted = await postRepairSummaries(pave, state, async (area) => {
    const r = reviewerOf(answer, area);
    if (r) names.push(r.name);
    return r;
  });
  return { flipped: answer?.moved?.to ?? null, reviewer: posted.length ? (names[0] ?? null) : null };
}
