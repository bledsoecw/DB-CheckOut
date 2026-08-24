// GENERATED FILE — do not edit. Source: apps/sync/src/*. Rebuild: npm run build:api

// apps/sync/src/env.ts
function loadEnv(source = process.env) {
  const jtGrantKey = source.JT_GRANT_KEY ?? "";
  const appToken = source.APP_TOKEN ?? "";
  if (!jtGrantKey) {
    throw new Error("JT_GRANT_KEY is not set. Create a grant key in JobTread and put it in apps/sync/.env");
  }
  if (!appToken) {
    throw new Error("APP_TOKEN is not set. Generate a shared secret for the mobile app (openssl rand -hex 24)");
  }
  return {
    jtGrantKey,
    appToken,
    port: Number(source.PORT ?? 8787)
  };
}

// apps/sync/src/pave.ts
var PAVE_URL = "https://api.jobtread.com/pave";
var PaveError = class extends Error {
  status;
  body;
  constructor(status, body) {
    super(`Pave request failed (${status}): ${body.slice(0, 500)}`);
    this.name = "PaveError";
    this.status = status;
    this.body = body;
  }
};
function withGrantKey(query, grantKey) {
  const dollar = query["$"] ?? {};
  return { ...query, $: { ...dollar, grantKey } };
}
function createPaveClient(grantKey, fetchImpl = fetch) {
  return {
    async query(query) {
      const res = await fetchImpl(PAVE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: withGrantKey(query, grantKey) })
      });
      const text = await res.text();
      if (!res.ok) {
        throw new PaveError(res.status, text);
      }
      return JSON.parse(text);
    }
  };
}

// packages/shared/src/jobtread.ts
var ORGANIZATION_ID = "22PBAjem8SSC";
var CUSTOM_FIELDS = {
  status: "22PBAjfWVVv9",
  jobType: "22PBzhnUydgC",
  projectManager: "22PC4DSTx7tg",
  salesRep: "22PBzhswJYd8"
};
var STATUS = {
  production: "Production",
  finalInspection: "Final Inspection",
  punchList: "Punch List",
  punchReview: "Punch Review",
  jobCompleted: "Job Completed",
  pendingFinalPayment: "Pending Final Payment"
};
var INSPECTION_FORM = {
  id: "22PdEQfPn8wQ",
  name: "DB Final Roofing Inspection",
  optionFields: [
    "22PdEQfPnVqh",
    // 1. Shingle field flat — no exposed fasteners or unaddressed damage
    "22PdEQfPnVqi",
    // 2. Starter, eave/rake edges & drip edge complete and secure
    "22PdEQfPnVqj",
    // 3. Ridge & hip caps seated; valleys clean; transitions shed water
    "22PdEQfPnVqk",
    // 4. Pipe boots, static vents & ridge ventilation installed and sealed
    "22PdEQfPnVqm",
    // 5. Step, headwall & sidewall flashing complete and integrated
    "22PdEQfPnVqn",
    // 6. Chimneys, skylights & penetrations flashed/reset as scoped
    "22PdEQfPnVqp",
    // 7. Sealant appropriate — not a substitute for flashing; roof surface clear
    "22PdEQfPnVqq"
    // 8. Attic / interior spot check — leak-prone areas inspected
  ],
  atticNotesField: "22PdEQfPnVqr",
  notesField: "22PdEQfPnVqs"
};
var CLEANUP_FORM = {
  id: "22PdEQhB67dq",
  name: "DB Site Cleanup",
  optionFields: [
    "22PdEQhB6rSR",
    // 1. Driveway, walks & landscaping clean — magnet sweep completed
    "22PdEQhB6rSS",
    // 2. Unused materials, pallets, tarps & crew debris removed or staged
    "22PdEQhB6rST",
    // 3. Gutters & downspouts clear of debris and reconnected
    "22PdEQhB6rSU",
    // 4. No production damage — siding, windows, doors, AC, plants
    "22PdEQhB6rSV"
    // 5. General appearance — ready for the homeowner to view
  ],
  notesField: "22PdEQhB6rSW"
};
var TASK_TYPES = {
  /** Punch/repair items created from crew reports. */
  punchList: "22PLePTbJVrQ",
  /** Optional: scheduling the inspection visit itself. */
  inspection: "22PNJDrm6TsA"
};

