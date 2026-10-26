// GENERATED FILE — do not edit. Source: apps/sync/src/*. Rebuild: npm run build:api

// apps/sync/src/env.ts
function loadEnv(source = process.env) {
  const jtGrantKey = source.JT_GRANT_KEY ?? "";
  if (!jtGrantKey) {
    throw new Error("JT_GRANT_KEY is not set. Create a grant key in JobTread and put it in apps/sync/.env");
  }
  return {
    jtGrantKey,
    sessionSecret: source.SESSION_SECRET ?? "",
    googleClientId: source.GOOGLE_CLIENT_ID ?? "",
    workspaceDomain: (source.GOOGLE_WORKSPACE_DOMAIN ?? "deitemeyerbrothers.com").toLowerCase(),
    allowedEmails: (source.GOOGLE_ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
    webhookSecret: source.WEBHOOK_SECRET ?? "",
    crewAppSecret: source.CREW_APP_SECRET ?? "",
    boardUrl: source.BOARD_URL ?? "",
    closeoutHookSecret: source.CLOSEOUT_HOOK_SECRET ?? "",
    publicUrl: source.PUBLIC_URL ?? "https://closeout.deitemeyerbrothers.com",
    geminiApiKey: source.GEMINI_API_KEY ?? "",
    geminiModel: source.GEMINI_MODEL ?? "gemini-flash-lite-latest",
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
      for (let attempt = 0; ; attempt++) {
        const res = await fetchImpl(PAVE_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: withGrantKey(query, grantKey) })
        });
        const text = await res.text();
        if (res.ok) return JSON.parse(text);
        if (attempt === 0 && [429, 502, 503, 504].includes(res.status)) {
          await new Promise((resolve) => setTimeout(resolve, 750));
          continue;
        }
        throw new PaveError(res.status, text);
      }
    }
  };
}

