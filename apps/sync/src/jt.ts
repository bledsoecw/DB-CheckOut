/**
 * Domain operations against JobTread. Every function here maps 1:1 to a
 * verified Pave query shape (see docs/jobtread-setup.md "Pave API notes").
 */

import type { PaveClient } from "./pave";
import {
  ANSWER,
  CHECKLIST_ITEMS,
  checklistItemByCode,
  checklistItemByKey,
  CUSTOM_FIELDS,
  ORGANIZATION_ID,
  PIPELINE_TASKS,
  SERVICE_PROJECT_TYPES,
  STATUS,
  TASK_TYPES,
} from "../../../packages/shared/src/jobtread";
import type {
  Assignee,
  BookedDay,
  ChecklistFinding,
  CloseoutArea,
  JobDetail,
  ProblemReport,
  PunchTask,
  QueueJob,
  ScopeDocument,
} from "../../../packages/shared/src/types";
import {
  AREA_LABEL,
  areaInspectionName,
  areaOfInspectionName,
  areaOfPunch,
  areaTagLine,
  jobAreas,
  lineArea,
  usesRoofForm,
  type AreaKey,
  type Reviewer,
} from "./areas";

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
  /** When the task was created — read on punch tasks only (listPunchTasks). */
  createdAt?: string | null;
  progress: number | null;
  /** Read by the org-wide assigned scan, for the day the work is booked. */
  startDate?: string | null;
  endDate: string | null;
  taskType: { id: string } | null;
  /** To-do (true) or scheduled task (false). Punch items are to-dos. */
  isToDo?: boolean | null;
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

/** The job as the queue sees it (type, project types, status) — one query. */
export async function getJobBasics(pave: PaveClient, jobId: string): Promise<QueueJob | null> {
  const res = await pave.query<{ job: RawJob | null }>({
    job: { $: { id: jobId }, ...JOB_SELECTION },
  });
  return res.job ? toQueueJob(res.job) : null;
}

/** Several jobs as the queue sees them, in one request (each under its own alias). */
export async function listJobsByIds(pave: PaveClient, ids: readonly string[]): Promise<QueueJob[]> {
  const out: QueueJob[] = [];
  // Ten at a time keeps the declared size (10 x 25 field values) far under Pave's cap.
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const query: Record<string, unknown> = {};
    chunk.forEach((id, n) => {
      query[`j${n}`] = { _: "job", $: { id }, ...JOB_SELECTION };
    });
    const res = await pave.query<Record<string, RawJob | null>>(query);
    chunk.forEach((_, n) => {
      const job = res[`j${n}`];
      if (job) out.push(toQueueJob(job));
    });
  }
  return out;
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
  const [res, rawPunch, soldScope, inspections] = await Promise.all([
    pave.query<{ job: RawJob | null }>({ job: { $: { id: jobId }, ...JOB_SELECTION } }),
    listPunchTasks(pave, jobId),
    listSoldScope(pave, jobId),
    listInspectionTasks(pave, jobId),
  ]);
  if (!res.job) throw new Error(`Job not found: ${jobId}`);

  const punchTasks = rawPunch.map((t) => ({ ...t, mine: assignedTo(t, viewer) }));
  const open = punchTasks.filter((t) => t.progress < 1);
  const mineOpen = open.filter((t) => t.mine).length;
  // Without a viewer there is no "yours", so the honest count is all of them.
  const count = viewer ? mineOpen : open.length;

  const basics = toQueueJob(res.job, count, mineOpen > 0);
  const areas = closeoutAreas(basics, punchTasks, inspections, viewer);
  const keys = jobAreas(basics);
  return {
    ...basics,
    // An area inspection assigned to them makes the job theirs too.
    mine: basics.mine || areas.some((a) => a.mine),
    // Which area each repair is for, so the phone can say "the last repair on
    // the gutters" rather than claim the whole job moves on.
    punchTasks: punchTasks.map((t) => ({ ...t, area: keys.length ? areaOfPunch(t, keys) : null })),
    areas,
    soldScope,
    openPunchTotal: open.length,
  };
}

/** An inspection task on a job, as the area list needs it. */
export interface InspectionTask {
  id: string;
  name: string;
  progress: number;
  description: string | null;
  startDate: string | null;
  assignees: Array<{ name: string | null; email: string | null }>;
}

/** The job's "Final inspection…" tasks — the template line and each area's own — with who is on them. */
export async function listInspectionTasks(pave: PaveClient, jobId: string): Promise<InspectionTask[]> {
  const res = await pave.query<{
    job: {
      tasks: {
        nodes: Array<{
          id: string;
          name: string;
          progress: number | null;
          description: string | null;
          startDate: string | null;
          assignedMemberships?: { nodes: Array<{ user?: { name?: string | null; emailAddress?: string | null } | null }> } | null;
        }>;
      };
    } | null;
  }>({
    job: {
      $: { id: jobId },
      tasks: {
        $: { size: 10, where: [["name"], "like", "Final inspection%"] },
        nodes: {
          id: {},
          name: {},
          progress: {},
          description: {},
          startDate: {},
          assignedMemberships: { $: { size: 5 }, nodes: { user: { name: {}, emailAddress: {} } } },
        },
      },
    },
  });
  return (res.job?.tasks.nodes ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    progress: t.progress ?? 0,
    description: t.description ?? null,
    startDate: t.startDate ?? null,
    assignees: (t.assignedMemberships?.nodes ?? []).map((m) => ({ name: m.user?.name ?? null, email: m.user?.emailAddress ?? null })),
  }));
}

/**
 * The job's work areas as the phone draws them: which form each takes, its
 * inspection task and who is on it, and the repairs open against it. Empty
 * on a job that is not roofing.
 */