// apps/sync/src/jt.ts
function cfv(job, fieldId) {
  const hit = job.customFieldValues.nodes.find((n) => n.customField.id === fieldId);
  return hit == null || hit.value == null ? null : String(hit.value);
}
function toQueueJob(job, openPunchCount = 0) {
  return {
    id: job.id,
    number: job.number,
    name: job.name,
    status: cfv(job, CUSTOM_FIELDS.status) ?? "",
    jobType: cfv(job, CUSTOM_FIELDS.jobType),
    projectManager: cfv(job, CUSTOM_FIELDS.projectManager),
    salesRep: cfv(job, CUSTOM_FIELDS.salesRep),
    address: job.location?.formattedAddress ?? null,
    openPunchCount
  };
}
var JOB_SELECTION = {
  id: {},
  number: {},
  name: {},
  customFieldValues: { $: { size: 25 }, nodes: { value: {}, customField: { id: {} } } },
  location: { formattedAddress: {} }
};
async function listPipelineJobs(pave) {
  const wanted = /* @__PURE__ */ new Set([STATUS.finalInspection, STATUS.punchList, STATUS.punchReview]);
  const out = [];
  let page = null;
  for (let i = 0; i < 20; i++) {
    const res = await pave.query({
      organization: {
        $: { id: ORGANIZATION_ID },
        jobs: {
          $: { size: 100, ...page ? { page } : {} },
          nextPage: {},
          nodes: JOB_SELECTION
        }
      }
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
async function getJob(pave, jobId) {
  const res = await pave.query({
    job: { $: { id: jobId }, ...JOB_SELECTION }
  });
  if (!res.job) throw new Error(`Job not found: ${jobId}`);
  const punchTasks = await listPunchTasks(pave, jobId);
  const open = punchTasks.filter((t) => t.progress < 1).length;
  return { ...toQueueJob(res.job, open), punchTasks };
}
async function listPunchTasks(pave, jobId) {
  const res = await pave.query({
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
          taskType: { id: {} }
        }
      }
    }
  });
  const nodes = res.job?.tasks.nodes ?? [];
  return nodes.filter((t) => t.taskType?.id === TASK_TYPES.punchList).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    progress: t.progress ?? 0,
    endDate: t.endDate,
    assigneeNames: (t.assignees?.nodes ?? []).map((a) => a.name).filter((n) => typeof n === "string")
  }));
}
async function submitForm(pave, formId, jobId, values) {
  const res = await pave.query({
    createFormSubmission: {
      $: { formId, targetId: jobId, isSubmitted: true, values },
      createdFormSubmission: { id: {} }
    }
  });
  return res.createFormSubmission.createdFormSubmission?.id ?? "";
}
async function createReportTask(pave, jobId, report) {
  const fixed = report.fixedOnSite === true;
  const lines = [report.englishNote];
  if (fixed) lines.push("\u2714 Corrected on site during the visit.");
  if (report.materialsNote) lines.push(`Materials & time: ${report.materialsNote}`);
  if (report.heardText) lines.push(`Crew said (verbatim): "${report.heardText}"`);
  if (report.originalCrew) lines.push(`Original work by: ${report.originalCrew}`);
  if (report.reportedBy) lines.push(`Reported by: ${report.reportedBy}`);
  const res = await pave.query({
    createTask: {
      $: {
        targetId: jobId,
        taskTypeId: TASK_TYPES.punchList,
        isToDo: true,
        name: `${fixed ? "FIXED ON SITE" : "REPORT"}: ${report.location}`,
        description: lines.join("\n\n").slice(0, 4096),
        ...fixed ? { progress: 1 } : {}
      },
      createdTask: { id: {} }
    }
  });
  return res.createTask.createdTask?.id ?? "";
}
async function completeTask(pave, taskId, note) {
  const trimmed = note?.trim();
  if (!trimmed) {
    await pave.query({ updateTask: { $: { id: taskId, progress: 1 } } });
    return;
  }
  const res = await pave.query({
    task: { $: { id: taskId }, description: {} }
  });
  const done = `\u2714 Done \u2014 ${trimmed}`;
  const description = res.task?.description ? `${res.task.description}

${done}` : done;
  await pave.query({
    updateTask: { $: { id: taskId, progress: 1, description: description.slice(0, 4096) } }
  });
}
async function setJobStatus(pave, jobId, status) {
  await pave.query({
    updateJob: {
      $: { id: jobId, customFieldValues: { [CUSTOM_FIELDS.status]: status } }
    }
  });
}

