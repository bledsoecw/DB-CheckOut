import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CLEANUP_CHECKLIST, INSPECTION_CHECKLIST } from "@shared/jobtread";
import type { RootStackParamList } from "../../App";
import {
  closeInspection,
  getJob,
  isDemoMode,
  newClientRef,
  sendReport,
  uploadJobPhoto,
  uploadReportPhoto,
  worstOutcome,
  type SendOutcome,
} from "../api";
import { BigButton, Card } from "../components";
import { useLang } from "../i18n";
import { useVisit } from "../store";
import { colors } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Send">;

/** One line of the post-send receipt. */
interface ReceiptItem {
  label: string;
  outcome: SendOutcome;
}

export default function SendScreen({ navigation, route }: Props) {
  const { jobId } = route.params;
  const { t, t2, p } = useLang();
  const { state, clear } = useVisit(jobId);
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptItem[] | null>(null);
  const [jobLabel, setJobLabel] = useState("");

  useEffect(() => {
    // Cached from the job screen; names outbox entries ("Inspección — 26-1357 Lininger").
    // JT job names already start with the number, so the name alone is enough.
    getJob(jobId)
      .then((job) => setJobLabel(job.name || job.number))
      .catch(() => {});
  }, [jobId]);

  const inspectionDone = INSPECTION_CHECKLIST.keys.filter((f) => state.inspection[f]).length;
  const cleanupDone = CLEANUP_CHECKLIST.keys.filter((f) => state.cleanup[f]).length;

  const noteOr = (key: string): string | undefined => state.notes[key]?.trim() || undefined;

  // THE send: the whole visit — photos, saved problems, then both checklists
  // — goes up as one packet, and every piece gets a line on the receipt.
  const send = async () => {
    setSending(true);
    try {
      const suffix = jobLabel ? ` — ${jobLabel}` : "";
      const items: ReceiptItem[] = [];

      if (state.visitPhotos.length > 0) {
        const results: SendOutcome[] = [];
        for (const [i, uri] of state.visitPhotos.entries()) {
          results.push(
            await uploadJobPhoto(jobId, "INSPECTION", uri, undefined, `Foto ${i + 1}/${state.visitPhotos.length} · Photo${suffix}`),
          );
        }
        items.push({
          label: `${state.visitPhotos.length} ${p({ es: "fotos", en: "photos" })}`,
          outcome: worstOutcome(results),
        });
      }
      for (const report of state.reports) {
        // The report goes first under its own reference; each photo follows
        // as its own send naming that reference, so a report with many
        // photos never outgrows one request, and a photo that arrives before
        // its report simply waits (the server answers 409 until it lands).
        const ref = newClientRef();
        const { photosBase64, photoBase64, ...rest } = report;
        const photos = [...(photosBase64 ?? []), ...(photoBase64 ? [photoBase64] : [])];
        const results: SendOutcome[] = [await sendReport(jobId, rest, `Problema · Problem: ${report.location}${suffix}`, ref)];
        for (const [i, uri] of photos.entries()) {
          results.push(
            await uploadReportPhoto(jobId, uri, ref, `Foto ${i + 1}/${photos.length} · ${report.location}${suffix}`, {
              itemKey: report.itemKey,
              location: report.location,
            }),
          );
        }
        items.push({
          label: `${p({ es: "Problema", en: "Problem" })}: ${report.location}`,
          outcome: worstOutcome(results),
        });
      }
      // LAST, and only after the reports: both checklists and the notes land
      // on the job's scheduled "Final inspection" task, it completes, and
      // that is what moves the job on — to Punch List when the crew found
      // something, otherwise to the PM's review. It carries the problem count
      // itself, so the routing holds even if those reports are still sitting
      // in the outbox.
      items.push({
        label: `${t("inspection")} + ${t("cleanup")} · ${t2("inspection")} + ${t2("cleanup")}`,
        outcome: await closeInspection(
          jobId,
          {
            answers: { inspection: state.inspection, cleanup: state.cleanup },
            notes: {
              inspection: noteOr(INSPECTION_CHECKLIST.notesKey),
              attic: noteOr(INSPECTION_CHECKLIST.atticKey),
              cleanup: noteOr(CLEANUP_CHECKLIST.notesKey),
            },
            // What each ACTION line found, so the note lands on that line
            // and a fixed-on-site line is ticked — whether or not the
            // REPORT sends above have reached JobTread yet.
            findings: state.reports
              .filter((r) => r.itemKey)
              .map((r) => ({
                itemKey: r.itemKey as string,
                fixedOnSite: r.fixedOnSite === true,
                location: r.location,
                note: r.englishNote,
                photos: (r.photosBase64?.length ?? 0) + (r.photoBase64 ? 1 : 0),
              })),
            // Only problems that still need a return trip. A "fixed on site"
            // report is documentation of work already done — counting it would
            // send a job with nothing left to repair to Punch List.
            problemsReported: state.reports.filter((r) => !r.fixedOnSite).length,
          },
          `Inspección y limpieza · Inspection & cleanup${suffix}`,
        ),
      });
      clear(new Date().toISOString());
      setReceipt(items);
    } finally {
      setSending(false);
    }
  };

  if (receipt) {
    const overall = worstOutcome(receipt.map((i) => i.outcome));
    const mark = (o: SendOutcome) => (o === "sent" ? "✓" : o === "queued" ? "⏳" : "✗");
    const tint = (o: SendOutcome) => (o === "sent" ? colors.greenDark : o === "queued" ? "#8A6100" : colors.red);
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.resultWrap}>
          <View style={[styles.heroBadge, overall === "sent" ? null : overall === "queued" ? styles.heroBadgeQueued : styles.heroBadgeFailed]}>
            <Text style={{ fontSize: 34, color: tint(overall) }}>{mark(overall)}</Text>
          </View>
          <Text style={styles.heroTitle}>
            {isDemoMode()
              ? p({ es: "Demostración — no se envió nada", en: "Demo — nothing was sent" })
              : overall === "sent"
                ? p({ es: "Enviado a JobTread", en: "Sent to JobTread" })
                : overall === "queued"
                  ? p({ es: "Guardado — aún no llega", en: "Saved — not delivered yet" })
                  : p({ es: "Algo no se pudo enviar", en: "Something could not be sent" })}
          </Text>

          <Card style={styles.receipt}>
            {receipt.map((item, i) => (
              <View key={i} style={styles.receiptRow}>
                <Text style={{ fontSize: 15 }}>{mark(item.outcome)}</Text>
                <Text style={styles.receiptLabel} numberOfLines={1}>
                  {item.label}
                </Text>
                <Text style={[styles.receiptState, { color: tint(item.outcome) }]}>
                  {item.outcome === "sent"
                    ? p({ es: "enviado", en: "sent" })
                    : item.outcome === "queued"
                      ? p({ es: "se reintenta", en: "will retry" })
                      : p({ es: "rechazado", en: "rejected" })}
                </Text>
              </View>
            ))}
          </Card>

          <Text style={styles.resultSub}>
            {p({
              es: "En JobTread: la lista de la tarea «Final inspection» · problemas en Tasks · fotos en Files.",
              en: "In JobTread: the checklist on the job's “Final inspection” task · problems under Tasks · photos under Files.",
            })}
          </Text>
          {overall !== "sent" ? (
            <View style={{ alignSelf: "stretch" }}>
              <BigButton
                bi={{ es: "Ver «Por enviar»", en: "View “Waiting to send”" }}
                color={overall === "failed" ? colors.red : colors.blue}
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
        </ScrollView>
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
          label={`${t("inspection")} — ${inspectionDone}/${INSPECTION_CHECKLIST.keys.length}`}
          sub={t2("inspection")}
        />
        <SummaryRow
          label={`${t("cleanup")} — ${cleanupDone}/${CLEANUP_CHECKLIST.keys.length}`}
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
              {state.reports.length} {t("problemsReported")}
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
          bi={
            sending
              ? { es: "Enviando…", en: "Sending…" }
              : { es: "Enviar todo a JobTread", en: "Send everything to JobTread" }
          }
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
  heroBadgeFailed: { backgroundColor: "#FDECEA", borderColor: "#EFC7C2" },
  heroTitle: { fontSize: 24, fontWeight: "700", color: colors.ink },
  resultWrap: {
    flexGrow: 1,
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
  receipt: { alignSelf: "stretch", gap: 8 },
  receiptRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  receiptLabel: { flex: 1, fontSize: 13.5, color: colors.ink },
  receiptState: { fontSize: 12, fontWeight: "700" },
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
