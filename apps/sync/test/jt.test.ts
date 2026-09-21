import { test } from "node:test";
import assert from "node:assert/strict";
import type { PaveClient, PaveQuery } from "../src/pave";
import {
  assignedTo,
  attachFileToComment,
  checklistSubtasks,
  closeInspectionTask,
  findingMessage,
  isInspectionClosed,
  postTaskMessage,
  syncInspectionChecklist,
  visitNotesMessage,
  completeTask,
  createReportTask,
  findFileByRef,
  findTaskByRef,
  inspectionNote,
  listAssignedWorkByJob,
  listPipelineJobs,
  listPipelineTasks,
  listPunchTasks,
  listSoldScope,
  selectScopeDocs,
  syncPunchListTask,
  toQueueJob,
  toScopeLines,
  uploadPhoto,
  type PipelineTask,
} from "../src/jt";
import { ensureWebhook, WEBHOOK_EVENT_TYPES } from "../src/webhookRegistration";
import {
  ANSWER,
  CLEANUP_ITEMS,
  CUSTOM_FIELDS,
  INSPECTION_ITEMS,
  TASK_TYPES,
} from "../../../packages/shared/src/jobtread";
import type { PunchTask } from "../../../packages/shared/src/types";

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

test("listPipelineJobs asks the Status field for pipeline values and maps the jobs", async () => {
  const { client, queries } = fakePave(() => ({
    customField: {
      customFieldValues: {
        nextPage: null,
        nodes: [
          { job: rawJob("j4", "26-0407", "PM Review") },
          { job: rawJob("j1", "26-0418", "Final Inspection") },
          { job: null }, // status value whose job is gone
        ],
      },
    },
  }));

  const jobs = await listPipelineJobs(client);
  assert.deepEqual(jobs.map((j) => j.number), ["26-0407", "26-0418"]);
  assert.equal(jobs[1].status, "Final Inspection");
  assert.equal(jobs[1].jobType, "Roofing");
  const dollar = ((queries[0]["customField"] as Record<string, unknown>)["customFieldValues"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.deepEqual(dollar["where"], {
    or: [
      [["value"], "=", "Final Inspection"],
      [["value"], "=", "Punch List"],
      [["value"], "=", "PM Review"],
    ],
  });
});

test("listPipelineJobs follows pagination and sorts by job number", async () => {
  let call = 0;
  const { client } = fakePave(() => {
    call += 1;
    return call === 1
      ? { customField: { customFieldValues: { nextPage: "p2", nodes: [{ job: rawJob("b", "26-1357", "Final Inspection") }] } } }
      : { customField: { customFieldValues: { nextPage: null, nodes: [{ job: rawJob("a", "26-0002", "Punch List") }] } } };
  });
  const jobs = await listPipelineJobs(client);
  assert.equal(call, 2);
  assert.deepEqual(jobs.map((j) => j.number), ["26-0002", "26-1357"]);
});

// --------------------------------------------------------------------------
// The visit lands on the scheduled "Final inspection" task
// --------------------------------------------------------------------------

const dollarOf = (q: PaveQuery, key: string): Record<string, unknown> =>
  (q[key] as Record<string, unknown>)["$"] as Record<string, unknown>;
const CHECKLIST_NAMES = [...INSPECTION_ITEMS.map((i) => i.subtask), ...CLEANUP_ITEMS.map((i) => i.subtask)];

test("checklistSubtasks writes the eight inspection items then the five cleanup items, OK and N/A ticked", () => {
  const subtasks = checklistSubtasks({
    inspection: {
      [INSPECTION_ITEMS[0].key]: ANSWER.ok,
      [INSPECTION_ITEMS[1].key]: ANSWER.na,
      [INSPECTION_ITEMS[2].key]: ANSWER.action,
      // items 4-8 unanswered
    },
    cleanup: { [CLEANUP_ITEMS[4].key]: ANSWER.ok },
  });
  assert.equal(subtasks.length, INSPECTION_ITEMS.length + CLEANUP_ITEMS.length);
  assert.deepEqual(
    subtasks.map((s) => s.name),
    [...INSPECTION_ITEMS.map((i) => i.subtask), ...CLEANUP_ITEMS.map((i) => i.subtask)],
  );
  assert.deepEqual(
    subtasks.map((s) => s.isComplete),
    [true, true, false, false, false, false, false, false, false, false, false, false, true],
  );
});

test("inspectionNote is the stamp and nothing else — notes are messages, not description", () => {
  assert.equal(inspectionNote({ inspection: {}, cleanup: {} }, "Yahir Gonzalez"), "✔ Inspected by Yahir Gonzalez — via DB CheckOut");
  const withNotes = inspectionNote(
    { inspection: {}, cleanup: {}, notes: { inspection: " Two boots resealed ", attic: "", cleanup: "Magnet run twice" } },
    "Alberto Gonzalez",
  );
  assert.equal(withNotes, "✔ Inspected by Alberto Gonzalez — via DB CheckOut");
});

test("a finding never touches the entry's name: fixed on site ticks it, a report leaves it open", () => {
  const subtasks = checklistSubtasks({
    inspection: { [INSPECTION_ITEMS[7].key]: ANSWER.action },
    cleanup: { [CLEANUP_ITEMS[3].key]: ANSWER.action },
    findings: [
      { itemKey: INSPECTION_ITEMS[7].key, fixedOnSite: false, location: "Attic", note: "Leak at the vent boot", photos: 1 },
      { itemKey: CLEANUP_ITEMS[3].key, fixedOnSite: true, location: "Plants", note: "Plants squished", photos: 2 },
    ],
  });
  assert.deepEqual(subtasks.map((s) => s.name), CHECKLIST_NAMES, "the template's names, untouched");
  assert.equal(subtasks[7].isComplete, false, "a reported item waits for its punch work");
  assert.equal(subtasks[11].isComplete, true, "nothing is left to do on a fixed-on-site item");
  // One open report among two findings on a line keeps it open.
  const two = checklistSubtasks({
    inspection: { [INSPECTION_ITEMS[0].key]: ANSWER.action },
    cleanup: {},
    findings: [
      { itemKey: INSPECTION_ITEMS[0].key, fixedOnSite: true, location: "a", note: "x", photos: 0 },
      { itemKey: INSPECTION_ITEMS[0].key, fixedOnSite: false, location: "b", note: "second", photos: 0 },
    ],
  })[0];
  assert.equal(two.isComplete, false);
});

test("a replayed close keeps a line that JobTread already shows ticked", () => {
  const current = [{ name: INSPECTION_ITEMS[7].subtask, isComplete: true }];
  const subtasks = checklistSubtasks(
    {
      inspection: { [INSPECTION_ITEMS[7].key]: ANSWER.action },
      cleanup: {},
      findings: [{ itemKey: INSPECTION_ITEMS[7].key, fixedOnSite: false, location: "Attic", note: "old note", photos: 0 }],
    },
    current,
  );
  assert.equal(subtasks[7].isComplete, true);
});

test("the description gets the stamp only; the free-text notes become one task message", () => {
  const visit = { inspection: {}, cleanup: {}, notes: { inspection: " Two boots resealed ", attic: "", cleanup: "Magnet run twice" } };
  assert.equal(inspectionNote(visit, "Alberto Gonzalez"), "✔ Inspected by Alberto Gonzalez — via DB CheckOut");
  assert.equal(
    visitNotesMessage(visit, "Alberto Gonzalez"),
    "Inspector notes: Two boots resealed\nCleanup notes: Magnet run twice\n— Alberto Gonzalez via DB CheckOut",
  );
  assert.equal(visitNotesMessage({ inspection: {}, cleanup: {} }, "x"), null);
});

test("findingMessage leads with the checklist line, then the finding and the rest of the report", () => {
  const fixed = findingMessage(
    {
      itemKey: CLEANUP_ITEMS[3].key,
      location: "Plants by the AC",
      englishNote: "Plants squished, reshaped the flashing",
      fixedOnSite: true,
      materialsNote: "No material",
      heardText: "I was able to unsquish him",
    },
    "Carl Bledsoe",
  );
  assert.equal(
    fixed,
    [
      CLEANUP_ITEMS[3].subtask,
      "✔ FIXED ON SITE — Plants squished, reshaped the flashing",
      "Where: Plants by the AC",
      "Materials & time: No material",
      'Crew said (verbatim): "I was able to unsquish him"',
      "Reported by Carl Bledsoe via DB CheckOut",
    ].join("\n"),
  );
  const loose = findingMessage({ location: "Rear slope", englishNote: "Nail pop", originalCrew: "George" }, "Yahir Gonzalez");
  assert.equal(loose, "Problem report — Rear slope\n⚠ REPORT (punch item) — Nail pop\nOriginal work by: George\nReported by Yahir Gonzalez via DB CheckOut");
});

test("postTaskMessage posts once per client reference, internal-only", async () => {
  let posted = 0;
  const { client, queries } = fakePave((q) => {
    if ("createComment" in q) {
      posted += 1;
      return { createComment: { createdComment: { id: `c${posted}` } } };
    }
    return { task: { comments: { nodes: posted > 0 ? [{ id: "c1" }] : [] } } };
  });
  assert.equal(await postTaskMessage(client, "fi", "hello", "175-abc"), "c1");
  const dollar = dollarOf(queries[1], "createComment");
  assert.equal(dollar["targetType"], "task");
  assert.equal(dollar["targetId"], "fi");
  assert.equal(dollar["message"], "hello\n\nDB CheckOut ref: 175-abc");
  assert.equal(dollar["isVisibleToInternalRoles"], true);
  assert.equal(dollar["isVisibleToCustomerRoles"], false);
  assert.equal(dollar["isVisibleToVendorRoles"], false);
  // Re-sent: found, not posted again.
  assert.equal(await postTaskMessage(client, "fi", "hello", "175-abc"), "c1");
  assert.equal(posted, 1);
});

test("attachFileToComment rewrites the message's file list with the new file, once", async () => {
  const { client, queries } = fakePave((q) =>
    "comment" in q ? { comment: { files: { nodes: [{ id: "cf1", file: { id: "f-old" } }] } } } : {},
  );
  assert.equal(await attachFileToComment(client, "c1", "f-new"), "attached");
  assert.deepEqual(dollarOf(queries[1], "updateComment")["files"], [
    { _type: "commentFile", id: "cf1" },
    { _type: "file", id: "f-new" },
  ]);
  assert.equal(await attachFileToComment(client, "c1", "f-old"), "already");
  assert.equal(queries.length, 3, "no write for a file already on the message");
});

test("isInspectionClosed reads the stamp, because JT derives a checklist task's progress from its ticks", () => {
  const base = punchListTask({ name: "Final inspection", taskTypeId: TASK_TYPES.inspection });
  assert.equal(isInspectionClosed({ ...base, progress: 0.85, description: "Template text\n\n✔ Inspected by Carl — via DB CheckOut" }), true);
  assert.equal(isInspectionClosed({ ...base, progress: 0.85, description: "Template text" }), false);
  assert.equal(isInspectionClosed({ ...base, progress: 1, description: null }), true);
  assert.equal(isInspectionClosed(undefined), false);
});

test("syncInspectionChecklist ticks the line a closed punch item came from and keeps its note", async () => {
  const { client, queries } = fakePave(() => ({}));
  const task = punchListTask({
    id: "fi",
    name: "Final inspection",
    subtasks: [
      { name: `${INSPECTION_ITEMS[7].subtask} · ⚠ REPORT — Leak at the boot`, isComplete: false },
      { name: CLEANUP_ITEMS[0].subtask, isComplete: true },
    ],
  });
  const done = { ...punchTask("REPORT: Attic", 1), description: "Leak at the boot\n\nChecklist: 8. Attic\nDB CheckOut item: 8" };
  const open = { ...punchTask("REPORT: Gutter", 0), description: "x\nDB CheckOut item: C3" };
  assert.equal(await syncInspectionChecklist(client, task, [done, open]), "updated");
  const dollar = dollarOf(queries[0], "updateTask");
  assert.deepEqual(dollar["subtasks"], [
    { name: `${INSPECTION_ITEMS[7].subtask} · ⚠ REPORT — Leak at the boot`, isComplete: true },
    { name: CLEANUP_ITEMS[0].subtask, isComplete: true },
  ]);
  // Nothing new to tick: no write.
  const ticked = punchListTask({ id: "fi", subtasks: [{ name: INSPECTION_ITEMS[7].subtask, isComplete: true }] });
  assert.equal(await syncInspectionChecklist(client, ticked, [done]), "unchanged");
  assert.equal(await syncInspectionChecklist(client, undefined, [done]), "none");
  assert.equal(queries.length, 1);
});

test("createReportTask assigns the punch crew when asked, and leaves a FIXED ON SITE record unassigned", async () => {
  const { client, queries } = fakePave(() => ({ createTask: { createdTask: { id: "t" } } }));
  await createReportTask(client, "job1", { location: "Attic", englishNote: "Leak" }, undefined, ["m-alberto", "m-yahir"]);
  assert.deepEqual(dollarOf(queries[0], "createTask")["assignedMembershipIds"], ["m-alberto", "m-yahir"]);
  await createReportTask(client, "job1", { location: "Attic", englishNote: "Leak", fixedOnSite: true });
  assert.equal(dollarOf(queries[1], "createTask")["assignedMembershipIds"], undefined);
});

test("createReportTask names the checklist item the report came from", async () => {
  const { client, queries } = fakePave(() => ({ createTask: { createdTask: { id: "t" } } }));
  await createReportTask(client, "job1", { itemKey: INSPECTION_ITEMS[7].key, location: "Attic", englishNote: "Leak" });
  const description = String((queries[0]["createTask"] as Record<string, unknown>)["$"] && ((queries[0]["createTask"] as Record<string, unknown>)["$"] as Record<string, unknown>)["description"]);
  assert.ok(description.includes(`Checklist: ${INSPECTION_ITEMS[7].subtask}`));
  assert.ok(description.includes("DB CheckOut item: 8"));
});

test("the Punch list mirror keeps the to-do's name as the entry — the note lives on the to-do and the message", async () => {
  const { client, queries } = fakePave(() => ({}));
  const report = { ...punchTask("REPORT: Attic", 0), description: "Leak at the boot\n\nCrew said: x" };
  await syncPunchListTask(client, punchListTask(), [report]);
  assert.deepEqual(dollarOf(queries[0], "updateTask")["subtasks"], [{ name: "REPORT: Attic", isComplete: false }]);
});

test("closeInspectionTask replaces the checklist, stamps the description, and posts the notes as a message", async () => {
  const { client, queries } = fakePave((q) => {
    if ("createComment" in q) return { createComment: { createdComment: { id: "c1" } } };
    if ("task" in q) return { task: { description: "Complete the quality inspection.", comments: { nodes: [] } } };
    return {};
  });
  await closeInspectionTask(
    client,
    "fi1",
    { inspection: { [INSPECTION_ITEMS[0].key]: ANSWER.ok }, cleanup: {}, notes: { inspection: "Clean pass" } },
    "Alberto Gonzalez",
    "175-close",
  );
  assert.deepEqual(queries.map((q) => Object.keys(q)[0]), ["task", "updateTask", "task", "createComment"]);
  const dollar = dollarOf(queries[1], "updateTask");
  assert.equal(dollar["id"], "fi1");
  assert.equal(dollar["progress"], 1);
  assert.equal(dollar["updateDependentTasks"], false, "the pipeline tasks are a chain — never let JT re-date them");
  assert.equal(dollar["notify"], false);
  assert.deepEqual((dollar["subtasks"] as Array<{ name: string }>).map((s) => s.name), CHECKLIST_NAMES);
  assert.equal(dollar["description"], "Complete the quality inspection.\n\n✔ Inspected by Alberto Gonzalez — via DB CheckOut");
  const message = dollarOf(queries[3], "createComment");
  assert.equal(message["targetId"], "fi1");
  assert.equal(message["message"], "Inspector notes: Clean pass\n— Alberto Gonzalez via DB CheckOut\n\nDB CheckOut ref: 175-close.notes");
});

test("closeInspectionTask does not stamp the task twice when the outbox delivers the same close again", async () => {
  const already = "Template text\n\n✔ Inspected by Alberto Gonzalez — via DB CheckOut";
  const { client, queries } = fakePave((q) => ("task" in q ? { task: { description: already } } : {}));
  await closeInspectionTask(client, "fi1", { inspection: {}, cleanup: {} }, "Alberto Gonzalez");
  assert.equal(dollarOf(queries[1], "updateTask")["description"], already);
  assert.equal(queries.length, 2, "no notes, no message");
});

test("listPipelineTasks reads each task's checklist as two-state subtasks", async () => {
  const { client, queries } = fakePave(() => ({
    job: {
      tasks: {
        nodes: [
          {
            id: "fi",
            name: "Final inspection",
            progress: null,
            taskType: { id: TASK_TYPES.inspection },
            subtasks: [{ name: "1. Shingles", isComplete: true }, { name: "2. Edges", isComplete: null }],
          },
          { id: "pl", name: "Punch list", progress: 1, taskType: null, subtasks: null },
        ],
      },
    },
  }));
  const tasks = await listPipelineTasks(client, "job1");
  assert.deepEqual(tasks[0].subtasks, [
    { name: "1. Shingles", isComplete: true },
    { name: "2. Edges", isComplete: false },
  ]);
  assert.deepEqual(tasks[1], { id: "pl", name: "Punch list", progress: 1, taskTypeId: null, description: null, subtasks: [] });
  assert.ok(JSON.stringify(queries[0]).includes("subtasks"), "the query selects the checklist");
});

// --------------------------------------------------------------------------
// The scheduled "Punch list" task mirrors the punch to-dos
// --------------------------------------------------------------------------

function punchTask(name: string, progress: number): PunchTask {
  return { id: `p-${name}`, name, description: null, progress, endDate: null, assignees: [], assigneeNames: [], mine: false };
}

function punchListTask(over: Partial<PipelineTask> = {}): PipelineTask {
  return {
    id: "pl1",
    name: "Punch list",
    progress: 0,
    taskTypeId: TASK_TYPES.general,
    description: null,
    subtasks: [],
    ...over,
  } as PipelineTask;
}

test("syncPunchListTask writes the to-dos onto the checklist when it differs", async () => {
  const { client, queries } = fakePave(() => ({}));
  const result = await syncPunchListTask(client, punchListTask(), [
    punchTask("REPORT: Rear slope — pipe boot", 0),
    punchTask("FIXED ON SITE: Ridge cap", 1),
  ]);
  assert.equal(result, "updated");
  const dollar = dollarOf(queries[0], "updateTask");
  assert.deepEqual(dollar["subtasks"], [
    { name: "REPORT: Rear slope — pipe boot", isComplete: false },
    { name: "FIXED ON SITE: Ridge cap", isComplete: true },
  ]);
  assert.equal(dollar["progress"], undefined, "an open item keeps the task open");
  assert.equal(dollar["updateDependentTasks"], false);
});

test("syncPunchListTask is a no-op when the checklist already matches — the webhook it fires comes back quiet", async () => {
  const { client, queries } = fakePave(() => ({}));
  const task = punchListTask({ subtasks: [{ name: "REPORT: Gutter", isComplete: false }] });
  assert.equal(await syncPunchListTask(client, task, [punchTask("REPORT: Gutter", 0)]), "unchanged");
  assert.equal(queries.length, 0);
});

test("syncPunchListTask completes the task when the last item closes, and never re-opens it", async () => {
  const { client, queries } = fakePave(() => ({}));
  const task = punchListTask({ subtasks: [{ name: "REPORT: Gutter", isComplete: false }] });
  assert.equal(await syncPunchListTask(client, task, [punchTask("REPORT: Gutter", 1)]), "updated");
  assert.equal(dollarOf(queries[0], "updateTask")["progress"], 1);

  // Already complete in JT and a new item shows up: the checklist updates, progress is left alone.
  const done = punchListTask({ progress: 1, subtasks: [{ name: "REPORT: Gutter", isComplete: true }] });
  await syncPunchListTask(client, done, [punchTask("REPORT: Gutter", 1), punchTask("REPORT: Vent", 0)]);
  assert.equal(dollarOf(queries[1], "updateTask")["progress"], undefined);
});

test("syncPunchListTask marks the step not required after a clean inspection, once", async () => {
  const { client, queries } = fakePave((q) => ("task" in q ? { task: { description: "Conditional." } } : {}));
  assert.equal(await syncPunchListTask(client, punchListTask(), [], { cleanInspection: true }), "updated");
  const dollar = dollarOf(queries[1], "updateTask");
  assert.equal(dollar["progress"], 1);
  assert.equal(dollar["description"], "Conditional.\n\n✔ Not required — clean inspection, nothing to fix (via DB CheckOut)");

  // Without the clean-inspection signal (a webhook replay), nothing is written.
  assert.equal(await syncPunchListTask(client, punchListTask(), []), "unchanged");
  assert.equal(queries.length, 2);
  // And a job without the template has nothing to mirror onto.
  assert.equal(await syncPunchListTask(client, undefined, [punchTask("REPORT: x", 0)]), "none");
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
  assert.equal(dollar["targetType"], "job");
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
  // updateDependentTasks MUST be false: Pave defaults it to true and would
  // cascade dates onto the rest of the pipeline chain.
  assert.deepEqual(dollar, {
    id: "t1",
    updateDependentTasks: false,
    notify: false,
    progress: 1,
  });
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
    number: 4,
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
              { id: "d1", name: "Estimate", number: 4, type: "customerOrder", status: "approved", price: 100, issueDate: "2026-07-01" },
              { id: "junk", name: "Invoice", number: 9, type: "customerInvoice", status: "approved", price: 1, issueDate: null },
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
  assert.equal(scope[0].number, 4);
  assert.match(scope[0].jtUrl, /app\.jobtread\.com\/jobs\/job1\/documents\/d1$/);
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

// --------------------------------------------------------------------------
// Whose punch item is it?
// --------------------------------------------------------------------------

function punch(assignees: Array<{ name: string; email: string | null }>) {
  return {
    id: "t1",
    name: "Reseal the pipe boot",
    description: null,
    progress: 0,
    endDate: null,
    assignees: assignees.map((a, i) => ({ membershipId: `m${i}`, ...a })),
    assigneeNames: assignees.map((a) => a.name),
    mine: false,
  };
}

test("assignedTo matches on email, ignoring case and spacing", () => {
  const task = punch([{ name: "Alberto Gonzalez", email: "albertogonzalez@deitemeyerbrothers.com" }]);
  assert.equal(
    assignedTo(task, { email: "  AlbertoGonzalez@Deitemeyerbrothers.com ", name: "Whoever" }),
    true,
  );
});

test("assignedTo falls back to the name when the emails differ", () => {
  // Subs sign in on a personal Google account that isn't their JT address.
  const task = punch([{ name: "Marcos Gonzales", email: "enfoqueconstructionfw@gmail.com" }]);
  assert.equal(assignedTo(task, { email: "marcos.personal@gmail.com", name: "marcos gonzales" }), true);
});

test("assignedTo says no for somebody else's item, and with no session", () => {
  const task = punch([{ name: "Alberto Gonzalez", email: "albertogonzalez@deitemeyerbrothers.com" }]);
  assert.equal(assignedTo(task, { email: "kyle@deitemeyerbrothers.com", name: "Kyle Akerman" }), false);
  assert.equal(assignedTo(task, undefined), false);
});

test("assignedTo ignores blank assignee fields rather than matching everyone", () => {
  const task = punch([{ name: "", email: null }]);
  assert.equal(assignedTo(task, { email: "", name: "" }), false);
  assert.equal(assignedTo(task, { email: "someone@deitemeyerbrothers.com", name: "Someone" }), false);
});

function orgTask(
  id: string,
  jobId: string,
  taskTypeId: string,
  assignees: Array<{ name: string; email: string | null }>,
) {
  return {
    id,
    taskType: { id: taskTypeId },
    job: { id: jobId },
    assignedMemberships: {
      nodes: assignees.map((a, i) => ({
        id: `m${i}`,
        user: { name: a.name, emailAddress: a.email },
      })),
    },
  };
}

const ALBERTO = { name: "Alberto Gonzalez", email: "albertogonzalez@deitemeyerbrothers.com" };

test("listAssignedWorkByJob groups the viewer's open tasks by job, punch count separate", async () => {
  const { client, queries } = fakePave(() => ({
    organization: {
      tasks: {
        nextPage: null,
        nodes: [
          orgTask("t1", "jobA", TASK_TYPES.punchList, [ALBERTO]),
          orgTask("t2", "jobA", TASK_TYPES.punchList, [ALBERTO]),
          // Inspection visit: makes the job "theirs" without inflating the repairs badge.
          orgTask("t3", "jobB", TASK_TYPES.inspection, [ALBERTO]),
          // Somebody else's punch item — must not count for Alberto.
          orgTask("t4", "jobC", TASK_TYPES.punchList, [{ name: "Marcos G.", email: null }]),
          // Task with no job link (org-level) — ignored.
          { id: "t5", taskType: { id: TASK_TYPES.punchList }, job: null, assignedMemberships: { nodes: [] } },
        ],
      },
    },
  }));

  const work = await listAssignedWorkByJob(client, {
    email: "AlbertoGonzalez@deitemeyerbrothers.com",
    name: "whoever",
  });
  assert.deepEqual(work.get("jobA"), { any: true, punchOpen: 2 });
  assert.deepEqual(work.get("jobB"), { any: true, punchOpen: 0 });
  assert.equal(work.get("jobC"), undefined);

  // The filter must only ask for open punch/inspection tasks (progress != 1
  // keeps JT's null-progress items, which are open work too).
  const dollar = ((queries[0]["organization"] as Record<string, unknown>)["tasks"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  // Newest first: the scan stops after a few hundred tasks and the org has
  // hundreds of older open sales inspections — oldest-first never reached
  // anything assigned this month.
  assert.deepEqual(dollar["sortBy"], [{ field: "createdAt", order: "desc" }]);
  assert.deepEqual(dollar["where"], {
    and: [
      {
        or: [
          { and: [[["taskType", "id"], "=", TASK_TYPES.punchList], [["isToDo"], "=", true]] },
          [["taskType", "id"], "=", TASK_TYPES.inspection],
        ],
      },
      [["progress"], "!=", 1],
    ],
  });
});

test("listAssignedWorkByJob follows pagination and matches subs by name", async () => {
  let call = 0;
  const { client } = fakePave(() => {
    call += 1;
    return call === 1
      ? { organization: { tasks: { nextPage: "p2", nodes: [orgTask("t1", "jobA", TASK_TYPES.punchList, [{ name: "Marcos Gonzales", email: "enfoqueconstructionfw@gmail.com" }])] } } }
      : { organization: { tasks: { nextPage: null, nodes: [orgTask("t2", "jobB", TASK_TYPES.punchList, [{ name: "Marcos Gonzales", email: "enfoqueconstructionfw@gmail.com" }])] } } };
  });
  const work = await listAssignedWorkByJob(client, {
    email: "marcos.personal@gmail.com",
    name: "Marcos Gonzales",
  });
  assert.equal(call, 2);
  assert.deepEqual([...work.keys()].sort(), ["jobA", "jobB"]);
});

test("listAssignedWorkByJob never breaks the queue — no viewer or errors mean an empty map", async () => {
  const boom = fakePave(() => {
    throw new Error("429 rate limited");
  });
  assert.equal((await listAssignedWorkByJob(boom.client, { email: "x@y.com", name: "X" })).size, 0);

  const idle = fakePave(() => ({}));
  assert.equal((await listAssignedWorkByJob(idle.client, undefined)).size, 0);
  assert.equal(idle.queries.length, 0, "no viewer, no query");
});

test("listPunchTasks reads the real assignedMemberships shape", async () => {
  const { client, queries } = fakePave(() => ({
    job: {
      tasks: {
        nodes: [
          {
            id: "p1",
            name: "Alberto — reseal the pipe boot",
            description: "Warranty · asked by Dave Elick",
            progress: 0,
            endDate: null,
            isToDo: true,
            taskType: { id: TASK_TYPES.punchList },
            assignedMemberships: {
              nodes: [
                {
                  id: "22PdPUpWzpHy",
                  user: {
                    id: "22PdPUpX2vyr",
                    name: "Alberto Gonzalez",
                    emailAddress: "albertogonzalez@deitemeyerbrothers.com",
                  },
                },
              ],
            },
          },
          { id: "p2", name: "Not punch", description: null, progress: 0, endDate: null, isToDo: true, taskType: { id: "other" } },
          // The template's scheduled "Punch list" phase task carries the Punch List type too.
          { id: "p3", name: "Punch list", description: "Conditional…", progress: null, endDate: null, isToDo: false, taskType: { id: TASK_TYPES.punchList } },
        ],
      },
    },
  }));

  const tasks = await listPunchTasks(client, "job1");
  assert.equal(tasks.length, 1, "only Punch List-typed TO-DOs come back");
  assert.deepEqual(tasks[0].assigneeNames, ["Alberto Gonzalez"]);
  assert.equal(tasks[0].assignees[0].membershipId, "22PdPUpWzpHy");
  assert.equal(tasks[0].assignees[0].email, "albertogonzalez@deitemeyerbrothers.com");

  // The old query never asked for assignees at all, which is why the app
  // could never show them. Guard the selection so that can't come back.
  const selection = JSON.stringify(queries[0]);
  assert.ok(selection.includes("assignedMemberships"), "the query asks for assignees");
  // 50 tasks x 10 assignees with the user fields is over Pave's declared-size
  // budget (live: "Request Entity Too Large" — every job screen 502'd).
  const tasksArgs = ((queries[0]["job"] as Record<string, unknown>)["tasks"] as Record<string, unknown>);
  const membersArgs = ((tasksArgs["nodes"] as Record<string, unknown>)["assignedMemberships"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.equal((tasksArgs["$"] as Record<string, unknown>)["size"], 50);
  assert.equal(membersArgs["size"], 5);
});

// --------------------------------------------------------------------------
// Re-sends: the client reference makes reports and photos land once
// --------------------------------------------------------------------------

test("createReportTask with a client reference writes the reference into the task and skips the lookup-less path", async () => {
  const { client, queries } = fakePave((q) =>
    "createTask" in q ? { createTask: { createdTask: { id: "t-new" } } } : { job: { tasks: { nodes: [] } } },
  );
  const id = await createReportTask(client, "job1", { location: "Rear slope", englishNote: "Boot cracked" }, "1758400000000-ab12cd");
  assert.equal(id, "t-new");
  assert.equal(queries.length, 2, "one lookup, one create");
  const lookup = ((queries[0]["job"] as Record<string, unknown>)["tasks"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.deepEqual(lookup["where"], [["description"], "like", "%DB CheckOut ref: 1758400000000-ab12cd%"]);
  const dollar = (queries[1]["createTask"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.match(String(dollar["description"]), /DB CheckOut ref: 1758400000000-ab12cd$/);
});

test("createReportTask returns the existing task when the reference already landed — no second REPORT", async () => {
  const { client, queries } = fakePave(() => ({ job: { tasks: { nodes: [{ id: "t-existing" }] } } }));
  const id = await createReportTask(client, "job1", { location: "Rear slope", englishNote: "Boot cracked" }, "1758400000000-ab12cd");
  assert.equal(id, "t-existing");
  assert.equal(queries.length, 1);
  assert.ok(!("createTask" in queries[0]));
});

test("an unusable client reference is ignored rather than written into JobTread", async () => {
  const { client, queries } = fakePave(() => ({ createTask: { createdTask: { id: "t" } } }));
  await createReportTask(client, "job1", { location: "x", englishNote: "y" }, "not a ref; drop table");
  assert.equal(queries.length, 1, "no lookup for a bad reference");
  assert.ok(!String((queries[0]["createTask"] as Record<string, unknown>)["$"]).includes("ref"));
  assert.equal(await findTaskByRef(client, "job1", "bad ref"), null);
  assert.equal(await findFileByRef(client, "task", "t1", ""), null);
});

test("uploadPhoto with a client reference skips a photo that already landed and stamps a new one", async () => {
  let files: Array<{ id: string }> = [{ id: "f-existing" }];
  const fetchCalls: string[] = [];
  const { client, queries } = fakePave((q) => {
    if ("task" in q) return { task: { files: { nodes: files } } };
    if ("createUploadRequest" in q) {
      return { createUploadRequest: { createdUploadRequest: { id: "u1", url: "https://up", method: "PUT", headers: {} } } };
    }
    return { createFile: { createdFile: { id: "f-new" } } };
  });
  const fetchImpl = (async (url: string) => {
    fetchCalls.push(url);
    return { ok: true, status: 200 } as Response;
  }) as unknown as typeof fetch;
  const photo = { label: "REPORT" as const, data: Buffer.from("img"), contentType: "image/jpeg", taskId: "t1", byName: "Yahir", clientRef: "175-abc" };

  assert.equal(await uploadPhoto(client, "job1", photo, fetchImpl), "f-existing");
  assert.equal(fetchCalls.length, 0, "no bytes sent for a photo that is already there");
  assert.equal(queries.length, 1);

  files = [];
  assert.equal(await uploadPhoto(client, "job1", photo, fetchImpl), "f-new");
  assert.equal(fetchCalls.length, 1);
  const created = (queries[queries.length - 1]["createFile"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.equal(created["description"], "Uploaded from DB CheckOut by Yahir · DB CheckOut ref: 175-abc");
  assert.equal(created["targetType"], "task");
});

test("completeTask does not write the done note twice on a re-send", async () => {
  const already = "Work order\n\n✔ Done — two boots — Yahir Gonzalez";
  const { client, queries } = fakePave((q) => ("task" in q ? { task: { description: already } } : {}));
  await completeTask(client, "t1", "two boots — Yahir Gonzalez");
  const dollar = (queries[1]["updateTask"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.equal(dollar["description"], already);
  assert.equal(dollar["progress"], 1);
});