// apps/sync/src/punchReview.ts
function shouldFlipToPunchReview(currentStatus, tasks) {
  if (currentStatus !== STATUS.punchList) return false;
  if (tasks.length === 0) return false;
  return tasks.every((t) => t.progress >= 1);
}
async function applyPunchReviewFlip(pave, jobId) {
  const job = await getJob(pave, jobId);
  if (!shouldFlipToPunchReview(job.status, job.punchTasks)) return null;
  await setJobStatus(pave, jobId, STATUS.punchReview);
  return STATUS.punchReview;
}

// apps/sync/src/routes.ts
function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
}
async function readBody(req, limit = 5e6) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Body too large");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function checklistValues(sub) {
  return { ...sub.answers, ...sub.texts ?? {} };
}
function createHandler(deps) {
  return async function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, { ok: true });
      }
      if (req.method === "POST" && parts[0] === "webhooks" && parts[1] === "jobtread") {
        if (parts[2] !== deps.appToken) return json(res, 401, { error: "Bad webhook token" });
        const body = await readBody(req);
        const jobId = extractJobId(body);
        let flipped = null;
        if (jobId) flipped = await applyPunchReviewFlip(deps.pave, jobId);
        return json(res, 200, { ok: true, flipped });
      }
      if (req.headers["x-app-token"] !== deps.appToken) {
        return json(res, 401, { error: "Unauthorized" });
      }
      if (req.method === "GET" && url.pathname === "/queue") {
        return json(res, 200, await listPipelineJobs(deps.pave));
      }
      if (req.method === "GET" && parts[0] === "jobs" && parts.length === 2) {
        return json(res, 200, await getJob(deps.pave, parts[1]));
      }
      if (req.method === "POST" && parts[0] === "jobs" && parts.length === 3) {
        const jobId = parts[1];
        if (parts[2] === "inspection" || parts[2] === "cleanup") {
          const sub = await readBody(req);
          const form = parts[2] === "inspection" ? INSPECTION_FORM : CLEANUP_FORM;
          const id = await submitForm(deps.pave, form.id, jobId, checklistValues(sub));
          return json(res, 200, { submissionId: id });
        }
        if (parts[2] === "reports") {
          const report = await readBody(req);
          if (!report.location || !report.englishNote) {
            return json(res, 400, { error: "location and englishNote are required" });
          }
          const id = await createReportTask(deps.pave, jobId, report);
          return json(res, 200, { taskId: id });
        }
      }
      if (req.method === "POST" && parts[0] === "tasks" && parts[2] === "complete") {
        const body = await readBody(req);
        await completeTask(deps.pave, parts[1], body.note);
        const flipped = body.jobId ? await applyPunchReviewFlip(deps.pave, body.jobId) : null;
        return json(res, 200, { ok: true, flipped });
      }
      return json(res, 404, { error: `No route: ${req.method} ${url.pathname}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json(res, 500, { error: message });
    }
  };
}
function extractJobId(body) {
  const direct = body["jobId"] ?? body["job"]?.["id"];
  if (typeof direct === "string") return direct;
  const task = body["task"];
  const target = task?.["target"];
  if (typeof target?.["id"] === "string" && target?.["type"] === "job") return target["id"];
  return null;
}

// apps/sync/src/vercel-entry.ts
var handler = null;
async function entry(req, res) {
  try {
    if (!handler) {
      const env = loadEnv();
      handler = createHandler({
        pave: createPaveClient(env.jtGrantKey),
        appToken: env.appToken
      });
    }
    await handler(req, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(500, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: message,
        diagnostics: {
          node: process.version,
          hasJtGrantKey: Boolean(process.env.JT_GRANT_KEY),
          hasAppToken: Boolean(process.env.APP_TOKEN)
        }
      })
    );
  }
}
export {
  entry as default
};
