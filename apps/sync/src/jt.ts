/**
 * Domain operations against JobTread. Every function here maps 1:1 to a
 * verified Pave query shape (see docs/jobtread-setup.md "Pave API notes").
 */

import type { PaveClient } from "./pave";
import {
  ANSWER,
  CLEANUP_ITEMS,
  CUSTOM_FIELDS,
  INSPECTION_ITEMS,
  ORGANIZATION_ID,
  SERVICE_PROJECT_TYPES,
  STATUS,
  TASK_TYPES,
} from "../../../packages/shared/src/jobtread";
import type {
  Assignee,
  JobDetail,
  ProblemReport,
  PunchTask,
  QueueJob,
  ScopeDocument,
} from "../../../packages/shared/src/types";

// --------------------------------------------------------------------------
// Raw node shapes as Pave returns them
// --------------------------------------------------------------------------

interface RawCfv {
  value: unknown;
  customField: { id: string };
}

interface RawJob {
  id: string;
  number: string;
  name: string;
  customFieldValues: { nodes: RawCfv[] };
  location?: { formattedAddress: string | null } | null;
}

interface RawDocumentMeta {
  id: string;
  name: string;
  number: number | null;
  type: string;
  status: string;
  price: number;
  issueDate: string | null;
}
export type { RawDocumentMeta };

interface RawCostItem {
  name: string;
  description: string | null;
  quantity: number | null;
  unit: { name: string } | null;
}
export type { RawCostItem };

interface RawTask {
  id: string;
  name: string;
  description: string | null;
  progress: number | null;
  endDate: string | null;
  taskType: { id: string } | null;
  /** Present only on org-wide task queries, where the job is the point. */
  job?: { id: string } | null;
  assignedMemberships?: {
    nodes: Array<{
      id: string;
      user?: { id?: string | null; name?: string | null; emailAddress?: string | null } | null;
    }>;
  } | null;
}

function cfv(job: RawJob, fieldId: string): string | null {
  const hit = job.customFieldValues.nodes.find((n) => n.customField.id === fieldId);
  return hit == null || hit.value == null ? null : String(hit.value);
}

/** All values of a multi-value custom field (Project Type can have several). */
function cfvAll(job: RawJob, fieldId: string): string[] {
  return job.customFieldValues.nodes
    .filter((n) => n.customField.id === fieldId && n.value != null)
    .map((n) => String(n.value));
}

export function toQueueJob(job: RawJob, openPunchCount = 0, mine = false): QueueJob {
  const projectTypes = cfvAll(job, CUSTOM_FIELDS.projectType);
  return {
    id: job.id,
    number: job.number,
    name: job.name,
    status: cfv(job, CUSTOM_FIELDS.status) ?? "",
    jobType: cfv(job, CUSTOM_FIELDS.jobType),
    projectTypes,
    isService: projectTypes.some((t) => SERVICE_PROJECT_TYPES.includes(t)),
    projectManager: cfv(job, CUSTOM_FIELDS.projectManager),
    salesRep: cfv(job, CUSTOM_FIELDS.salesRep),
    address: job.location?.formattedAddress ?? null,
    openPunchCount,
    mine,
  };
}

const JOB_SELECTION = {
  id: {},
  number: {},
  name: {},
  customFieldValues: { $: { size: 25 }, nodes: { value: {}, customField: { id: {} } } },
  location: { formattedAddress: {} },
} as const;

/**
 * Pave rejects queries whose declared nested page sizes multiply out too
 * large ("Request Entity Too Large" — e.g. documents:25 × costItems:100),
 * so the sold scope is fetched in small pieces: the document list first,
 * then line items per approved order, paginated.
 */
const DOC_META_SELECTION = {
  $: { size: 25 },
  nodes: { id: {}, name: {}, number: {}, type: {}, status: {}, price: {}, issueDate: {} },
} as const;

