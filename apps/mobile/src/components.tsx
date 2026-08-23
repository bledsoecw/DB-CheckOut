import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Bi } from "@shared/i18n";
import { ANSWER_LABELS } from "@shared/i18n";
import type { Answer } from "@shared/jobtread";
import { ANSWER } from "@shared/jobtread";
import { useLang } from "./i18n";
import { colors, HIT, radius } from "./theme";

/** Bilingual text block: primary language large, the other small below. */
export function BiText({
  bi,
  size = 15,
  weight = "700",
  color = colors.ink,
}: {
  bi: Bi;
  size?: number;
  weight?: "400" | "600" | "700";
  color?: string;
}) {
  const { p, s } = useLang();
  return (
    <View>
      <Text style={{ fontSize: size, fontWeight: weight, color }}>{p(bi)}</Text>
      <Text style={{ fontSize: size * 0.75, color: colors.faint }}>{s(bi)}</Text>
    </View>
  );
}

/** The ES·EN pill. */
export function LangPill() {
  const { lang, toggle } = useLang();
  return (
    <Pressable onPress={toggle} style={styles.pill} hitSlop={8}>
      <Text style={[styles.pillText, lang === "es" ? styles.pillOn : styles.pillOff]}>ES</Text>
      <Text style={[styles.pillText, styles.pillOff]}> · </Text>
      <Text style={[styles.pillText, lang === "en" ? styles.pillOn : styles.pillOff]}>EN</Text>
    </Pressable>
  );
}

/** BIEN / N-A / FALLA (OK / N-A / FIX) — the checklist answer buttons. */
export function TriToggle({
  value,
  onChange,
}: {
  value: Answer | null;
  onChange: (next: Answer) => void;
}) {
  const { lang } = useLang();
  const options: Array<{ answer: Answer; on: string }> = [
    { answer: ANSWER.ok, on: colors.green },
    { answer: ANSWER.na, on: colors.muted },
    { answer: ANSWER.action, on: colors.orange },
  ];
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {options.map(({ answer, on }) => {
        const selected = value === answer;
        const label = ANSWER_LABELS[answer][lang];
        return (
          <Pressable
            key={answer}
            onPress={() => onChange(answer)}
            style={[styles.tri, selected ? { backgroundColor: on, borderColor: on } : null]}
          >
            <Text style={[styles.triText, selected ? { color: "#fff" } : null]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Big primary action button with bilingual label. */
export function BigButton({
  bi,
  onPress,
  color = colors.blue,
  disabled = false,
}: {
  bi: Bi;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
}) {
  const { p, s } = useLang();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.big, { backgroundColor: disabled ? "#DDE4EC" : color }]}
    >
      <Text style={[styles.bigPrimary, disabled ? { color: "#66788C" } : null]}>{p(bi)}</Text>
      <Text style={[styles.bigSecondary, disabled ? { color: "#8FA0B2" } : null]}>{s(bi)}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 32,
  },
  pillText: { fontSize: 12 },
  pillOn: { fontWeight: "700", color: colors.ink },
  pillOff: { fontWeight: "600", color: "#9AA8B8" },
  tri: {
    minWidth: 52,
    minHeight: HIT + 6,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#D9E1EB",
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  triText: { fontSize: 11, fontWeight: "700", color: colors.faint },
  big: {
    minHeight: 56,
    borderRadius: radius.control + 2,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  bigPrimary: { color: "#fff", fontSize: 16, fontWeight: "700" },
  bigSecondary: { color: "rgba(255,255,255,0.75)", fontSize: 11, fontWeight: "600" },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    padding: 14,
  },
});