export function closeoutAreas(
  job: Pick<QueueJob, "jobType" | "projectTypes">,
  punch: PunchTask[],
  inspections: InspectionTask[],
  viewer: Viewer | undefined,
): CloseoutArea[] {
  const areas = jobAreas(job);
  const line = lineArea(areas);
  return areas.map((area) => {
    const isLine = area === line;
    const task = isLine
      ? inspections.find((t) => sameName(t.name, areaInspectionName(area, line)))
      : inspections.find((t) => areaOfInspectionName(t.name) === area);
    return {
      key: area,
      label: AREA_LABEL[area],
      line: isLine,
      form: usesRoofForm(area, line) ? "roof" : "notes",
      inspectionTaskId: task?.id ?? null,
      inspectionDate: task?.startDate ?? null,
      assigneeNames: (task?.assignees ?? []).map((a) => a.name ?? "").filter((n) => n.length > 0),
      mine: task ? viewerMatches(task.assignees, viewer) : false,
      inspected: Boolean(task && (task.progress >= 1 || (task.description ?? "").includes(INSPECTED_STAMP))),
      openRepairs: punch.filter((t) => t.progress < 1 && areaOfPunch(t, areas) === area).length,
    };
  });
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
          // When the repair was asked for: DB Crew refuses an AFTER photo
          // picked from the phone that was taken before it (T2.9). One scalar;
          // the 50 x 5 shape below still passes (verified live 2026-10-13).
          createdAt: {},
          isToDo: {},
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
  // Punch items are the Punch List-typed TO-DOs. The template's scheduled
  // "Punch list" task carries the same type since 2026-09-21 and must not
  // count as an open punch item on every job.
  return nodes
    .filter((t) => t.taskType?.id === TASK_TYPES.punchList && t.isToDo === true)
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
        createdAt: t.createdAt ?? null,
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
  /** They are on an open repair or final inspection here — the job is "theirs". */
  any: boolean;
  /** Open punch-type tasks naming them — the number on the REPAIRS badge. */
  punchOpen: number;
  /** The days that work is booked for, oldest first; undated work adds nothing. */
  booked: BookedDay[];
}

/**
 * A task's booked stretch, or null when it has no day. JobTread hands back
 * plain dates, sometimes with a time on them; an end before the start (or
 * none) is read as the one day.
 */
export function bookedDayOf(task: { startDate?: string | null; endDate?: string | null; taskType?: { id: string } | null }): BookedDay | null {
  const start = String(task.startDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const rawEnd = String(task.endDate ?? "").slice(0, 10);
  const end = /^\d{4}-\d{2}-\d{2}$/.test(rawEnd) && rawEnd >= start ? rawEnd : start;
  return { start, end, kind: task.taskType?.id === TASK_TYPES.punchList ? "repair" : "inspection" };
}

/** Add a booking once — three repair items on one day are one day of work. */
function addBooked(list: BookedDay[], day: BookedDay | null): void {
  if (!day) return;
  if (list.some((d) => d.start === day.start && d.end === day.end && d.kind === day.kind)) return;
  list.push(day);
  list.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.kind.localeCompare(b.kind));
}

/**
 * Close-out work: a punch to-do, or a FINAL inspection — the template line
 * or a work area's own "Final inspection — Gutters". The Inspection type
 * alone is not enough: the org uses it for every sales rep's inspection
 * visit, and a sales visit is nothing Close Out can act on.
 */
export function isCloseoutTask(task: { name?: string | null; taskType?: { id: string } | null; isToDo?: boolean | null }): boolean {
  if (task.taskType?.id === TASK_TYPES.punchList) return task.isToDo !== false;
  return task.taskType?.id === TASK_TYPES.inspection && /^\s*final inspection/i.test(task.name ?? "");
}

/**
 * The org-wide scan's shape. Pave caps a query by its DECLARED size — the
 * page times every nested page — and rejects anything at 500 or over with
 * "Request Entity Too Large" (measured 2026-10-06: 49 x 10 fails, 40 x 10
 * passes, 50 x 5 passes). 40 x 10 keeps ten assignees per task, and ten
 * pages keep the same 400-task reach the old 8 x 50 had.
 */
export const ASSIGNED_SCAN_PAGE_SIZE = 40;
export const ASSIGNED_SCAN_ASSIGNEES = 10;
export const ASSIGNED_SCAN_PAGES = 10;

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
    for (let i = 0; i < ASSIGNED_SCAN_PAGES; i++) {
      const res: {
        organization: { tasks: { nextPage: string | null; nodes: RawTask[] } } | null;
      } = await pave.query({
        organization: {
          $: { id: ORGANIZATION_ID },
          tasks: {
            $: {
              // 50 x 10 = 500 declared used to pass; Pave rejects it now, and
              // the catch below read that as "nothing assigned" for everyone.
              size: ASSIGNED_SCAN_PAGE_SIZE,
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
                      // Punch items are to-dos; the scheduled "Punch list" phase task shares the type.
                      { and: [[["taskType", "id"], "=", TASK_TYPES.punchList], [["isToDo"], "=", true]] },
                      // Final inspections only: the template line and each work area's own.
                      // Not every Inspection-typed task — those are mostly sales visits.
                      { and: [[["taskType", "id"], "=", TASK_TYPES.inspection], [["name"], "like", "Final inspection%"]] },
                    ],
                  },
                  [["progress"], "!=", 1],
                ],
              },
            },
            nextPage: {},
            nodes: {
              id: {},
              name: {},
              isToDo: {},
              // The day it is booked for — the phone files the job under it.
              startDate: {},
              endDate: {},
              taskType: { id: {} },
              job: { id: {} },
              assignedMemberships: {
                $: { size: ASSIGNED_SCAN_ASSIGNEES },
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
        if (!isCloseoutTask(task) || !viewerMatches(assignees, viewer)) continue;
        const entry = work.get(jobId) ?? { any: false, punchOpen: 0, booked: [] };
        entry.any = true;
        if (task.taskType?.id === TASK_TYPES.punchList) entry.punchOpen += 1;
        addBooked(entry.booked, bookedDayOf(task));
        work.set(jobId, entry);
      }
      if (!tasks?.nextPage) break;
      page = tasks.nextPage;
    }
  } catch (err) {
    // Partial (or empty) is fine — worst case the Assigned tab under-counts
    // until the next refresh; All still shows everything. But say so in the
    // log: a rejected query here read as "0 assigned" with no trace anywhere.
    console.warn(
      `assigned-work scan stopped early: ${err instanceof Error ? err.message : String(err)}`,
    );
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
  /**
   * 0..1; JT leaves it null until someone touches the task — and on a task
   * with a checklist JT DERIVES it (ticked / total), ignoring what is written.
   */
  progress: number;
  taskTypeId: string | null;
  description: string | null;
  /** The task's checklist, in order. Two states — there is no third. */
  subtasks: Subtask[];
}