/** JT web deep link for a document (constructed; the API exposes no URLs). */
export function jtDocumentUrl(jobId: string, documentId: string): string {
  return `https://app.jobtread.com/jobs/${jobId}/documents/${documentId}`;
}

/**
 * The sold scope is every APPROVED customer-facing order on the job — the
 * original signed estimate plus approved changes — oldest first. Invoices,
 * vendor orders/bills and anything draft/pending/denied are not scope.
 */
export function selectScopeDocs(docs: RawDocumentMeta[]): RawDocumentMeta[] {
  return docs
    .filter((d) => d.type === "customerOrder" && d.status === "approved")
    .sort((a, b) => (a.issueDate ?? "").localeCompare(b.issueDate ?? ""));
}

export function toScopeLines(nodes: RawCostItem[]): ScopeDocument["lines"] {
  return nodes.map((li) => ({
    name: li.name,
    quantity: li.quantity ? li.quantity : null,
    unit: li.unit?.name ?? null,
    description: li.description || null,
  }));
}

async function listDocumentLines(pave: PaveClient, documentId: string): Promise<ScopeDocument["lines"]> {
  const lines: ScopeDocument["lines"] = [];
  let page: string | null = null;
  for (let i = 0; i < 4; i++) {
    const res: { document: { costItems: { nextPage: string | null; nodes: RawCostItem[] } } | null } =
      await pave.query({
        document: {
          $: { id: documentId },
          costItems: {
            $: { size: 50, ...(page ? { page } : {}) },
            nextPage: {},
            nodes: { name: {}, description: {}, quantity: {}, unit: { name: {} } },
          },
        },
      });
    const items = res.document?.costItems;
    lines.push(...toScopeLines(items?.nodes ?? []));
    if (!items?.nextPage) break;
    page = items.nextPage;
  }
  return lines;
}

/** Scope is helpful context, never blocking: any failure returns []. */
export async function listSoldScope(pave: PaveClient, jobId: string): Promise<ScopeDocument[]> {
  try {
    const res = await pave.query<{ job: { documents: { nodes: RawDocumentMeta[] } } | null }>({
      job: { $: { id: jobId }, documents: DOC_META_SELECTION },
    });
    const docs = selectScopeDocs(res.job?.documents.nodes ?? []);
    return await Promise.all(
      docs.slice(0, 10).map(async (d) => ({
        id: d.id,
        name: d.name,
        number: d.number,
        issueDate: d.issueDate,
        price: d.price,
        jtUrl: jtDocumentUrl(jobId, d.id),
        lines: await listDocumentLines(pave, d.id),
      })),
    );
  } catch {
    return [];
  }
}

// --------------------------------------------------------------------------
// Queries
// --------------------------------------------------------------------------

/**
 * Jobs currently at Status = Final Inspection (the crew queue), plus any at
 * Punch List / PM Review (so punch work stays visible until completed).
 *
 * Queried through the Status field's own values (each links back to its
 * job), so the queue is complete no matter how many jobs the org has —
 * paging the whole org missed anything past its scan cap. Page size 15
 * keeps the declared size product (15 x 25 nested custom field values)
 * inside Pave's query budget.
 */
interface StatusValuesPage {
  customField: {
    customFieldValues: { nextPage: string | null; nodes: Array<{ job: RawJob | null }> };
  };
}

export async function listPipelineJobs(pave: PaveClient): Promise<QueueJob[]> {
  const statuses = [STATUS.finalInspection, STATUS.punchList, STATUS.pmReview];
  const out: QueueJob[] = [];
  let page: string | null = null;
  for (let i = 0; i < 10; i++) {
    const res: StatusValuesPage = await pave.query<StatusValuesPage>({
      customField: {
        $: { id: CUSTOM_FIELDS.status },
        customFieldValues: {
          $: {
            size: 15,
            ...(page ? { page } : {}),
            where: { or: statuses.map((status) => [["value"], "=", status]) },
          },
          nextPage: {},
          nodes: { job: JOB_SELECTION },
        },
      },
    });
    const values = res.customField.customFieldValues;
    for (const node of values.nodes) {
      if (node.job) out.push(toQueueJob(node.job));
    }
    if (!values.nextPage) break;
    page = values.nextPage;
  }
  return out.sort((a, b) => a.number.localeCompare(b.number));
}

