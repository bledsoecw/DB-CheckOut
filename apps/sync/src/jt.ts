/**
 * Domain operations against JobTread. Every function here maps 1:1 to a
 * verified Pave query shape (see docs/jobtread-setup.md "Pave API notes").
 */

import type { PaveClient } from "./pave";
import {
  CUSTOM_FIELDS,
  ORGANIZATION_ID,
  SERVICE_PROJECT_TYPES,
  STATUS,
  TASK_TYPES,
} from "../../../packages/shared/src/jobtread";
import type {
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
  assignees?: { nodes: Array<{ name?: string | null }> } | null;
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

export function toQueueJob(job: RawJob, openPunchCount = 0): QueueJob {
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
 * Punch List / Punch Review (so punch work stays visible until completed).
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
  const statuses = [STATUS.finalInspection, STATUS.punchList, STATUS.punchReview];
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

export async function getJob(pave: PaveClient, jobId: string): Promise<JobDetail> {
  const [res, punchTasks, soldScope] = await Promise.all([
    pave.query<{ job: RawJob | null }>({ job: { $: { id: jobId }, ...JOB_SELECTION } }),
    listPunchTasks(pave, jobId),
    listSoldScope(pave, jobId),
  ]);
  if (!res.job) throw new Error(`Job not found: ${jobId}`);
  const open = punchTasks.filter((t) => t.progress < 1).length;
  return { ...toQueueJob(res.job, open), punchTasks, soldScope };
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
        },
      },
    },
  });
  const nodes = res.job?.tasks.nodes ?? [];
  return nodes
    .filter((t) => t.taskType?.id === TASK_TYPES.punchList)
    .map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      progress: t.progress ?? 0,
      endDate: t.endDate,
      assigneeNames: (t.assignees?.nodes ?? [])
        .map((a) => a.name)
        .filter((n): n is string => typeof n === "string"),
    }));
}

// --------------------------------------------------------------------------
// Mutations
// --------------------------------------------------------------------------

/** Submit a filled form (inspection / cleanup / walkthrough) onto a job. */
export async function submitForm(
  pave: PaveClient,
  formId: string,
  jobId: string,
  values: Record<string, string>,
): Promise<string> {
  const res = await pave.query<{
    createFormSubmission: { createdFormSubmission?: { id: string } };
  }>({
    createFormSubmission: {
      $: { formId, targetId: jobId, isSubmitted: true, values },
      createdFormSubmission: { id: {} },
    },
  });
  return res.createFormSubmission.createdFormSubmission?.id ?? "";
}

/**
 * A crew problem report becomes a to-do task of type Punch List.
 * - Default: UNASSIGNED, for the Service Manager / PM to turn into a work
 *   order on the Production board.
 * - fixedOnSite: created already complete (progress 1) — the crew corrected
 *   it during the visit; the task is the documentation of that correction.
 */
export async function createReportTask(
  pave: PaveClient,
  jobId: string,
  report: ProblemReport,
): Promise<string> {
  const fixed = report.fixedOnSite === true;
  const lines = [report.englishNote];
  if (fixed) lines.push("✔ Corrected on site during the visit.");
  if (report.materialsNote) lines.push(`Materials & time: ${report.materialsNote}`);
  if (report.heardText) lines.push(`Crew said (verbatim): "${report.heardText}"`);
  if (report.originalCrew) lines.push(`Original work by: ${report.originalCrew}`);
  if (report.reportedBy) lines.push(`Reported by: ${report.reportedBy}`);
  const res = await pave.query<{ createTask: { createdTask?: { id: string } } }>({
    createTask: {
      $: {
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
    await pave.query({ updateTask: { $: { id: taskId, progress: 1 } } });
    return;
  }
  const res = await pave.query<{ task: { description: string | null } | null }>({
    task: { $: { id: taskId }, description: {} },
  });
  const done = `✔ Done — ${trimmed}`;
  const description = res.task?.description ? `${res.task.description}\n\n${done}` : done;
  await pave.query({
    updateTask: { $: { id: taskId, progress: 1, description: description.slice(0, 4096) } },
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
        targetId: photo.taskId ?? jobId,
        targetType: photo.taskId ? "task" : "job",
        name: `${photo.label} ${stamp} — ${photo.byName}`,
        uploadRequestId: request.id,
        description: `Uploaded from DB CheckOut by ${photo.byName}`,
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
