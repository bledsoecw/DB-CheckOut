import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ANSWER, CLEANUP_FORM } from "@shared/jobtread";
import { FIELD_LABELS } from "@shared/i18n";
import type { RootStackParamList } from "../../App";
import { Card, LangPill, TriToggle } from "../components";
import { useLang } from "../i18n";
import { useVisit } from "../store";
import { colors } from "../theme";
import { VoiceNotesSection } from "../VoiceNote";

type Props = NativeStackScreenProps<RootStackParamList, "Cleanup">;

export default function CleanupScreen({ navigation, route }: Props) {
  const { jobId } = route.params;
  const { t, t2, p, s } = useLang();
  const { state, setAnswer, setNote } = useVisit(jobId);
  const done = CLEANUP_FORM.optionFields.filter((f) => state.cleanup[f]).length;
  const note = state.notes[CLEANUP_FORM.notesField] ?? "";

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.back} hitSlop={8}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t("cleanup")}</Text>
          <Text style={styles.subtitle}>{t2("cleanup")}</Text>
        </View>
        <LangPill />
        <View style={styles.count}>
          <Text style={styles.countText}>
            {done}/{CLEANUP_FORM.optionFields.length}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        {CLEANUP_FORM.optionFields.map((fieldId) => (
          <Card key={fieldId} style={styles.item}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.itemTitle}>{p(FIELD_LABELS[fieldId])}</Text>
              <Text style={styles.itemSub}>{s(FIELD_LABELS[fieldId])}</Text>
            </View>
            <TriToggle
              value={state.cleanup[fieldId] ?? null}
              onChange={(answer) => {
                setAnswer("cleanup", fieldId, answer);
                if (answer === ANSWER.action) navigation.navigate("Report", { jobId });
              }}
            />
          </Card>
        ))}
        <VoiceNotesSection note={note} onChange={(text) => setNote(CLEANUP_FORM.notesField, text)} />
        <Text style={styles.hint}>
          {t("seeDamageReport")} · {t2("seeDamageReport")}
        </Text>
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
    backgroundColor: colors.greenTint,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  countText: { color: colors.greenDark, fontSize: 16, fontWeight: "700" },
  item: { flexDirection: "row", alignItems: "center" },
  itemTitle: { fontSize: 14.5, fontWeight: "700", color: colors.ink },
  itemSub: { fontSize: 11.5, color: colors.faint },
  hint: { textAlign: "center", fontSize: 12, color: colors.orange, fontWeight: "600" },
});