/** Just the job's pipeline Status value — the cheap read for webhook checks. */
export async function getJobStatusValue(pave: PaveClient, jobId: string): Promise<string> {
  const res = await pave.query<{ job: RawJob | null }>({
    job: { $: { id: jobId }, ...JOB_SELECTION },
  });
  if (!res.job) return "";
  return cfv(res.job, CUSTOM_FIELDS.status) ?? "";
}

export async function getJob(
  pave: PaveClient,
  jobId: string,
  viewer?: Viewer,
): Promise<JobDetail> {
  const [res, rawPunch, soldScope] = await Promise.all([
    pave.query<{ job: RawJob | null }>({ job: { $: { id: jobId }, ...JOB_SELECTION } }),
    listPunchTasks(pave, jobId),
    listSoldScope(pave, jobId),
  ]);
  if (!res.job) throw new Error(`Job not found: ${jobId}`);

  const punchTasks = rawPunch.map((t) => ({ ...t, mine: assignedTo(t, viewer) }));
  const open = punchTasks.filter((t) => t.progress < 1);
  const mineOpen = open.filter((t) => t.mine).length;
  // Without a viewer there is no "yours", so the honest count is all of them.
  const count = viewer ? mineOpen : open.length;

  return {
    ...toQueueJob(res.job, count, mineOpen > 0),
    punchTasks,
    soldScope,
    openPunchTotal: open.length,
  };
}

export async function listPunchTasks(pave: PaveClient, jobId: string): Promise<PunchTask[]> {
  const res = await pave.query<{
    job: { tasks: { nodes: RawTask[] } } | null;
  }>({
    job: {
      $: { id: jobId },
      tasks: {
        $: { size: 50 },
        nodes: {
          id: {},
          name: {},
          description: {},
          progress: {},
          endDate: {},
          taskType: { id: {} },
          // 50 x 10 with the user fields is over Pave's declared-size budget
          // ("Request Entity Too Large", verified live 2026-09-21 — it took
          // every job screen down with a 502). 50 x 5 passes, and a punch
          // item never has five assignees anyway.
          assignedMemberships: {
            $: { size: 5 },
            nodes: { id: {}, user: { id: {}, name: {}, emailAddress: {} } },
          },
        },
      },
    },
  });
  const nodes = res.job?.tasks.nodes ?? [];
  return nodes
    .filter((t) => t.taskType?.id === TASK_TYPES.punchList)
    .map((t) => {
      const assignees: Assignee[] = (t.assignedMemberships?.nodes ?? []).map((m) => ({
        membershipId: m.id,
        name: m.user?.name ?? "",
        email: m.user?.emailAddress ?? null,
      }));
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        progress: t.progress ?? 0,
        endDate: t.endDate,
        assignees,
        assigneeNames: assignees.map((a) => a.name).filter((n) => n.length > 0),
        // Filled in by getJob, which is the layer that knows who is asking.
        mine: false,
      };
    });
}

// --------------------------------------------------------------------------
// Whose item is it?
// --------------------------------------------------------------------------

const norm = (v: string | null | undefined): string => (v ?? "").trim().toLowerCase();

/**
 * Who is asking. The session carries what Google gave us at sign-in.
 */
export interface Viewer {
  email: string;
  name: string;
}

/**
 * Match the signed-in crew member against a punch item's assignees.
 *
 * Email first, because it is exact: office staff sign in on the
 * deitemeyerbrothers.com address that is also on their JobTread user. Subs are
 * on personal addresses in JT that may differ from whatever Google account
 * they use, so the name is the fallback — that is the only other thing the two
 * systems reliably share.
 */