// apps/sync/src/auth.ts
import {
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature
} from "node:crypto";
var SESSION_ISSUER = "db-checkout";
var SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
var b64json = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function parseB64Json(part) {
  try {
    const parsed = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}
function sessionSignature(secret, signingInput) {
  return createHmac("sha256", secret).update(signingInput).digest();
}
function mintSession(secret, user, nowMs = Date.now()) {
  const iat = Math.floor(nowMs / 1e3);
  const header = b64json({ alg: "HS256", typ: "JWT" });
  const payload = b64json({
    iss: SESSION_ISSUER,
    sub: user.email,
    name: user.name,
    iat,
    exp: iat + SESSION_TTL_SECONDS
  });
  const signature = sessionSignature(secret, `${header}.${payload}`).toString("base64url");
  return `${header}.${payload}.${signature}`;
}
function verifySession(secret, token, nowMs = Date.now()) {
  const parts = token.split(".");
  if (parts.length !== 3 || !secret) return null;
  const expected = sessionSignature(secret, `${parts[0]}.${parts[1]}`);
  const actual = Buffer.from(parts[2], "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const payload = parseB64Json(parts[1]);
  if (!payload || payload["iss"] !== SESSION_ISSUER) return null;
  if (typeof payload["exp"] !== "number" || payload["exp"] * 1e3 <= nowMs) return null;
  const email = payload["sub"];
  if (typeof email !== "string" || !email) return null;
  return { email, name: typeof payload["name"] === "string" ? payload["name"] : email };
}
var GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
var GOOGLE_ISSUERS = /* @__PURE__ */ new Set(["https://accounts.google.com", "accounts.google.com"]);
var JWKS_TTL_MS = 60 * 60 * 1e3;
var jwksCache = null;
async function googleKeys(fetchImpl, forceRefresh) {
  const now = Date.now();
  if (!forceRefresh && jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetchImpl(GOOGLE_JWKS_URL);
  if (!res.ok) throw new Error(`Google JWKS fetch failed: ${res.status}`);
  const body = await res.json();
  jwksCache = { keys: body.keys ?? [], fetchedAt: now };
  return jwksCache.keys;
}
async function verifyGoogleCredential(credential, clientId, fetchImpl = fetch, nowMs = Date.now()) {
  const parts = credential.split(".");
  if (parts.length !== 3) throw new Error("Malformed credential");
  const header = parseB64Json(parts[0]);
  const payload = parseB64Json(parts[1]);
  if (!header || !payload) throw new Error("Malformed credential");
  if (header["alg"] !== "RS256") throw new Error("Unexpected algorithm");
  const kid = header["kid"];
  let keys = await googleKeys(fetchImpl, false);
  let jwk = keys.find((k) => k.kid === kid);
  if (!jwk) {
    keys = await googleKeys(fetchImpl, true);
    jwk = keys.find((k) => k.kid === kid);
  }
  if (!jwk) throw new Error("Unknown signing key");
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  const ok = verifySignature(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    publicKey,
    Buffer.from(parts[2], "base64url")
  );
  if (!ok) throw new Error("Bad signature");
  if (!GOOGLE_ISSUERS.has(String(payload["iss"]))) throw new Error("Bad issuer");
  if (payload["aud"] !== clientId) throw new Error("Bad audience");
  if (typeof payload["exp"] !== "number" || payload["exp"] * 1e3 <= nowMs) {
    throw new Error("Credential expired");
  }
  return payload;
}
function assertAllowedIdentity(payload, workspaceDomain, allowedEmails) {
  const email = String(payload["email"] ?? "").toLowerCase();
  if (!email || payload["email_verified"] !== true) throw new Error("Email not verified");
  const onDomain = workspaceDomain.length > 0 && (payload["hd"] === workspaceDomain || email.endsWith(`@${workspaceDomain}`));
  const allowListed = allowedEmails.includes(email);
  if (!onDomain && !allowListed) throw new Error(`Account not allowed: ${email}`);
  const name = typeof payload["name"] === "string" && payload["name"] ? payload["name"] : email;
  return { email, name };
}

// packages/shared/src/jobtread.ts
var ORGANIZATION_ID = "22PBAjem8SSC";
var CUSTOM_FIELDS = {
  status: "22PBAjfWVVv9",
  jobType: "22PBzhnUydgC",
  /** Multi-value: a job can carry several Project Types (e.g. R-Shingles + R-Metal). */
  projectType: "22PC7idvhRzp",
  projectManager: "22PC4DSTx7tg",
  salesRep: "22PBzhswJYd8"
};
var SERVICE_PROJECT_TYPES = ["R-Repairs/Service", "R-Warranty"];
var STATUS = {
  preProduction: "Pre-Production",
  production: "Production",
  finalInspection: "Final Inspection",
  punchList: "Punch List",
  /** Renamed in JT from "Punch Review" on 2026-09-16 — JT refuses the old value. */
  pmReview: "PM Review",
  /** Every work area approved: the sales rep calls the customer, then sets Job Completed by hand. */
  repReview: "Sales Rep > Cust Final Contact",
  jobCompleted: "Job Completed",
  pendingFinalPayment: "Pending Final Payment"
};
var ANSWER = {
  ok: "OK",
  na: "N/A",
  action: "ACTION"
};
var INSPECTION_ITEMS = [
  { key: "22PdEQfPnVqh", code: "1", subtask: "1. Shingle field flat \u2014 no exposed fasteners or unaddressed damage" },
  { key: "22PdEQfPnVqi", code: "2", subtask: "2. Starter, eave/rake edges & drip edge complete and secure" },
  { key: "22PdEQfPnVqj", code: "3", subtask: "3. Ridge & hip caps seated; valleys clean; transitions shed water" },
  { key: "22PdEQfPnVqk", code: "4", subtask: "4. Pipe boots, static vents & ridge ventilation installed and sealed" },
  { key: "22PdEQfPnVqm", code: "5", subtask: "5. Step, headwall & sidewall flashing complete and integrated" },
  { key: "22PdEQfPnVqn", code: "6", subtask: "6. Chimneys, skylights & penetrations flashed/reset as scoped" },
  { key: "22PdEQfPnVqp", code: "7", subtask: "7. Sealant appropriate \u2014 not a substitute for flashing; roof surface clear" },
  { key: "22PdEQfPnVqq", code: "8", subtask: "8. Attic / interior spot check \u2014 leak-prone areas inspected" }
];
var CLEANUP_ITEMS = [
  { key: "22PdEQhB6rSR", code: "C1", subtask: "Cleanup 1. Driveway, walks & landscaping clean \u2014 magnet sweep completed" },
  { key: "22PdEQhB6rSS", code: "C2", subtask: "Cleanup 2. Unused materials, pallets, tarps & crew debris removed or staged" },
  { key: "22PdEQhB6rST", code: "C3", subtask: "Cleanup 3. Gutters & downspouts clear of debris and reconnected" },
  { key: "22PdEQhB6rSU", code: "C4", subtask: "Cleanup 4. No production damage \u2014 siding, windows, doors, AC, plants" },
  { key: "22PdEQhB6rSV", code: "C5", subtask: "Cleanup 5. General appearance \u2014 ready for the homeowner to view" }
];
var CHECKLIST_ITEMS = [
  ...INSPECTION_ITEMS,
  ...CLEANUP_ITEMS
];
function checklistItemByKey(key) {
  return key ? CHECKLIST_ITEMS.find((item) => item.key === key) : void 0;
}
var INSPECTION_CHECKLIST = {
  /** Item keys in crew order; derived so the app and the subtasks can never drift apart. */
  keys: INSPECTION_ITEMS.map((i) => i.key),
  /** Free text: attic access limitation / existing conditions. */
  atticKey: "22PdEQfPnVqr",
  /** Free text: inspector notes (English). */
  notesKey: "22PdEQfPnVqs"
};
var CLEANUP_CHECKLIST = {
  keys: CLEANUP_ITEMS.map((i) => i.key),
  /** Free text: cleanup notes (English). */
  notesKey: "22PdEQhB6rSW"
};
var TASK_TYPES = {
  /** Punch/repair items created from crew reports. */
  punchList: "22PLePTbJVrQ",
  /** The "Final inspection" pipeline task, and inspection visits generally. */
  inspection: "22PNJDrm6TsA",
  /** Planning bars that are not crew bookings ("Order materials", "Roof install"). */
  preProduction: "22PDM6m8Vdqw",
  /** The remaining pipeline milestones — deliberately NOT Punch List (see below). */
  general: "22PBAjfWNQrT"
};
var PIPELINE_TASKS = {
  /** Crew ticks the checklist here; completing it ends the inspection. */
  finalInspection: { name: "Final inspection", typeId: TASK_TYPES.inspection },
  /** Its checklist mirrors the job's punch to-dos; it completes when the last one closes. */
  punchList: { name: "Punch list", typeId: TASK_TYPES.punchList },
  /** Sales rep has spoken to the customer; completing it closes the job. */
  finalCheckOff: { name: "Final check-off", typeId: TASK_TYPES.general },
  /**
   * The PM ticks it after checking the punch work. A human gate with no
   * status of its own — the summary of every finished repair is posted here
   * when the last one moves the job to PM Review (Carl, 13 Oct 2026).
   */
  pmPunchReview: { name: "PM punch review", typeId: TASK_TYPES.general }
};
var PUNCH_CREW = [
  { name: "Alberto Gonzalez", membershipId: "22PdPUpWzpHy" },
  { name: "Yahir Gonzalez", membershipId: "22PdPTwMdkzj" }
];
var PM_REVIEWER = { name: "Dave Elick", membershipId: "22PLtDsn6f4P" };
function isRoofingJob(job) {
  return job.jobType === "Roofing" || job.projectTypes.some((t) => t.startsWith("R-"));
}

// apps/sync/src/areas.ts
var AREA_ORDER = ["shingle", "metal", "flat", "siding", "gutters"];
var AREA_LABEL = {
  shingle: "Shingle roof",
  metal: "Metal roof",
  flat: "Low-slope roof",
  siding: "Siding",
  gutters: "Gutters"
};
var PTYPE_AREA = {
  "R-Shingles": "shingle",
  "R-Metal": "metal",
  "R-Low Slope": "flat",
  "R-Commercial": "flat",
  "R-Siding": "siding",
  "R-Gutters": "gutters"
};
var ROOFS = ["shingle", "metal", "flat"];
function isAreaKey(v) {
  return typeof v === "string" && AREA_ORDER.includes(v);
}
function jobAreas(job) {
  if (job.jobType !== "Roofing") return [];
  const found = /* @__PURE__ */ new Set();
  for (const p of job.projectTypes) {
    const a = PTYPE_AREA[p];
    if (a) found.add(a);
  }
  return AREA_ORDER.filter((a) => found.has(a));
}
function lineArea(areas) {
  return areas.find((a) => ROOFS.includes(a)) ?? areas[0] ?? null;
}
function usesRoofForm(area, line) {
  return area === line && ROOFS.includes(area);
}
function areaInspectionName(area, line) {
  return area === line ? "Final inspection" : `Final inspection \u2014 ${AREA_LABEL[area]}`;
}
var flat = (s) => s.replace(/\s+/g, " ").trim();
function areaOfInspectionName(name) {
  const m = /^Final inspection — (.+)$/.exec(flat(name));
  return m ? AREA_ORDER.find((a) => AREA_LABEL[a] === m[1].trim()) ?? null : null;
}
function areaOfReviewName(name) {
  const m = /^PM review — (.+)$/.exec(flat(name));
  return m ? AREA_ORDER.find((a) => AREA_LABEL[a] === m[1].trim()) ?? null : null;
}
function areaTagLine(area, byName) {
  return `${AREA_LABEL[area]} \xB7 reported by ${byName}`;
}
function areaOfPunch(task, areas) {
  const text = task.description ?? "";
  for (const a of AREA_ORDER) {
    if (new RegExp(`(^|\xB7)\\s*${AREA_LABEL[a]}\\s*\xB7\\s*(asked|reported) by`, "im").test(text)) return a;
  }
  if (/^(REPORT|FIXED ON SITE):/i.test(task.name.trim())) return lineArea(areas);
  return areas.length === 1 ? areas[0] : null;
}
function fallbackReviewer(area) {
  if (area === "gutters") return { name: "Neal Deitemeyer", membershipId: "22PLUqZNCKaY" };
  return { name: PM_REVIEWER.name, membershipId: PM_REVIEWER.membershipId };
}
function fallbackRepairCrew(area, roofingJob) {
  if (area === "shingle" || area === null && roofingJob) return PUNCH_CREW.map((m) => m.membershipId);
  return [];
}

// apps/sync/src/jt.ts
function cfv(job, fieldId) {
  const hit = job.customFieldValues.nodes.find((n) => n.customField.id === fieldId);
  return hit == null || hit.value == null ? null : String(hit.value);
}
function cfvAll(job, fieldId) {
  return job.customFieldValues.nodes.filter((n) => n.customField.id === fieldId && n.value != null).map((n) => String(n.value));
}
function toQueueJob(job, openPunchCount = 0, mine = false) {
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
    mine
  };
}
var JOB_SELECTION = {
  id: {},
  number: {},
  name: {},
  customFieldValues: { $: { size: 25 }, nodes: { value: {}, customField: { id: {} } } },
  location: { formattedAddress: {} }
};
var DOC_META_SELECTION = {
  $: { size: 25 },
  nodes: { id: {}, name: {}, number: {}, type: {}, status: {}, price: {}, issueDate: {} }
};
function jtDocumentUrl(jobId, documentId) {
  return `https://app.jobtread.com/jobs/${jobId}/documents/${documentId}`;
}
function selectScopeDocs(docs) {
  return docs.filter((d) => d.type === "customerOrder" && d.status === "approved").sort((a, b) => (a.issueDate ?? "").localeCompare(b.issueDate ?? ""));
}
function toScopeLines(nodes) {
  return nodes.map((li) => ({
    name: li.name,
    quantity: li.quantity ? li.quantity : null,
    unit: li.unit?.name ?? null,
    description: li.description || null
  }));
}
async function listDocumentLines(pave, documentId) {
  const lines = [];
  let page = null;
  for (let i = 0; i < 4; i++) {
    const res = await pave.query({
      document: {
        $: { id: documentId },
        costItems: {
          $: { size: 50, ...page ? { page } : {} },
          nextPage: {},
          nodes: { name: {}, description: {}, quantity: {}, unit: { name: {} } }
        }
      }
    });
    const items = res.document?.costItems;
    lines.push(...toScopeLines(items?.nodes ?? []));
    if (!items?.nextPage) break;
    page = items.nextPage;
  }
  return lines;
}
async function listSoldScope(pave, jobId) {
  try {
    const res = await pave.query({
      job: { $: { id: jobId }, documents: DOC_META_SELECTION }
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
        lines: await listDocumentLines(pave, d.id)
      }))
    );
  } catch {
    return [];
  }
}
async function listPipelineJobs(pave) {
  const statuses = [STATUS.finalInspection, STATUS.punchList, STATUS.pmReview];
  const out = [];
  let page = null;
  for (let i = 0; i < 10; i++) {
    const res = await pave.query({
      customField: {
        $: { id: CUSTOM_FIELDS.status },
        customFieldValues: {
          $: {
            size: 15,
            ...page ? { page } : {},
            where: { or: statuses.map((status) => [["value"], "=", status]) }
          },
          nextPage: {},
          nodes: { job: JOB_SELECTION }
        }
      }
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
async function getJobBasics(pave, jobId) {
  const res = await pave.query({
    job: { $: { id: jobId }, ...JOB_SELECTION }
  });
  return res.job ? toQueueJob(res.job) : null;
}
async function listJobsByIds(pave, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const query = {};
    chunk.forEach((id, n) => {
      query[`j${n}`] = { _: "job", $: { id }, ...JOB_SELECTION };
    });
    const res = await pave.query(query);
    chunk.forEach((_, n) => {
      const job = res[`j${n}`];
      if (job) out.push(toQueueJob(job));
    });
  }
  return out;
}
async function getJob(pave, jobId, viewer) {
  const [res, rawPunch, soldScope, inspections] = await Promise.all([
    pave.query({ job: { $: { id: jobId }, ...JOB_SELECTION } }),
    listPunchTasks(pave, jobId),
    listSoldScope(pave, jobId),
    listInspectionTasks(pave, jobId)
  ]);
  if (!res.job) throw new Error(`Job not found: ${jobId}`);
  const punchTasks = rawPunch.map((t) => ({ ...t, mine: assignedTo(t, viewer) }));
  const open = punchTasks.filter((t) => t.progress < 1);
  const mineOpen = open.filter((t) => t.mine).length;
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
    openPunchTotal: open.length
  };
}
async function listInspectionTasks(pave, jobId) {
  const res = await pave.query({
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
          assignedMemberships: { $: { size: 5 }, nodes: { user: { name: {}, emailAddress: {} } } }
        }
      }
    }
  });
  return (res.job?.tasks.nodes ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    progress: t.progress ?? 0,
    description: t.description ?? null,
    startDate: t.startDate ?? null,
    assignees: (t.assignedMemberships?.nodes ?? []).map((m) => ({ name: m.user?.name ?? null, email: m.user?.emailAddress ?? null }))
  }));
}
function closeoutAreas(job, punch, inspections, viewer) {
  const areas = jobAreas(job);
  const line = lineArea(areas);
  return areas.map((area) => {
    const isLine = area === line;
    const task = isLine ? inspections.find((t) => sameName(t.name, areaInspectionName(area, line))) : inspections.find((t) => areaOfInspectionName(t.name) === area);
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
      openRepairs: punch.filter((t) => t.progress < 1 && areaOfPunch(t, areas) === area).length
    };
  });
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
            nodes: { id: {}, user: { id: {}, name: {}, emailAddress: {} } }
          }
        }
      }
    }
  });
  const nodes = res.job?.tasks.nodes ?? [];
  return nodes.filter((t) => t.taskType?.id === TASK_TYPES.punchList && t.isToDo === true).map((t) => {
    const assignees = (t.assignedMemberships?.nodes ?? []).map((m) => ({
      membershipId: m.id,
      name: m.user?.name ?? "",
      email: m.user?.emailAddress ?? null
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
      mine: false
    };
  });
}
var norm = (v) => (v ?? "").trim().toLowerCase();
function assignedTo(task, viewer) {
  return viewerMatches(task.assignees, viewer);
}
function viewerMatches(assignees, viewer) {
  if (!viewer) return false;
  const email = norm(viewer.email);
  const name = norm(viewer.name);
  return assignees.some(
    (a) => email.length > 0 && norm(a.email) === email || name.length > 0 && norm(a.name) === name
  );
}
function bookedDayOf(task) {
  const start = String(task.startDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const rawEnd = String(task.endDate ?? "").slice(0, 10);
  const end = /^\d{4}-\d{2}-\d{2}$/.test(rawEnd) && rawEnd >= start ? rawEnd : start;
  return { start, end, kind: task.taskType?.id === TASK_TYPES.punchList ? "repair" : "inspection" };
}
function addBooked(list, day) {
  if (!day) return;
  if (list.some((d) => d.start === day.start && d.end === day.end && d.kind === day.kind)) return;
  list.push(day);
  list.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.kind.localeCompare(b.kind));
}
function isCloseoutTask(task) {
  if (task.taskType?.id === TASK_TYPES.punchList) return task.isToDo !== false;
  return task.taskType?.id === TASK_TYPES.inspection && /^\s*final inspection/i.test(task.name ?? "");
}
var ASSIGNED_SCAN_PAGE_SIZE = 40;
var ASSIGNED_SCAN_ASSIGNEES = 10;
var ASSIGNED_SCAN_PAGES = 10;
async function listAssignedWorkByJob(pave, viewer) {
  const work = /* @__PURE__ */ new Map();
  if (!viewer) return work;
  try {
    let page = null;
    for (let i = 0; i < ASSIGNED_SCAN_PAGES; i++) {
      const res = await pave.query({
        organization: {
          $: { id: ORGANIZATION_ID },
          tasks: {
            $: {
              // 50 x 10 = 500 declared used to pass; Pave rejects it now, and
              // the catch below read that as "nothing assigned" for everyone.
              size: ASSIGNED_SCAN_PAGE_SIZE,
              ...page ? { page } : {},
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
                      { and: [[["taskType", "id"], "=", TASK_TYPES.inspection], [["name"], "like", "Final inspection%"]] }
                    ]
                  },
                  [["progress"], "!=", 1]
                ]
              }
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
                nodes: { id: {}, user: { name: {}, emailAddress: {} } }
              }
            }
          }
        }
      });
      const tasks = res.organization?.tasks;
      for (const task of tasks?.nodes ?? []) {
        const jobId = task.job?.id;
        if (!jobId) continue;
        const assignees = (task.assignedMemberships?.nodes ?? []).map((m) => ({
          name: m.user?.name ?? null,
          email: m.user?.emailAddress ?? null
        }));
        if (!isCloseoutTask(task) || !viewerMatches(assignees, viewer)) continue;
        const entry2 = work.get(jobId) ?? { any: false, punchOpen: 0, booked: [] };
        entry2.any = true;
        if (task.taskType?.id === TASK_TYPES.punchList) entry2.punchOpen += 1;
        addBooked(entry2.booked, bookedDayOf(task));
        work.set(jobId, entry2);
      }
      if (!tasks?.nextPage) break;
      page = tasks.nextPage;
    }
  } catch (err) {
    console.warn(
      `assigned-work scan stopped early: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return work;
}
var TASK_WRITE_GUARDS = { updateDependentTasks: false, notify: false };
function isInspectionClosed(task) {
  if (!task) return false;
  return task.progress >= 1 || (task.description ?? "").includes(INSPECTED_STAMP);
}
async function listPipelineTasks(pave, jobId) {
  const res = await pave.query({
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
          subtasks: { name: {}, isComplete: {} }
        }
      }
    }
  });
  return (res.job?.tasks.nodes ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    progress: t.progress ?? 0,
    taskTypeId: t.taskType?.id ?? null,
    description: t.description ?? null,
    subtasks: (t.subtasks ?? []).map((st) => ({ name: st.name ?? "", isComplete: st.isComplete === true }))
  }));
}
var sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
function findPipelineTask(tasks, spec) {
  const named = tasks.filter((t) => sameName(t.name, spec.name));
  if (named.length === 0) return void 0;
  return named.find((t) => t.taskTypeId === spec.typeId) ?? named[0];
}
var CHECKLIST_STAMP = "via DB CheckOut";
var INSPECTED_STAMP = "\u2714 Inspected by ";
var ITEM_MARKER = /DB CheckOut item: ([A-Z]?\d+)/;
var oneLine = (text, max) => {
  const flat2 = text.replace(/\s+/g, " ").trim();
  return flat2.length > max ? `${flat2.slice(0, max - 1)}\u2026` : flat2;
};
function checklistSubtasks(visit, current = []) {
  const answered = { ...visit.cleanup, ...visit.inspection };
  const findingsFor = (key) => (visit.findings ?? []).filter((f) => f.itemKey === key);
  return CHECKLIST_ITEMS.map((item) => {
    const findings = findingsFor(item.key);
    const answer = answered[item.key];
    const already = current.find((s) => s.name === item.subtask)?.isComplete === true;
    const ticked = answer === ANSWER.ok || answer === ANSWER.na || answer === ANSWER.action && findings.length > 0 && findings.every((f) => f.fixedOnSite) || already;
    return { name: item.subtask, isComplete: ticked };
  });
}
function inspectionNote(_visit, byName) {
  return `${INSPECTED_STAMP}${byName} \u2014 ${CHECKLIST_STAMP}`;
}
function visitNotesMessage(visit, byName) {
  const notes = visit.notes ?? {};
  const lines = [];
  if (notes.inspection?.trim()) lines.push(`Inspector notes: ${notes.inspection.trim()}`);
  if (notes.attic?.trim()) lines.push(`Attic access limitation / existing conditions: ${notes.attic.trim()}`);
  if (notes.cleanup?.trim()) lines.push(`Cleanup notes: ${notes.cleanup.trim()}`);
  if (lines.length === 0) return null;
  lines.push(`\u2014 ${byName} via DB CheckOut`);
  return lines.join("\n");
}
var COMMENT_VISIBILITY = {
  isVisibleToInternalRoles: true,
  isVisibleToCustomerRoles: false,
  isVisibleToVendorRoles: false
};
async function findCommentByRef(pave, target, ref) {
  const marker = clientRefMarker(ref);
  if (!marker) return null;
  const t = typeof target === "string" ? { type: "task", id: target } : target;
  const res = await pave.query({
    [t.type]: {
      $: { id: t.id },
      comments: { $: { size: 5, where: [["message"], "like", `%${marker}%`] }, nodes: { id: {} } }
    }
  });
  return res[t.type]?.comments?.nodes?.[0]?.id ?? null;
}
async function postTaskMessage(pave, taskId, message, clientRef2, tagged = []) {
  return postMessage(pave, { type: "task", id: taskId }, message, clientRef2, tagged);
}
async function postMessage(pave, target, message, clientRef2, tagged = []) {
  const marker = clientRefMarker(clientRef2);
  if (marker && clientRef2) {
    const existing = await findCommentByRef(pave, target, clientRef2);
    if (existing) return existing;
  }
  const res = await pave.query({
    createComment: {
      $: {
        targetType: target.type,
        targetId: target.id,
        message: marker ? `${message}

${marker}` : message,
        ...COMMENT_VISIBILITY,
        ...tagged.length ? { assignees: tagged.map((membershipId) => ({ membershipId })) } : {}
      },
      createdComment: { id: {} }
    }
  });
  return res.createComment.createdComment?.id ?? "";
}
function findingMessage(report, byName) {
  const item = checklistItemByKey(report.itemKey);
  const fixed = report.fixedOnSite === true;
  const lines = [item ? item.subtask : `Problem report \u2014 ${report.location}`];
  const note = report.englishNote.trim();
  lines.push(fixed ? `\u2714 FIXED ON SITE${note ? ` \u2014 ${note}` : ""}` : `\u26A0 REPORT (punch item)${note ? ` \u2014 ${note}` : ""}`);
  if (item && report.location.trim() && report.location.trim() !== item.subtask) lines.push(`Where: ${report.location.trim()}`);
  if (fixed && report.materialsNote?.trim()) lines.push(`Materials & time: ${report.materialsNote.trim()}`);
  if (report.heardText?.trim()) lines.push(`Crew said (verbatim): "${report.heardText.trim()}"`);
  if (report.originalCrew?.trim()) lines.push(`Original work by: ${report.originalCrew.trim()}`);
  lines.push(`Reported by ${byName} via DB CheckOut`);
  return lines.join("\n");
}
async function attachFileToComment(pave, commentId, fileId) {
  const res = await pave.query({
    comment: { $: { id: commentId }, files: { $: { size: 10 }, nodes: { id: {}, file: { id: {} } } } }
  });
  const current = res.comment?.files.nodes ?? [];
  if (current.some((f) => f.file?.id === fileId)) return "already";
  await pave.query({
    updateComment: {
      $: {
        id: commentId,
        files: [...current.map((f) => ({ _type: "commentFile", id: f.id })), { _type: "file", id: fileId }]
      }
    }
  });
  return "attached";
}
function repairDoneMessage(note, byName) {
  const said = note?.trim();
  return [`\u2714 REPAIR DONE${said ? ` \u2014 ${said}` : ""}`, `Finished by ${byName} via DB CheckOut`].join("\n");
}
async function listTaskFiles(pave, taskId) {
  const res = await pave.query({
    task: {
      $: { id: taskId },
      files: {
        $: { size: 10, sortBy: [{ field: "createdAt", order: "desc" }] },
        nodes: { id: {}, name: {}, description: {}, createdAt: {} }
      }
    }
  });
  return res.task?.files.nodes ?? [];
}
function pickRepairPhotos(files, ref) {
  const byRef = (suffix) => {
    const marker = ref ? clientRefMarker(`${ref}${suffix}`) : null;
    return marker ? files.find((f) => (f.description ?? "").includes(marker))?.id : void 0;
  };
  const byName = (word) => files.find((f) => f.name.toUpperCase().startsWith(word))?.id;
  return { before: byRef(".b") ?? byName("BEFORE"), after: byRef(".a") ?? byName("AFTER") };
}
async function postRepairDone(pave, taskId, note, byName, clientRef2) {
  const commentId = await postTaskMessage(pave, taskId, repairDoneMessage(note, byName), clientRef2);
  if (!commentId) return { commentId, photos: 0 };
  const picked = pickRepairPhotos(await listTaskFiles(pave, taskId), clientRef2);
  let photos = 0;
  for (const fileId of [picked.before, picked.after]) {
    if (!fileId) continue;
    await attachFileToComment(pave, commentId, fileId);
    photos++;
  }
  return { commentId, photos };
}
function doneLine(description) {
  const prefix = "\u2714 Done \u2014 ";
  const lines = (description ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith(prefix));
  return lines.length ? lines[lines.length - 1].slice(prefix.length) : null;
}
var SUMMARY_PHOTOS_MAX = 10;
var REVIEW_ASK = "Check the work, then approve it on the Production Board (Close-out), or put it on a punch list there.";
var PUNCH_ASK = "Book the repair day on the Production Board (Close-out). Assigned repairs are already on their phones in Close Out.";
var areaLine = (label) => label ? [`Work area: ${label}`] : [];
var tagsFor = (reviewer) => reviewer?.membershipId ? [reviewer.membershipId] : [];
function pmReviewSummary(done, photosLinked, area) {
  const head = `\u{1F50D} READY FOR PM REVIEW \u2014 ${done.length} repair${done.length === 1 ? "" : "s"} finished`;
  const lines = done.map((t, i) => `${i + 1}. ${t.name} \u2014 ${doneLine(t.description) ?? "closed in JobTread, no finish note"}`);
  const photos = photosLinked === 0 ? "No after photos to link here; each repair's own messages carry what it has." : photosLinked < done.length ? `After photos for ${photosLinked} of the ${done.length} are linked here; every repair's own message carries its before and after.` : "The after photos are linked here; each repair's own message carries its before and after.";
  return [head, ...areaLine(area), ...lines, "", photos, REVIEW_ASK].join("\n").slice(0, 3900);
}
function summaryRef(done) {
  return `pmr-${fnv(done.map((t) => t.id).sort().join(","))}`;
}
function fnv(text) {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
async function postPmReviewSummary(pave, punchTasks, target, reviewer, area) {
  if (!target) return null;
  const done = punchTasks.filter((t) => t.progress >= 1);
  if (done.length === 0) return null;
  const ref = summaryRef(done);
  const already = await findCommentByRef(pave, target, ref);
  if (already) return already;
  const who = typeof reviewer === "function" ? await reviewer() : reviewer;
  const afters = [];
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
function reviewTarget(milestones) {
  return findPipelineTask(milestones, PIPELINE_TASKS.pmPunchReview) ?? findPipelineTask(milestones, PIPELINE_TASKS.finalInspection);
}
function inspectorOf(description) {
  const stamps = (description ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith(INSPECTED_STAMP));
  if (!stamps.length) return null;
  const rest = stamps[stamps.length - 1].slice(INSPECTED_STAMP.length);
  const end = rest.indexOf(` \u2014 ${CHECKLIST_STAMP}`);
  return (end >= 0 ? rest.slice(0, end) : rest).trim() || null;
}
async function listTaskMessages(pave, taskId) {
  const res = await pave.query({
    task: {
      $: { id: taskId },
      comments: { $: { size: 20, sortBy: [{ field: "createdAt", order: "desc" }] }, nodes: { message: {} } }
    }
  });
  return (res.task?.comments.nodes ?? []).map((c) => c.message ?? "");
}
function messageBody(message) {
  return message.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("DB CheckOut ref:") && !/^— .+ via DB CheckOut$/.test(l) && !/^Reported by .+ via DB CheckOut$/.test(l));
}
var NOTE_PREFIXES = ["Inspector notes:", "Attic access limitation", "Cleanup notes:"];
function visitExtras(messages) {
  const out = [];
  const fixed = [...messages].reverse().map(messageBody).filter((b) => b.some((l) => l.startsWith("\u2714 FIXED ON SITE"))).map((b) => {
    const said = b.find((l) => l.startsWith("\u2714 FIXED ON SITE")) ?? "";
    const note = said.replace(/^✔ FIXED ON SITE( — )?/, "");
    const where = b.find((l) => l.startsWith("Where: "));
    return `- ${b[0]}${note ? ` \u2014 ${note}` : ""}${where ? ` (${where.slice(7)})` : ""}`;
  });
  if (fixed.length) out.push("", "Fixed on site:", ...fixed);
  const notes = messages.find((m) => NOTE_PREFIXES.some((p) => m.trim().startsWith(p)));
  if (notes) out.push("", "Crew notes:", ...messageBody(notes));
  return out;
}
function inspectionReviewSummary(args) {
  const lines = ["\u{1F50D} READY FOR PM REVIEW \u2014 final inspection passed, no repairs needed", ...areaLine(args.area)];
  if (args.inspector) lines.push(`Inspected by ${args.inspector}`);
  const open = args.checklist.filter((s) => !s.isComplete);
  if (args.checklist.length) {
    lines.push(
      open.length === 0 ? `All ${args.checklist.length} checks passed` : `${args.checklist.length - open.length} of ${args.checklist.length} checks passed \u2014 left open: ${open.map((s) => s.name).join("; ")}`
    );
  }
  lines.push(...visitExtras(args.messages));
  lines.push(
    "",
    args.photosLinked ? "The visit photos are linked here." : "No visit photos came with the inspection.",
    REVIEW_ASK
  );
  return lines.join("\n").slice(0, 3900);
}
function reportNote(description) {
  return oneLine((description ?? "").split("\n\n")[0] ?? "", 160);
}
function punchListSummary(args) {
  const n = Math.max(args.open.length, args.reported);
  const lines = [`\u{1F6E0} PUNCH LIST TO SCHEDULE \u2014 the final inspection found ${n} thing${n === 1 ? "" : "s"} to repair`, ...areaLine(args.area)];
  if (args.inspector) lines.push(`Inspected by ${args.inspector}`);
  lines.push("");
  args.open.forEach((t, i) => {
    const note = reportNote(t.description);
    const who = t.assigneeNames.length ? `for ${t.assigneeNames.join(" and ")}` : "nobody assigned yet";
    lines.push(`${i + 1}. ${t.name.replace(/^REPORT:\s*/, "")}${note ? ` \u2014 ${note}` : ""} \u2014 ${who}`);
  });
  if (args.reported > args.open.length) {
    const more = args.reported - args.open.length;
    lines.push(`${more} more reported on the phone ${more === 1 ? "is" : "are"} still on the way and will show up as to-dos.`);
  }
  lines.push(...visitExtras(args.messages));
  lines.push(
    "",
    args.photosLinked ? "The problem photos are linked here." : "No problem photos have reached JobTread yet.",
    PUNCH_ASK
  );
  return lines.join("\n").slice(0, 3900);
}
function punchTarget(milestones) {
  return findPipelineTask(milestones, PIPELINE_TASKS.punchList) ?? findPipelineTask(milestones, PIPELINE_TASKS.finalInspection);
}
async function postPunchListSummary(pave, inspectionTask, open, reported, target, reviewer, area) {
  if (!target || open.length === 0 && reported === 0) return null;
  const ref = `pls-${fnv(inspectionTask?.id ?? open.map((t) => t.id).sort().join(","))}`;
  const already = await findCommentByRef(pave, target, ref);
  if (already) return already;
  const messages = inspectionTask ? await listTaskMessages(pave, inspectionTask.id) : [];
  const photos = [];
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
    area
  });
  const commentId = await postMessage(pave, target, message, ref, tagsFor(reviewer));
  if (!commentId) return null;
  for (const fileId of photos) await attachFileToComment(pave, commentId, fileId);
  return commentId;
}
async function postInspectionReviewSummary(pave, inspectionTask, target, reviewer, area) {
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
    area
  });
  const commentId = await postMessage(pave, target, message, ref, tagsFor(reviewer));
  if (!commentId) return null;
  for (const fileId of photos) await attachFileToComment(pave, commentId, fileId);
  return commentId;
}
async function closeInspectionTask(pave, taskId, visit, byName, clientRef2) {
  const res = await pave.query({
    task: { $: { id: taskId }, description: {}, subtasks: { name: {}, isComplete: {} } }
  });
  const current = (res.task?.subtasks ?? []).map((st) => ({
    name: st.name ?? "",
    isComplete: st.isComplete === true
  }));
  const subtasks = checklistSubtasks(visit, current);
  const note = inspectionNote(visit, byName);
  const existing = res.task?.description ?? "";
  const description = existing.includes(note) ? existing : existing ? `${existing}

${note}` : note;
  await pave.query({
    updateTask: {
      $: {
        id: taskId,
        ...TASK_WRITE_GUARDS,
        progress: 1,
        subtasks,
        description: description.slice(0, 4096)
      }
    }
  });
  const message = visitNotesMessage(visit, byName);
  if (message) await postTaskMessage(pave, taskId, message, clientRef2 ? `${clientRef2}.notes` : void 0);
}
function areaNotesMessage(notes, byName) {
  const said = notes?.trim();
  return said ? `Inspector notes: ${said}
\u2014 ${byName} via DB CheckOut` : null;
}
async function closeAreaInspection(pave, taskId, notes, byName, clientRef2) {
  const res = await pave.query({
    task: { $: { id: taskId }, description: {} }
  });
  const stamp = `${INSPECTED_STAMP}${byName} \u2014 ${CHECKLIST_STAMP}`;
  const existing = res.task?.description ?? "";
  const description = existing.includes(stamp) ? existing : existing ? `${existing}

${stamp}` : stamp;
  await pave.query({
    updateTask: { $: { id: taskId, ...TASK_WRITE_GUARDS, progress: 1, description: description.slice(0, 4096) } }
  });
  const message = areaNotesMessage(notes, byName);
  if (message) await postTaskMessage(pave, taskId, message, clientRef2 ? `${clientRef2}.notes` : void 0);
}
async function syncInspectionChecklist(pave, task, punchTasks) {
  if (!task || task.subtasks.length === 0) return "none";
  const doneCodes = new Set(
    punchTasks.filter((t) => t.progress >= 1).map((t) => ITEM_MARKER.exec(t.description ?? "")?.[1]).filter((code) => Boolean(code))
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
async function syncPunchListTask(pave, task, punchTasks, opts = {}) {
  if (!task) return "none";
  const complete = task.progress >= 1;
  if (punchTasks.length === 0) {
    if (!opts.cleanInspection || complete) return "unchanged";
    const note = `\u2714 Not required \u2014 clean inspection, nothing to fix (${CHECKLIST_STAMP})`;
    const res = await pave.query({
      task: { $: { id: task.id }, description: {} }
    });
    const existing = res.task?.description ?? "";
    const description = existing.includes(note) ? existing : existing ? `${existing}

${note}` : note;
    await pave.query({
      updateTask: { $: { id: task.id, ...TASK_WRITE_GUARDS, progress: 1, description: description.slice(0, 4096) } }
    });
    return "updated";
  }
  const desired = punchTasks.map((t) => ({ name: t.name, isComplete: t.progress >= 1 }));
  const allDone = desired.every((s) => s.isComplete);
  const same = task.subtasks.length === desired.length && task.subtasks.every((s, i) => s.name === desired[i].name && s.isComplete === desired[i].isComplete);
  if (same && (complete || !allDone)) return "unchanged";
  await pave.query({
    updateTask: {
      $: {
        id: task.id,
        ...TASK_WRITE_GUARDS,
        subtasks: desired,
        ...allDone && !complete ? { progress: 1 } : {}
      }
    }
  });
  return "updated";
}
var CLIENT_REF = /^[A-Za-z0-9._-]{1,64}$/;
function clientRefMarker(ref) {
  return ref && CLIENT_REF.test(ref) ? `DB CheckOut ref: ${ref}` : null;
}
async function findTaskByRef(pave, jobId, ref) {
  const marker = clientRefMarker(ref);
  if (!marker) return null;
  const res = await pave.query({
    job: {
      $: { id: jobId },
      tasks: { $: { size: 5, where: [["description"], "like", `%${marker}%`] }, nodes: { id: {} } }
    }
  });
  return res.job?.tasks.nodes[0]?.id ?? null;
}
async function findFileByRef(pave, targetType, targetId, ref) {
  const marker = clientRefMarker(ref);
  if (!marker) return null;
  const res = await pave.query({
    [targetType]: {
      $: { id: targetId },
      files: { $: { size: 5, where: [["description"], "like", `%${marker}%`] }, nodes: { id: {} } }
    }
  });
  return res[targetType]?.files.nodes[0]?.id ?? null;
}
async function createReportTask(pave, jobId, report, clientRef2, assignedMembershipIds = [], area) {
  const marker = clientRefMarker(clientRef2);
  if (marker && clientRef2) {
    const existing = await findTaskByRef(pave, jobId, clientRef2);
    if (existing) return existing;
  }
  const fixed = report.fixedOnSite === true;
  const lines = [report.englishNote];
  if (fixed) lines.push("\u2714 Corrected on site during the visit.");
  if (report.materialsNote) lines.push(`Materials & time: ${report.materialsNote}`);
  if (report.heardText) lines.push(`Crew said (verbatim): "${report.heardText}"`);
  if (report.originalCrew) lines.push(`Original work by: ${report.originalCrew}`);
  if (report.reportedBy) lines.push(`Reported by: ${report.reportedBy}`);
  if (area) lines.push(areaTagLine(area, report.reportedBy || "the crew"));
  const item = checklistItemByKey(report.itemKey);
  if (item) lines.push(`Checklist: ${item.subtask}
DB CheckOut item: ${item.code}`);
  if (marker) lines.push(marker);
  const res = await pave.query({
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
        ...fixed ? { progress: 1 } : {},
        ...assignedMembershipIds.length > 0 ? { assignedMembershipIds: [...assignedMembershipIds] } : {}
      },
      createdTask: { id: {} }
    }
  });
  return res.createTask.createdTask?.id ?? "";
}
async function completeTask(pave, taskId, note) {
  const trimmed = note?.trim();
  if (!trimmed) {
    await pave.query({ updateTask: { $: { id: taskId, ...TASK_WRITE_GUARDS, progress: 1 } } });
    return;
  }
  const res = await pave.query({
    task: { $: { id: taskId }, description: {} }
  });
  const done = `\u2714 Done \u2014 ${trimmed}`;
  const existing = res.task?.description ?? "";
  const description = existing.includes(done) ? existing : existing ? `${existing}

${done}` : done;
  await pave.query({
    updateTask: {
      $: { id: taskId, ...TASK_WRITE_GUARDS, progress: 1, description: description.slice(0, 4096) }
    }
  });
}
function officeTime(iso) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(iso));
}
function officeStamp(iso) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(iso));
  const v = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")} ${v("hour")}:${v("minute")}`;
}
function photoFileWords(photo, marker, now = /* @__PURE__ */ new Date()) {
  const head = photo.title ?? photo.label;
  if (!photo.fromPhone) {
    const stamp = now.toISOString().slice(0, 16).replace("T", " ");
    return {
      name: `${head} ${stamp} \u2014 ${photo.byName}`,
      description: `Uploaded from DB CheckOut by ${photo.byName}${marker ? ` \xB7 ${marker}` : ""}`
    };
  }
  const taken = photo.takenAt ? ` (from phone, taken ${officeStamp(photo.takenAt)})` : " (from phone, time unknown)";
  const said = photo.takenAt ? `picked from the phone's photos, taken ${officeTime(photo.takenAt)}` : "picked from the phone's photos, time taken unknown";
  return {
    name: `${head}${taken} \u2014 ${photo.byName}`,
    description: `Uploaded from DB CheckOut by ${photo.byName} \xB7 ${said}${marker ? ` \xB7 ${marker}` : ""}`
  };
}
async function uploadPhoto(pave, jobId, photo, fetchImpl = fetch) {
  const targetType = photo.taskId ? "task" : "job";
  const targetId = photo.taskId ?? jobId;
  const marker = clientRefMarker(photo.clientRef);
  if (marker && photo.clientRef) {
    const existing = await findFileByRef(pave, targetType, targetId, photo.clientRef);
    if (existing) return existing;
  }
  const up = await pave.query({
    createUploadRequest: {
      $: { organizationId: ORGANIZATION_ID, size: photo.data.length, type: photo.contentType },
      createdUploadRequest: { id: {}, url: {}, method: {}, headers: {} }
    }
  });
  const request = up.createUploadRequest.createdUploadRequest;
  if (!request) throw new Error("JobTread did not return an upload request");
  const sent = await fetchImpl(request.url, {
    method: request.method,
    headers: request.headers,
    body: new Uint8Array(photo.data)
  });
  if (!sent.ok) throw new Error(`Photo upload failed: ${sent.status}`);
  const words = photoFileWords(photo, marker);
  const res = await pave.query({
    createFile: {
      $: {
        targetId,
        targetType,
        name: words.name,
        uploadRequestId: request.id,
        description: words.description
      },
      createdFile: { id: {} }
    }
  });
  return res.createFile.createdFile?.id ?? "";
}
async function setJobStatus(pave, jobId, status) {
  await pave.query({
    updateJob: {
      $: { id: jobId, customFieldValues: { [CUSTOM_FIELDS.status]: status } }
    }
  });
}
function checklistItemTitle(itemKey) {
  const item = checklistItemByKey(itemKey);
  return item ? oneLine(item.subtask, 60) : void 0;
}

