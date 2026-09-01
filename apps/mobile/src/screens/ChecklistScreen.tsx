import React, { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ANSWER, INSPECTION_FORM } from "@shared/jobtread";
import { FIELD_LABELS } from "@shared/i18n";
import type { RootStackParamList } from "../../App";
import { transcribeNote } from "../api";
import { Card, LangPill, TriToggle } from "../components";
import { useLang } from "../i18n";
import { useVisit } from "../store";
import { colors } from "../theme";
import { startRecording, voiceSupported, type ActiveRecording } from "../voice";

type Props = NativeStackScreenProps<RootStackParamList, "Checklist">;

type MicState = "idle" | "recording" | "transcribing";

export default function ChecklistScreen({ navigation, route }: Props) {
  const { jobId } = route.params;
  const { t, t2, p, s } = useLang();
  const { state, setAnswer, setNote } = useVisit(jobId);

  const [mic, setMic] = useState<MicState>("idle");
  const [micError, setMicError] = useState<{ es: string; en: string } | null>(null);
  const recording = useRef<ActiveRecording | null>(null);
  const note = state.notes[INSPECTION_FORM.notesField] ?? "";

  const startSpeak = async () => {
    if (mic !== "idle" || recording.current) return;
    setMicError(null);
    try {
      recording.current = await startRecording();
      setMic("recording");
    } catch {
      recording.current = null;
      setMicError({
        es: "Permite el micrófono en el navegador para dictar.",
        en: "Allow the microphone in the browser to dictate.",
      });
    }
  };

  const stopSpeak = async () => {
    const active = recording.current;
    recording.current = null;
    if (!active) return;
    setMic("transcribing");
    try {
      const dataUri = await active.stop();
      if (!dataUri) {
        setMicError({ es: "Mantén presionado mientras hablas.", en: "Keep holding while you speak." });
        return;
      }
      if (dataUri.length > 5_600_000) {
        setMicError({ es: "Nota demasiado larga — intenta en partes.", en: "Note too long — try shorter pieces." });
        return;
      }
      const { en } = await transcribeNote(dataUri);
      setNote(INSPECTION_FORM.notesField, note ? `${note}\n${en}` : en);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "";
      setMicError({
        es: `No se pudo transcribir — se necesita señal. ${reason}`.trim(),
        en: `Could not transcribe — needs signal. ${reason}`.trim(),
      });
    } finally {
      setMic("idle");
    }
  };

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

        {voiceSupported() ? (
          <Pressable
            onPressIn={startSpeak}
            onPressOut={stopSpeak}
            disabled={mic === "transcribing"}
          >
            <Card style={[styles.micCard, mic === "recording" ? styles.micCardActive : null]}>
              <View style={[styles.mic, mic === "recording" ? styles.micActive : null]}>
                <Text style={styles.micIcon}>{mic === "recording" ? "⏺" : "🎤"}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.micTitle}>
                  {mic === "recording"
                    ? p({ es: "Grabando… suelta para terminar", en: "Recording… release to finish" })
                    : mic === "transcribing"
                      ? p({ es: "Escribiendo tu nota…", en: "Writing your note…" })
                      : t("holdAndSpeak")}
                </Text>
                <Text style={styles.micSub}>
                  {mic === "idle" ? t("speakAnyLanguage") : t2("holdAndSpeak")}
                </Text>
              </View>
            </Card>
          </Pressable>
        ) : null}

        {micError ? <Text style={styles.micError}>{p(micError)} · {s(micError)}</Text> : null}

        {note ? (
          <Card style={styles.noteCard}>
            <View style={styles.noteHeader}>
              <Text style={styles.noteTitle}>{p({ es: "Nota para la oficina", en: "Note for the office" })}</Text>
              <Pressable onPress={() => setNote(INSPECTION_FORM.notesField, "")} hitSlop={8}>
                <Text style={styles.noteClear}>{p({ es: "Borrar", en: "Clear" })}</Text>
              </Pressable>
            </View>
            <Text style={styles.noteText}>{note}</Text>
            <Text style={styles.noteSub}>
              {p({
                es: "Se envía en inglés con la inspección.",
                en: "Goes to JobTread with the inspection.",
              })}
            </Text>
          </Card>
        ) : null}
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
  micCardActive: { borderColor: "#E5B6B0", backgroundColor: "#FDF4F3" },
  mic: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.navy,
    alignItems: "center",
    justifyContent: "center",
  },
  micActive: { backgroundColor: colors.red },
  micIcon: { fontSize: 22 },
  micTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  micSub: { fontSize: 11.5, color: colors.muted },
  micError: { fontSize: 12.5, color: colors.red, textAlign: "center" },
  noteCard: { gap: 6 },
  noteHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  noteTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  noteClear: { fontSize: 12.5, fontWeight: "700", color: colors.red },
  noteText: { fontSize: 13.5, color: colors.ink, lineHeight: 19 },
  noteSub: { fontSize: 11, color: colors.faint },
});