/**
 * The crew has closed the inspection on this task. Not `progress >= 1`: a
 * checklist task's progress is the ticked share, and a reported item stays
 * unticked until its punch work is done — the stamp close-inspection writes
 * is what says the visit happened.
 */
export function isInspectionClosed(task: PipelineTask | undefined): boolean {
  if (!task) return false;
  return task.progress >= 1 || (task.description ?? "").includes(INSPECTED_STAMP);
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
    description?: string | null;
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
        nodes: {
          id: {},
          name: {},
          progress: {},
          taskType: { id: {} },
          description: {},
          subtasks: { name: {}, isComplete: {} },
        },
      },
    },
  });
  return (res.job?.tasks.nodes ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    progress: t.progress ?? 0,
    taskTypeId: t.taskType?.id ?? null,
    description: t.description ?? null,
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

/** The visit's checklist answers, free-text notes and per-item findings, as the app sends them. */
export interface VisitChecklists {
  inspection: Record<string, string>;
  cleanup: Record<string, string>;
  notes?: { inspection?: string; attic?: string; cleanup?: string };
  findings?: ChecklistFinding[];
}

/** Marks every description line this server writes, so a replay can find its own stamp. */
export const CHECKLIST_STAMP = "via DB CheckOut";
/** The line close-inspection writes; its presence is what "the inspection is closed" means. */
export const INSPECTED_STAMP = "✔ Inspected by ";
/** Written into a REPORT task so its checklist item can be ticked when the work is done. */
const ITEM_MARKER = /DB CheckOut item: ([A-Z]?\d+)/;

const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * The checklist as JobTread stores it: eight inspection items, then the five
 * cleanup items — the template's names, untouched. Notes never go on the
 * entry: they are task MESSAGES that name the line (see postFindingComment).
 *
 * Ticked: OK, N/A, an ACTION the crew corrected on the spot (nothing is
 * left to do), and anything JT already shows ticked (a reported item whose
 * punch work has since closed — a replayed close must not untick it).
 * A reported ACTION stays unticked until its punch task closes.
 */
export function checklistSubtasks(visit: VisitChecklists, current: Subtask[] = []): Subtask[] {
  const answered = { ...visit.cleanup, ...visit.inspection };
  const findingsFor = (key: string) => (visit.findings ?? []).filter((f) => f.itemKey === key);
  return CHECKLIST_ITEMS.map((item) => {
    const findings = findingsFor(item.key);
    const answer = answered[item.key];
    const already = current.find((s) => s.name === item.subtask)?.isComplete === true;
    const ticked =
      answer === ANSWER.ok ||
      answer === ANSWER.na ||
      (answer === ANSWER.action && findings.length > 0 && findings.every((f) => f.fixedOnSite)) ||
      already;
    return { name: item.subtask, isComplete: ticked };
  });
}

/** The one line the task description gets: who inspected. It is also the "closed" marker. */
export function inspectionNote(_visit: VisitChecklists, byName: string): string {
  return `${INSPECTED_STAMP}${byName} — ${CHECKLIST_STAMP}`;
}

/** The crew's free-text notes as one task message, or null when there are none. */
export function visitNotesMessage(visit: VisitChecklists, byName: string): string | null {
  const notes = visit.notes ?? {};
  const lines: string[] = [];
  if (notes.inspection?.trim()) lines.push(`Inspector notes: ${notes.inspection.trim()}`);
  if (notes.attic?.trim()) lines.push(`Attic access limitation / existing conditions: ${notes.attic.trim()}`);
  if (notes.cleanup?.trim()) lines.push(`Cleanup notes: ${notes.cleanup.trim()}`);
  if (lines.length === 0) return null;
  lines.push(`— ${byName} via DB CheckOut`);
  return lines.join("\n");
}

// --------------------------------------------------------------------------
// Task messages: where the notes and the photos live
// --------------------------------------------------------------------------

const COMMENT_VISIBILITY = {
  isVisibleToInternalRoles: true,
  isVisibleToCustomerRoles: false,
  isVisibleToVendorRoles: false,
} as const;

/**
 * Where a message goes: a task's own thread, or — for a summary about a work
 * area that has no task of its own to carry it — the job's.
 */
export interface MessageTarget {
  type: "task" | "job";
  id: string;
}

/** The message on this task (or job) created for this client reference, if it already exists. */
export async function findCommentByRef(pave: PaveClient, target: string | MessageTarget, ref: string): Promise<string | null> {
  const marker = clientRefMarker(ref);
  if (!marker) return null;
  const t: MessageTarget = typeof target === "string" ? { type: "task", id: target } : target;
  const res = await pave.query<Record<string, { comments: { nodes: Array<{ id: string }> } } | null>>({
    [t.type]: {
      $: { id: t.id },
      comments: { $: { size: 5, where: [["message"], "like", `%${marker}%`] }, nodes: { id: {} } },
    },
  });
  return res[t.type]?.comments?.nodes?.[0]?.id ?? null;
}

/**
 * Post a message on a task. With a client reference, a re-send finds the
 * message it already posted instead of posting twice. Internal-only:
 * customers and vendors never see crew notes.
 */
export async function postTaskMessage(
  pave: PaveClient,
  taskId: string,
  message: string,
  clientRef?: string,
  /** Memberships tagged on the message; JobTread notifies each. */
  tagged: readonly string[] = [],
): Promise<string> {
  return postMessage(pave, { type: "task", id: taskId }, message, clientRef, tagged);
}

/** postTaskMessage, on a task or on the job itself. */
export async function postMessage(
  pave: PaveClient,
  target: MessageTarget,
  message: string,
  clientRef?: string,
  tagged: readonly string[] = [],
): Promise<string> {
  const marker = clientRefMarker(clientRef);
  if (marker && clientRef) {
    const existing = await findCommentByRef(pave, target, clientRef);
    if (existing) return existing;
  }
  const res = await pave.query<{ createComment: { createdComment?: { id: string } } }>({
    createComment: {
      $: {
        targetType: target.type,
        targetId: target.id,
        message: marker ? `${message}\n\n${marker}` : message,
        ...COMMENT_VISIBILITY,
        ...(tagged.length ? { assignees: tagged.map((membershipId) => ({ membershipId })) } : {}),
      },
      createdComment: { id: {} },
    },
  });
  return res.createComment.createdComment?.id ?? "";
}

/**
 * What the crew found on a checklist line, as a message on the "Final
 * inspection" task: the line first, so the PM reads which item it is about,
 * then the finding, the note, and the rest of the report.
 */
export function findingMessage(report: ProblemReport, byName: string): string {
  const item = checklistItemByKey(report.itemKey);
  const fixed = report.fixedOnSite === true;
  const lines = [item ? item.subtask : `Problem report — ${report.location}`];
  const note = report.englishNote.trim();
  lines.push(fixed ? `✔ FIXED ON SITE${note ? ` — ${note}` : ""}` : `⚠ REPORT (punch item)${note ? ` — ${note}` : ""}`);
  if (item && report.location.trim() && report.location.trim() !== item.subtask) lines.push(`Where: ${report.location.trim()}`);
  if (fixed && report.materialsNote?.trim()) lines.push(`Materials & time: ${report.materialsNote.trim()}`);
  if (report.heardText?.trim()) lines.push(`Crew said (verbatim): "${report.heardText.trim()}"`);
  if (report.originalCrew?.trim()) lines.push(`Original work by: ${report.originalCrew.trim()}`);
  lines.push(`Reported by ${byName} via DB CheckOut`);
  return lines.join("\n");
}

/**
 * Link a task's file to a message on that task (no second upload). JT
 * REPLACES a message's file list on update, so the current list is read
 * and written back with the new file; a file already on the message is
 * left alone.
 */
export async function attachFileToComment(pave: PaveClient, commentId: string, fileId: string): Promise<"attached" | "already"> {
  const res = await pave.query<{
    comment: { files: { nodes: Array<{ id: string; file: { id: string } | null }> } } | null;
  }>({
    comment: { $: { id: commentId }, files: { $: { size: 10 }, nodes: { id: {}, file: { id: {} } } } },
  });
  const current = res.comment?.files.nodes ?? [];
  if (current.some((f) => f.file?.id === fileId)) return "already";
  await pave.query({
    updateComment: {
      $: {
        id: commentId,
        files: [...current.map((f) => ({ _type: "commentFile", id: f.id })), { _type: "file", id: fileId }],
      },
    },
  });
  return "attached";
}

// --------------------------------------------------------------------------
// A finished repair, said where the PM looks (Carl, 13 Oct 2026)
// --------------------------------------------------------------------------
//
// The crew's finish note used to be appended to the bottom of the to-do's
// description and nowhere else — invisible in the to-do list once the repair
// was done, and absent from the tasks a PM works from. Now each finished
// repair posts a MESSAGE on its own to-do with its before and after photos
// linked, and the repair that moves the job to PM Review posts one summary
// of every repair on the "PM punch review" task. Messages, not the job's
// activity feed: Carl's rule for crew notes since the site checks
// (20 Sep 2026). The description line stays — it is what a re-sent
// completion is checked against.

/** What a finished repair says on its own to-do. */
export function repairDoneMessage(note: string | undefined, byName: string): string {
  const said = note?.trim();
  return [`✔ REPAIR DONE${said ? ` — ${said}` : ""}`, `Finished by ${byName} via DB CheckOut`].join("\n");
}

export interface TaskFile {
  id: string;
  name: string;
  description: string | null;
  createdAt: string | null;
}

/** A task's files, newest first (verified live 2026-10-13: files take sortBy createdAt). */
export async function listTaskFiles(pave: PaveClient, taskId: string): Promise<TaskFile[]> {
  const res = await pave.query<{ task: { files: { nodes: TaskFile[] } } | null }>({
    task: {
      $: { id: taskId },
      files: {
        $: { size: 10, sortBy: [{ field: "createdAt", order: "desc" }] },
        nodes: { id: {}, name: {}, description: {}, createdAt: {} },
      },
    },
  });
  return res.task?.files.nodes ?? [];
}

/**
 * The before and after photos of a repair, among its to-do's files (newest
 * first). DB Crew sends a repair's photos with its own reference plus ".b" /
 * ".a", so those are found exactly; otherwise — a photo added another way —
 * the newest file named BEFORE / AFTER.
 */
export function pickRepairPhotos(files: TaskFile[], ref?: string): { before?: string; after?: string } {
  const byRef = (suffix: string) => {
    const marker = ref ? clientRefMarker(`${ref}${suffix}`) : null;
    return marker ? files.find((f) => (f.description ?? "").includes(marker))?.id : undefined;
  };
  const byName = (word: string) => files.find((f) => f.name.toUpperCase().startsWith(word))?.id;
  return { before: byRef(".b") ?? byName("BEFORE"), after: byRef(".a") ?? byName("AFTER") };
}

/**
 * Post the finished repair on its to-do and link its photos. With the
 * completion's client reference a re-send finds the message it posted.
 */
export async function postRepairDone(
  pave: PaveClient,
  taskId: string,
  note: string | undefined,
  byName: string,
  clientRef?: string,
): Promise<{ commentId: string; photos: number }> {
  const commentId = await postTaskMessage(pave, taskId, repairDoneMessage(note, byName), clientRef);
  if (!commentId) return { commentId, photos: 0 };
  const picked = pickRepairPhotos(await listTaskFiles(pave, taskId), clientRef);
  let photos = 0;
  for (const fileId of [picked.before, picked.after]) {
    if (!fileId) continue;
    await attachFileToComment(pave, commentId, fileId);
    photos++;
  }
  return { commentId, photos };
}

/** "Fixed — Yahir Gonzalez" off the "✔ Done — …" line completeTask wrote; null when there is none. */
export function doneLine(description: string | null): string | null {
  const prefix = "✔ Done — ";
  const lines = (description ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith(prefix));
  return lines.length ? lines[lines.length - 1].slice(prefix.length) : null;
}

/** How many after photos the summary links; the rest stay on each repair's own message. */
export const SUMMARY_PHOTOS_MAX = 10;

/**
 * What every summary asks of the PM. The approval and the repair day are
 * the Production Board's now (Carl, 23 Oct 2026: "The PMs need to live in
 * Production board for all of this") — its Close-out panel lists the area.
 */
export const REVIEW_ASK = "Check the work, then approve it on the Production Board (Close-out), or put it on a punch list there.";
export const PUNCH_ASK = "Book the repair day on the Production Board (Close-out). Assigned repairs are already on their phones in Close Out.";

/** "Work area: Gutters" under a summary's head — only on a job with more than one. */
const areaLine = (label?: string | null): string[] => (label ? [`Work area: ${label}`] : []);

/** The memberships a summary is tagged to: its reviewer, when JobTread knows who that is. */
const tagsFor = (reviewer: Reviewer | null): string[] => (reviewer?.membershipId ? [reviewer.membershipId] : []);

/** The summary the PM reads when an area's repairs are all finished: every repair, its note, who did it. */
export function pmReviewSummary(done: PunchTask[], photosLinked: number, area?: string | null): string {
  const head = `🔍 READY FOR PM REVIEW — ${done.length} repair${done.length === 1 ? "" : "s"} finished`;
  const lines = done.map((t, i) => `${i + 1}. ${t.name} — ${doneLine(t.description) ?? "closed in JobTread, no finish note"}`);
  const photos =
    photosLinked === 0
      ? "No after photos to link here; each repair's own messages carry what it has."
      : photosLinked < done.length
        ? `After photos for ${photosLinked} of the ${done.length} are linked here; every repair's own message carries its before and after.`
        : "The after photos are linked here; each repair's own message carries its before and after.";
  return [head, ...areaLine(area), ...lines, "", photos, REVIEW_ASK].join("\n").slice(0, 3900);
}

/**
 * A reference for the summary that is the same for the same set of finished
 * repairs, so the two callers that can both see the flip (the completion and
 * JobTread's webhook) post one summary between them, while a later punch
 * round — a different set — gets its own.
 */
export function summaryRef(done: PunchTask[]): string {
  return `pmr-${fnv(done.map((t) => t.id).sort().join(","))}`;
}

/** FNV-1a, 8 hex characters — a short, stable client reference out of ids. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Post the summary for one area's finished repairs and link each repair's
 * after photo, tagging the area's reviewer so JobTread notifies him. The
 * reference is checked FIRST: this runs on every webhook event of a job in
 * close-out, and the same finished set must cost one lookup, not a read of
 * every repair's files.
 */
export async function postPmReviewSummary(
  pave: PaveClient,
  punchTasks: PunchTask[],
  target: MessageTarget | undefined,
  reviewer: Reviewer | null | (() => Promise<Reviewer | null>),
  area?: string | null,
): Promise<string | null> {
  if (!target) return null;
  const done = punchTasks.filter((t) => t.progress >= 1);
  if (done.length === 0) return null;
  const ref = summaryRef(done);
  const already = await findCommentByRef(pave, target, ref);
  if (already) return already;
  const who = typeof reviewer === "function" ? await reviewer() : reviewer;
  const afters: string[] = [];
  for (const t of done) {
    if (afters.length >= SUMMARY_PHOTOS_MAX) break;
    const after = pickRepairPhotos(await listTaskFiles(pave, t.id)).after;
    if (after) afters.push(after);
  }
  const commentId = await postMessage(pave, target, pmReviewSummary(done, afters.length, area), ref, tagsFor(who));
  if (!commentId) return null;
  for (const fileId of afters) await attachFileToComment(pave, commentId, fileId);
  return commentId;
}

/**
 * Where a review summary goes: the template's "PM punch review" task, which
 * is what the PM ticks; on a template without one (the construction
 * schedule has none) the "Final inspection" task, so the PM is still told.
 */
export function reviewTarget(milestones: PipelineTask[]): PipelineTask | undefined {
  return findPipelineTask(milestones, PIPELINE_TASKS.pmPunchReview) ?? findPipelineTask(milestones, PIPELINE_TASKS.finalInspection);
}

// --------------------------------------------------------------------------
// A clean final inspection, the other way the app reaches PM Review
// --------------------------------------------------------------------------

/** "Yahir Gonzalez" off the "✔ Inspected by … — via DB CheckOut" stamp; null without one. */
export function inspectorOf(description: string | null): string | null {
  const stamps = (description ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith(INSPECTED_STAMP));
  if (!stamps.length) return null;
  const rest = stamps[stamps.length - 1].slice(INSPECTED_STAMP.length);
  const end = rest.indexOf(` — ${CHECKLIST_STAMP}`);
  return (end >= 0 ? rest.slice(0, end) : rest).trim() || null;
}

/** A task's messages, newest first (verified live 2026-10-13: comments take sortBy createdAt). */
export async function listTaskMessages(pave: PaveClient, taskId: string): Promise<string[]> {
  const res = await pave.query<{ task: { comments: { nodes: Array<{ message: string | null }> } } | null }>({
    task: {
      $: { id: taskId },
      comments: { $: { size: 20, sortBy: [{ field: "createdAt", order: "desc" }] }, nodes: { message: {} } },
    },
  });
  return (res.task?.comments.nodes ?? []).map((c) => c.message ?? "");
}

/** A message's own lines: no "— X via DB CheckOut" byline, no reference marker, no blanks. */
function messageBody(message: string): string[] {
  return message
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("DB CheckOut ref:") && !/^— .+ via DB CheckOut$/.test(l) && !/^Reported by .+ via DB CheckOut$/.test(l));
}

