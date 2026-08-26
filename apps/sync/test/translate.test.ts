import { test } from "node:test";
import assert from "node:assert/strict";
import { translateToSpanish } from "../src/translate";

const env = { geminiApiKey: "k", geminiModel: "gemini-test" };

test("translateToSpanish batches, caches, and maps results in order", async () => {
  let calls = 0;
  const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
    const texts = JSON.parse(body.contents[0].parts[0].text.split("\n\n")[1]) as string[];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(texts.map((t) => `ES:${t}`)) }] } }],
      }),
    } as Response;
  }) as typeof fetch;

  const first = await translateToSpanish(["Replace the pipe boot", "Hauling & Disposal"], env, fakeFetch);
  assert.deepEqual(first, ["ES:Replace the pipe boot", "ES:Hauling & Disposal"]);
  assert.equal(calls, 1);

  // Second call reuses the cache — no new Gemini request for known strings.
  const second = await translateToSpanish(["Hauling & Disposal", "New text"], env, fakeFetch);
  assert.deepEqual(second, ["ES:Hauling & Disposal", "ES:New text"]);
  assert.equal(calls, 2);
});

test("translateToSpanish throws when unconfigured and on mismatched output", async () => {
  await assert.rejects(() => translateToSpanish(["x"], { geminiApiKey: "", geminiModel: "m" }));
  const badFetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: "[]" }] } }] }),
  })) as unknown as typeof fetch;
  await assert.rejects(() => translateToSpanish(["only-one-brand-new-string"], env, badFetch));
});

test("a retired model name triggers discovery of the key's newest flash model", async () => {
  const seen: string[] = [];
  const fakeFetch = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.includes(":generateContent")) {
      const model = /models\/([^:]+):/.exec(u)?.[1] ?? "";
      seen.push(model);
      if (model !== "gemini-4.1-flash-lite") return { ok: false, status: 404 } as Response;
      const body = JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
      const texts = JSON.parse(body.contents[0].parts[0].text.split("\n\n")[1]) as string[];
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify(texts.map((t) => `ES:${t}`)) }] } }],
        }),
      } as Response;
    }
    // model list
    return {
      ok: true,
      status: 200,
      json: async () => ({
        models: [
          { name: "models/gemini-4.1-pro", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-4.1-flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-4.1-flash-preview", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-4.1-flash-lite", supportedGenerationMethods: ["generateContent"] },
          { name: "models/imagen-4", supportedGenerationMethods: ["predict"] },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  const out = await translateToSpanish(["fresh-string-for-discovery"], { geminiApiKey: "k", geminiModel: "gemini-9-gone" }, fakeFetch);
  assert.deepEqual(out, ["ES:fresh-string-for-discovery"]);
  assert.deepEqual(seen, ["gemini-9-gone", "gemini-4.1-flash-lite"]);

  // Discovered model is remembered — no re-discovery on the next call.
  const out2 = await translateToSpanish(["second-fresh-string"], { geminiApiKey: "k", geminiModel: "gemini-9-gone" }, fakeFetch);
  assert.deepEqual(out2, ["ES:second-fresh-string"]);
  assert.equal(seen[seen.length - 1], "gemini-4.1-flash-lite");
});
