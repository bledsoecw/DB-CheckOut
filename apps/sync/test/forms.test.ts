import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { CLOSEOUT_FORMS, ROOF_FORM, jobFormKey } from "../../../packages/shared/src/forms";
import { CLEANUP_ITEMS, INSPECTION_ITEMS } from "../../../packages/shared/src/jobtread";
import { createHandler, type RouterDeps } from "../src/routes";

// Close Out's forms are data the phone draws (T2.25): the roof form here IS
// the items close-inspection writes, and both languages ride every item.
test("the roof form is the eight inspection items and the five cleanup items, in JobTread order", () => {
  assert.deepEqual(ROOF_FORM.sections.map((s) => s.key), ["inspection", "cleanup"]);
  assert.deepEqual(ROOF_FORM.sections[0].items.map((i) => [i.key, i.n]), INSPECTION_ITEMS.map((i) => [i.key, i.code]));
  assert.deepEqual(ROOF_FORM.sections[1].items.map((i) => [i.key, i.n]), CLEANUP_ITEMS.map((i) => [i.key, i.code]));
});

test("every item carries its Spanish and its English, and the sections are named in both", () => {
  for (const sec of ROOF_FORM.sections) {
    assert.ok(sec.label.es && sec.label.en, sec.key);
    for (const i of sec.items) assert.ok(i.es.length > 0 && i.en.length > 0, i.key);
  }
  assert.deepEqual(ROOF_FORM.sections.map((s) => s.label), [{ es: "Inspección", en: "Inspection" }, { es: "Limpieza", en: "Cleanup" }]);
});

test("the magnet sweep is the customer's lawn, not the shop's yard", () => {
  assert.equal(ROOF_FORM.sections[1].items[0].en, "Magnet sweep — driveway, walks & lawn");
});

test("the roof's form is every job's line inspection; the gutters and the siding have their own (T2.27)", () => {
  assert.deepEqual(Object.keys(CLOSEOUT_FORMS), ["roof", "gutters", "siding"]);
  assert.equal(jobFormKey(), "roof");
});

test("the gutters' and the siding's checklists: inspection then cleanup, every item labelled both ways, keys unique", () => {
  for (const key of ["gutters", "siding"]) {
    const f = CLOSEOUT_FORMS[key];
    assert.deepEqual(f.sections.map((x) => x.key), ["inspection", "cleanup"]);
    for (const sec of f.sections) for (const it of sec.items) assert.ok(it.en && it.es && it.n, `${key} ${it.key} labelled`);
  }
  const keys = Object.values(CLOSEOUT_FORMS).flatMap((f) => f.sections.flatMap((x) => x.items.map((i) => i.key)));
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(CLOSEOUT_FORMS.gutters.sections[0].items.map((i) => i.n), ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"]);
  assert.deepEqual(CLOSEOUT_FORMS.siding.sections[1].items.map((i) => i.n), ["SC1", "SC2", "SC3"]);
});

const CREW = "forms-test-crew-secret";
const AS_YAHIR = { authorization: `Bearer ${CREW}`, "x-acting-email": "yahirgonzalez@deitemeyerbrothers.com", "x-acting-name": "Yahir Gonzalez" };
function post(path: string, body: unknown) {
  const chunks = [Buffer.from(JSON.stringify(body))];
  const req = { method: "POST", url: path, headers: AS_YAHIR, async *[Symbol.asyncIterator]() { yield* chunks; } } as unknown as IncomingMessage;
  const out = { status: 0, body: "" };
  const res = { writeHead(s: number) { out.status = s; }, end(t?: string) { out.body = t ?? ""; } } as unknown as ServerResponse;
  return { req, res, out };
}

test("close-inspection refuses a form it cannot write, rather than writing it as the roof's", async () => {
  const queries: unknown[] = [];
  const deps: RouterDeps = {
    pave: { async query<T>(q: unknown): Promise<T> { queries.push(q); return {} as T; } },
    geminiApiKey: "", geminiModel: "gemini-test",
    workspaceDomain: "deitemeyerbrothers.com", allowedEmails: [], webhookSecret: "", crewAppSecret: CREW,
  };
  const { req, res, out } = post("/jobs/22PJOB/close-inspection", { form: "walkthrough", answers: { walkthrough: {} } });
  await createHandler(deps)(req, res);
  assert.equal(out.status, 400);
  assert.match(JSON.parse(out.body).error, /walkthrough form is not written to JobTread yet/);
  assert.equal(queries.length, 0);
});