export function assignedTo(task: PunchTask, viewer: Viewer | undefined): boolean {
  return viewerMatches(task.assignees, viewer);
}

function viewerMatches(
  assignees: Array<{ name: string | null; email: string | null }>,
  viewer: Viewer | undefined,
): boolean {
  if (!viewer) return false;
  const email = norm(viewer.email);
  const name = norm(viewer.name);
  return assignees.some(
    (a) =>
      (email.length > 0 && norm(a.email) === email) ||
      (name.length > 0 && norm(a.name) === name),
  );
}

/** What the viewer is on the hook for on one job (see listAssignedWorkByJob). */
export interface AssignedWork {
  /** They are on any open punch/inspection task here — the job is "theirs". */
  any: boolean;
  /** Open punch-type tasks naming them — the number on the REPAIRS badge. */
  punchOpen: number;
}

/**
 * Every open punch/inspection task in the org that names the viewer,
 * grouped by job id. One org-wide query (paginated) instead of one query
 * per queue job, so the queue's Assigned tab costs a handful of requests
 * however many jobs are in the pipeline. progress != 1 deliberately keeps
 * null-progress tasks — JT leaves progress unset until someone touches it.
 *
 * Best-effort by design: any failure returns what was gathered so far
 * (possibly nothing). The queue itself must never die over the tabs.
 */
export async function listAssignedWorkByJob(
  pave: PaveClient,
  viewer: Viewer | undefined,
): Promise<Map<string, AssignedWork>> {
  const work = new Map<string, AssignedWork>();
  if (!viewer) return work;
  try {
    let page: string | null = null;
    for (let i = 0; i < 8; i++) {
      const res: {
        organization: { tasks: { nextPage: string | null; nodes: RawTask[] } } | null;
      } = await pave.query({
        organization: {
          $: { id: ORGANIZATION_ID },
          tasks: {
            $: {
              // 50 x 10 nested memberships = 500 declared, verified live.
              size: 50,
              ...(page ? { page } : {}),
              // Newest first: the org carries hundreds of old open
              // Inspection-typed sales visits, and this scan stops after a
              // few hundred tasks. Oldest-first (Pave's default) never
              // reached anything assigned this month.
              sortBy: [{ field: "createdAt", order: "desc" }],
              where: {
                and: [
                  {
                    or: [
                      [["taskType", "id"], "=", TASK_TYPES.punchList],
                      [["taskType", "id"], "=", TASK_TYPES.inspection],
                    ],
                  },
                  [["progress"], "!=", 1],
                ],
              },
            },
            nextPage: {},
            nodes: {
              id: {},
              taskType: { id: {} },
              job: { id: {} },
              assignedMemberships: {
                $: { size: 10 },
                nodes: { id: {}, user: { name: {}, emailAddress: {} } },
              },
            },
          },
        },
      });
      const tasks = res.organization?.tasks;
      for (const task of tasks?.nodes ?? []) {
        const jobId = task.job?.id;
        if (!jobId) continue;
        const assignees = (task.assignedMemberships?.nodes ?? []).map((m) => ({
          name: m.user?.name ?? null,
          email: m.user?.emailAddress ?? null,
        }));
        if (!viewerMatches(assignees, viewer)) continue;
        const entry = work.get(jobId) ?? { any: false, punchOpen: 0 };
        entry.any = true;
        if (task.taskType?.id === TASK_TYPES.punchList) entry.punchOpen += 1;
        work.set(jobId, entry);
      }
      if (!tasks?.nextPage) break;
      page = tasks.nextPage;
    }
  } catch {
    // Partial (or empty) is fine — worst case the Assigned tab under-counts
    // until the next refresh; All still shows everything.
  }
  return work;
}

// --------------------------------------------------------------------------
// Mutations
// --------------------------------------------------------------------------