const NOTE_PREFIXES = ["Inspector notes:", "Attic access limitation", "Cleanup notes:"];

/**
 * What the inspection task's messages add to a summary: every "✔ FIXED ON
 * SITE" finding (oldest first — JobTread hands them newest first) and the
 * crew's notes message, each under its heading; nothing when there is none.
 */
function visitExtras(messages: string[]): string[] {
  const out: string[] = [];
  const fixed = [...messages]
    .reverse()
    .map(messageBody)
    .filter((b) => b.some((l) => l.startsWith("✔ FIXED ON SITE")))
    .map((b) => {
      const said = b.find((l) => l.startsWith("✔ FIXED ON SITE")) ?? "";
      const note = said.replace(/^✔ FIXED ON SITE( — )?/, "");
      const where = b.find((l) => l.startsWith("Where: "));
      return `- ${b[0]}${note ? ` — ${note}` : ""}${where ? ` (${where.slice(7)})` : ""}`;
    });
  if (fixed.length) out.push("", "Fixed on site:", ...fixed);
  const notes = messages.find((m) => NOTE_PREFIXES.some((p) => m.trim().startsWith(p)));
  if (notes) out.push("", "Crew notes:", ...messageBody(notes));
  return out;
}

/**
 * The PM's summary of a clean final inspection: who inspected, how the
 * checklist came out (naming any line left open), what the crew corrected on
 * the spot, and the crew's notes — all of it already on the "Final
 * inspection" task, gathered into the one message the PM is tagged on.
 */
