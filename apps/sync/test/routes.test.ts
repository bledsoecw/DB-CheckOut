import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVisit, photoOrigin } from "../src/routes";
import { ANSWER, CLEANUP_ITEMS, CUSTOM_FIELDS, INSPECTION_ITEMS, PUNCH_CREW, TASK_TYPES } from "../../../packages/shared/src/jobtread";
import type { BoardAnswer, BoardAsk, BoardClient } from "../src/board";

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
    crewAppSecret: "",
  };
}

// --------------------------------------------------------------------------
// DB Crew acting for its signed-in person
// --------------------------------------------------------------------------

test("the Crew App's shared secret acts for the person it names, on the same gate a sign-in passes", async () => {
  const queries: PaveQuery[] = [];
  const deps = { ...routerDeps(() => ({ customField: { customFieldValues: { nodes: [], nextPage: null } } }), queries), crewAppSecret: "crew-secret" };
  const handle = createHandler(deps);

  const asCrew = (email: string, name = "Alberto Gonzalez") =>
    fakeHttp("GET", "/queue", { authorization: "Bearer crew-secret", "x-acting-email": email, "x-acting-name": name });

  let h = asCrew("alberto@deitemeyerbrothers.com");
  await handle(h.req, h.res);
  assert.equal(h.out.status, 200, "a domain account acts through the door");

  h = asCrew("stranger@gmail.com");
  await handle(h.req, h.res);
  assert.equal(h.out.status, 401, "the secret cannot act for an outsider");

  h = fakeHttp("GET", "/queue", { authorization: "Bearer crew-secret" });
  await handle(h.req, h.res);
  assert.equal(h.out.status, 401, "the secret alone names nobody");

  h = fakeHttp("GET", "/queue", { authorization: "Bearer wrong-secret", "x-acting-email": "alberto@deitemeyerbrothers.com" });
  await handle(h.req, h.res);
  assert.equal(h.out.status, 401, "a wrong secret reads like no token");

  const off = createHandler({ ...deps, crewAppSecret: "" });
  h = asCrew("alberto@deitemeyerbrothers.com");
  await off(h.req, h.res);
  assert.equal(h.out.status, 401, "unset, the door does not exist");

  h = fakeHttp("GET", "/queue");
  await handle(h.req, h.res);
  assert.equal(h.out.status, 200, "the app's own session still works beside it");
});

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

test("photoOrigin: a phone photo carries its taken time; a bad time is dropped, never refused", () => {
  const now = new Date("2026-10-13T18:00:00Z");
  assert.deepEqual(photoOrigin({}, now), { fromPhone: false });
  assert.deepEqual(photoOrigin({ source: "camera", takenAt: "2026-10-12T18:10:00Z" }, now), { fromPhone: false }, "a time only counts on a phone photo");
  assert.deepEqual(photoOrigin({ source: "phone", takenAt: "2026-10-12T14:10:00-04:00" }, now), { fromPhone: true, takenAt: "2026-10-12T18:10:00.000Z" });
  assert.deepEqual(photoOrigin({ source: "phone" }, now), { fromPhone: true });
  assert.deepEqual(photoOrigin({ source: "phone", takenAt: "yesterday" }, now), { fromPhone: true });
  assert.deepEqual(photoOrigin({ source: "phone", takenAt: "1970-01-01T00:00:00Z" }, now), { fromPhone: true }, "a zeroed camera clock");
  assert.deepEqual(photoOrigin({ source: "phone", takenAt: "2026-10-20T00:00:00Z" }, now), { fromPhone: true }, "a phone clock set ahead");
  assert.deepEqual(photoOrigin({ source: "phone", takenAt: 1760292600000 }, now), { fromPhone: true }, "a number is not the ISO string asked for");
});

