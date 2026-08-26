/**
 * English -> Spanish translation for JobTread-sourced text (scope lines,
 * punch work orders) via the Gemini API. Results are cached in memory per
 * exact string, and the app caches them on-device too, so each string is
 * translated roughly once. Unconfigured or failing translation must never
 * break anything — callers fall back to the English original.
 */

import type { Env } from "./env";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export const TRANSLATE_LIMITS = { maxTexts: 100, maxTextLength: 4000 } as const;

const PROMPT =
  "Translate each string in the JSON array from English to Latin American Spanish " +
  "for a roofing/construction field crew. Keep brand names, product names, model " +
  "numbers, measurements and numbers unchanged. Keep it natural and concise. " +
  "Return ONLY a JSON array of the translated strings, same length, same order.";

const cache = new Map<string, string>();

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

/** Model discovered from the key's own model list when the configured one is gone. */
let discoveredModel: string | null = null;

/**
 * Google retires Gemini models on a rolling basis, so a hardcoded name rots.
 * When the configured model 404s, ask the API which models this key can use
 * and pick the newest stable flash-class one.
 */
async function discoverModel(apiKey: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(`${GEMINI_URL}?pageSize=200`, {
    headers: { "x-goog-api-key": apiKey },
  });
  if (!res.ok) throw new Error(`Gemini model list failed: ${res.status}`);
  const body = (await res.json()) as {
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
  };
  const usable = (body.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => String(m.name ?? "").replace(/^models\//, ""))
    .filter(Boolean);
  const score = (name: string): number => {
    const version = Number(/gemini-(\d+(?:\.\d+)?)/.exec(name)?.[1] ?? 0);
    let points = version * 100;
    if (name.includes("flash")) points += 40;
    if (/preview|exp|image|tts|live|audio|embedding|thinking/.test(name)) points -= 500;
    if (name.includes("lite")) points -= 5;
    return points;
  };
  const best = [...usable].sort((a, b) => score(b) - score(a))[0];
  if (!best) throw new Error("No usable Gemini model on this key");
  return best;
}

/**
 * Minimum-thinking controls, newest naming first: Gemini 3 uses
 * thinkingLevel, 2.5 uses thinkingBudget; unknown knobs get a 400, so the
 * ladder walks down to "no knob". Full thinking is far too slow for
 * translation/summary work inside a serverless time limit.
 */
const THINKING_VARIANTS: Array<Record<string, unknown> | null> = [
  { thinkingLevel: "low" },
  { thinkingBudget: 0 },
  null,
];
let workingVariant = 0;
const GEMINI_CALL_TIMEOUT_MS = 45_000;

/** One generateContent call; on a model-name miss, discover a working model. */
async function geminiGenerate(
  prompt: string,
  env: Pick<Env, "geminiApiKey" | "geminiModel">,
  fetchImpl: typeof fetch,
): Promise<string> {
  const attempt = async (model: string, variant: Record<string, unknown> | null) => {
    try {
      return await fetchImpl(`${GEMINI_URL}/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": env.geminiApiKey },
        signal: AbortSignal.timeout(GEMINI_CALL_TIMEOUT_MS),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
            maxOutputTokens: 8192,
            ...(variant ? { thinkingConfig: variant } : {}),
          },
        }),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(`Gemini timed out after ${GEMINI_CALL_TIMEOUT_MS / 1000}s (${model})`);
      }
      throw err;
    }
  };

  const tryModel = async (model: string) => {
    let res = await attempt(model, THINKING_VARIANTS[workingVariant]);
    for (let i = workingVariant + 1; res.status === 400 && i < THINKING_VARIANTS.length; i++) {
      res = await attempt(model, THINKING_VARIANTS[i]);
      if (res.status !== 400) workingVariant = i;
    }
    return res;
  };

  let model = discoveredModel ?? env.geminiModel;
  let res = await tryModel(model);
  if (res.status === 404 || res.status === 400) {
    model = await discoverModel(env.geminiApiKey, fetchImpl);
    discoveredModel = model;
    res = await tryModel(model);
  }
  if (!res.ok) throw new Error(`Gemini request failed: ${res.status} (${model})`);
  const body = (await res.json()) as GeminiResponse;
  return body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function geminiTranslate(
  texts: string[],
  env: Pick<Env, "geminiApiKey" | "geminiModel">,
  fetchImpl: typeof fetch,
): Promise<string[]> {
  const raw = await geminiGenerate(`${PROMPT}\n\n${JSON.stringify(texts)}`, env, fetchImpl);
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length !== texts.length) {
    throw new Error("Gemini returned a mismatched translation array");
  }
  return parsed.map((t, i) => (typeof t === "string" && t ? t : texts[i]));
}

const SUMMARY_PROMPT =
  "You write for a roofing/construction field crew about to inspect a finished job. " +
  "Given the sold scope below (documents and line items), write a short summary of " +
  "the work that was sold: 2-4 plain sentences, main work first, then notable " +
  "extras/change orders. No prices. Keep brand/product names and measurements as-is. " +
  'Return ONLY JSON: {"en": "<English summary>", "es": "<Latin American Spanish summary>"}';

const summaryCache = new Map<string, { en: string; es: string }>();

/** Bilingual crew summary of the sold scope; cached per exact scope content. */
export async function summarizeScope(
  scopeText: string,
  env: Pick<Env, "geminiApiKey" | "geminiModel">,
  fetchImpl: typeof fetch = fetch,
): Promise<{ en: string; es: string }> {
  if (!env.geminiApiKey) throw new Error("Summaries are not configured");
  const hit = summaryCache.get(scopeText);
  if (hit) return hit;
  const raw = await geminiGenerate(`${SUMMARY_PROMPT}\n\n${scopeText}`, env, fetchImpl);
  const parsed = JSON.parse(raw) as { en?: unknown; es?: unknown };
  if (typeof parsed.en !== "string" || typeof parsed.es !== "string") {
    throw new Error("Gemini returned a malformed summary");
  }
  const summary = { en: parsed.en, es: parsed.es };
  summaryCache.set(scopeText, summary);
  return summary;
}

/** Translate to Spanish with caching; missing config throws (route turns it into 501). */
export async function translateToSpanish(
  texts: string[],
  env: Pick<Env, "geminiApiKey" | "geminiModel">,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  if (!env.geminiApiKey) throw new Error("Translation is not configured");
  const missing = [...new Set(texts.filter((t) => !cache.has(t)))];
  if (missing.length > 0) {
    const translated = await geminiTranslate(missing, env, fetchImpl);
    missing.forEach((t, i) => cache.set(t, translated[i]));
  }
  return texts.map((t) => cache.get(t) ?? t);
}