// apps/sync/src/pmReview.ts
function shouldFlipToPmReview(currentStatus, tasks) {
  if (currentStatus !== STATUS.punchList) return false;
  if (tasks.length === 0) return false;
  return tasks.every((t) => t.progress >= 1);
}

// apps/sync/src/pipeline.ts
function openProblemCount(input) {
  const open = input.punchTasks.filter((t) => t.progress < 1).length;
  return Math.max(open, input.problemsReported);
}
function nextPipelineStatus(input) {
  if (input.currentStatus === STATUS.pmReview && input.checkOffDone) return STATUS.jobCompleted;
  if (shouldFlipToPmReview(input.currentStatus, input.punchTasks)) return STATUS.pmReview;
  if (input.currentStatus === STATUS.finalInspection && input.inspectionDone) {
    return openProblemCount(input) > 0 ? STATUS.punchList : STATUS.pmReview;
  }
  return null;
}
async function applyLinear(pave, basics, board, opts = {}) {
  const jobId = basics.id;
  const currentStatus = basics.status;
  const inPipeline = currentStatus === STATUS.finalInspection || currentStatus === STATUS.punchList || currentStatus === STATUS.pmReview;
  if (!inPipeline) return { flipped: null, reviewer: null };
  const needsPunch = currentStatus !== STATUS.pmReview;
  const [punchTasks, milestones] = await Promise.all([
    needsPunch ? listPunchTasks(pave, jobId) : Promise.resolve([]),
    listPipelineTasks(pave, jobId)
  ]);
  const problemsReported = opts.problemsReported ?? 0;
  const inspection = findPipelineTask(milestones, PIPELINE_TASKS.finalInspection);
  const input = {
    currentStatus,
    inspectionDone: isInspectionClosed(inspection),
    checkOffDone: (findPipelineTask(milestones, PIPELINE_TASKS.finalCheckOff)?.progress ?? 0) >= 1,
    punchTasks,
    problemsReported
  };
  const next = nextPipelineStatus(input);
  if (needsPunch) {
    await syncChecklists(
      pave,
      { jobId, basics, areas: [], line: null, punch: punchTasks, milestones },
      problemsReported,
      currentStatus === STATUS.finalInspection && input.inspectionDone
    );
  }
  if (!next) return { flipped: null, reviewer: null };
  await setJobStatus(pave, jobId, next);
  let reviewer = null;
  try {
    const answer = board ? await board.closeout({ jobId, move: false, actor: opts.actor }) : null;
    reviewer = reviewerOf(answer, null);
    const review = reviewTarget(milestones);
    const asTask = (t) => t ? { type: "task", id: t.id } : void 0;
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
async function readCloseoutState(pave, jobId, basics) {
  const job = basics ?? await getJobBasics(pave, jobId);
  if (!job) return null;
  const [punch, milestones] = await Promise.all([listPunchTasks(pave, jobId), listPipelineTasks(pave, jobId)]);
  const areas = jobAreas(job);
  return { jobId, basics: job, areas, line: lineArea(areas), punch, milestones };
}
function punchFor(state, area) {
  return state.punch.filter((t) => areaOfPunch(t, state.areas) === area);
}
function areaInspectionTaskOf(milestones, area, line) {
  if (area === null || area === line) return findPipelineTask(milestones, PIPELINE_TASKS.finalInspection);
  return milestones.find((t) => areaOfInspectionName(t.name) === area);
}
function summaryTargets(state, area) {
  if (area === null || area === state.line) {
    const asTask = (t) => t ? { type: "task", id: t.id } : void 0;
    return { review: asTask(reviewTarget(state.milestones)), punch: asTask(punchTarget(state.milestones)) };
  }
  const job = { type: "job", id: state.jobId };
  return { review: job, punch: job };
}
function reviewerOf(answer, area) {
  const found = answer?.areas.find((a) => a.area === area);
  if (found) return found.reviewer;
  if (area === null && answer?.pm) return answer.pm;
  return fallbackReviewer(area);
}
var areaLabel = (state, area) => state.areas.length > 1 && area ? AREA_LABEL[area] : null;
function areaApproved(milestones, area) {
  return area !== null && milestones.some((t) => areaOfReviewName(t.name) === area && t.progress >= 1);
}
async function syncChecklists(pave, state, problemsReported = 0, closed) {
  const inspection = findPipelineTask(state.milestones, PIPELINE_TASKS.finalInspection);
  try {
    await syncPunchListTask(pave, findPipelineTask(state.milestones, PIPELINE_TASKS.punchList), state.punch, {
      // Only on a one-area job: a clean roof says nothing about gutters still to hang.
      cleanInspection: state.areas.length <= 1 && (closed ?? isInspectionClosed(inspection)) && openProblemCount({ punchTasks: state.punch, problemsReported }) === 0
    });
    await syncInspectionChecklist(pave, inspection, state.punch);
  } catch (err) {
    console.warn(`checklists not updated for ${state.jobId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
async function postRepairSummaries(pave, state, reviewer) {
  const posted = [];
  const groups = [...state.areas, null];
  for (const area of groups) {
    const tasks = punchFor(state, area);
    if (tasks.length === 0 || tasks.some((t) => t.progress < 1)) continue;
    const who = area ?? state.line;
    if (areaApproved(state.milestones, who)) continue;
    try {
      const id = await postPmReviewSummary(
        pave,
        tasks,
        summaryTargets(state, who).review,
        () => reviewer(who),
        areaLabel(state, area)
      );
      if (id) posted.push(id);
    } catch (err) {
      console.warn(`repair summary not posted on ${state.jobId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return posted;
}
function boardOnce(board, jobId, actor) {
  let pending = null;
  return () => pending ??= board ? board.closeout({ jobId, move: false, actor }) : Promise.resolve(null);
}
async function applyPipeline(pave, jobId, board) {
  const basics = await getJobBasics(pave, jobId);
  if (!basics) return null;
  if (jobAreas(basics).length === 0) return (await applyLinear(pave, basics, board)).flipped;
  if (basics.status !== STATUS.finalInspection && basics.status !== STATUS.punchList) return null;
  const state = await readCloseoutState(pave, jobId, basics);
  if (!state) return null;
  await syncChecklists(pave, state);
  const ask = boardOnce(board, jobId);
  await postRepairSummaries(pave, state, async (area) => reviewerOf(await ask(), area));
  return null;
}
async function afterInspection(pave, board, args) {
  const basics = await getJobBasics(pave, args.jobId);
  if (!basics) return { flipped: null, reviewer: null };
  if (jobAreas(basics).length === 0) {
    return applyLinear(pave, basics, board, { problemsReported: args.problemsReported, actor: args.actor });
  }
  const state = await readCloseoutState(pave, args.jobId, basics);
  if (!state) return { flipped: null, reviewer: null };
  const area = args.area ?? state.line;
  await syncChecklists(pave, state, area === state.line ? args.problemsReported : 0);
  const answer = board ? await board.closeout({ jobId: args.jobId, move: true, problemsReported: args.problemsReported, area, actor: args.actor }) : null;
  const reviewer = reviewerOf(answer, area);
  const inspection = areaInspectionTaskOf(state.milestones, area, state.line);
  const open = punchFor(state, area).filter((t) => t.progress < 1);
  const targets = summaryTargets(state, area);
  const label = areaLabel(state, area);
  let posted = null;
  try {
    posted = openProblemCount({ punchTasks: open, problemsReported: args.problemsReported }) > 0 ? await postPunchListSummary(pave, inspection, open, args.problemsReported, targets.punch, reviewer, label) : await postInspectionReviewSummary(pave, inspection, targets.review, reviewer, label);
  } catch (err) {
    console.warn(`inspection summary not posted on ${args.jobId}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { flipped: answer?.moved?.to ?? null, reviewer: posted ? reviewer?.name ?? null : null };
}
async function afterRepair(pave, board, args) {
  const basics = await getJobBasics(pave, args.jobId);
  if (!basics) return { flipped: null, reviewer: null };
  if (jobAreas(basics).length === 0) return applyLinear(pave, basics, board, { actor: args.actor });
  const state = await readCloseoutState(pave, args.jobId, basics);
  if (!state) return { flipped: null, reviewer: null };
  await syncChecklists(pave, state);
  const answer = board ? await board.closeout({ jobId: args.jobId, move: true, actor: args.actor }) : null;
  const names = [];
  const posted = await postRepairSummaries(pave, state, async (area) => {
    const r = reviewerOf(answer, area);
    if (r) names.push(r.name);
    return r;
  });
  return { flipped: answer?.moved?.to ?? null, reviewer: posted.length ? names[0] ?? null : null };
}

// apps/sync/src/translate.ts
var GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
var TRANSLATE_LIMITS = { maxTexts: 100, maxTextLength: 4e3 };
var PROMPTS = {
  es: "Translate each string in the JSON array from English to Latin American Spanish for a roofing/construction field crew. Keep brand names, product names, model numbers, measurements and numbers unchanged. Keep it natural and concise. Return ONLY a JSON array of the translated strings, same length, same order.",
  // The other direction: a note a crew member dictated or typed in Spanish
  // (or a mix), made into the clean English the office reads. Same rules.
  en: "Each string in the JSON array is a field note from a roofing/construction crew member, in Spanish, English or a mix. Rewrite each as clear, concise English for the office. Keep brand names, product names, model numbers, measurements and numbers unchanged. A string already in English is returned cleaned up, not changed in meaning. Return ONLY a JSON array of the strings, same length, same order."
};
var caches = { es: /* @__PURE__ */ new Map(), en: /* @__PURE__ */ new Map() };
var discoveredModel = null;
async function discoverModel(apiKey, fetchImpl) {
  const res = await fetchImpl(`${GEMINI_URL}?pageSize=200`, {
    headers: { "x-goog-api-key": apiKey }
  });
  if (!res.ok) throw new Error(`Gemini model list failed: ${res.status}`);
  const body = await res.json();
  const usable = (body.models ?? []).filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => String(m.name ?? "").replace(/^models\//, "")).filter(Boolean);
  const score = (name) => {
    const version = Number(/gemini-(\d+(?:\.\d+)?)/.exec(name)?.[1] ?? 0);
    let points = version * 100;
    if (name.includes("flash")) points += 40;
    if (/preview|exp|image|tts|live|audio|embedding|thinking/.test(name)) points -= 500;
    if (name.includes("lite")) points += 20;
    return points;
  };
  const best = [...usable].sort((a, b) => score(b) - score(a))[0];
  if (!best) throw new Error("No usable Gemini model on this key");
  return best;
}
var THINKING_VARIANTS = [
  { thinkingLevel: "low" },
  { thinkingBudget: 0 },
  null
];
var workingVariant = 0;
var GEMINI_CALL_TIMEOUT_MS = 45e3;
async function geminiGenerate(prompt, env, fetchImpl, audio) {
  const parts = [
    ...audio ? [{ inlineData: { mimeType: audio.mimeType, data: audio.base64 } }] : [],
    { text: prompt }
  ];
  const attempt = async (model2, variant) => {
    try {
      return await fetchImpl(`${GEMINI_URL}/${model2}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": env.geminiApiKey },
        signal: AbortSignal.timeout(GEMINI_CALL_TIMEOUT_MS),
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
            maxOutputTokens: 8192,
            ...variant ? { thinkingConfig: variant } : {}
          }
        })
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(`Gemini timed out after ${GEMINI_CALL_TIMEOUT_MS / 1e3}s (${model2})`);
      }
      throw err;
    }
  };
  const tryModel = async (model2) => {
    let res2 = await attempt(model2, THINKING_VARIANTS[workingVariant]);
    for (let i = workingVariant + 1; res2.status === 400 && i < THINKING_VARIANTS.length; i++) {
      res2 = await attempt(model2, THINKING_VARIANTS[i]);
      if (res2.status !== 400) workingVariant = i;
    }
    return res2;
  };
  let model = discoveredModel ?? env.geminiModel;
  let res = await tryModel(model);
  if (res.status === 404 || res.status === 400) {
    model = await discoverModel(env.geminiApiKey, fetchImpl);
    discoveredModel = model;
    res = await tryModel(model);
  }
  if (!res.ok) throw new Error(`Gemini request failed: ${res.status} (${model})`);
  const body = await res.json();
  return body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
async function geminiTranslate(texts, env, fetchImpl, to = "es") {
  const raw = await geminiGenerate(`${PROMPTS[to]}

${JSON.stringify(texts)}`, env, fetchImpl);
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length !== texts.length) {
    throw new Error("Gemini returned a mismatched translation array");
  }
  return parsed.map((t, i) => typeof t === "string" && t ? t : texts[i]);
}
var SUMMARY_PROMPT = 'You write for a roofing/construction field crew about to inspect a finished job. Given the sold scope below (documents and line items), write a short summary of the work that was sold: 2-4 plain sentences, main work first, then notable extras/change orders. No prices. Keep brand/product names and measurements as-is. Return ONLY JSON: {"en": "<English summary>", "es": "<Latin American Spanish summary>"}';
var summaryCache = /* @__PURE__ */ new Map();
async function summarizeScope(scopeText, env, fetchImpl = fetch) {
  if (!env.geminiApiKey) throw new Error("Summaries are not configured");
  const hit = summaryCache.get(scopeText);
  if (hit) return hit;
  const raw = await geminiGenerate(`${SUMMARY_PROMPT}

${scopeText}`, env, fetchImpl);
  const parsed = JSON.parse(raw);
  if (typeof parsed.en !== "string" || typeof parsed.es !== "string") {
    throw new Error("Gemini returned a malformed summary");
  }
  const summary = { en: parsed.en, es: parsed.es };
  summaryCache.set(scopeText, summary);
  return summary;
}
var TRANSCRIBE_PROMPT = 'The audio is a roofing/construction field crew member dictating an inspection note, in Spanish or English (possibly mixed). Transcribe it, then produce a clean, professional English version of the note for the office record. Fix obvious dictation stumbles; keep every factual detail. Return ONLY JSON: {"original": "<verbatim transcription>", "en": "<clean English note>"}';
async function transcribeNote(audio, env, fetchImpl = fetch) {
  if (!env.geminiApiKey) throw new Error("Transcription is not configured");
  const raw = await geminiGenerate(TRANSCRIBE_PROMPT, env, fetchImpl, audio);
  const parsed = JSON.parse(raw);
  if (typeof parsed.en !== "string" || !parsed.en) {
    throw new Error("Gemini returned a malformed transcription");
  }
  return {
    original: typeof parsed.original === "string" ? parsed.original : parsed.en,
    en: parsed.en
  };
}
async function translateTexts(texts, to, env, fetchImpl = fetch) {
  if (!env.geminiApiKey) throw new Error("Translation is not configured");
  const cache = caches[to];
  const missing = [...new Set(texts.filter((t) => !cache.has(t)))];
  if (missing.length > 0) {
    const translated = await geminiTranslate(missing, env, fetchImpl, to);
    missing.forEach((t, i) => cache.set(t, translated[i]));
  }
  return texts.map((t) => cache.get(t) ?? t);
}

// apps/sync/src/routes.ts
function bearerToken(req) {
  const header = req.headers["authorization"];
  if (typeof header !== "string") return "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}
var headerValue = (req, name) => {
  const header = req.headers[name];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === "string" ? value.trim() : "";
};
function actingUser(req, deps) {
  const bearer = bearerToken(req);
  if (!bearer) return null;
  if (deps.crewAppSecret && bearer === deps.crewAppSecret) {
    const email = headerValue(req, "x-acting-email").toLowerCase();
    if (!email) return null;
    try {
      return assertAllowedIdentity(
        { email, email_verified: true, name: headerValue(req, "x-acting-name") || void 0 },
        deps.workspaceDomain,
        deps.allowedEmails
      );
    } catch {
      return null;
    }
  }
  return deps.sessionSecret ? verifySession(deps.sessionSecret, bearer) : null;
}
function clientRef(req) {
  const header = req.headers["x-client-ref"];
  const value = Array.isArray(header) ? header[0] : header;
  return value && clientRefMarker(value) ? value : void 0;
}
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
var stringMap = (value) => {
  if (!value || typeof value !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
};
function parseVisit(body) {
  const answers = body.answers ?? {};
  const nested = typeof answers["inspection"] === "object" || typeof answers["cleanup"] === "object";
  const notes = stringMap(body.notes);
  const findings = Array.isArray(body.findings) ? body.findings.filter((f) => Boolean(f) && typeof f === "object").filter((f) => typeof f["itemKey"] === "string").map((f) => ({
    itemKey: String(f["itemKey"]),
    fixedOnSite: f["fixedOnSite"] === true,
    location: typeof f["location"] === "string" ? f["location"] : "",
    note: typeof f["note"] === "string" ? f["note"] : "",
    photos: typeof f["photos"] === "number" && f["photos"] > 0 ? Math.floor(f["photos"]) : 0
  })) : [];
  return {
    inspection: nested ? stringMap(answers["inspection"]) : stringMap(answers),
    cleanup: nested ? stringMap(answers["cleanup"]) : {},
    notes: { inspection: notes["inspection"], attic: notes["attic"], cleanup: notes["cleanup"] },
    findings
  };
}
var PHOTO_LABELS = /* @__PURE__ */ new Set(["BEFORE", "AFTER", "REPORT", "INSPECTION"]);
function decodeAudio(audioBase64) {
  if (typeof audioBase64 !== "string" || !audioBase64) {
    return { error: "audioBase64 must be a data URI string" };
  }
  const dataUri = /^data:([\w/+.;=-]*);base64,(.*)$/s.exec(audioBase64);
  if (!dataUri) return { error: `expected a base64 data URI (got "${audioBase64.slice(0, 40)}\u2026")` };
  const bare = dataUri[1].split(";")[0].toLowerCase();
  const mimeType = bare.startsWith("audio/") ? bare : bare === "video/webm" ? "audio/webm" : bare === "video/mp4" || bare === "" || bare === "application/octet-stream" ? "audio/mp4" : null;
  if (!mimeType) return { error: `expected an audio recording (got "${bare}")` };
  if (dataUri[2].length === 0) return { error: "the recording is empty" };
  if (dataUri[2].length > 56e5) return { error: "the recording is too long to send (~4MB max)" };
  return { mimeType, base64: dataUri[2] };
}
var MAX_PHOTO_BYTES = 4e6;
function photoOrigin(body, now = /* @__PURE__ */ new Date()) {
  const fromPhone = body.source === "phone";
  if (!fromPhone || typeof body.takenAt !== "string" || !body.takenAt) return { fromPhone };
  const t = new Date(body.takenAt).getTime();
  if (!Number.isFinite(t) || t < Date.UTC(2e3, 0, 1) || t > now.getTime() + 864e5) return { fromPhone };
  return { fromPhone, takenAt: new Date(t).toISOString() };
}
var oneLineTitle = (text) => {
  const flat2 = text.replace(/\s+/g, " ").trim();
  return flat2.length > 60 ? `${flat2.slice(0, 59)}\u2026` : flat2;
};
function decodePhoto(imageBase64) {
  if (typeof imageBase64 !== "string" || !imageBase64) return null;
  let contentType = "image/jpeg";
  let b64 = imageBase64;
  const dataUri = /^data:([\w/+.-]+);base64,(.*)$/s.exec(imageBase64);
  if (dataUri) {
    contentType = dataUri[1];
    b64 = dataUri[2];
  }
  if (!contentType.startsWith("image/")) return null;
  try {
    const data = Buffer.from(b64, "base64");
    if (data.length === 0 || data.length > MAX_PHOTO_BYTES) return null;
    return { data, contentType };
  } catch {
    return null;
  }
}
var ASSIGNED_STATUSES = [
  STATUS.preProduction,
  STATUS.production,
  STATUS.finalInspection,
  STATUS.punchList,
  STATUS.pmReview,
  STATUS.repReview
];
function areaOf(value, areas) {
  return isAreaKey(value) && areas.includes(value) ? value : null;
}
function createHandler(deps) {
  return async function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, {
          ok: true,
          signIn: Boolean(deps.googleClientId && deps.sessionSecret),
          gemini: Boolean(deps.geminiApiKey),
          webhook: Boolean(deps.webhookSecret),
          crewApp: Boolean(deps.crewAppSecret),
          board: Boolean(deps.board)
        });
      }
      if (req.method === "GET" && url.pathname === "/auth/config") {
        return json(res, 200, { googleClientId: deps.googleClientId || null });
      }
      if (req.method === "POST" && url.pathname === "/auth/google") {
        if (!deps.googleClientId || !deps.sessionSecret) {
          return json(res, 501, { error: "Google sign-in is not configured on the server" });
        }
        const body = await readBody(req);
        if (typeof body.credential !== "string" || !body.credential) {
          return json(res, 400, { error: "credential is required" });
        }
        try {
          const verify = deps.verifyGoogle ?? verifyGoogleCredential;
          const payload = await verify(body.credential, deps.googleClientId);
          const user = assertAllowedIdentity(payload, deps.workspaceDomain, deps.allowedEmails);
          const token = mintSession(deps.sessionSecret, user);
          return json(res, 200, { token, name: user.name, email: user.email });
        } catch {
          return json(res, 401, { error: "This Google account is not allowed" });
        }
      }
      if (req.method === "POST" && parts[0] === "webhooks" && parts[1] === "jobtread") {
        if (!deps.webhookSecret || parts[2] !== deps.webhookSecret) {
          return json(res, 401, { error: "Bad webhook token" });
        }
        const body = await readBody(req);
        const jobId = extractJobId(body);
        console.log(`jobtread webhook ${describeWebhook(body)} jobId=${jobId ?? "-"}`);
        let flipped = null;
        if (jobId) {
          try {
            flipped = await applyPipeline(deps.pave, jobId, deps.board);
          } catch (err) {
            console.warn(
              `pipeline check skipped for ${jobId}: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
        return json(res, 200, { ok: true, flipped });
      }
      const session = actingUser(req, deps);
      if (!session) return json(res, 401, { error: "Unauthorized" });
      if (req.method === "POST" && url.pathname === "/transcribe") {
        if (!deps.geminiApiKey) return json(res, 501, { error: "Transcription is not configured" });
        const body = await readBody(req, 6e6);
        const audio = decodeAudio(body.audioBase64);
        if ("error" in audio) return json(res, 400, { error: audio.error });
        return json(res, 200, await transcribeNote(audio, deps));
      }
      if (req.method === "POST" && url.pathname === "/translate") {
        if (!deps.geminiApiKey) return json(res, 501, { error: "Translation is not configured" });
        const body = await readBody(req);
        const to = body.to === "en" ? "en" : "es";
        const texts = Array.isArray(body.texts) ? body.texts.filter((t) => typeof t === "string" && t.length > 0) : [];
        if (texts.length === 0 || texts.length > TRANSLATE_LIMITS.maxTexts || texts.some((t) => t.length > TRANSLATE_LIMITS.maxTextLength)) {
          return json(res, 400, { error: "texts must be 1-100 strings, each under 4000 chars" });
        }
        const translations = await translateTexts(texts, to, deps);
        return json(res, 200, { translations });
      }
      if (req.method === "GET" && url.pathname === "/queue") {
        const [jobs, assigned] = await Promise.all([
          listPipelineJobs(deps.pave),
          listAssignedWorkByJob(deps.pave, session)
        ]);
        for (const job of jobs) {
          const work = assigned.get(job.id);
          if (work) {
            job.mine = work.any;
            job.openPunchCount = work.punchOpen;
            job.booked = work.booked;
          }
        }
        const listed = new Set(jobs.map((j) => j.id));
        const others = [...assigned.entries()].filter(([id, w]) => w.any && !listed.has(id)).map(([id]) => id);
        let extra = [];
        if (others.length) {
          try {
            extra = (await listJobsByIds(deps.pave, others.slice(0, 30))).filter((j) => ASSIGNED_STATUSES.includes(j.status)).map((j) => ({
              ...j,
              mine: true,
              openPunchCount: assigned.get(j.id)?.punchOpen ?? 0,
              booked: assigned.get(j.id)?.booked ?? []
            }));
          } catch (err) {
            console.warn(`assigned jobs outside the pipeline not listed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return json(res, 200, [...jobs, ...extra].sort((a, b) => a.number.localeCompare(b.number)));
      }
      if (req.method === "GET" && parts[0] === "jobs" && parts.length === 2) {
        return json(res, 200, await getJob(deps.pave, parts[1], session ?? void 0));
      }
      if (req.method === "GET" && parts[0] === "jobs" && parts[2] === "scope-summary") {
        if (!deps.geminiApiKey) return json(res, 501, { error: "Summaries are not configured" });
        const scope = await listSoldScope(deps.pave, parts[1]);
        if (scope.length === 0) return json(res, 200, { en: "", es: "" });
        const scopeText = scope.map((d) => {
          const lines = d.lines.slice(0, 40);
          const extra = d.lines.length - lines.length;
          return `${d.name}${d.number ? ` #${d.number}` : ""} (${d.issueDate ?? "no date"}):
` + lines.map((l) => `- ${l.name}${l.quantity ? ` (${l.quantity} ${l.unit ?? ""})` : ""}`).join("\n") + (extra > 0 ? `
- (+${extra} more items)` : "");
        }).join("\n\n");
        try {
          return json(res, 200, await summarizeScope(scopeText, deps));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return json(res, 502, { error: `summary generation: ${message}` });
        }
      }
      if (req.method === "POST" && parts[0] === "jobs" && parts.length === 3) {
        const jobId = parts[1];
        if (parts[2] === "inspection" || parts[2] === "cleanup") {
          return json(res, 410, {
            error: "Checklist forms were retired \u2014 the visit is sent through close-inspection"
          });
        }
        if (parts[2] === "close-inspection") {
          const body = await readBody(req);
          const problemsReported = typeof body.problemsReported === "number" && body.problemsReported > 0 ? Math.floor(body.problemsReported) : 0;
          const milestones = await listPipelineTasks(deps.pave, jobId);
          const task = findPipelineTask(milestones, PIPELINE_TASKS.finalInspection);
          if (task) {
            await closeInspectionTask(deps.pave, task.id, parseVisit(body), session.name, clientRef(req));
          }
          const outcome = await afterInspection(deps.pave, deps.board, { jobId, area: null, problemsReported, actor: session.name });
          return json(res, 200, { completedTaskId: task?.id ?? null, flipped: outcome.flipped, sentTo: outcome.reviewer });
        }
        if (parts[2] === "close-area-inspection") {
          const body = await readBody(req);
          const basics = await getJobBasics(deps.pave, jobId);
          if (!basics) return json(res, 404, { error: "JobTread has no job with that id" });
          const areas = jobAreas(basics);
          const area = areaOf(body.area, areas);
          if (!area) {
            return json(res, 400, {
              error: `area must be one of this job's work areas (${areas.length ? areas.join(", ") : "it has none"})`
            });
          }
          const problemsReported = typeof body.problemsReported === "number" && body.problemsReported > 0 ? Math.floor(body.problemsReported) : 0;
          const notes = typeof body.notes === "string" ? body.notes.slice(0, 4e3) : void 0;
          const line = lineArea(areas);
          const ref = clientRef(req);
          let taskId = areaInspectionTaskOf(await listPipelineTasks(deps.pave, jobId), area, line)?.id;
          if (!taskId) taskId = await createAreaInspection(deps.pave, jobId, area, line, ref);
          await closeAreaInspection(deps.pave, taskId, notes, session.name, ref);
          const outcome = await afterInspection(deps.pave, deps.board, { jobId, area, problemsReported, actor: session.name });
          return json(res, 200, { completedTaskId: taskId, flipped: outcome.flipped, sentTo: outcome.reviewer });
        }
        if (parts[2] === "reports") {
          const report = await readBody(req);
          if (!report.location || !report.englishNote) {
            return json(res, 400, { error: "location and englishNote are required" });
          }
          const ref = clientRef(req);
          let basics = null;
          try {
            basics = await getJobBasics(deps.pave, jobId);
          } catch {
          }
          const areas = basics ? jobAreas(basics) : [];
          const line = lineArea(areas);
          const area = areaOf(report.area, areas) ?? line;
          let assignTo = [];
          if (report.fixedOnSite !== true) {
            const back = basics?.status === STATUS.pmReview || basics?.status === STATUS.repReview;
            const answer = deps.board && areas.length ? await deps.board.closeout({ jobId, move: back, repairs: true, problemsReported: 1, area, actor: session.name }) : null;
            const fromBoard = answer?.areas.find((a) => a.area === area);
            assignTo = fromBoard ? fromBoard.crew : fallbackRepairCrew(area, basics ? isRoofingJob(basics) : false);
          }
          const id = await createReportTask(
            deps.pave,
            jobId,
            { ...report, reportedBy: session.name },
            ref,
            assignTo,
            area && area !== line ? area : null
          );
          let commentId = null;
          try {
            const inspection = areaInspectionTaskOf(await listPipelineTasks(deps.pave, jobId), area, line);
            if (inspection) {
              commentId = await postTaskMessage(deps.pave, inspection.id, findingMessage(report, session.name), ref);
            }
          } catch (err) {
            console.warn(`finding message not posted for ${jobId}: ${err instanceof Error ? err.message : String(err)}`);
          }
          const sources = [
            ...Array.isArray(report.photosBase64) ? report.photosBase64 : [],
            report.photoBase64
          ];
          let photosUploaded = 0;
          for (const [i, source] of sources.entries()) {
            const photo = decodePhoto(source);
            if (!photo) continue;
            try {
              await uploadPhoto(deps.pave, jobId, {
                label: "REPORT",
                ...photo,
                taskId: id || void 0,
                byName: session.name,
                clientRef: ref ? `${ref}.p${i}` : void 0
              });
              photosUploaded += 1;
            } catch {
            }
          }
          return json(res, 200, { taskId: id, commentId, photosUploaded, photoUploaded: photosUploaded > 0 });
        }
        if (parts[2] === "photos") {
          const body = await readBody(req);
          const label = typeof body.label === "string" ? body.label.toUpperCase() : "";
          if (!PHOTO_LABELS.has(label)) {
            return json(res, 400, { error: "label must be BEFORE, AFTER, REPORT or INSPECTION" });
          }
          const photo = decodePhoto(body.imageBase64);
          if (!photo) return json(res, 400, { error: "imageBase64 must be an image under 4MB" });
          const ref = clientRef(req);
          let taskId = typeof body.taskId === "string" && body.taskId ? body.taskId : void 0;
          if (!taskId && typeof body.reportRef === "string" && clientRefMarker(body.reportRef)) {
            taskId = await findTaskByRef(deps.pave, jobId, body.reportRef) ?? void 0;
            if (!taskId) return json(res, 409, { error: "The report this photo belongs to has not reached JobTread yet" });
          }
          const itemTitle = checklistItemTitle(typeof body.itemKey === "string" ? body.itemKey : void 0);
          const where = typeof body.location === "string" && body.location.trim() ? body.location.trim() : void 0;
          const title = itemTitle ? `${itemTitle} \u2014 ${label}` : where ? `${oneLineTitle(where)} \u2014 ${label}` : void 0;
          let inspectionTaskId;
          if (label === "INSPECTION" || label === "REPORT") {
            try {
              const milestones = await listPipelineTasks(deps.pave, jobId);
              let area = null;
              let line = null;
              if (isAreaKey(body.area)) {
                const basics = await getJobBasics(deps.pave, jobId);
                const areas = basics ? jobAreas(basics) : [];
                area = areaOf(body.area, areas);
                line = lineArea(areas);
              }
              inspectionTaskId = areaInspectionTaskOf(milestones, area, line)?.id;
            } catch {
            }
          }
          const upload = {
            label,
            ...photo,
            taskId: taskId ?? (label === "INSPECTION" ? inspectionTaskId : void 0),
            byName: session.name,
            clientRef: ref,
            title,
            ...photoOrigin(body)
          };
          const fileId = await uploadPhoto(deps.pave, jobId, upload);
          let commentId = null;
          if (label === "REPORT" && inspectionTaskId && typeof body.reportRef === "string" && fileId) {
            try {
              commentId = await findCommentByRef(deps.pave, inspectionTaskId, body.reportRef);
              if (commentId) await attachFileToComment(deps.pave, commentId, fileId);
            } catch (err) {
              console.warn(`photo not linked to the finding message on ${jobId}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          return json(res, 200, { fileId, commentId });
        }
      }
      if (req.method === "POST" && parts[0] === "tasks" && parts[2] === "complete") {
        const body = await readBody(req);
        const note = body.note?.trim() ? `${body.note.trim()} \u2014 ${session.name}` : session.name;
        await completeTask(deps.pave, parts[1], note);
        try {
          await postRepairDone(deps.pave, parts[1], body.note, session.name, clientRef(req));
        } catch (err) {
          console.warn(`repair message not posted on ${parts[1]}: ${err instanceof Error ? err.message : String(err)}`);
        }
        const outcome = body.jobId ? await afterRepair(deps.pave, deps.board, { jobId: body.jobId, actor: session.name }) : { flipped: null, reviewer: null };
        return json(res, 200, { ok: true, flipped: outcome.flipped, sentTo: outcome.reviewer });
      }
      return json(res, 404, { error: `No route: ${req.method} ${url.pathname}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json(res, err instanceof PaveError ? 502 : 500, { error: message });
    }
  };
}
async function createAreaInspection(pave, jobId, area, line, ref) {
  const marker = ref ? clientRefMarker(`${ref}.task`) : null;
  if (marker && ref) {
    const existing = await findTaskByRef(pave, jobId, `${ref}.task`);
    if (existing) return existing;
  }
  const description = [
    `Final inspection of the ${AREA_LABEL[area].toLowerCase()} \u2014 inspected in Close Out with nobody booked on the board.`,
    ...marker ? [marker] : []
  ].join("\n\n");
  const res = await pave.query({
    createTask: {
      $: {
        targetType: "job",
        targetId: jobId,
        taskTypeId: TASK_TYPES.inspection,
        isToDo: true,
        name: areaInspectionName(area, line),
        description
      },
      createdTask: { id: {} }
    }
  });
  const id = res.createTask.createdTask?.id;
  if (!id) throw new Error("JobTread did not create the inspection task");
  return id;
}
var asObject = (v) => v && typeof v === "object" ? v : void 0;
var asId = (v) => typeof v === "string" && v ? v : null;
function extractJobId(body) {
  const direct = asId(body["jobId"]) ?? asId(asObject(body["job"])?.["id"]);
  if (direct) return direct;
  const target = asObject(asObject(body["task"])?.["target"]);
  if (target?.["type"] === "job" && asId(target["id"])) return target["id"];
  const event = asObject(body["createdEvent"]) ?? asObject(body["event"]);
  if (!event) return null;
  const related = asId(asObject(event["job"])?.["id"]);
  if (related) return related;
  const data = asObject(event["data"]);
  for (const record of [asObject(data?.["next"]), asObject(data?.["previous"])]) {
    if (!record) continue;
    const viaTask = asId(record["jobId"]) ?? (record["targetType"] === "job" ? asId(record["targetId"]) : null);
    if (viaTask) return viaTask;
    if (asId(record["number"]) && asId(record["id"])) return record["id"];
  }
  return null;
}
function describeWebhook(body) {
  const event = asObject(body["createdEvent"]) ?? asObject(body["event"]);
  if (!event) return `keys=${Object.keys(body).join(",")}`;
  const data = asObject(event["data"]);
  const next = asObject(data?.["next"]);
  const kind = asId(event["type"]) ?? asId(event["eventType"]) ?? (next ? asId(next["jobId"]) ? "task" : asId(next["number"]) ? "job" : "record" : "?");
  return `event=${kind} eventKeys=${Object.keys(event).join(",")} next=${next ? Object.keys(next).slice(0, 12).join(",") : "-"}`;
}

// apps/sync/src/board.ts
var TIMEOUT_MS = 1e4;
var asObj = (v) => v && typeof v === "object" ? v : null;
var asStr = (v) => typeof v === "string" && v ? v : null;
function readBoardAnswer(raw) {
  const o = asObj(raw);
  if (!o || o["ok"] !== true || !Array.isArray(o["areas"])) return null;
  const m = asObj(o["moved"]);
  const moved = m && asStr(m["from"]) && asStr(m["to"]) ? { from: m["from"], to: m["to"] } : null;
  const areas = [];
  for (const a of o["areas"]) {
    const x = asObj(a);
    if (!x || !isAreaKey(x["trade"])) continue;
    const r = asObj(x["reviewer"]);
    const crew = Array.isArray(x["crew"]) ? x["crew"].map((c) => asStr(asObj(c)?.["membershipId"])).filter((id) => Boolean(id)) : [];
    areas.push({
      area: x["trade"],
      label: asStr(x["label"]) ?? "",
      line: x["line"] === true,
      inspectionName: asStr(x["inspectionName"]) ?? "",
      stage: asStr(x["stage"]) ?? "",
      reviewer: r && asStr(r["name"]) ? { name: r["name"], membershipId: asStr(r["membershipId"]) } : null,
      crew
    });
  }
  const p = asObj(o["pm"]);
  const pm = p && asStr(p["name"]) ? { name: p["name"], membershipId: asStr(p["membershipId"]) } : null;
  return { status: asStr(o["status"]), moved, areas, pm };
}
function createBoardClient(baseUrl, secret, fetchImpl = fetch) {
  if (!baseUrl || !secret) return null;
  let origin;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    console.warn("BOARD_URL is not a URL \u2014 the Production Board will not be asked");
    return null;
  }
  return {
    async closeout(ask) {
      try {
        const res = await fetchImpl(`${origin}/api/hooks/closeout`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
          body: JSON.stringify(ask),
          signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        const text = await res.text();
        if (!res.ok) {
          console.warn(`board close-out hook ${res.status} for ${ask.jobId}: ${text.slice(0, 200)}`);
          return null;
        }
        const answer = readBoardAnswer(JSON.parse(text));
        if (!answer) console.warn(`board close-out hook answered something unreadable for ${ask.jobId}`);
        return answer;
      } catch (err) {
        console.warn(`board close-out hook failed for ${ask.jobId}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    }
  };
}

// apps/sync/src/webhookRegistration.ts
var WEBHOOK_EVENT_TYPES = ["taskCreated", "taskUpdated", "taskDeleted", "jobUpdated"];
async function ensureWebhook(pave, publicUrl, webhookSecret) {
  if (!publicUrl || !webhookSecret) return "skipped";
  const target = `${publicUrl.replace(/\/$/, "")}/webhooks/jobtread/${webhookSecret}`;
  const res = await pave.query({
    organization: {
      $: { id: ORGANIZATION_ID },
      webhooks: { $: { size: 50 }, nodes: { id: {}, url: {} } }
    }
  });
  if (res.organization.webhooks.nodes.some((w) => w.url === target)) return "exists";
  await pave.query({
    createWebhook: {
      $: { organizationId: ORGANIZATION_ID, url: target, eventTypes: WEBHOOK_EVENT_TYPES }
    }
  });
  return "created";
}

// apps/sync/src/vercel-entry.ts
var handler = null;
async function entry(req, res) {
  try {
    if (!handler) {
      const env = loadEnv();
      const pave = createPaveClient(env.jtGrantKey);
      void ensureWebhook(pave, env.publicUrl, env.webhookSecret).catch(() => {
      });
      handler = createHandler({
        pave,
        sessionSecret: env.sessionSecret,
        geminiApiKey: env.geminiApiKey,
        geminiModel: env.geminiModel,
        googleClientId: env.googleClientId,
        workspaceDomain: env.workspaceDomain,
        allowedEmails: env.allowedEmails,
        webhookSecret: env.webhookSecret,
        crewAppSecret: env.crewAppSecret,
        board: createBoardClient(env.boardUrl, env.closeoutHookSecret)
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
          hasSessionSecret: Boolean(process.env.SESSION_SECRET),
          hasGoogleClientId: Boolean(process.env.GOOGLE_CLIENT_ID)
        }
      })
    );
  }
}
export {
  entry as default
};
