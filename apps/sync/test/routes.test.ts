import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVisit } from "../src/routes";
import { ANSWER, CLEANUP_ITEMS, CUSTOM_FIELDS, INSPECTION_ITEMS, PUNCH_CREW, TASK_TYPES } from "../../../packages/shared/src/jobtread";

test("parseVisit reads the app's close-inspection body: both checklists and the notes", () => {
  const visit = parseVisit({
    answers: {
      inspection: { [INSPECTION_ITEMS[0].key]: ANSWER.ok },
      cleanup: { [CLEANUP_ITEMS[0].key]: ANSWER.action },
    },
    notes: { inspection: "Clean pass", attic: "", cleanup: "Magnet run" },
    problemsReported: 1,
  });
  assert.deepEqual(visit.inspection, { [INSPECTION_ITEMS[0].key]: ANSWER.ok });
  assert.deepEqual(visit.cleanup, { [CLEANUP_ITEMS[0].key]: ANSWER.action });
  assert.deepEqual(visit.notes, { inspection: "Clean pass", attic: "", cleanup: "Magnet run" });
});

test("parseVisit reads the findings and drops malformed ones", () => {
  const visit = parseVisit({
    answers: { inspection: {}, cleanup: {} },
    findings: [
      { itemKey: INSPECTION_ITEMS[7].key, fixedOnSite: true, location: "Attic", note: "Leak", photos: 2 },
      { nope: true } as never,
      { itemKey: CLEANUP_ITEMS[0].key } as never,
    ],
    problemsReported: 0,
  });
  assert.deepEqual(visit.findings, [
    { itemKey: INSPECTION_ITEMS[7].key, fixedOnSite: true, location: "Attic", note: "Leak", photos: 2 },
    { itemKey: CLEANUP_ITEMS[0].key, fixedOnSite: false, location: "", note: "", photos: 0 },
  ]);
});

test("parseVisit still accepts the flat inspection map older app builds queued in their outbox", () => {
  const visit = parseVisit({ answers: { [INSPECTION_ITEMS[2].key]: ANSWER.na, junk: 42 } as never });
  assert.deepEqual(visit.inspection, { [INSPECTION_ITEMS[2].key]: ANSWER.na });
  assert.deepEqual(visit.cleanup, {});
  assert.deepEqual(visit.notes, { inspection: undefined, attic: undefined, cleanup: undefined });
});

test("parseVisit tolerates a missing or malformed body", () => {
  assert.deepEqual(parseVisit({}).inspection, {});
  assert.deepEqual(parseVisit({ answers: "nope", notes: 3 } as never).cleanup, {});
});

// --------------------------------------------------------------------------
// Re-sends through the HTTP layer: the client reference and report photos
// --------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from "node:http";
import { mintSession } from "../src/auth";
import { createHandler, describeWebhook, extractJobId, type RouterDeps } from "../src/routes";
import type { PaveClient, PaveQuery } from "../src/pave";

const SECRET = "routes-test-secret";
const TOKEN = mintSession(SECRET, { email: "yahirgonzalez@deitemeyerbrothers.com", name: "Yahir Gonzalez" });

function fakeHttp(method: string, path: string, headers: Record<string, string> = {}, body?: unknown) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = {
    method,
    url: path,
    headers: { authorization: `Bearer ${TOKEN}`, ...headers },
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  } as unknown as IncomingMessage;
  const out = { status: 0, body: "" };
  const res = {
    writeHead(status: number) {
      out.status = status;
    },
    end(text?: string) {
      out.body = text ?? "";
    },
  } as unknown as ServerResponse;
  return { req, res, out };
}

function routerDeps(responder: (q: PaveQuery) => unknown, queries: PaveQuery[]): RouterDeps {
  const pave: PaveClient = {
    async query<T>(q: PaveQuery): Promise<T> {
      queries.push(q);
      return responder(q) as T;
    },
  };
  return {
    pave,
    sessionSecret: SECRET,
    geminiApiKey: "",
    geminiModel: "gemini-test",
    googleClientId: "client-id",
    workspaceDomain: "deitemeyerbrothers.com",
    allowedEmails: [],
    webhookSecret: "",
  };
}

const PIXEL = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

function jobResponder(jobType: string, withInspectionTask: boolean) {
  return (q: PaveQuery): unknown => {
    if ("createTask" in q) return { createTask: { createdTask: { id: "t9" } } };
    if ("createComment" in q) return { createComment: { createdComment: { id: "c9" } } };
    if ("task" in q) return { task: { comments: { nodes: [] } } };
    if ("job" in q) {
      const jobQ = q["job"] as Record<string, unknown>;
      if ("tasks" in jobQ) {
        const wantsPipeline = JSON.stringify(jobQ).includes("subtasks");
        return {
          job: {
            tasks: {
              nodes:
                wantsPipeline && withInspectionTask
                  ? [{ id: "fi", name: "Final inspection", progress: null, taskType: { id: TASK_TYPES.inspection }, description: null, subtasks: [] }]
                  : [],
            },
          },
        };
      }
      return {
        job: {
          id: "job1",
          number: "26-0001",
          name: "260001 Test_Roof",
          customFieldValues: { nodes: [{ value: jobType, customField: { id: CUSTOM_FIELDS.jobType } }] },
        },
      };
    }
    return {};
  };
}