/**
 * Every task write the sync server makes carries these.
 *
 * `updateDependentTasks` DEFAULTS TO TRUE in Pave: JobTread cascades a date
 * change onto everything downstream by its own rules. The pipeline tasks are
 * a dependency chain, so without this, completing "Final inspection" would
 * silently re-date the punch list, the PM review and the final check-off by
 * logic this server did not compute and cannot show anyone.
 *
 * `notify` is off because these are bookkeeping writes — the crew already
 * knows what they just did, and the PM gets the status change.
 */
const TASK_WRITE_GUARDS = { updateDependentTasks: false, notify: false } as const;

/** The pipeline milestone tasks copied onto a job, as the decision needs them. */
export interface PipelineTask {
  id: string;
  name: string;
  /** 0..1; JT leaves it null until someone touches the task. */
  progress: number;
  taskTypeId: string | null;
  /** The task's checklist, in order. Two states — there is no third. */
  subtasks: Subtask[];
}

export interface Subtask {
  name: string;
  isComplete: boolean;
}

/**
 * The job's pipeline milestones. Lean on purpose — this runs on every
 * org-wide webhook event, so it reads only what the decision needs.
 */
export async function listPipelineTasks(pave: PaveClient, jobId: string): Promise<PipelineTask[]> {
  // Its own narrow shape rather than RawTask: this query deliberately does
  // not select description/endDate, and the type should say so.
  interface RawPipelineTask {
    id: string;
    name: string;
    progress: number | null;
    taskType: { id: string } | null;
    subtasks?: Array<{ name?: string | null; isComplete?: boolean | null }> | null;
  }
  const res = await pave.query<{
    job: { tasks: { nodes: RawPipelineTask[] } } | null;
  }>({
    job: {
      $: { id: jobId },
      tasks: {
        $: { size: 50 },
        // subtasks is a plain array, not a paged connection — no size budget.
        nodes: { id: {}, name: {}, progress: {}, taskType: { id: {} }, subtasks: { name: {}, isComplete: {} } },
      },
    },
  });
  return (res.job?.tasks.nodes ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    progress: t.progress ?? 0,
    taskTypeId: t.taskType?.id ?? null,
    subtasks: (t.subtasks ?? []).map((st) => ({ name: st.name ?? "", isComplete: st.isComplete === true })),
  }));
}

const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Find one pipeline milestone among a job's tasks.
 *
 * Name first, type only to break a tie. The org uses the Inspection type for
 * every sales rep's inspection visit ("26-0921 Rob Gamble 567-…"), so a lone
 * Inspection-typed task on a job is usually NOT the milestone — picking it by
 * type would rewrite a sales rep's visit with the crew's checklist. Older
 * template copies carry no task types at all, which is the other reason the
 * name has to carry the match. Returns undefined freely — a job that never
 * got the template simply has no milestone, and the caller treats that as
 * "nothing to do" rather than an error.
 */
export function findPipelineTask(
  tasks: PipelineTask[],
  spec: { name: string; typeId: string },
): PipelineTask | undefined {
  const named = tasks.filter((t) => sameName(t.name, spec.name));
  if (named.length === 0) return undefined;
  return named.find((t) => t.taskTypeId === spec.typeId) ?? named[0];
}

/** The visit's checklist answers and free-text notes, as the app sends them. */
export interface VisitChecklists {
  inspection: Record<string, string>;
  cleanup: Record<string, string>;
  notes?: { inspection?: string; attic?: string; cleanup?: string };
}

/** Marks every description line this server writes, so a replay can find its own stamp. */
export const CHECKLIST_STAMP = "via DB CheckOut";

/**
 * The checklist as JobTread stores it: eight inspection items, then the five
 * cleanup items, ticked or not.
 *
 * The collapse from three answers to two states is deliberate and lossy:
 * a subtask is only `{ name, isComplete }`, so OK and N/A both tick and
 * ACTION does not. Nothing is lost overall — an ACTION is what created the
 * `REPORT:` punch task, which is where that finding actually lives.
 */
