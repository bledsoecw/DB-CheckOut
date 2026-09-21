import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVisit } from "../src/routes";
import { ANSWER, CLEANUP_ITEMS, INSPECTION_ITEMS } from "../../../packages/shared/src/jobtread";

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
import { createHandler, type RouterDeps } from "../src/routes";
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

test("POST /jobs/:id/reports carries the x-client-ref into the task so a re-send is recognised", async () => {
  const queries: PaveQuery[] = [];
  const handle = createHandler(
    routerDeps((q) => ("createTask" in q ? { createTask: { createdTask: { id: "t9" } } } : { job: { tasks: { nodes: [] } } }), queries),
  );
  const call = fakeHttp("POST", "/jobs/job1/reports", { "x-client-ref": "1758400000000-ab12cd" }, { location: "Rear slope", englishNote: "Boot cracked" });
  await handle(call.req, call.res);
  assert.equal(call.out.status, 200);
  assert.equal(JSON.parse(call.out.body).taskId, "t9");
  const created = queries.find((q) => "createTask" in q)!;
  const description = String(((created["createTask"] as Record<string, unknown>)["$"] as Record<string, unknown>)["description"]);
  assert.match(description, /Reported by: Yahir Gonzalez/);
  assert.match(description, /DB CheckOut ref: 1758400000000-ab12cd$/);
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
