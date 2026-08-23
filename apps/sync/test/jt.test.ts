import { test } from "node:test";
import assert from "node:assert/strict";
import type { PaveClient, PaveQuery } from "../src/pave";
import { createReportTask, listPipelineJobs, submitForm, toQueueJob } from "../src/jt";
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
});
