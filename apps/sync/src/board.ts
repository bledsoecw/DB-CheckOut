/**
 * The Production Board's door for Close Out: `POST {BOARD_URL}/api/hooks/closeout`.
 *
 * Close Out no longer writes the job's Status (Carl, 23 Oct 2026: "the
 * board sets the Status, Close Out stops"). After the crew does something —
 * an inspection closed, a finding reported, a repair finished — the server
 * tells the board, and the board works the Status out from the job's work
 * areas by the same rule as its own writes, forward only. The answer says
 * who reviews each area and who its work goes to, from Operations' lists, so
 * a summary is tagged to the right PM.
 *
 * Best-effort by construction: unset, unreachable or refusing, every call
 * answers null and the caller falls back (`fallbackReviewer`,
 * `fallbackRepairCrew` in areas.ts) — the board's hourly sweep then moves
 * the Status. Nothing the crew does may fail over this.
 */

import { isAreaKey, type AreaKey, type Reviewer } from "./areas";

export interface BoardArea {
  area: AreaKey;
  label: string;
  /** This area owns the template's "Final inspection" line. */
  line: boolean;
  inspectionName: string;
  /** The board's stage word for it ("installed", "inspect", "repairs", "review", "done"…). */
  stage: string;
  reviewer: Reviewer | null;
  /** Who its inspection and repairs go to by default — memberships. */
  crew: string[];
}

export interface BoardAnswer {
  status: string | null;
  /** The move the board made, or null. */
  moved: { from: string; to: string } | null;
  areas: BoardArea[];
  /** The job's own PM — who a job with no work areas (construction, a service call) is reviewed by. */
  pm: Reviewer | null;
}

export interface BoardAsk {
  jobId: string;
  /** false: answer the areas, leave the Status alone. Default true. */
  move?: boolean;
  /** Findings the crew sent that JobTread may not hold yet. */
  problemsReported?: number;
  area?: AreaKey | null;
  /** A REPORT is going in: a job past Punch List may come back to it. */
  repairs?: boolean;
  /** Who did it — named in the board's status comment. */
  actor?: string;
}

export interface BoardClient {
  closeout(ask: BoardAsk): Promise<BoardAnswer | null>;
}

const TIMEOUT_MS = 10_000;

const asObj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);
const asStr = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** The board's answer, or null when it is not one. Exported for the tests. */
export function readBoardAnswer(raw: unknown): BoardAnswer | null {
  const o = asObj(raw);
  if (!o || o["ok"] !== true || !Array.isArray(o["areas"])) return null;
  const m = asObj(o["moved"]);
  const moved = m && asStr(m["from"]) && asStr(m["to"]) ? { from: m["from"] as string, to: m["to"] as string } : null;
  const areas: BoardArea[] = [];
  for (const a of o["areas"] as unknown[]) {
    const x = asObj(a);
    if (!x || !isAreaKey(x["trade"])) continue;
    const r = asObj(x["reviewer"]);
    const crew = Array.isArray(x["crew"])
      ? (x["crew"] as unknown[]).map((c) => asStr(asObj(c)?.["membershipId"])).filter((id): id is string => Boolean(id))
      : [];
    areas.push({
      area: x["trade"],
      label: asStr(x["label"]) ?? "",
      line: x["line"] === true,
      inspectionName: asStr(x["inspectionName"]) ?? "",
      stage: asStr(x["stage"]) ?? "",
      reviewer: r && asStr(r["name"]) ? { name: r["name"] as string, membershipId: asStr(r["membershipId"]) } : null,
      crew,
    });
  }
  const p = asObj(o["pm"]);
  const pm = p && asStr(p["name"]) ? { name: p["name"] as string, membershipId: asStr(p["membershipId"]) } : null;
  return { status: asStr(o["status"]), moved, areas, pm };
}

/** null when BOARD_URL or CLOSEOUT_HOOK_SECRET is unset — the door is simply not there. */
export function createBoardClient(
  baseUrl: string,
  secret: string,
  fetchImpl: typeof fetch = fetch,
): BoardClient | null {
  if (!baseUrl || !secret) return null;
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    console.warn("BOARD_URL is not a URL — the Production Board will not be asked");
    return null;
  }
  return {
    async closeout(ask: BoardAsk): Promise<BoardAnswer | null> {
      try {
        const res = await fetchImpl(`${origin}/api/hooks/closeout`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
          body: JSON.stringify(ask),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const text = await res.text();
        if (!res.ok) {
          console.warn(`board close-out hook ${res.status} for ${ask.jobId}: ${text.slice(0, 200)}`);
          return null;
        }
        const answer = readBoardAnswer(JSON.parse(text));
        if (!answer) console.warn(`board close-out hook answered something unreadable for ${ask.jobId}`);
        return answer;
      } catch (err) {
        console.warn(`board close-out hook failed for ${ask.jobId}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },
  };
}
