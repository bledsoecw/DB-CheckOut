import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { CLOSEOUT_FORMS, ROOF_FORM, jobFormKey } from "../../../packages/shared/src/forms";
import { CLEANUP_ITEMS, INSPECTION_ITEMS } from "../../../packages/shared/src/jobtread";
import { mintSession } from "../src/auth";
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

test("only the roof form is written to JobTread yet, and it is every job's", () => {
  assert.deepEqual(Object.keys(CLOSEOUT_FORMS), ["roof"]);
  assert.equal(jobFormKey(), "roof");
});

const SECRET = "forms-test-secret";
const TOKEN = mintSession(SECRET, { email: "yahirgonzalez@deitemeyerbrothers.com", name: "Yahir Gonzalez" });
function post(path: string, body: unknown) {
  const chunks = [Buffer.from(JSON.stringify(body))];
  const req = { method: "POST", url: path, headers: { authorization: `Bearer ${TOKEN}` }, async *[Symbol.asyncIterator]() { yield* chunks; } } as unknown as IncomingMessage;
  const out = { status: 0, body: "" };
  const res = { writeHead(s: number) { out.status = s; }, end(t?: string) { out.body = t ?? ""; } } as unknown as ServerResponse;
  return { req, res, out };
}

test("close-inspection refuses a form it cannot write, rather than writing it as the roof's", async () => {
  const queries: unknown[] = [];
  const deps: RouterDeps = {
    pave: { async query<T>(q: unknown): Promise<T> { queries.push(q); return {} as T; } },
    sessionSecret: SECRET, geminiApiKey: "", geminiModel: "gemini-test", googleClientId: "client-id",
    workspaceDomain: "deitemeyerbrothers.com", allowedEmails: [], webhookSecret: "", crewAppSecret: "",
  };
  const { req, res, out } = post("/jobs/22PJOB/close-inspection", { form: "walkthrough", answers: { walkthrough: {} } });
  await createHandler(deps)(req, res);
  assert.equal(out.status, 400);
  assert.match(JSON.parse(out.body).error, /walkthrough form is not written to JobTread yet/);
  assert.equal(queries.length, 0);
});