export function checklistSubtasks(visit: VisitChecklists): Subtask[] {
  const ticked = (answers: Record<string, string>, key: string): boolean =>
    answers[key] === ANSWER.ok || answers[key] === ANSWER.na;
  return [
    ...INSPECTION_ITEMS.map((item) => ({ name: item.subtask, isComplete: ticked(visit.inspection, item.key) })),
    ...CLEANUP_ITEMS.map((item) => ({ name: item.subtask, isComplete: ticked(visit.cleanup, item.key) })),
  ];
}

/** What the visit adds to the task's description: who inspected, and the notes. */
export function inspectionNote(visit: VisitChecklists, byName: string): string {
  const notes = visit.notes ?? {};
  const lines = [`✔ Inspected by ${byName} — ${CHECKLIST_STAMP}`];
  if (notes.inspection?.trim()) lines.push(`Inspector notes: ${notes.inspection.trim()}`);
  if (notes.attic?.trim()) lines.push(`Attic access limitation / existing conditions: ${notes.attic.trim()}`);
  if (notes.cleanup?.trim()) lines.push(`Cleanup notes: ${notes.cleanup.trim()}`);
  return lines.join("\n");
}

/**
 * Close the inspection: write the visit's checklist onto the job's scheduled
 * "Final inspection" task, put the notes in its description, and mark the
 * task done — in ONE write.
 *
 * `subtasks` REPLACES on update (same as dependsOnTasks), so the full list
 * goes every time, and the stamp is only appended when it isn't there yet —
 * together that is what makes this idempotent when the outbox delivers the
 * same close twice.
 */
export async function closeInspectionTask(
  pave: PaveClient,
  taskId: string,
  visit: VisitChecklists,
  byName: string,
): Promise<void> {
  const subtasks = checklistSubtasks(visit);
  const res = await pave.query<{ task: { description: string | null } | null }>({
    task: { $: { id: taskId }, description: {} },
  });
  const note = inspectionNote(visit, byName);
  const existing = res.task?.description ?? "";
  const description = existing.includes(note) ? existing : existing ? `${existing}\n\n${note}` : note;
  await pave.query({
    updateTask: {
      $: {
        id: taskId,
        ...TASK_WRITE_GUARDS,
        progress: 1,
        subtasks,
        description: description.slice(0, 4096),
      },
    },
  });
}

/**
 * Mirror the job's punch to-dos onto the scheduled "Punch list" task's
 * checklist, so the PM's Gantt shows what is open and what is done without
 * opening each to-do. The to-dos stay the record (they carry the assignee,
 * the photos and the work order); this is the view.
 *
 * Writes only when something differs, so the taskUpdated webhook this write
 * fires comes straight back as "unchanged" — no loop. Completes the task
 * when the last item closes (never re-opens it), and on a clean inspection
 * with nothing to fix marks it not required, as the template asks.
 */
export async function syncPunchListTask(
  pave: PaveClient,
  task: PipelineTask | undefined,
  punchTasks: PunchTask[],
  opts: { cleanInspection?: boolean } = {},
): Promise<"updated" | "unchanged" | "none"> {
  if (!task) return "none";
  const complete = task.progress >= 1;

  if (punchTasks.length === 0) {
    if (!opts.cleanInspection || complete) return "unchanged";
    const note = `✔ Not required — clean inspection, nothing to fix (${CHECKLIST_STAMP})`;
    const res = await pave.query<{ task: { description: string | null } | null }>({
      task: { $: { id: task.id }, description: {} },
    });
    const existing = res.task?.description ?? "";
    const description = existing.includes(note) ? existing : existing ? `${existing}\n\n${note}` : note;
    await pave.query({
      updateTask: { $: { id: task.id, ...TASK_WRITE_GUARDS, progress: 1, description: description.slice(0, 4096) } },
    });
    return "updated";
  }

  const desired: Subtask[] = punchTasks.map((t) => ({ name: t.name, isComplete: t.progress >= 1 }));
  const allDone = desired.every((s) => s.isComplete);
  const same =
    task.subtasks.length === desired.length &&
    task.subtasks.every((s, i) => s.name === desired[i].name && s.isComplete === desired[i].isComplete);
  if (same && (complete || !allDone)) return "unchanged";
  await pave.query({
    updateTask: {
      $: {
        id: task.id,
        ...TASK_WRITE_GUARDS,
        subtasks: desired,
        ...(allDone && !complete ? { progress: 1 } : {}),
      },
    },
  });
  return "updated";
}

