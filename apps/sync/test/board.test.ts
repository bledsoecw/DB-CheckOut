import { test } from "node:test";
import assert from "node:assert/strict";
import { createBoardClient, readBoardAnswer } from "../src/board";

test("no BOARD_URL or no secret: the door is simply not there", () => {
  assert.equal(createBoardClient("", "s"), null);
  assert.equal(createBoardClient("https://ops.deitemeyerbrothers.com", ""), null);
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(createBoardClient("not a url", "s"), null);
  } finally {
    console.warn = warn;
  }
});

test("Close Out asks the board's origin, with the secret, and reads its answer", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(
      JSON.stringify({
        ok: true,
        status: "Punch List",
        moved: { from: "Final Inspection", to: "Punch List" },
        pm: { name: "Kyle Akerman", membershipId: null },
        areas: [
          { trade: "shingle", label: "Shingle roof", line: true, inspectionName: "Final inspection", stage: "repairs", reviewer: { name: "Dave Elick", membershipId: "22PLtDsn6f4P" }, crew: [{ membershipId: "22PdPUpWzpHy", name: "Alberto" }] },
          { trade: "chimney", label: "?", line: false },
        ],
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  // A page URL is cut back to its origin — the hook lives at the root.
  const board = createBoardClient("https://ops.deitemeyerbrothers.com/production-board", "hook-secret", fetchImpl)!;
  const answer = await board.closeout({ jobId: "j1", problemsReported: 2, area: "shingle", actor: "Yahir Gonzalez" });
  assert.equal(seen[0].url, "https://ops.deitemeyerbrothers.com/api/hooks/closeout");
  assert.equal((seen[0].init.headers as Record<string, string>)["authorization"], "Bearer hook-secret");
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), { jobId: "j1", problemsReported: 2, area: "shingle", actor: "Yahir Gonzalez" });
  assert.deepEqual(answer, {
    status: "Punch List",
    moved: { from: "Final Inspection", to: "Punch List" },
    pm: { name: "Kyle Akerman", membershipId: null },
    areas: [
      { area: "shingle", label: "Shingle roof", line: true, inspectionName: "Final inspection", stage: "repairs", reviewer: { name: "Dave Elick", membershipId: "22PLtDsn6f4P" }, crew: ["22PdPUpWzpHy"] },
    ],
  });
});

test("a board that refuses, fails or answers nonsense is null — never an error the crew sees", async () => {
  const warn = console.warn;
  const said: string[] = [];
  console.warn = (...a: unknown[]) => { said.push(a.map(String).join(" ")); };
  try {
    const refusing = createBoardClient("https://b.example", "s", (async () => new Response('{"error":"Not authorized"}', { status: 401 })) as unknown as typeof fetch)!;
    assert.equal(await refusing.closeout({ jobId: "j1" }), null);
    const down = createBoardClient("https://b.example", "s", (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch)!;
    assert.equal(await down.closeout({ jobId: "j1" }), null);
    const odd = createBoardClient("https://b.example", "s", (async () => new Response('{"hello":1}', { status: 200 })) as unknown as typeof fetch)!;
    assert.equal(await odd.closeout({ jobId: "j1" }), null);
  } finally {
    console.warn = warn;
  }
  assert.ok(said.some((s) => s.includes("401")) && said.some((s) => s.includes("ECONNREFUSED")), said.join("\n"));
  assert.equal(readBoardAnswer({ ok: true, areas: [] })?.moved, null);
});
