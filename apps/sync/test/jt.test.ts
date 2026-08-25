import { test } from "node:test";
import assert from "node:assert/strict";
import type { PaveClient, PaveQuery } from "../src/pave";
import {
  completeTask,
  createReportTask,
  listPipelineJobs,
  listSoldScope,
  selectScopeDocs,
  submitForm,
  toQueueJob,
  toScopeLines,
  uploadPhoto,
} from "../src/jt";
import { ensureWebhook, WEBHOOK_EVENT_TYPES } from "../src/webhookRegistration";
import { CUSTOM_FIELDS, INSPECTION_FORM, TASK_TYPES } from "../../../packages/shared/src/jobtread";

function fakePave(responder: (q: PaveQuery) => unknown): { client: PaveClient; queries: PaveQuery[] } {
  const queries: PaveQuery[] = [];
  return {
    queries,
    client: {
      async query<T>(q: PaveQuery): Promise<T> {
        queries.push(q);
        return responder(q) as T;
      },
    },
  };
}

function rawJob(id: string, number: string, status: string) {
  return {
    id,
    number,
    name: `${number} Test_Roof`,
    customFieldValues: {
      nodes: [
        { value: status, customField: { id: CUSTOM_FIELDS.status } },
        { value: "Roofing", customField: { id: CUSTOM_FIELDS.jobType } },
      ],
    },
  };
}

test("listPipelineJobs keeps only pipeline statuses and maps custom fields", async () => {
  const { client } = fakePave(() => ({
    organization: {
      jobs: {
        nextPage: null,
        nodes: [
          rawJob("j1", "26-0418", "Final Inspection"),
          rawJob("j2", "26-0415", "Punch List"),
          rawJob("j3", "26-0300", "Closed"),
          rawJob("j4", "26-0407", "Punch Review"),
          rawJob("j5", "26-0299", "Production"),
        ],
      },
    },
  }));

  const jobs = await listPipelineJobs(client);
  assert.deepEqual(
    jobs.map((j) => j.number),
    ["26-0418", "26-0415", "26-0407"],
  );
  assert.equal(jobs[0].status, "Final Inspection");
  assert.equal(jobs[0].jobType, "Roofing");
});

test("listPipelineJobs follows pagination", async () => {
  let call = 0;
  const { client } = fakePave(() => {
    call += 1;
    return call === 1
      ? { organization: { jobs: { nextPage: "p2", nodes: [rawJob("a", "26-0001", "Final Inspection")] } } }
      : { organization: { jobs: { nextPage: null, nodes: [rawJob("b", "26-0002", "Punch List")] } } };
  });
  const jobs = await listPipelineJobs(client);
  assert.equal(call, 2);
  assert.deepEqual(jobs.map((j) => j.id), ["a", "b"]);
});