/**
 * The app stamps every send with a client reference (its outbox item id).
 * A write that reached JobTread but whose answer never made it back to the
 * phone is re-sent with the same reference, so the non-idempotent writes —
 * a report task, a photo — look the reference up before creating anything.
 */
const CLIENT_REF = /^[A-Za-z0-9._-]{1,64}$/;

/** The reference exactly as it is written into JT, or null when unusable. */
export function clientRefMarker(ref: string | undefined): string | null {
  return ref && CLIENT_REF.test(ref) ? `DB CheckOut ref: ${ref}` : null;
}

/** The task on this job created for this client reference, if it already exists. */
export async function findTaskByRef(pave: PaveClient, jobId: string, ref: string): Promise<string | null> {
  const marker = clientRefMarker(ref);
  if (!marker) return null;
  const res = await pave.query<{ job: { tasks: { nodes: Array<{ id: string }> } } | null }>({
    job: {
      $: { id: jobId },
      tasks: { $: { size: 5, where: [["description"], "like", `%${marker}%`] }, nodes: { id: {} } },
    },
  });
  return res.job?.tasks.nodes[0]?.id ?? null;
}

/** The file on this task/job uploaded for this client reference, if it already exists. */
export async function findFileByRef(
  pave: PaveClient,
  targetType: "task" | "job",
  targetId: string,
  ref: string,
): Promise<string | null> {
  const marker = clientRefMarker(ref);
  if (!marker) return null;
  const res = await pave.query<Record<string, { files: { nodes: Array<{ id: string }> } } | null>>({
    [targetType]: {
      $: { id: targetId },
      files: { $: { size: 5, where: [["description"], "like", `%${marker}%`] }, nodes: { id: {} } },
    },
  });
  return res[targetType]?.files.nodes[0]?.id ?? null;
}

/**
 * A crew problem report becomes a to-do task of type Punch List.
 * - Default: UNASSIGNED, for the Service Manager / PM to turn into a work
 *   order on the Production board.
 * - fixedOnSite: created already complete (progress 1) — the crew corrected
 *   it during the visit; the task is the documentation of that correction.
 * - clientRef: a re-send of a report that already landed returns the
 *   existing task instead of a second one (see clientRefMarker).
 */
export async function createReportTask(
  pave: PaveClient,
  jobId: string,
  report: ProblemReport,
  clientRef?: string,
): Promise<string> {
  const marker = clientRefMarker(clientRef);
  if (marker && clientRef) {
    const existing = await findTaskByRef(pave, jobId, clientRef);
    if (existing) return existing;
  }
  const fixed = report.fixedOnSite === true;
  const lines = [report.englishNote];
  if (fixed) lines.push("✔ Corrected on site during the visit.");
  if (report.materialsNote) lines.push(`Materials & time: ${report.materialsNote}`);
  if (report.heardText) lines.push(`Crew said (verbatim): "${report.heardText}"`);
  if (report.originalCrew) lines.push(`Original work by: ${report.originalCrew}`);
  if (report.reportedBy) lines.push(`Reported by: ${report.reportedBy}`);
  if (marker) lines.push(marker);
  const res = await pave.query<{ createTask: { createdTask?: { id: string } } }>({
    createTask: {
      $: {
        // Live Pave rejects targetId alone ("either a parent task or task
        // target must be specified") — targetType is required with it.
        targetType: "job",
        targetId: jobId,
        taskTypeId: TASK_TYPES.punchList,
        isToDo: true,
        name: `${fixed ? "FIXED ON SITE" : "REPORT"}: ${report.location}`,
        description: lines.join("\n\n").slice(0, 4096),
        ...(fixed ? { progress: 1 } : {}),
      },
      createdTask: { id: {} },
    },
  });
  return res.createTask.createdTask?.id ?? "";
}

