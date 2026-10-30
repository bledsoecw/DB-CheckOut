import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac } from "node:crypto";
import { assertAllowedIdentity } from "../src/auth";
import { createHandler, decodePhoto, type RouterDeps } from "../src/routes";
import type { PaveClient, PaveQuery } from "../src/pave";

const CREW = "crew-app-test-secret";
const USER = { email: "yahir@deitemeyerbrothers.com", name: "Yahir Gonzalez" };
/** How DB Crew's Apps Script calls: the shared secret and the person. */
const AS_YAHIR = { authorization: `Bearer ${CREW}`, "x-acting-email": USER.email, "x-acting-name": USER.name };

test("assertAllowedIdentity accepts the Workspace domain and the allow-list only", () => {
  const base = { email_verified: true, name: "Alberto Gonzalez" };
  const domain = "deitemeyerbrothers.com";
  // hd claim match
  assert.equal(
    assertAllowedIdentity({ ...base, email: "Alberto@DeitemeyerBrothers.com", hd: domain }, domain, []).email,
    "alberto@deitemeyerbrothers.com",
  );
  // email-suffix match without hd
  assert.equal(
    assertAllowedIdentity({ ...base, email: "yahir@deitemeyerbrothers.com" }, domain, []).name,
    "Alberto Gonzalez",
  );
  // allow-listed personal account
  assert.equal(
    assertAllowedIdentity({ ...base, email: "owner@gmail.com" }, domain, ["owner@gmail.com"]).email,
    "owner@gmail.com",
  );
  // outsiders and unverified emails are rejected
  assert.throws(() => assertAllowedIdentity({ ...base, email: "someone@gmail.com" }, domain, []));
  assert.throws(() =>
    assertAllowedIdentity({ email: "yahir@deitemeyerbrothers.com", email_verified: false }, domain, []),
  );
  // name falls back to the email when Google sends none
  assert.equal(
    assertAllowedIdentity({ email: "a@deitemeyerbrothers.com", email_verified: true }, domain, []).name,
    "a@deitemeyerbrothers.com",
  );
});

// ---------------------------------------------------------------------------
// Route-level auth via fake HTTP
// ---------------------------------------------------------------------------

function fakeHttp(method: string, path: string, headers: Record<string, string> = {}, body?: unknown) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = {
    method,
    url: path,
    headers,
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

function deps(queries: PaveQuery[]): RouterDeps {
  const pave: PaveClient = {
    async query<T>(q: PaveQuery): Promise<T> {
      queries.push(q);
      return { createTask: { createdTask: { id: "t1" } } } as T;
    },
  };
  return {
    pave,
    geminiApiKey: "",
    geminiModel: "gemini-test",
    workspaceDomain: "deitemeyerbrothers.com",
    allowedEmails: [],
    webhookSecret: "hook-secret",
    crewAppSecret: CREW,
  };
}

test("everything but /health needs DB Crew's secret and a person", async () => {
  const handle = createHandler(deps([]));
  const health = fakeHttp("GET", "/health");
  await handle(health.req, health.res);
  assert.equal(health.out.status, 200);

  const noAuth = fakeHttp("GET", "/queue");
  await handle(noAuth.req, noAuth.res);
  assert.equal(noAuth.out.status, 401);

  const badToken = fakeHttp("GET", "/queue", { authorization: "Bearer nope" });
  await handle(badToken.req, badToken.res);
  assert.equal(badToken.out.status, 401);

  const asYahir = fakeHttp("GET", "/queue", AS_YAHIR);
  await handle(asYahir.req, asYahir.res);
  assert.notEqual(asYahir.out.status, 401, "DB Crew acting for Yahir gets in");
});

// The retired Expo app's door (30 Oct 2026, DB Crew T2.29): no sign-in, no
// session tokens. A token it minted is refused whatever it carries.
test("the retired app's sign-in is gone and its session tokens are refused", async () => {
  const handle = createHandler(deps([]));
  for (const [method, path] of [["GET", "/auth/config"], ["POST", "/auth/google"]] as const) {
    const h = fakeHttp(method, path, {}, method === "POST" ? { credential: "fake-google-jwt" } : undefined);
    await handle(h.req, h.res);
    assert.equal(h.out.status, 401, `${path} is not a door any more`);
    assert.doesNotMatch(h.out.body, /token|googleClientId/);
  }
  // A well-formed session token the old server would have accepted.
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ iss: "db-checkout", sub: USER.email, name: USER.name, iat: 1, exp: 9e9 });
  const sig = createHmac("sha256", "any-old-secret").update(`${head}.${body}`).digest("base64url");
  const old = fakeHttp("GET", "/queue", { authorization: `Bearer ${head}.${body}.${sig}` });
  await handle(old.req, old.res);
  assert.equal(old.out.status, 401);
});

test("/health says what the server was built from, and no longer offers sign-in", async () => {
  const handle = createHandler(deps([]));
  const h = fakeHttp("GET", "/health");
  await handle(h.req, h.res);
  const body = JSON.parse(h.out.body) as Record<string, unknown>;
  assert.equal(body["signIn"], undefined);
  assert.equal(body["crewApp"], true);
  // Run from source there is no bundle, and it says so.
  assert.deepEqual(body["build"], { source: null, on: "source", commit: null });
  // DB Crew's Diagnostics compares this with the level the phone needs.
  assert.equal(body["contract"], 1);
});

test("reports are stamped with the acted-for name, not the client's claim", async () => {
  const queries: PaveQuery[] = [];
  const handle = createHandler(deps(queries));
  const call = fakeHttp(
    "POST",
    "/jobs/job1/reports",
    AS_YAHIR,
    { location: "Rear slope", englishNote: "Boot cracked.", reportedBy: "Spoofed Name" },
  );
  await handle(call.req, call.res);
  assert.equal(call.out.status, 200);
  const created = queries.find((q) => "createTask" in q)!;
  const dollar = (created["createTask"] as Record<string, unknown>)["$"] as Record<string, unknown>;
  assert.match(String(dollar["description"]), /Reported by: Yahir Gonzalez/);
  assert.doesNotMatch(String(dollar["description"]), /Spoofed/);
});

test("decodePhoto accepts data URIs and bare base64, rejects junk", () => {
  const bytes = Buffer.from("hello").toString("base64");
  assert.deepEqual(decodePhoto(`data:image/png;base64,${bytes}`), {
    data: Buffer.from("hello"),
    contentType: "image/png",
  });
  assert.equal(decodePhoto(`data:text/html;base64,${bytes}`), null);
  assert.equal(decodePhoto(""), null);
  assert.equal(decodePhoto(undefined), null);
  assert.equal(decodePhoto(bytes)?.contentType, "image/jpeg");
});

test("POST /translate is gated on auth and configuration", async () => {
  const handle = createHandler(deps([]));
  const noAuth = fakeHttp("POST", "/translate", {}, { texts: ["Hello"] });
  await handle(noAuth.req, noAuth.res);
  assert.equal(noAuth.out.status, 401);

  const unconfigured = fakeHttp("POST", "/translate", AS_YAHIR, { texts: ["Hello"] });
  await handle(unconfigured.req, unconfigured.res);
  assert.equal(unconfigured.out.status, 501);
});
