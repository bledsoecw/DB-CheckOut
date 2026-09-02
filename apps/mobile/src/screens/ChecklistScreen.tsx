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
import { VoiceNotesSection } from "../VoiceNote";

type Props = NativeStackScreenProps<RootStackParamList, "Checklist">;

export default function ChecklistScreen({ navigation, route }: Props) {
  const { jobId } = route.params;
  const { t, t2, p, s } = useLang();
  const { state, setAnswer, setNote } = useVisit(jobId);
  const note = state.notes[INSPECTION_FORM.notesField] ?? "";

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
                  if (answer === ANSWER.action) {
                    // The failed line becomes the report's "Where is it?".
                    navigation.navigate("Report", { jobId, from: FIELD_LABELS[fieldId].en });
                  }
                }}
              />
            </View>
          ))}
        </Card>

        <VoiceNotesSection note={note} onChange={(text) => setNote(INSPECTION_FORM.notesField, text)} />
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
});
