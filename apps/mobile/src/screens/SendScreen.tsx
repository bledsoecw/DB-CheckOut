import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CLEANUP_FORM, INSPECTION_FORM } from "@shared/jobtread";
import type { RootStackParamList } from "../../App";
import { getJob, submitCleanup, submitInspection, uploadJobPhoto } from "../api";
import { BigButton, Card } from "../components";
import { useLang } from "../i18n";
import { useVisit } from "../store";
import { colors } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Send">;

export default function SendScreen({ navigation, route }: Props) {
  const { jobId } = route.params;
  const { t, t2, p } = useLang();
  const { state, clear } = useVisit(jobId);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<"sent" | "queued" | null>(null);
  const [jobLabel, setJobLabel] = useState("");

  useEffect(() => {
    // Cached from the job screen; names outbox entries ("Inspección — 26-1357 Lininger").
    // JT job names already start with the number, so the name alone is enough.
    getJob(jobId)
      .then((job) => setJobLabel(job.name || job.number))
      .catch(() => {});
  }, [jobId]);

  const inspectionDone = INSPECTION_FORM.optionFields.filter((f) => state.inspection[f]).length;
  const cleanupDone = CLEANUP_FORM.optionFields.filter((f) => state.cleanup[f]).length;

  // Each form only accepts its own field ids, so split the shared notes map.
  const textsFor = (ids: readonly string[]) =>
    Object.fromEntries(Object.entries(state.notes).filter(([id, v]) => ids.includes(id) && v.trim()));

  const send = async () => {
    setSending(true);
    try {
      const suffix = jobLabel ? ` — ${jobLabel}` : "";
      const outcomes: Array<"sent" | "queued"> = [];
      // Visit photos stayed on the phone until now — this is the upload.
      for (const uri of state.visitPhotos) {
        outcomes.push(await uploadJobPhoto(jobId, "INSPECTION", uri, undefined, `Foto · Photo${suffix}`));
      }
      outcomes.push(
        await submitInspection(
          jobId,
          {
            answers: state.inspection,
            texts: textsFor([INSPECTION_FORM.atticNotesField, INSPECTION_FORM.notesField]),
          },
          `Inspección · Inspection${suffix}`,
        ),
        await submitCleanup(
          jobId,
          { answers: state.cleanup, texts: textsFor([CLEANUP_FORM.notesField]) },
          `Limpieza · Cleanup${suffix}`,
        ),
      );
      // Problem reports were already sent (or queued) the moment they were
      // saved on the report screen — only the two checklists go out here.
      clear();
      setResult(outcomes.every((o) => o === "sent") ? "sent" : "queued");
    } finally {
      setSending(false);
    }
  };

  if (result) {
    const sent = result === "sent";
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.resultWrap}>
          <View style={[styles.heroBadge, sent ? null : styles.heroBadgeQueued]}>
            <Text style={{ fontSize: 34, color: sent ? colors.greenDark : "#8A6100" }}>
              {sent ? "✓" : "⏳"}
            </Text>
          </View>
          <Text style={styles.heroTitle}>
            {sent
              ? p({ es: "Enviado a JobTread", en: "Sent to JobTread" })
              : p({ es: "Guardado — sin señal", en: "Saved — no signal" })}
          </Text>
          <Text style={styles.resultSub}>
            {sent
              ? p({ es: "La oficina ya lo puede ver.", en: "The office can see it now." })
              : p({
                  es: "Se enviará solo cuando el teléfono recupere señal. Míralo en «Por enviar».",
                  en: "It will send itself when the phone gets signal back. See it under “Waiting to send”.",
                })}
          </Text>
          {!sent ? (
            <View style={{ alignSelf: "stretch" }}>
              <BigButton
                bi={{ es: "Ver «Por enviar»", en: "View “Waiting to send”" }}
                color={colors.blue}
                onPress={() => navigation.navigate("Outbox")}
              />
            </View>
          ) : null}
          <View style={{ alignSelf: "stretch" }}>
            <BigButton
              bi={{ es: "Listo", en: "Done" }}
              color={colors.greenDark}
              onPress={() => navigation.popToTop()}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.back} hitSlop={8}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View>
          <Text style={styles.title}>{t("finish")}</Text>
          <Text style={styles.subtitle}>{t2("finish")}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        <View style={styles.hero}>
          <View style={styles.heroBadge}>
            <Text style={{ fontSize: 34, color: colors.greenDark }}>✓</Text>
          </View>
          <Text style={styles.heroTitle}>{t("allDone")}</Text>
          <Text style={styles.heroSub}>
            {t2("allDone")} — {t("checkAndSend")}
          </Text>
        </View>

        <SummaryRow
          label={`${t("inspection")} — ${inspectionDone}/${INSPECTION_FORM.optionFields.length}`}
          sub={t2("inspection")}
        />
        <SummaryRow
          label={`${t("cleanup")} — ${cleanupDone}/${CLEANUP_FORM.optionFields.length}`}
          sub={t2("cleanup")}
        />
        {state.visitPhotos.length > 0 ? (
          <SummaryRow
            label={`${state.visitPhotos.length} ${p({
              es: state.visitPhotos.length === 1 ? "foto de la visita" : "fotos de la visita",
              en: state.visitPhotos.length === 1 ? "visit photo" : "visit photos",
            })}`}
            sub={p({ es: "se suben a JobTread", en: "uploaded to JobTread" })}
          />
        ) : null}
        {state.reports.length > 0 ? (
          <Card style={styles.reports}>
            <Text style={styles.reportsTitle}>
              {state.reports.length} {t("problemsReported")} —{" "}
              {p({ es: "ya enviados", en: "already sent" })}
            </Text>
            {state.reports.map((r, i) => (
              <Text key={i} style={r.fixedOnSite ? styles.reportLineFixed : styles.reportLine}>
                {r.fixedOnSite ? "✔" : "•"} {r.location}
              </Text>
            ))}
            {state.reports.some((r) => !r.fixedOnSite) ? (
              <Text style={styles.reportsSub}>{t("pmAssigns")}</Text>
            ) : null}
          </Card>
        ) : null}

        <BigButton
          bi={{ es: "Enviar a JobTread", en: "Send to JobTread" }}
          color={colors.greenDark}
          disabled={sending}
          onPress={send}
        />
        <Text style={styles.footnote}>
          {t("offlineSaved")} · {t("offlineDetail")}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryRow({ label, sub }: { label: string; sub: string }) {
  return (
    <Card style={styles.summary}>
      <Text style={{ fontSize: 20, color: colors.green }}>✓</Text>
      <View>
        <Text style={styles.summaryLabel}>{label}</Text>
        <Text style={styles.summarySub}>{sub}</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 8 },
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
  hero: { alignItems: "center", paddingVertical: 10, gap: 4 },
  heroBadge: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.greenTint,
    alignItems: "center",
    justifyContent: "center",
  },
  heroBadgeQueued: { backgroundColor: "#FBF0D9" },
  heroTitle: { fontSize: 24, fontWeight: "700", color: colors.ink },
  resultWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  resultSub: {
    fontSize: 14,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 8,
  },
  heroSub: { fontSize: 13, color: colors.muted },
  summary: { flexDirection: "row", alignItems: "center", gap: 12 },
  summaryLabel: { fontSize: 15, fontWeight: "700", color: colors.ink },
  summarySub: { fontSize: 11.5, color: colors.faint },
  reports: {
    backgroundColor: "#FDF8F4",
    borderColor: colors.orangeBorder,
    gap: 4,
  },
  reportsTitle: { fontSize: 15, fontWeight: "700", color: "#9A3D0C" },
  reportLine: { fontSize: 13, color: "#9A3D0C" },
  reportLineFixed: { fontSize: 13, color: colors.greenDark },
  reportsSub: { fontSize: 11.5, color: "#B36A44" },
  footnote: { textAlign: "center", fontSize: 11.5, color: "#66788C" },
});