/**
 * Mark a punch task finished (crew pressed Terminado; after photo enforced
 * app-side). An optional note (materials, time, what was done) is appended
 * to the task description so the correction is documented on the job.
 */
export async function completeTask(pave: PaveClient, taskId: string, note?: string): Promise<void> {
  const trimmed = note?.trim();
  if (!trimmed) {
    await pave.query({ updateTask: { $: { id: taskId, ...TASK_WRITE_GUARDS, progress: 1 } } });
    return;
  }
  const res = await pave.query<{ task: { description: string | null } | null }>({
    task: { $: { id: taskId }, description: {} },
  });
  const done = `✔ Done — ${trimmed}`;
  const existing = res.task?.description ?? "";
  // A re-sent completion must not write "Done" twice.
  const description = existing.includes(done) ? existing : existing ? `${existing}\n\n${done}` : done;
  await pave.query({
    updateTask: {
      $: { id: taskId, ...TASK_WRITE_GUARDS, progress: 1, description: description.slice(0, 4096) },
    },
  });
}

export interface PhotoUpload {
  /** BEFORE / AFTER a repair, or the photo on a problem REPORT. */
  label: "BEFORE" | "AFTER" | "REPORT" | "INSPECTION";
  data: Buffer;
  contentType: string;
  /** Attach to this punch task; without it the photo lands on the job. */
  taskId?: string;
  /** Signed-in crew member, stamped into the file name and description. */
  byName: string;
  /** The app's send reference; a re-send of a photo that already landed is skipped. */
  clientRef?: string;
}

/**
 * Upload a photo to JobTread: createUploadRequest -> send the bytes to the
 * returned URL -> createFile attached to the task (or job).
 */
export async function uploadPhoto(
  pave: PaveClient,
  jobId: string,
  photo: PhotoUpload,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const targetType = photo.taskId ? "task" : "job";
  const targetId = photo.taskId ?? jobId;
  const marker = clientRefMarker(photo.clientRef);
  if (marker && photo.clientRef) {
    const existing = await findFileByRef(pave, targetType, targetId, photo.clientRef);
    if (existing) return existing;
  }
  const up = await pave.query<{
    createUploadRequest: {
      createdUploadRequest?: {
        id: string;
        url: string;
        method: string;
        headers: Record<string, string>;
      };
    };
  }>({
    createUploadRequest: {
      $: { organizationId: ORGANIZATION_ID, size: photo.data.length, type: photo.contentType },
      createdUploadRequest: { id: {}, url: {}, method: {}, headers: {} },
    },
  });
  const request = up.createUploadRequest.createdUploadRequest;
  if (!request) throw new Error("JobTread did not return an upload request");
  const sent = await fetchImpl(request.url, {
    method: request.method,
    headers: request.headers,
    body: new Uint8Array(photo.data),
  });
  if (!sent.ok) throw new Error(`Photo upload failed: ${sent.status}`);

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const res = await pave.query<{ createFile: { createdFile?: { id: string } } }>({
    createFile: {
      $: {
        targetId,
        targetType,
        name: `${photo.label} ${stamp} — ${photo.byName}`,
        uploadRequestId: request.id,
        description: `Uploaded from DB CheckOut by ${photo.byName}${marker ? ` · ${marker}` : ""}`,
      },
      createdFile: { id: {} },
    },
  });
  return res.createFile.createdFile?.id ?? "";
}

/** Move the job's Status custom field. */
export async function setJobStatus(pave: PaveClient, jobId: string, status: string): Promise<void> {
  await pave.query({
    updateJob: {
      $: { id: jobId, customFieldValues: { [CUSTOM_FIELDS.status]: status } },
    },
  });
}