test("an AFTER photo picked from the phone lands on its repair named by when it was taken", async () => {
  const queries: PaveQuery[] = [];
  const handle = createHandler(
    routerDeps((q) => {
      if ("task" in q) return { task: { files: { nodes: [] } } };
      if ("createUploadRequest" in q) {
        return { createUploadRequest: { createdUploadRequest: { id: "u1", url: "https://up.example", method: "PUT", headers: {} } } };
      }
      if ("createFile" in q) return { createFile: { createdFile: { id: "f7" } } };
      return {};
    }, queries),
  );
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
  try {
    const call = fakeHttp(
      "POST",
      "/jobs/job1/photos",
      { "x-client-ref": "1758400000000-ab12cd.a" },
      { label: "AFTER", imageBase64: PIXEL, taskId: "pt1", source: "phone", takenAt: "2026-10-12T14:10:00-04:00" },
    );
    await handle(call.req, call.res);
    assert.equal(call.out.status, 200);
    const created = queries.filter((q) => "createFile" in q).map((q) => (q["createFile"] as Record<string, unknown>)["$"] as Record<string, unknown>);
    assert.equal(created.length, 1);
    assert.equal(created[0]["targetId"], "pt1");
    assert.match(String(created[0]["name"]), /^AFTER \(from phone, taken 2026-10-12 14:10\) — /);
    assert.match(String(created[0]["description"]), /picked from the phone's photos, taken Oct 12, 2026, 2:10 PM · DB CheckOut ref: 1758400000000-ab12cd\.a$/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("finishing a repair posts its note as a message on the to-do, with its photos linked", async () => {
  const queries: PaveQuery[] = [];
  const handle = createHandler(
    routerDeps((q) => {
      const task = q["task"] as Record<string, unknown> | undefined;
      if (task && "comments" in task) return { task: { comments: { nodes: [] } } };
      if (task && "files" in task) {
        return { task: { files: { nodes: [
          { id: "fa", name: "AFTER 2026-10-13 19:38 — Carl Bledsoe", description: "DB CheckOut ref: 1758400000000-ab12cd.a", createdAt: null },
          { id: "fb", name: "BEFORE 2026-10-13 19:37 — Carl Bledsoe", description: "DB CheckOut ref: 1758400000000-ab12cd.b", createdAt: null },
        ] } } };
      }
      if (task) return { task: { description: "Reseal the boot" } };
      if ("createComment" in q) return { createComment: { createdComment: { id: "c1" } } };
      if ("comment" in q) return { comment: { files: { nodes: [] } } };
      return {};
    }, queries),
  );
  const call = fakeHttp("POST", "/tasks/pt1/complete", { "x-client-ref": "1758400000000-ab12cd" }, { note: "New boot, sealed" });
  await handle(call.req, call.res);
  assert.equal(call.out.status, 200);
  const done = (queries.find((q) => "updateTask" in q)!["updateTask"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.match(String(done["description"]), /✔ Done — New boot, sealed — /, "the description line stays");
  const created = (queries.find((q) => "createComment" in q)!["createComment"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.equal(created["targetId"], "pt1");
  assert.match(String(created["message"]), /^✔ REPAIR DONE — New boot, sealed\nFinished by .+ via DB CheckOut\n\nDB CheckOut ref: 1758400000000-ab12cd$/);
  assert.equal(queries.filter((q) => "updateComment" in q).length, 2, "before and after linked");
});

// --------------------------------------------------------------------------
// Work areas, and the board that moves the Status (Carl, 23 Oct 2026)
// --------------------------------------------------------------------------

interface AreaJob {
  status: string;
  projectTypes: string[];
  /** Tasks on the job (the pipeline read sees them all). */
  tasks: Array<{ id: string; name: string; progress?: number | null; typeId?: string | null; description?: string | null }>;
}

/** A two-area roofing job, as every read the routes make sees it. */
function areaResponder(job: AreaJob) {
  return (q: PaveQuery): unknown => {
    if ("createTask" in q) return { createTask: { createdTask: { id: "new-task" } } };
    if ("createComment" in q) return { createComment: { createdComment: { id: "c9" } } };
    if ("updateTask" in q || "updateJob" in q) return {};
    const task = q["task"] as Record<string, unknown> | undefined;
    if (task) {
      if ("comments" in task) return { task: { comments: { nodes: [] } } };
      if ("files" in task) return { task: { files: { nodes: [] } } };
      const id = (task["$"] as Record<string, unknown>)["id"];
      return { task: { description: job.tasks.find((t) => t.id === id)?.description ?? null } };
    }
    if ("job" in q) {
      const jobQ = q["job"] as Record<string, unknown>;
      if ("comments" in jobQ) return { job: { comments: { nodes: [] } } };
      if ("tasks" in jobQ) {
        const text = JSON.stringify(jobQ);
        if (text.includes("assignedMemberships")) return { job: { tasks: { nodes: [] } } };
        if (text.includes("DB CheckOut ref")) return { job: { tasks: { nodes: [] } } };
        return {
          job: {
            tasks: {
              nodes: job.tasks.map((t) => ({
                id: t.id,
                name: t.name,
                progress: t.progress ?? null,
                taskType: t.typeId ? { id: t.typeId } : null,
                description: t.description ?? null,
                subtasks: [],
              })),
            },
          },
        };
      }
      return {
        job: {
          id: "job1",
          number: "26-1483",
          name: "261483 McCoy_Roof",
          customFieldValues: {
            nodes: [
              { value: job.status, customField: { id: CUSTOM_FIELDS.status } },
              { value: "Roofing", customField: { id: CUSTOM_FIELDS.jobType } },
              ...job.projectTypes.map((v) => ({ value: v, customField: { id: CUSTOM_FIELDS.projectType } })),
            ],
          },
        },
      };
    }
    return {};
  };
}

function boardThat(answer: Partial<BoardAnswer> = {}): BoardClient & { asks: BoardAsk[] } {
  const asks: BoardAsk[] = [];
  return {
    asks,
    async closeout(ask) {
      asks.push(ask);
      return { status: null, moved: null, pm: null, areas: [], ...answer };
    },
  };
}

const McCOY: AreaJob = {
  status: "Production",
  projectTypes: ["R-Shingles", "R-Gutters"],
  tasks: [
    { id: "fi", name: "Final inspection", typeId: TASK_TYPES.inspection },
    { id: "fg", name: "Final inspection — Gutters", typeId: TASK_TYPES.inspection, description: "Walk the gutters." },
  ],
};
const GUTTERS_AREA = {
  area: "gutters" as const, label: "Gutters", line: false, inspectionName: "Final inspection — Gutters", stage: "inspect",
  reviewer: { name: "Neal Deitemeyer", membershipId: "22PLUqZNCKaY" }, crew: [] as string[],
};

const dollarOf = (q: PaveQuery | undefined, key: string) => (q![key] as Record<string, unknown>)["$"] as Record<string, unknown>;

test("a finding on the gutters is filed under the gutters: tagged, its message on their inspection, nobody's repair by default", async () => {
  const queries: PaveQuery[] = [];
  const board = boardThat({ areas: [GUTTERS_AREA] });
  const handle = createHandler({ ...routerDeps(areaResponder(McCOY), queries), board });
  const call = fakeHttp("POST", "/jobs/job1/reports", {}, { area: "gutters", location: "NE corner", englishNote: "Downspout loose" });
  await handle(call.req, call.res);
  assert.equal(call.out.status, 200);
  const created = dollarOf(queries.find((q) => "createTask" in q), "createTask");
  assert.match(String(created["description"]), /\n\nGutters · reported by Yahir Gonzalez/);
  assert.equal(created["assignedMembershipIds"], undefined, "the board names nobody for gutters");
  assert.equal(dollarOf(queries.find((q) => "createComment" in q), "createComment")["targetId"], "fg");
  // At Production the close moves the job; a finding only asks who its repairs go to.
  assert.deepEqual(board.asks, [{ jobId: "job1", move: false, repairs: true, problemsReported: 1, area: "gutters", actor: "Yahir Gonzalez" }]);
});

test("a finding on a job already at PM Review asks the board to bring it back to Punch List", async () => {
  const board = boardThat({ areas: [{ ...GUTTERS_AREA, area: "shingle", line: true, label: "Shingle roof", crew: ["22PdPUpWzpHy"] }] });
  const queries: PaveQuery[] = [];
  const handle = createHandler({ ...routerDeps(areaResponder({ ...McCOY, status: "PM Review" }), queries), board });
  const call = fakeHttp("POST", "/jobs/job1/reports", {}, { location: "Ridge", englishNote: "Cap lifted" });
  await handle(call.req, call.res);
  assert.equal(board.asks[0].move, true);
  assert.equal(board.asks[0].area, "shingle", "no area named: the template line's");
  const created = dollarOf(queries.find((q) => "createTask" in q), "createTask");
  assert.deepEqual(created["assignedMembershipIds"], ["22PdPUpWzpHy"], "the board's crew for the roof");
  assert.doesNotMatch(String(created["description"]), /· reported by/, "an untagged REPORT is the roof's, as always");
});

test("with no board, a shingle finding goes to Alberto and Yahir and a gutters finding to nobody", async () => {
  const roof: PaveQuery[] = [];
  let call = fakeHttp("POST", "/jobs/job1/reports", {}, { location: "Ridge", englishNote: "Cap lifted" });
  await createHandler(routerDeps(areaResponder(McCOY), roof))(call.req, call.res);
  assert.deepEqual(dollarOf(roof.find((q) => "createTask" in q), "createTask")["assignedMembershipIds"], PUNCH_CREW.map((m) => m.membershipId));

  const gutters: PaveQuery[] = [];
  call = fakeHttp("POST", "/jobs/job1/reports", {}, { area: "gutters", location: "NE", englishNote: "Loose" });
  await createHandler(routerDeps(areaResponder(McCOY), gutters))(call.req, call.res);
  assert.equal(dollarOf(gutters.find((q) => "createTask" in q), "createTask")["assignedMembershipIds"], undefined);
});

test("POST /jobs/:id/close-area-inspection stamps the area's own inspection, posts the notes, and tells the board and the reviewer", async () => {
  const queries: PaveQuery[] = [];
  const board = boardThat({ moved: null, areas: [GUTTERS_AREA] });
  const handle = createHandler({ ...routerDeps(areaResponder(McCOY), queries), board });
  const call = fakeHttp("POST", "/jobs/job1/close-area-inspection", { "x-client-ref": "1758400000000-ab12cd" }, {
    area: "gutters",
    notes: "All downspouts strapped and running clear.",
    problemsReported: 0,
  });
  await handle(call.req, call.res);
  assert.equal(call.out.status, 200);
  assert.deepEqual(JSON.parse(call.out.body), { completedTaskId: "fg", flipped: null, sentTo: "Neal Deitemeyer" });
  const stamp = dollarOf(queries.find((q) => "updateTask" in q && dollarOf(q, "updateTask")["id"] === "fg"), "updateTask");
  assert.equal(stamp["progress"], 1);
  assert.equal(stamp["description"], "Walk the gutters.\n\n✔ Inspected by Yahir Gonzalez — via DB CheckOut");
  const posted = queries.filter((q) => "createComment" in q).map((q) => dollarOf(q, "createComment"));
  assert.equal(posted[0]["targetId"], "fg", "the notes on the inspection task, where the board's review sheet reads them");
  assert.match(String(posted[0]["message"]), /^Inspector notes: All downspouts strapped and running clear\.\n— Yahir Gonzalez via DB CheckOut/);
  assert.equal(posted[1]["targetType"], "job", "the summary on the job — the gutters have no review step of their own");
  assert.deepEqual(posted[1]["assignees"], [{ membershipId: "22PLUqZNCKaY" }]);
  assert.deepEqual(board.asks, [{ jobId: "job1", move: true, problemsReported: 0, area: "gutters", actor: "Yahir Gonzalez" }]);
  assert.ok(!queries.some((q) => "updateJob" in q), "Close Out writes no Status");
});

test("an area inspection nobody booked is made, so the visit is on record", async () => {
  const queries: PaveQuery[] = [];
  const handle = createHandler(routerDeps(areaResponder({ ...McCOY, tasks: [McCOY.tasks[0]] }), queries));
  const call = fakeHttp("POST", "/jobs/job1/close-area-inspection", {}, { area: "gutters", problemsReported: 0 });
  await handle(call.req, call.res);
  assert.equal(call.out.status, 200);
  const made = dollarOf(queries.find((q) => "createTask" in q), "createTask");
  assert.equal(made["name"], "Final inspection — Gutters");
  assert.equal(made["taskTypeId"], TASK_TYPES.inspection);
  assert.equal(made["isToDo"], true);
  assert.equal(JSON.parse(call.out.body).completedTaskId, "new-task");
});

test("close-area-inspection refuses an area the job does not have", async () => {
  const handle = createHandler(routerDeps(areaResponder(McCOY), []));
  const call = fakeHttp("POST", "/jobs/job1/close-area-inspection", {}, { area: "siding", problemsReported: 0 });
  await handle(call.req, call.res);
  assert.equal(call.out.status, 400);
  assert.match(JSON.parse(call.out.body).error, /shingle, gutters/);
});

test("an inspection photo for the gutters lands on the gutters' inspection", async () => {
  const queries: PaveQuery[] = [];
  const responder = areaResponder(McCOY);
  const handle = createHandler(
    routerDeps((q) => {
      if ("createUploadRequest" in q) {
        return { createUploadRequest: { createdUploadRequest: { id: "u1", url: "https://up.example", method: "PUT", headers: {} } } };
      }
      if ("createFile" in q) return { createFile: { createdFile: { id: "f1" } } };
      return responder(q);
    }, queries),
  );
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
  try {
    const call = fakeHttp("POST", "/jobs/job1/photos", {}, { label: "INSPECTION", imageBase64: PIXEL, area: "gutters" });
    await handle(call.req, call.res);
    assert.equal(call.out.status, 200);
    assert.equal(dollarOf(queries.find((q) => "createFile" in q), "createFile")["targetId"], "fg");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("finishing a repair answers where the board moved the job and who was told", async () => {
  const board = boardThat({ moved: { from: "Punch List", to: "PM Review" }, areas: [] });
  const handle = createHandler({ ...routerDeps(areaResponder({ ...McCOY, status: "Punch List" }), []), board });
  const call = fakeHttp("POST", "/tasks/pt1/complete", {}, { jobId: "job1" });
  await handle(call.req, call.res);
  assert.equal(call.out.status, 200);
  assert.deepEqual(JSON.parse(call.out.body), { ok: true, flipped: "PM Review", sentTo: null });
  assert.deepEqual(board.asks, [{ jobId: "job1", move: true, actor: "Yahir Gonzalez" }]);
});

test("the queue lists a job still in production when a work area's close-out is assigned to them", async () => {
  const queries: PaveQuery[] = [];
  const job = (id: string, number: string, status: string) => ({
    id,
    number,
    name: `${number} Test`,
    customFieldValues: { nodes: [{ value: status, customField: { id: CUSTOM_FIELDS.status } }] },
  });
  const handle = createHandler(
    routerDeps((q) => {
      if ("customField" in q) {
        return { customField: { customFieldValues: { nextPage: null, nodes: [{ job: job("jFI", "26-0900", "Final Inspection") }] } } };
      }
      if ("organization" in q) {
        const me = [{ id: "m1", user: { name: "Yahir Gonzalez", emailAddress: "yahirgonzalez@deitemeyerbrothers.com" } }];
        return {
          organization: {
            tasks: {
              nextPage: null,
              nodes: [
                { id: "t1", name: "Final inspection — Gutters", isToDo: true, startDate: "2026-10-27", endDate: "2026-10-27", taskType: { id: TASK_TYPES.inspection }, job: { id: "jProd" }, assignedMemberships: { nodes: me } },
                { id: "t2", name: "REPORT: old", isToDo: true, taskType: { id: TASK_TYPES.punchList }, job: { id: "jDone" }, assignedMemberships: { nodes: me } },
                { id: "t3", name: "REPORT: ridge", isToDo: true, taskType: { id: TASK_TYPES.punchList }, job: { id: "jFI" }, assignedMemberships: { nodes: me } },
              ],
            },
          },
        };
      }
      // listJobsByIds: one alias per job.
      const out: Record<string, unknown> = {};
      for (const [alias, sel] of Object.entries(q)) {
        const id = ((sel as Record<string, unknown>)["$"] as Record<string, unknown>)["id"];
        out[alias] = id === "jProd" ? job("jProd", "26-1483", "Production") : job("jDone", "25-7000", "Job Completed");
      }
      return out;
    }, queries),
  );
  const call = fakeHttp("GET", "/queue");
  await handle(call.req, call.res);
  assert.equal(call.out.status, 200);
  const jobs = JSON.parse(call.out.body) as Array<{ id: string; mine: boolean; openPunchCount: number; status: string }>;
  assert.deepEqual(jobs.map((j) => [j.id, j.status, j.mine, j.openPunchCount]), [
    ["jFI", "Final Inspection", true, 1],
    ["jProd", "Production", true, 0],
  ], "the gutters job is theirs; a completed job's stale to-do is not listed");
  // Each of their jobs carries the days its work is booked for, so the phone
  // can file it under its day.
  const booked = Object.fromEntries((JSON.parse(call.out.body) as Array<{ id: string; booked?: unknown }>).map((j) => [j.id, j.booked]));
  assert.deepEqual(booked["jProd"], [{ start: "2026-10-27", end: "2026-10-27", kind: "inspection" }]);
  assert.deepEqual(booked["jFI"], []);
});
