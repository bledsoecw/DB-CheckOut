/**
 * Minimal client for the JobTread Pave API.
 *
 * Pave is a JSON graph API: one POST endpoint, the whole query is a JSON
 * object, auth rides inside the query as `$.grantKey`.
 */

export const PAVE_URL = "https://api.jobtread.com/pave";

export type PaveQuery = Record<string, unknown>;

export class PaveError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Pave request failed (${status}): ${body.slice(0, 500)}`);
    this.name = "PaveError";
    this.status = status;
    this.body = body;
  }
}

export interface PaveClient {
  query<T = Record<string, unknown>>(query: PaveQuery): Promise<T>;
}

/** Injects the grant key at query.$.grantKey without mutating the caller's object. */
export function withGrantKey(query: PaveQuery, grantKey: string): PaveQuery {
  const dollar = (query["$"] ?? {}) as Record<string, unknown>;
  return { ...query, $: { ...dollar, grantKey } };
}

export function createPaveClient(
  grantKey: string,
  fetchImpl: typeof fetch = fetch,
): PaveClient {
  return {
    async query<T>(query: PaveQuery): Promise<T> {
      for (let attempt = 0; ; attempt++) {
        const res = await fetchImpl(PAVE_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: withGrantKey(query, grantKey) }),
        });
        const text = await res.text();
        if (res.ok) return JSON.parse(text) as T;
        // One breather for rate limiting / transient upstream trouble.
        if (attempt === 0 && [429, 502, 503, 504].includes(res.status)) {
          await new Promise((resolve) => setTimeout(resolve, 750));
          continue;
        }
        throw new PaveError(res.status, text);
      }
    },
  };
}
