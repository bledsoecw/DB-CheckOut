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