export function inspectionReviewSummary(args: {
  inspector: string | null;
  checklist: Subtask[];
  messages: string[];
  photosLinked: number;
  area?: string | null;
}): string {
  const lines = ["🔍 READY FOR PM REVIEW — final inspection passed, no repairs needed", ...areaLine(args.area)];
  if (args.inspector) lines.push(`Inspected by ${args.inspector}`);
  const open = args.checklist.filter((s) => !s.isComplete);
  if (args.checklist.length) {
    lines.push(
      open.length === 0
        ? `All ${args.checklist.length} checks passed`
        : `${args.checklist.length - open.length} of ${args.checklist.length} checks passed — left open: ${open.map((s) => s.name).join("; ")}`,
    );
  }
  lines.push(...visitExtras(args.messages));
  lines.push(
    "",
    args.photosLinked ? "The visit photos are linked here." : "No visit photos came with the inspection.",
    REVIEW_ASK,
  );
  return lines.join("\n").slice(0, 3900);
}

// --------------------------------------------------------------------------
// An inspection that finds problems: the PM schedules the punch work
// --------------------------------------------------------------------------

/** The crew's note on a REPORT to-do — the first paragraph createReportTask wrote. */
function reportNote(description: string | null): string {
  return oneLine((description ?? "").split("\n\n")[0] ?? "", 160);
}

