import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { assertAllowedIdentity, mintSession, SESSION_TTL_SECONDS, verifySession } from "../src/auth";
import { createHandler, decodePhoto, type RouterDeps } from "../src/routes";
import type { PaveClient, PaveQuery } from "../src/pave";

const SECRET = "test-secret";
const USER = { email: "yahir@deitemeyerbrothers.com", name: "Yahir Gonzalez" };

test("session tokens round-trip and carry the user", () => {
  const token = mintSession(SECRET, USER);
  assert.deepEqual(verifySession(SECRET, token), USER);
});

test("session tokens expire, reject tampering and wrong secrets", () => {
  const token = mintSession(SECRET, USER);
  const afterExpiry = Date.now() + (SESSION_TTL_SECONDS + 60) * 1000;
  assert.equal(verifySession(SECRET, token, afterExpiry), null);
  assert.equal(verifySession("other-secret", token), null);
  const [h, p] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ iss: "db-checkout", sub: "x@y.com", exp: 9e9 })).toString("base64url");
  assert.equal(verifySession(SECRET, `${h}.${forged}.${token.split(".")[2]}`), null);
  assert.equal(verifySession(SECRET, `${h}.${p}`), null);
  assert.equal(verifySession(SECRET, ""), null);
});

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
    sessionSecret: SECRET,
    googleClientId: "client-id.apps.googleusercontent.com",
    workspaceDomain: "deitemeyerbrothers.com",
    allowedEmails: [],
    webhookSecret: "hook-secret",
  };
}

test("auth config is public, everything else requires a session", async () => {
  const handle = createHandler(deps([]));
  const cfg = fakeHttp("GET", "/auth/config");
  await handle(cfg.req, cfg.res);
  assert.equal(cfg.out.status, 200);
  assert.deepEqual(JSON.parse(cfg.out.body), { googleClientId: "client-id.apps.googleusercontent.com" });

  const noAuth = fakeHttp("GET", "/queue");
  await handle(noAuth.req, noAuth.res);
  assert.equal(noAuth.out.status, 401);

  const badToken = fakeHttp("GET", "/queue", { authorization: "Bearer nope" });
  await handle(badToken.req, badToken.res);
  assert.equal(badToken.out.status, 401);
});

test("POST /auth/google verifies, gates the domain, and mints a session", async () => {
  const d = deps([]);
  d.verifyGoogle = async () => ({
    email: USER.email,
    email_verified: true,
    name: USER.name,
    hd: "deitemeyerbrothers.com",
  });
  const handle = createHandler(d);
  const login = fakeHttp("POST", "/auth/google", {}, { credential: "fake-google-jwt" });
  await handle(login.req, login.res);
  assert.equal(login.out.status, 200);
  const granted = JSON.parse(login.out.body) as { token: string; name: string };
  assert.equal(granted.name, USER.name);
  assert.deepEqual(verifySession(SECRET, granted.token), USER);

  d.verifyGoogle = async () => ({ email: "stranger@gmail.com", email_verified: true });
  const denied = fakeHttp("POST", "/auth/google", {}, { credential: "fake-google-jwt" });
  await createHandler(d)(denied.req, denied.res);
  assert.equal(denied.out.status, 401);
});

test("reports are stamped with the signed-in name, not the client's claim", async () => {
  const queries: PaveQuery[] = [];
  const handle = createHandler(deps(queries));
  const token = mintSession(SECRET, USER);
  const call = fakeHttp(
    "POST",
    "/jobs/job1/reports",
    { authorization: `Bearer ${token}` },
    { location: "Rear slope", englishNote: "Boot cracked.", reportedBy: "Spoofed Name" },
  );
  await handle(call.req, call.res);
  assert.equal(call.out.status, 200);
  const dollar = (queries[0]["createTask"] as Record<string, unknown>)["$"] as Record<string, unknown>;
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