test("submitForm sends a filled, submitted form with values keyed by field id", async () => {
  const { client, queries } = fakePave(() => ({
    createFormSubmission: { createdFormSubmission: { id: "sub1" } },
  }));
  const values = { [INSPECTION_FORM.optionFields[0]]: "OK" };
  const id = await submitForm(client, INSPECTION_FORM.id, "job1", values);
  assert.equal(id, "sub1");
  const dollar = (queries[0]["createFormSubmission"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.equal(dollar["formId"], INSPECTION_FORM.id);
  assert.equal(dollar["targetId"], "job1");
  assert.equal(dollar["isSubmitted"], true);
  assert.deepEqual(dollar["values"], values);
});

test("createReportTask creates an unassigned Punch List to-do with the English note", async () => {
  const { client, queries } = fakePave(() => ({ createTask: { createdTask: { id: "t1" } } }));
  const id = await createReportTask(client, "job1", {
    location: "Rear slope — pipe boot",
    englishNote: "The pipe boot is cracked. Replace it.",
    heardText: "La bota del tubo está quebrada",
    reportedBy: "José R.",
  });
  assert.equal(id, "t1");
  const dollar = (queries[0]["createTask"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.equal(dollar["targetId"], "job1");
  assert.equal(dollar["taskTypeId"], TASK_TYPES.punchList);
  assert.equal(dollar["isToDo"], true);
  assert.equal(dollar["name"], "REPORT: Rear slope — pipe boot");
  const description = String(dollar["description"]);
  assert.match(description, /Replace it\./);
  assert.match(description, /La bota del tubo/);
  assert.match(description, /José R\./);
  assert.equal(dollar["progress"], undefined);
});

test("createReportTask with fixedOnSite creates the task already complete as documentation", async () => {
  const { client, queries } = fakePave(() => ({ createTask: { createdTask: { id: "t2" } } }));
  await createReportTask(client, "job1", {
    location: "Rear slope — pipe boot",
    englishNote: "Pipe boot was cracked.",
    fixedOnSite: true,
    materialsNote: "1 pipe boot, 20 min",
    originalCrew: "Vasquez crew",
  });
  const dollar = (queries[0]["createTask"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.equal(dollar["name"], "FIXED ON SITE: Rear slope — pipe boot");
  assert.equal(dollar["progress"], 1);
  const description = String(dollar["description"]);
  assert.match(description, /Corrected on site/);
  assert.match(description, /Materials & time: 1 pipe boot, 20 min/);
  assert.match(description, /Original work by: Vasquez crew/);
});

test("completeTask without a note only sets progress", async () => {
  const { client, queries } = fakePave(() => ({}));
  await completeTask(client, "t1");
  assert.equal(queries.length, 1);
  const dollar = (queries[0]["updateTask"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.deepEqual(dollar, { id: "t1", progress: 1 });
});

test("completeTask with a note appends the correction to the task description", async () => {
  const { client, queries } = fakePave((q) =>
    "task" in q ? { task: { description: "Reconnect the downspout." } } : {},
  );
  await completeTask(client, "t1", "2 straps, 15 min");
  assert.equal(queries.length, 2);
  const dollar = (queries[1]["updateTask"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.equal(dollar["progress"], 1);
  assert.equal(dollar["description"], "Reconnect the downspout.\n\n✔ Done — 2 straps, 15 min");
});

test("toQueueJob collects multi-value project types and flags service calls", () => {
  const job = toQueueJob({
    id: "s",
    number: "26-0500",
    name: "26-0500 Estes_Service",
    customFieldValues: {
      nodes: [
        { value: "Roofing", customField: { id: CUSTOM_FIELDS.jobType } },
        { value: "R-Shingles", customField: { id: CUSTOM_FIELDS.projectType } },
        { value: "R-Warranty", customField: { id: CUSTOM_FIELDS.projectType } },
      ],
    },
  });
  assert.deepEqual(job.projectTypes, ["R-Shingles", "R-Warranty"]);
  assert.equal(job.isService, true);
  assert.equal(toQueueJob(rawJob("x", "26-0001", "Closed")).isService, false);
});

test("selectScopeDocs keeps only approved customer orders, oldest first", () => {
  const doc = (id: string, type: string, status: string, issueDate: string | null) => ({
    id,
    name: id,
    type,
    status,
    price: 100,
    issueDate,
  });
  const scope = selectScopeDocs([
    doc("change-order", "customerOrder", "approved", "2026-05-12"),
    doc("invoice", "customerInvoice", "approved", "2026-04-01"),
    doc("pending-estimate", "customerOrder", "pending", "2026-05-05"),
    doc("work-order", "vendorOrder", "approved", "2026-03-14"),
    doc("original", "customerOrder", "approved", "2026-03-14"),
  ]);
  assert.deepEqual(scope.map((d) => d.id), ["original", "change-order"]);
});

test("toScopeLines drops zero quantities and empty descriptions", () => {
  assert.deepEqual(toScopeLines([{ name: "Item", description: "", quantity: 0, unit: null }]), [
    { name: "Item", quantity: null, unit: null, description: null },
  ]);
  assert.deepEqual(toScopeLines([{ name: "Shingles", description: "OC", quantity: 2, unit: { name: "Square" } }]), [
    { name: "Shingles", quantity: 2, unit: "Square", description: "OC" },
  ]);
});

test("listSoldScope fetches lines per approved order and follows pagination", async () => {
  const { client, queries } = fakePave((q) => {
    if ("job" in q) {
      return {
        job: {
          documents: {
            nodes: [
              { id: "d1", name: "Estimate", type: "customerOrder", status: "approved", price: 100, issueDate: "2026-07-01" },
              { id: "junk", name: "Invoice", type: "customerInvoice", status: "approved", price: 1, issueDate: null },
            ],
          },
        },
      };
    }
    const page = ((q["document"] as Record<string, unknown>)["costItems"] as Record<string, unknown>)["$"] as Record<string, unknown>;
    return page["page"] === "p2"
      ? { document: { costItems: { nextPage: null, nodes: [{ name: "B", description: null, quantity: 1, unit: null }] } } }
      : { document: { costItems: { nextPage: "p2", nodes: [{ name: "A", description: null, quantity: 1, unit: null }] } } };
  });
  const scope = await listSoldScope(client, "job1");
  assert.equal(queries.length, 3); // doc list + two line pages, only for the approved order
  assert.deepEqual(scope.map((d) => d.id), ["d1"]);
  assert.deepEqual(scope[0].lines.map((l) => l.name), ["A", "B"]);
});

test("listSoldScope never breaks the job detail — errors become an empty scope", async () => {
  const { client } = fakePave(() => {
    throw new Error("Request Entity Too Large");
  });
  assert.deepEqual(await listSoldScope(client, "job1"), []);
});

test("uploadPhoto requests an upload, sends the bytes, attaches the file to the task", async () => {
  const { client, queries } = fakePave((q) =>
    "createUploadRequest" in q
      ? {
          createUploadRequest: {
            createdUploadRequest: {
              id: "up1",
              url: "https://uploads.jobtread.com/x",
              method: "PUT",
              headers: { "x-key": "v" },
            },
          },
        }
      : { createFile: { createdFile: { id: "f1" } } },
  );
  const sent: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch = (async (url: unknown, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} });
    return { ok: true, status: 200 } as Response;
  }) as typeof fetch;

  const fileId = await uploadPhoto(
    client,
    "job1",
    { label: "AFTER", data: Buffer.from("img"), contentType: "image/jpeg", taskId: "t9", byName: "Yahir Gonzalez" },
    fakeFetch,
  );
  assert.equal(fileId, "f1");
  assert.equal(sent[0].url, "https://uploads.jobtread.com/x");
  assert.equal(sent[0].init.method, "PUT");
  const createDollar = (queries[1]["createFile"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.equal(createDollar["targetId"], "t9");
  assert.equal(createDollar["targetType"], "task");
  assert.equal(createDollar["uploadRequestId"], "up1");
  assert.match(String(createDollar["name"]), /^AFTER .*Yahir Gonzalez$/);
});

test("uploadPhoto without a task attaches to the job", async () => {
  const { client, queries } = fakePave((q) =>
    "createUploadRequest" in q
      ? { createUploadRequest: { createdUploadRequest: { id: "up1", url: "u", method: "PUT", headers: {} } } }
      : { createFile: { createdFile: { id: "f2" } } },
  );
  const okFetch = (async () => ({ ok: true, status: 200 }) as Response) as typeof fetch;
  await uploadPhoto(client, "job1", { label: "REPORT", data: Buffer.from("x"), contentType: "image/png", byName: "A" }, okFetch);
  const createDollar = (queries[1]["createFile"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.equal(createDollar["targetId"], "job1");
  assert.equal(createDollar["targetType"], "job");
});

test("ensureWebhook creates once, skips existing, skips unconfigured", async () => {
  const make = (existingUrl: string | null) =>
    fakePave((q) =>
      "organization" in q
        ? {
            organization: {
              webhooks: { nodes: existingUrl ? [{ id: "w1", url: existingUrl }] : [] },
            },
          }
        : { createWebhook: {} },
    );

  const fresh = make(null);
  assert.equal(await ensureWebhook(fresh.client, "https://x.example", "sec"), "created");
  const createDollar = (fresh.queries[1]["createWebhook"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.equal(createDollar["url"], "https://x.example/webhooks/jobtread/sec");
  assert.deepEqual(createDollar["eventTypes"], WEBHOOK_EVENT_TYPES);

  const already = make("https://x.example/webhooks/jobtread/sec");
  assert.equal(await ensureWebhook(already.client, "https://x.example/", "sec"), "exists");
  assert.equal(already.queries.length, 1);

  const other = make("https://script.google.com/whatever");
  assert.equal(await ensureWebhook(other.client, "https://x.example", "sec"), "created");

  const off = make(null);
  assert.equal(await ensureWebhook(off.client, "https://x.example", ""), "skipped");
  assert.equal(off.queries.length, 0);
});

test("toQueueJob tolerates missing custom fields", () => {
  const job = toQueueJob({
    id: "x",
    number: "26-0001",
    name: "26-0001 Test",
    customFieldValues: { nodes: [] },
  });
  assert.equal(job.status, "");
  assert.equal(job.projectManager, null);
  assert.equal(job.address, null);
  assert.deepEqual(job.projectTypes, []);
  assert.equal(job.isService, false);
});