/**
 * What the PM needs to schedule the punch crew (Carl, 13 Oct 2026: *"Dave
 * needs notified so he can schedule when to send them out to complete the
 * punch list"*): every repair the inspection reported, the crew's note, who
 * it is assigned to; then what was fixed on site and the crew's notes. When
 * the phone reported more than have reached JobTread yet, it says so rather
 * than under-counting.
 */
export function punchListSummary(args: {
  inspector: string | null;
  open: PunchTask[];
  reported: number;
  messages: string[];
  photosLinked: number;
  area?: string | null;
}): string {
  const n = Math.max(args.open.length, args.reported);
  const lines = [`🛠 PUNCH LIST TO SCHEDULE — the final inspection found ${n} thing${n === 1 ? "" : "s"} to repair`, ...areaLine(args.area)];
  if (args.inspector) lines.push(`Inspected by ${args.inspector}`);
  lines.push("");
  args.open.forEach((t, i) => {
    const note = reportNote(t.description);
    const who = t.assigneeNames.length ? `for ${t.assigneeNames.join(" and ")}` : "nobody assigned yet";
    lines.push(`${i + 1}. ${t.name.replace(/^REPORT:\s*/, "")}${note ? ` — ${note}` : ""} — ${who}`);
  });
  if (args.reported > args.open.length) {
    const more = args.reported - args.open.length;
    lines.push(`${more} more reported on the phone ${more === 1 ? "is" : "are"} still on the way and will show up as to-dos.`);
  }
  lines.push(...visitExtras(args.messages));
  lines.push(
    "",
    args.photosLinked ? "The problem photos are linked here." : "No problem photos have reached JobTread yet.",
    PUNCH_ASK,
  );
  return lines.join("\n").slice(0, 3900);
}

