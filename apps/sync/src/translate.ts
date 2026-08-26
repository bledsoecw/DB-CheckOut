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

/**
 * One generateContent call, trying the configured model first and falling
 * back to widely-available older models when the key's API version doesn't
 * know it (404/model errors vary by key vintage).
 */
async function geminiGenerate(
  prompt: string,
  env: Pick<Env, "geminiApiKey" | "geminiModel">,
  fetchImpl: typeof fetch,
): Promise<string> {
  const models = [...new Set([env.geminiModel, "gemini-2.0-flash", "gemini-1.5-flash"])];
  let lastError = "";
  for (const model of models) {
    const res = await fetchImpl(`${GEMINI_URL}/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.geminiApiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      }),
    });
    if (res.ok) {
      const body = (await res.json()) as GeminiResponse;
      return body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    }
    lastError = `Gemini request failed: ${res.status} (${model})`;
    if (res.status !== 404 && res.status !== 400) break; // real failure, not a model-name miss
  }
  throw new Error(lastError || "Gemini request failed");
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
