/**
 * Domain operations against JobTread. Every function here maps 1:1 to a
 * verified Pave query shape (see docs/jobtread-setup.md "Pave API notes").
 */

import type { PaveClient } from "./pave";
import {
  CUSTOM_FIELDS,
  ORGANIZATION_ID,
  STATUS,
  TASK_TYPES,
} from "../../../packages/shared/src/jobtread";
import type { JobDetail, ProblemReport, PunchTask, QueueJob } from "../../../packages/shared/src/types";

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
  location?: { address: string | null } | null;
}

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

export function toQueueJob(job: RawJob, openPunchCount = 0): QueueJob {
  return {
    id: job.id,
    number: job.number,
    name: job.name,
    status: cfv(job, CUSTOM_FIELDS.status) ?? "",
    jobType: cfv(job, CUSTOM_FIELDS.jobType),
    projectManager: cfv(job, CUSTOM_FIELDS.projectManager),
    salesRep: cfv(job, CUSTOM_FIELDS.salesRep),
    address: job.location?.address ?? null,
    openPunchCount,
  };
}

const JOB_SELECTION = {
  id: {},
  number: {},
  name: {},
  customFieldValues: { $: { size: 25 }, nodes: { value: {}, customField: { id: {} } } },
} as const;

// --------------------------------------------------------------------------
// Queries
// --------------------------------------------------------------------------

/**
 * Jobs currently at Status = Final Inspection (the crew queue), plus any at
 * Punch List / Punch Review (so punch work stays visible until completed).
 *
 * Their org is small (hundreds of jobs, a handful in-pipeline), so we page
 * jobs and filter on the status custom field in code rather than depending
 * on Pave's where-grammar for custom fields.
 */
interface JobsPage {
  organization: { jobs: { nextPage: string | null; nodes: RawJob[] } };
}

export async function listPipelineJobs(pave: PaveClient): Promise<QueueJob[]> {
  const wanted = new Set<string>([STATUS.finalInspection, STATUS.punchList, STATUS.punchReview]);
  const out: QueueJob[] = [];
  let page: string | null = null;
  for (let i = 0; i < 20; i++) {
    const res: JobsPage = await pave.query<JobsPage>({
      organization: {
        $: { id: ORGANIZATION_ID },
        jobs: {
          $: { size: 100, ...(page ? { page } : {}) },
          nextPage: {},
          nodes: JOB_SELECTION,
        },
      },
    });
    const jobs = res.organization.jobs;
    for (const job of jobs.nodes) {
      const status = cfv(job, CUSTOM_FIELDS.status);
      if (status != null && wanted.has(status)) out.push(toQueueJob(job));
    }
    if (!jobs.nextPage) break;
    page = jobs.nextPage;
  }
  return out;
}

export async function getJob(pave: PaveClient, jobId: string): Promise<JobDetail> {
  const res = await pave.query<{ job: RawJob | null }>({
    job: { $: { id: jobId }, ...JOB_SELECTION },
  });
  if (!res.job) throw new Error(`Job not found: ${jobId}`);
  const punchTasks = await listPunchTasks(pave, jobId);
  const open = punchTasks.filter((t) => t.progress < 1).length;
  return { ...toQueueJob(res.job, open), punchTasks };
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
 * A crew problem report becomes an UNASSIGNED to-do task of type Punch List.
 * The PM assigns it (and edits the work order) on the Production board.
 */
export async function createReportTask(
  pave: PaveClient,
  jobId: string,
  report: ProblemReport,
): Promise<string> {
  const heard = report.heardText ? `\n\nCrew said (verbatim): "${report.heardText}"` : "";
  const by = report.reportedBy ? `\nReported by: ${report.reportedBy}` : "";
  const res = await pave.query<{ createTask: { createdTask?: { id: string } } }>({
    createTask: {
      $: {
        targetId: jobId,
        taskTypeId: TASK_TYPES.punchList,
        isToDo: true,
        name: `REPORT: ${report.location}`,
        description: `${report.englishNote}${heard}${by}`,
      },
      createdTask: { id: {} },
    },
  });
  return res.createTask.createdTask?.id ?? "";
}

/** Mark a punch task finished (crew pressed Terminado; after photo enforced app-side). */
export async function completeTask(pave: PaveClient, taskId: string): Promise<void> {
  await pave.query({ updateTask: { $: { id: taskId, progress: 1 } } });
}

/** Move the job's Status custom field. */
export async function setJobStatus(pave: PaveClient, jobId: string, status: string): Promise<void> {
  await pave.query({
    updateJob: {
      $: { id: jobId, customFieldValues: { [CUSTOM_FIELDS.status]: status } },
    },
  });
}
