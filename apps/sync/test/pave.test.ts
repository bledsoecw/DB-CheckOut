import { test } from "node:test";
import assert from "node:assert/strict";
import { createPaveClient, PaveError, withGrantKey } from "../src/pave";

test("withGrantKey injects the key without clobbering existing $ args", () => {
  const q = withGrantKey({ $: { foo: 1 }, organization: {} }, "KEY");
  assert.deepEqual(q["$"], { foo: 1, grantKey: "KEY" });
  assert.deepEqual(q["organization"], {});
});

test("withGrantKey does not mutate the input", () => {
  const original = { organization: {} };
  withGrantKey(original, "KEY");
  assert.equal("$" in original, false);
});

test("client posts the wrapped query and parses JSON", async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body) });
    return new Response(JSON.stringify({ ok: { value: 42 } }), { status: 200 });
  }) as typeof fetch;

  const client = createPaveClient("SECRET", fakeFetch);
  const result = await client.query<{ ok: { value: number } }>({ ok: {} });

  assert.equal(result.ok.value, 42);
  assert.equal(calls.length, 1);
  const sent = JSON.parse(calls[0].body) as { query: Record<string, unknown> };
  assert.deepEqual(sent.query["$"], { grantKey: "SECRET" });
});

test("client throws PaveError with status and body on failure", async () => {
  const fakeFetch = (async () =>
    new Response("no access", { status: 403 })) as typeof fetch;
  const client = createPaveClient("SECRET", fakeFetch);
  await assert.rejects(
    () => client.query({ organization: {} }),
    (err: unknown) => err instanceof PaveError && err.status === 403 && err.body === "no access",
  );
});