/**
 * Where the punch-list summary goes: the template's "Punch list" task — the
 * step the PM dates — else "Final inspection" (the construction schedule has
 * no Punch list task), so the PM is told either way.
 */
export function punchTarget(milestones: PipelineTask[]): PipelineTask | undefined {
  return findPipelineTask(milestones, PIPELINE_TASKS.punchList) ?? findPipelineTask(milestones, PIPELINE_TASKS.finalInspection);
}

/** The parts of an inspection task a summary reads. */
export type InspectionRecord = Pick<PipelineTask, "id" | "description" | "subtasks">;

/**
 * Post the punch-list summary with each repair's newest photo linked and the
 * area's reviewer tagged. An inspection closes once, so the reference is the
 * inspection task's id: a re-sent close posts it once.
 */
export async function postPunchListSummary(
  pave: PaveClient,
  inspectionTask: InspectionRecord | undefined,
  open: PunchTask[],
  reported: number,
  target: MessageTarget | undefined,
  reviewer: Reviewer | null,
  area?: string | null,
): Promise<string | null> {
  if (!target || (open.length === 0 && reported === 0)) return null;
  const ref = `pls-${fnv(inspectionTask?.id ?? open.map((t) => t.id).sort().join(","))}`;
  const already = await findCommentByRef(pave, target, ref);
  if (already) return already;
  const messages = inspectionTask ? await listTaskMessages(pave, inspectionTask.id) : [];
  const photos: string[] = [];
  for (const t of open) {
    if (photos.length >= SUMMARY_PHOTOS_MAX) break;
    const newest = (await listTaskFiles(pave, t.id))[0];
    if (newest) photos.push(newest.id);
  }
  const message = punchListSummary({
    inspector: inspectionTask ? inspectorOf(inspectionTask.description) : null,
    open,
    reported,
    messages,
    photosLinked: photos.length,
    area,
  });
  const commentId = await postMessage(pave, target, message, ref, tagsFor(reviewer));
  if (!commentId) return null;
  for (const fileId of photos) await attachFileToComment(pave, commentId, fileId);
  return commentId;
}

/**
 * Post the clean-inspection summary, with the visit's photos linked and the
 * area's reviewer tagged. An inspection closes once, so the reference is the
 * inspection task's own id: a re-sent close posts it once.
 */
export async function postInspectionReviewSummary(
  pave: PaveClient,
  inspectionTask: InspectionRecord | undefined,
  target: MessageTarget | undefined,
  reviewer: Reviewer | null,
  area?: string | null,
): Promise<string | null> {
  if (!inspectionTask || !target) return null;
  const ref = `pmi-${fnv(inspectionTask.id)}`;
  const already = await findCommentByRef(pave, target, ref);
  if (already) return already;
  const [messages, files] = await Promise.all([listTaskMessages(pave, inspectionTask.id), listTaskFiles(pave, inspectionTask.id)]);
  const photos = files.filter((f) => f.name.toUpperCase().startsWith("INSPECTION")).slice(0, SUMMARY_PHOTOS_MAX).map((f) => f.id);
  const message = inspectionReviewSummary({
    inspector: inspectorOf(inspectionTask.description),
    checklist: inspectionTask.subtasks,
    messages,
    photosLinked: photos.length,
    area,
  });
  const commentId = await postMessage(pave, target, message, ref, tagsFor(reviewer));
  if (!commentId) return null;
  for (const fileId of photos) await attachFileToComment(pave, commentId, fileId);
  return commentId;
}

/**
 * Close the inspection: write the visit's checklist onto the job's scheduled
 * "Final inspection" task, put the notes and findings in its description,
 * and mark it done — in ONE write. (JT derives a checklist task's progress
 * from its ticks, so `progress: 1` only lands when everything is ticked;
 * the pipeline reads the description stamp instead — see isInspectionClosed.)
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
  clientRef?: string,
): Promise<void> {
  const res = await pave.query<{
    task: { description: string | null; subtasks: Array<{ name?: string | null; isComplete?: boolean | null }> | null } | null;
  }>({
    task: { $: { id: taskId }, description: {}, subtasks: { name: {}, isComplete: {} } },
  });
  const current: Subtask[] = (res.task?.subtasks ?? []).map((st) => ({
    name: st.name ?? "",
    isComplete: st.isComplete === true,
  }));
  const subtasks = checklistSubtasks(visit, current);
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
  // The crew's free-text notes are a message on the task, not its description.
  const message = visitNotesMessage(visit, byName);
  if (message) await postTaskMessage(pave, taskId, message, clientRef ? `${clientRef}.notes` : undefined);
}

/** The crew's notes on an area inspection, as one task message, or null when there are none. */
export function areaNotesMessage(notes: string | undefined, byName: string): string | null {
  const said = notes?.trim();
  return said ? `Inspector notes: ${said}\n— ${byName} via DB CheckOut` : null;
}

/**
 * Close a work area's inspection that is notes and photos rather than the
 * roof checklist (Carl, 23 Oct 2026). The same stamp close-inspection writes
 * — "✔ Inspected by …" is what both apps read as "inspected", whatever the
 * task's progress says — plus progress 1, and the notes as a message on the
 * task, where the board's review sheet reads them. Idempotent the same way:
 * the stamp is only appended once, and the notes message carries the send's
 * reference.
 */
