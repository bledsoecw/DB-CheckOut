import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ANSWER, INSPECTION_FORM } from "@shared/jobtread";
import { FIELD_LABELS } from "@shared/i18n";
import type { RootStackParamList } from "../../App";
import { Card, LangPill, TriToggle } from "../components";
import { useLang } from "../i18n";
import { useVisit } from "../store";
import { colors } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Checklist">;

export default function ChecklistScreen({ navigation, route }: Props) {
  const { jobId } = route.params;
  const { t, t2, p, s } = useLang();
  const { state, setAnswer } = useVisit(jobId);

  const done = INSPECTION_FORM.optionFields.filter((f) => state.inspection[f]).length;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.back} hitSlop={8}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t("inspection")}</Text>
          <Text style={styles.subtitle}>{t2("inspection")}</Text>
        </View>
        <LangPill />
        <View style={styles.count}>
          <Text style={styles.countText}>
            {done}/{INSPECTION_FORM.optionFields.length}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {INSPECTION_FORM.optionFields.map((fieldId, i) => (
            <View
              key={fieldId}
              style={[styles.row, i > 0 ? styles.rowBorder : null]}
            >
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.itemTitle}>{p(FIELD_LABELS[fieldId])}</Text>
                <Text style={styles.itemSub}>{s(FIELD_LABELS[fieldId])}</Text>
              </View>
              <TriToggle
                value={state.inspection[fieldId] ?? null}
                onChange={(answer) => {
                  setAnswer("inspection", fieldId, answer);
                  if (answer === ANSWER.action) navigation.navigate("Report", { jobId });
                }}
              />
            </View>
          ))}
        </Card>

        <Card style={styles.micCard}>
          <View style={styles.mic}>
            <Text style={styles.micIcon}>🎤</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.micTitle}>{t("holdAndSpeak")}</Text>
            <Text style={styles.micSub}>{t("speakAnyLanguage")}</Text>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  backText: { fontSize: 24, color: colors.ink, marginTop: -2 },
  title: { fontSize: 21, fontWeight: "700", color: colors.ink },
  subtitle: { fontSize: 12, color: colors.muted },
  count: {
    backgroundColor: colors.blueTint,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  countText: { color: colors.blue, fontSize: 16, fontWeight: "700" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.divider },
  itemTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  itemSub: { fontSize: 11, color: colors.faint },
  micCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  mic: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.navy,
    alignItems: "center",
    justifyContent: "center",
  },
  micIcon: { fontSize: 22 },
  micTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  micSub: { fontSize: 11.5, color: colors.muted },
});
