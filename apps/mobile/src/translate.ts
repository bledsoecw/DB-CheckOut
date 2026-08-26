/**
 * Spanish translations of JobTread text (scope lines, punch work orders).
 * Each string is translated once: results live in memory and on-device, so
 * revisits cost nothing. Anything untranslated (offline, server not
 * configured, demo mode) falls back to the English original.
 */

import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { translateBatch } from "./api";

const KEY_PREFIX = "db-checkout.es.";
const SEP = "\u0001"; // never appears in real text
const memory = new Map<string, string>();

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + text.length.toString(36);
}

async function translateTexts(texts: string[]): Promise<void> {
  const wanted = [...new Set(texts.filter((t) => t && t.length <= 4000 && !memory.has(t)))];
  if (wanted.length === 0) return;

  // On-device cache first
  const misses: string[] = [];
  for (const text of wanted) {
    const cached = await AsyncStorage.getItem(KEY_PREFIX + hash(text)).catch(() => null);
    if (cached) memory.set(text, cached);
    else misses.push(text);
  }
  if (misses.length === 0) return;

  const translations = await translateBatch(misses.slice(0, 100));
  if (!translations) return;
  misses.forEach((text, i) => {
    const translated = translations[i];
    if (typeof translated === "string" && translated) {
      memory.set(text, translated);
      void AsyncStorage.setItem(KEY_PREFIX + hash(text), translated).catch(() => {});
    }
  });
}

/**
 * Returns a lookup that maps English JT text to Spanish once translations
 * arrive (identity until then / when inactive). Pass `active` as
 * `lang === "es"` so EN mode never translates.
 */
export function useSpanish(texts: Array<string | null | undefined>, active: boolean) {
  const [, bump] = useState(0);
  const key = texts.filter(Boolean).join(SEP);

  useEffect(() => {
    if (!active || !key) return;
    let on = true;
    translateTexts(key.split(SEP)).then(() => {
      if (on) bump((n) => n + 1);
    });
    return () => {
      on = false;
    };
  }, [active, key]);

  return (text: string | null | undefined): string => {
    if (!text) return "";
    return (active ? memory.get(text) : undefined) ?? text;
  };
}