export async function closeAreaInspection(
  pave: PaveClient,
  taskId: string,
  notes: string | undefined,
  byName: string,
  clientRef?: string,
): Promise<void> {
  const res = await pave.query<{ task: { description: string | null } | null }>({
    task: { $: { id: taskId }, description: {} },
  });
  const stamp = `${INSPECTED_STAMP}${byName} — ${CHECKLIST_STAMP}`;
  const existing = res.task?.description ?? "";
  const description = existing.includes(stamp) ? existing : existing ? `${existing}\n\n${stamp}` : stamp;
  await pave.query({
    updateTask: { $: { id: taskId, ...TASK_WRITE_GUARDS, progress: 1, description: description.slice(0, 4096) } },
  });
  const message = areaNotesMessage(notes, byName);
  if (message) await postTaskMessage(pave, taskId, message, clientRef ? `${clientRef}.notes` : undefined);
}

/**
 * When a REPORT punch task closes, tick the checklist item it came from on
 * the "Final inspection" task. The link is the "DB CheckOut item: 8" line
 * the report was created with; the entry is matched by its item's base
 * name, so the note on the entry's name is kept. Writes only on a change.
 */
export async function syncInspectionChecklist(
  pave: PaveClient,
  task: PipelineTask | undefined,
  punchTasks: PunchTask[],
): Promise<"updated" | "unchanged" | "none"> {
  if (!task || task.subtasks.length === 0) return "none";
  const doneCodes = new Set(
    punchTasks
      .filter((t) => t.progress >= 1)
      .map((t) => ITEM_MARKER.exec(t.description ?? "")?.[1])
      .filter((code): code is string => Boolean(code)),
  );
  if (doneCodes.size === 0) return "unchanged";
  let changed = false;
  const subtasks = task.subtasks.map((st) => {
    if (st.isComplete) return st;
    const item = CHECKLIST_ITEMS.find((i) => st.name.startsWith(i.subtask));
    if (!item || !doneCodes.has(item.code)) return st;
    changed = true;
    return { ...st, isComplete: true };
  });
  if (!changed) return "unchanged";
  await pave.query({ updateTask: { $: { id: task.id, ...TASK_WRITE_GUARDS, subtasks } } });
  return "updated";
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
  assignedMembershipIds: readonly string[] = [],
  /** The work area it is filed against, when it is not the template line's (an untagged REPORT is the line's). */
  area?: AreaKey | null,
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
  // "Gutters · reported by Yahir": how the board and the next send file it
  // under its area (areaOfPunch, and the board's tradeOfPunch).
  if (area) lines.push(areaTagLine(area, report.reportedBy || "the crew"));
  const item = checklistItemByKey(report.itemKey);
  if (item) lines.push(`Checklist: ${item.subtask}\nDB CheckOut item: ${item.code}`);
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
        ...(assignedMembershipIds.length > 0 ? { assignedMembershipIds: [...assignedMembershipIds] } : {}),
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
  /** Leads the file name instead of the bare label — "8. Attic… — REPORT". */
  title?: string;
  /**
   * Picked from the phone's own photos rather than taken in the app (DB Crew
   * T2.9, Carl 13 Oct 2026). The file says so, so a PM can tell a live shot
   * from one chosen out of the gallery.
   */
  fromPhone?: boolean;
  /** When a phone photo was actually taken (ISO 8601), read from the photo itself. */
  takenAt?: string;
}

/** "Oct 12, 2026, 2:10 PM" in the office's own clock — the time a crew member means. */
function officeTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** "2026-10-12 14:10", office time — the file-name stamp for a phone photo. */
function officeStamp(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")} ${v("hour")}:${v("minute")}`;
}

/**
 * The name and description a photo's JobTread file gets. A camera shot keeps
 * the upload stamp it always had; a photo picked from the phone is named by
 * when it was TAKEN, says "from phone", and its description says so in words
 * — or that the time is unknown (screenshots and messaging-app copies carry
 * none), never a guess.
 */
export function photoFileWords(
  photo: Pick<PhotoUpload, "label" | "title" | "byName" | "fromPhone" | "takenAt">,
  marker: string | null,
  now: Date = new Date(),
): { name: string; description: string } {
  const head = photo.title ?? photo.label;
  if (!photo.fromPhone) {
    const stamp = now.toISOString().slice(0, 16).replace("T", " ");
    return {
      name: `${head} ${stamp} — ${photo.byName}`,
      description: `Uploaded from DB CheckOut by ${photo.byName}${marker ? ` · ${marker}` : ""}`,
    };
  }
  const taken = photo.takenAt ? ` (from phone, taken ${officeStamp(photo.takenAt)})` : " (from phone, time unknown)";
  const said = photo.takenAt
    ? `picked from the phone's photos, taken ${officeTime(photo.takenAt)}`
    : "picked from the phone's photos, time taken unknown";
  return {
    name: `${head}${taken} — ${photo.byName}`,
    description: `Uploaded from DB CheckOut by ${photo.byName} · ${said}${marker ? ` · ${marker}` : ""}`,
  };
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

  const words = photoFileWords(photo, marker);
  const res = await pave.query<{ createFile: { createdFile?: { id: string } } }>({
    createFile: {
      $: {
        targetId,
        targetType,
        name: words.name,
        uploadRequestId: request.id,
        description: words.description,
      },
      createdFile: { id: {} },
    },
  });
  return res.createFile.createdFile?.id ?? "";
}

/**
 * Move the job's Status custom field. Only for a job OUTSIDE the work-area
 * loop (a service call, a construction job — see pipeline.ts): the
 * Production Board moves every job that has work areas.
 */
export async function setJobStatus(pave: PaveClient, jobId: string, status: string): Promise<void> {
  await pave.query({
    updateJob: {
      $: { id: jobId, customFieldValues: { [CUSTOM_FIELDS.status]: status } },
    },
  });
}

/** "8. Attic / interior spot check…" for a photo's file name, from the item it belongs to. */
export function checklistItemTitle(itemKey: string | undefined): string | undefined {
  const item = checklistItemByKey(itemKey);
  return item ? oneLine(item.subtask, 60) : undefined;
}

export { checklistItemByCode };
