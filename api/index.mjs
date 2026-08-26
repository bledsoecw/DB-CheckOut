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
    publicUrl: source.PUBLIC_URL ?? "https://closeout.deitemeyerbrothers.com",
    geminiApiKey: source.GEMINI_API_KEY ?? "",
    geminiModel: source.GEMINI_MODEL ?? "gemini-2.5-flash",
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
function cfvAll(job, fieldId) {
  return job.customFieldValues.nodes.filter((n) => n.customField.id === fieldId && n.value != null).map((n) => String(n.value));
}
function toQueueJob(job, openPunchCount = 0) {
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
    const out = [];
    for (const d of docs.slice(0, 10)) {
      out.push({
        id: d.id,
        name: d.name,
        number: d.number,
        issueDate: d.issueDate,
        price: d.price,
        jtUrl: jtDocumentUrl(jobId, d.id),
        lines: await listDocumentLines(pave, d.id)
      });
    }
    return out;
  } catch {
    return [];
  }
}
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
  const [res, punchTasks, soldScope] = await Promise.all([
    pave.query({ job: { $: { id: jobId }, ...JOB_SELECTION } }),
    listPunchTasks(pave, jobId),
    listSoldScope(pave, jobId)
  ]);
  if (!res.job) throw new Error(`Job not found: ${jobId}`);
  const open = punchTasks.filter((t) => t.progress < 1).length;
  return { ...toQueueJob(res.job, open), punchTasks, soldScope };
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
async function uploadPhoto(pave, jobId, photo, fetchImpl = fetch) {
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
  const stamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 16).replace("T", " ");
  const res = await pave.query({
    createFile: {
      $: {
        targetId: photo.taskId ?? jobId,
        targetType: photo.taskId ? "task" : "job",
        name: `${photo.label} ${stamp} \u2014 ${photo.byName}`,
        uploadRequestId: request.id,
        description: `Uploaded from DB CheckOut by ${photo.byName}`
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

// apps/sync/src/translate.ts
var GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
var TRANSLATE_LIMITS = { maxTexts: 100, maxTextLength: 4e3 };
var PROMPT = "Translate each string in the JSON array from English to Latin American Spanish for a roofing/construction field crew. Keep brand names, product names, model numbers, measurements and numbers unchanged. Keep it natural and concise. Return ONLY a JSON array of the translated strings, same length, same order.";
var cache = /* @__PURE__ */ new Map();
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
    if (name.includes("lite")) points -= 5;
    return points;
  };
  const best = [...usable].sort((a, b) => score(b) - score(a))[0];
  if (!best) throw new Error("No usable Gemini model on this key");
  return best;
}
async function geminiGenerate(prompt, env, fetchImpl) {
  const attempt = async (model2) => fetchImpl(`${GEMINI_URL}/${model2}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.geminiApiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
    })
  });
  let model = discoveredModel ?? env.geminiModel;
  let res = await attempt(model);
  if (res.status === 404 || res.status === 400) {
    model = await discoverModel(env.geminiApiKey, fetchImpl);
    discoveredModel = model;
    res = await attempt(model);
  }
  if (!res.ok) throw new Error(`Gemini request failed: ${res.status} (${model})`);
  const body = await res.json();
  return body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
async function geminiTranslate(texts, env, fetchImpl) {
  const raw = await geminiGenerate(`${PROMPT}

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
async function translateToSpanish(texts, env, fetchImpl = fetch) {
  if (!env.geminiApiKey) throw new Error("Translation is not configured");
  const missing = [...new Set(texts.filter((t) => !cache.has(t)))];
  if (missing.length > 0) {
    const translated = await geminiTranslate(missing, env, fetchImpl);
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
var PHOTO_LABELS = /* @__PURE__ */ new Set(["BEFORE", "AFTER", "REPORT", "INSPECTION"]);
var MAX_PHOTO_BYTES = 4e6;
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
          webhook: Boolean(deps.webhookSecret)
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
        let flipped = null;
        if (jobId) flipped = await applyPunchReviewFlip(deps.pave, jobId);
        return json(res, 200, { ok: true, flipped });
      }
      const session = deps.sessionSecret ? verifySession(deps.sessionSecret, bearerToken(req)) : null;
      if (!session) return json(res, 401, { error: "Unauthorized" });
      if (req.method === "POST" && url.pathname === "/translate") {
        if (!deps.geminiApiKey) return json(res, 501, { error: "Translation is not configured" });
        const body = await readBody(req);
        const texts = Array.isArray(body.texts) ? body.texts.filter((t) => typeof t === "string" && t.length > 0) : [];
        if (texts.length === 0 || texts.length > TRANSLATE_LIMITS.maxTexts || texts.some((t) => t.length > TRANSLATE_LIMITS.maxTextLength)) {
          return json(res, 400, { error: "texts must be 1-100 strings, each under 4000 chars" });
        }
        const translations = await translateToSpanish(texts, deps);
        return json(res, 200, { translations });
      }
      if (req.method === "GET" && url.pathname === "/queue") {
        return json(res, 200, await listPipelineJobs(deps.pave));
      }
      if (req.method === "GET" && parts[0] === "jobs" && parts.length === 2) {
        return json(res, 200, await getJob(deps.pave, parts[1]));
      }
      if (req.method === "GET" && parts[0] === "jobs" && parts[2] === "scope-summary") {
        if (!deps.geminiApiKey) return json(res, 501, { error: "Summaries are not configured" });
        const scope = await listSoldScope(deps.pave, parts[1]);
        if (scope.length === 0) return json(res, 200, { en: "", es: "" });
        const scopeText = scope.map(
          (d) => `${d.name}${d.number ? ` #${d.number}` : ""} (${d.issueDate ?? "no date"}):
` + d.lines.map((l) => `- ${l.name}${l.quantity ? ` (${l.quantity} ${l.unit ?? ""})` : ""}`).join("\n")
        ).join("\n\n");
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
          const id = await createReportTask(deps.pave, jobId, {
            ...report,
            reportedBy: session.name
          });
          let photoUploaded = false;
          const photo = decodePhoto(report.photoBase64);
          if (photo) {
            try {
              await uploadPhoto(deps.pave, jobId, {
                label: "REPORT",
                ...photo,
                taskId: id || void 0,
                byName: session.name
              });
              photoUploaded = true;
            } catch {
              photoUploaded = false;
            }
          }
          return json(res, 200, { taskId: id, photoUploaded });
        }
        if (parts[2] === "photos") {
          const body = await readBody(req);
          const label = typeof body.label === "string" ? body.label.toUpperCase() : "";
          if (!PHOTO_LABELS.has(label)) {
            return json(res, 400, { error: "label must be BEFORE, AFTER or REPORT" });
          }
          const photo = decodePhoto(body.imageBase64);
          if (!photo) return json(res, 400, { error: "imageBase64 must be an image under 4MB" });
          const upload = {
            label,
            ...photo,
            taskId: typeof body.taskId === "string" && body.taskId ? body.taskId : void 0,
            byName: session.name
          };
          const fileId = await uploadPhoto(deps.pave, jobId, upload);
          return json(res, 200, { fileId });
        }
      }
      if (req.method === "POST" && parts[0] === "tasks" && parts[2] === "complete") {
        const body = await readBody(req);
        const note = body.note?.trim() ? `${body.note.trim()} \u2014 ${session.name}` : session.name;
        await completeTask(deps.pave, parts[1], note);
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
        webhookSecret: env.webhookSecret
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