test("POST /jobs/:id/reports: the to-do carries the reference, goes to the punch crew on a roofing job, and the finding is a message on the inspection task", async () => {
  const queries: PaveQuery[] = [];
  const handle = createHandler(routerDeps(jobResponder("Roofing", true), queries));
  const call = fakeHttp(
    "POST",
    "/jobs/job1/reports",
    { "x-client-ref": "1758400000000-ab12cd" },
    { itemKey: INSPECTION_ITEMS[7].key, location: "Attic", englishNote: "Boot cracked" },
  );
  await handle(call.req, call.res);
  assert.equal(call.out.status, 200);
  assert.deepEqual(JSON.parse(call.out.body), { taskId: "t9", commentId: "c9", photosUploaded: 0, photoUploaded: false });
  const created = (queries.find((q) => "createTask" in q)!["createTask"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.match(String(created["description"]), /Reported by: Yahir Gonzalez/);
  assert.match(String(created["description"]), /DB CheckOut item: 8/);
  assert.match(String(created["description"]), /DB CheckOut ref: 1758400000000-ab12cd$/);
  assert.deepEqual(created["assignedMembershipIds"], PUNCH_CREW.map((m) => m.membershipId));
  const message = (queries.find((q) => "createComment" in q)!["createComment"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.equal(message["targetId"], "fi");
  assert.ok(
    String(message["message"]).startsWith(`${INSPECTION_ITEMS[7].subtask}\n⚠ REPORT (punch item) — Boot cracked\nWhere: Attic`),
    "the message leads with the checklist line, then the finding",
  );
  assert.match(String(message["message"]), /DB CheckOut ref: 1758400000000-ab12cd$/);
});

test("POST /jobs/:id/reports leaves a construction job's report for the PM, and a FIXED ON SITE record unassigned", async () => {
  const construction: PaveQuery[] = [];
  await createHandler(routerDeps(jobResponder("Construction", false), construction))(
    ...(() => {
      const c = fakeHttp("POST", "/jobs/job1/reports", {}, { location: "Window", englishNote: "Scratched" });
      return [c.req, c.res] as const;
    })(),
  );
  const made = (construction.find((q) => "createTask" in q)!["createTask"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.equal(made["assignedMembershipIds"], undefined);
  assert.ok(!construction.some((q) => "createComment" in q), "no inspection task on the job: no message");

  const fixed: PaveQuery[] = [];
  const c2 = fakeHttp("POST", "/jobs/job1/reports", {}, { location: "Plants", englishNote: "Reshaped", fixedOnSite: true });
  await createHandler(routerDeps(jobResponder("Roofing", true), fixed))(c2.req, c2.res);
  const madeFixed = (fixed.find((q) => "createTask" in q)!["createTask"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.equal(madeFixed["assignedMembershipIds"], undefined);
  assert.equal(madeFixed["progress"], 1);
});

test("POST /jobs/:id/photos with a reportRef waits (409) until the report's task exists, then attaches to it", async () => {
  let taskOnJob: Array<{ id: string }> = [];
  const queries: PaveQuery[] = [];
  const handle = createHandler(
    routerDeps((q) => {
      if ("job" in q) return { job: { tasks: { nodes: taskOnJob } } };
      if ("task" in q) return { task: { files: { nodes: [] } } };
      if ("createUploadRequest" in q) {
        return { createUploadRequest: { createdUploadRequest: { id: "u1", url: "https://up.example", method: "PUT", headers: {} } } };
      }
      return { createFile: { createdFile: { id: "f1" } } };
    }, queries),
  );
  const body = { label: "REPORT", imageBase64: PIXEL, reportRef: "1758400000000-ab12cd" };

  const early = fakeHttp("POST", "/jobs/job1/photos", { "x-client-ref": "1758400000000-ab12cd.p0" }, body);
  await handle(early.req, early.res);
  assert.equal(early.out.status, 409, "the report has not landed: keep the photo pending");
  assert.ok(!queries.some((q) => "createUploadRequest" in q), "no bytes were sent");

  // uploadPhoto's upload step uses global fetch; stub it for the bytes.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
  try {
    taskOnJob = [{ id: "t9" }];
    const later = fakeHttp("POST", "/jobs/job1/photos", { "x-client-ref": "1758400000000-ab12cd.p0" }, body);
    await handle(later.req, later.res);
    assert.equal(later.out.status, 200);
    assert.equal(JSON.parse(later.out.body).fileId, "f1");
    const created = queries.find((q) => "createFile" in q)!;
    const dollar = (created["createFile"] as Record<string, unknown>)["$"] as Record<string, unknown>;
    assert.equal(dollar["targetId"], "t9");
    assert.equal(dollar["targetType"], "task");
    assert.match(String(dollar["description"]), /DB CheckOut ref: 1758400000000-ab12cd\.p0$/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the retired checklist form endpoints answer 410", async () => {
  const handle = createHandler(routerDeps(() => ({}), []));
  for (const path of ["/jobs/job1/inspection", "/jobs/job1/cleanup"]) {
    const call = fakeHttp("POST", path, {}, { answers: {} });
    await handle(call.req, call.res);
    assert.equal(call.out.status, 410);
  }
});

test("a report photo is uploaded once, to its punch to-do, and linked to the finding's message on the inspection task", async () => {
  const queries: PaveQuery[] = [];
  const handle = createHandler(
    routerDeps((q) => {
      if ("job" in q) {
        const wantsPipeline = JSON.stringify(q).includes("subtasks");
        return wantsPipeline
          ? { job: { tasks: { nodes: [{ id: "fi", name: "Final inspection", progress: 0.9, taskType: { id: TASK_TYPES.inspection }, description: null, subtasks: [] }] } } }
          : { job: { tasks: { nodes: [{ id: "t9" }] } } };
      }
      if ("task" in q) {
        const asksComments = JSON.stringify(q).includes("comments");
        return asksComments ? { task: { comments: { nodes: [{ id: "c9" }] } } } : { task: { files: { nodes: [] } } };
      }
      if ("comment" in q) return { comment: { files: { nodes: [] } } };
      if ("createUploadRequest" in q) {
        return { createUploadRequest: { createdUploadRequest: { id: "u1", url: "https://up.example", method: "PUT", headers: {} } } };
      }
      if ("createFile" in q) return { createFile: { createdFile: { id: "f1" } } };
      return {};
    }, queries),
  );
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
  try {
    const call = fakeHttp(
      "POST",
      "/jobs/job1/photos",
      { "x-client-ref": "1758400000000-ab12cd.p0" },
      { label: "REPORT", imageBase64: PIXEL, reportRef: "1758400000000-ab12cd", itemKey: INSPECTION_ITEMS[7].key, location: "Attic" },
    );
    await handle(call.req, call.res);
    assert.equal(call.out.status, 200);
    assert.deepEqual(JSON.parse(call.out.body), { fileId: "f1", commentId: "c9" });
    const created = queries.filter((q) => "createFile" in q).map((q) => (q["createFile"] as Record<string, unknown>)["$"] as Record<string, unknown>);
    assert.equal(created.length, 1, "one upload");
    assert.equal(created[0]["targetId"], "t9");
    assert.match(String(created[0]["name"]), /^8\. Attic \/ interior spot check — leak-prone areas inspected — REPORT /);
    const linked = (queries.find((q) => "updateComment" in q)!["updateComment"] as Record<string, unknown>)["$"] as Record<string, unknown>;
    assert.equal(linked["id"], "c9");
    assert.deepEqual(linked["files"], [{ _type: "file", id: "f1" }]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("extractJobId reads JobTread's real delivery shape, and the older guesses", () => {
  // Seen live 2026-09-21 (trimmed): a task event, the job id on the record.
  const taskEvent = {
    _type: "root",
    createdEvent: {
      _type: "event",
      account: { _type: "account", id: "22PPwHV46nxy" },
      comment: null,
      createdAt: "2026-09-21T13:37:23.778Z",
      data: {
        next: { id: "22PeuuepCGBk", name: "26-1558 Michael Taylor", jobId: "22PeuuT4kfMy", isToDo: false, targetType: "job", taskTypeId: "22PNJDrm6TsA" },
      },
    },
  };
  assert.equal(extractJobId(taskEvent), "22PeuuT4kfMy");
  assert.match(describeWebhook(taskEvent), /event=task eventKeys=_type,account,comment,createdAt,data next=id,name,jobId/);

  // A job event: the record is the job itself.
  assert.equal(
    extractJobId({ createdEvent: { data: { previous: { id: "j1", number: "26-0001" }, next: { id: "j1", number: "26-0001" } } } }),
    "j1",
  );
  // A related job on the event wins when present.
  assert.equal(extractJobId({ createdEvent: { job: { id: "j2" }, data: { next: { id: "t", jobId: "j9" } } } }), "j2");
  // The older, hand-made shapes still work.
  assert.equal(extractJobId({ jobId: "j3" }), "j3");
  assert.equal(extractJobId({ job: { id: "j4" } }), "j4");
  assert.equal(extractJobId({ task: { target: { type: "job", id: "j5" } } }), "j5");
  assert.equal(extractJobId({ createdEvent: { data: { next: { id: "x" } } } }), null);
  assert.equal(extractJobId({}), null);
});
