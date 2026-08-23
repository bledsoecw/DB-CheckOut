import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Bi, Lang } from "@shared/i18n";
import { UI, pick, secondary } from "@shared/i18n";

interface LangContextValue {
  lang: Lang;
  toggle: () => void;
  /** Primary (large) text for a bilingual label. */
  p: (bi: Bi) => string;
  /** Secondary (small) text — the other language. */
  s: (bi: Bi) => string;
  /** Primary text for a UI string key. */
  t: (key: keyof typeof UI) => string;
  /** Secondary text for a UI string key. */
  t2: (key: keyof typeof UI) => string;
}

const LangContext = createContext<LangContextValue | null>(null);
const STORAGE_KEY = "db-checkout.lang";

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>("es");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === "en" || saved === "es") setLang(saved);
    });
  }, []);

  const toggle = () => {
    setLang((prev) => {
      const next = prev === "es" ? "en" : "es";
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      return next;
    });
  };

  const value: LangContextValue = {
    lang,
    toggle,
    p: (bi) => pick(bi, lang),
    s: (bi) => secondary(bi, lang),
    t: (key) => pick(UI[key], lang),
    t2: (key) => secondary(UI[key], lang),
  };

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang outside LangProvider");
  return ctx;
}
