import React, { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../App";
import { getJob, sendReport } from "../api";
import CameraView from "../Camera";
import { BigButton, Card, LangPill } from "../components";
import { useLang } from "../i18n";
import PhotoViewer from "../PhotoViewer";
import { useVisit } from "../store";
import { colors } from "../theme";
import { VoiceNoteButton } from "../VoiceNote";

type Props = NativeStackScreenProps<RootStackParamList, "Report">;

export default function ReportScreen({ navigation, route }: Props) {
  const { jobId } = route.params;
  const { t, t2, p, s, lang } = useLang();
  const { state, addReport, addReportPhoto, removeReportPhoto, clearReportPhotos } = useVisit(jobId);
  const [detail, setDetail] = useState("");
  const [note, setNote] = useState("");
  const [heard, setHeard] = useState("");
  const [fixedOnSite, setFixedOnSite] = useState(false);
  const [materials, setMaterials] = useState("");
  const [originalCrew, setOriginalCrew] = useState("");
  // Photos live in the visit store so they survive moving around the app.
  const photos = state.reportPhotos;
  const [viewing, setViewing] = useState<number | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState<"sent" | "queued" | null>(null);
  const [jobLabel, setJobLabel] = useState("");

  useEffect(() => {
    getJob(jobId)
      .then((job) => setJobLabel(job.name || job.number))
      .catch(() => {});
  }, [jobId]);

  const resetForm = () => {
    setDetail("");
    setNote("");
    setHeard("");
    setFixedOnSite(false);
    setMaterials("");
    setOriginalCrew("");
    clearReportPhotos();
  };

  const missing = [
    photos.length === 0 ? p({ es: "foto", en: "photo" }) : null,
    !note.trim() ? p({ es: "nota", en: "note" }) : null,
  ].filter((m): m is string => m !== null);

  const send = async () => {
    // The task name the PM sees in JobTread: the detail, or the note's start.
    const location = detail.trim() || note.trim().slice(0, 60);
    const report = {
      location,
      englishNote: note.trim(),
      heardText: heard.trim() || undefined,
      reportedBy: undefined,
      fixedOnSite: fixedOnSite || undefined,
      materialsNote: fixedOnSite && materials.trim() ? materials.trim() : undefined,
      originalCrew: originalCrew.trim() || undefined,
      photosBase64: photos.length > 0 ? photos : undefined,
    };
    setSending(true);
    try {
      // Goes to JobTread right away (or into the outbox with no signal) —
      // it does not wait for "Finish & send".
      const outcome = await sendReport(
        jobId,
        report,
        `Reporte · Report${jobLabel ? ` — ${jobLabel}` : ""}`,
      );
      addReport(report);
      resetForm();
      setSaved(outcome);
    } finally {
      setSending(false);
    }
  };

  if (saved) {
    const sent = saved === "sent";
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.savedWrap}>
          <View style={[styles.savedBadge, sent ? null : styles.savedBadgeQueued]}>
            <Text style={{ fontSize: 34, color: sent ? colors.greenDark : "#8A6100" }}>
              {sent ? "✓" : "⏳"}
            </Text>
          </View>
          <Text style={styles.savedTitle}>
            {sent
              ? p({ es: "Reporte enviado a JobTread", en: "Report sent to JobTread" })
              : p({ es: "Reporte guardado — sin señal", en: "Report saved — no signal" })}
          </Text>
          <Text style={styles.savedSub}>
            {state.reports.length} {t("problemsReported")} ·{" "}
            {sent
              ? p({ es: "el PM ya lo puede ver", en: "the PM can see it now" })
              : p({
                  es: "se envía solo cuando haya señal (míralo en «Por enviar»)",
                  en: "sends itself when there's signal (see “Waiting to send”)",
                })}
          </Text>
          <View style={{ alignSelf: "stretch" }}>
            <BigButton
              bi={{ es: "Reportar otro problema", en: "Report another problem" }}
              color={colors.orange}
              onPress={() => setSaved(null)}
            />
          </View>
          <View style={{ alignSelf: "stretch" }}>
            <BigButton
              bi={{ es: "Listo", en: "Done" }}
              color={colors.greenDark}
              onPress={() => navigation.goBack()}
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
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t("reportProblem")}</Text>
          <Text style={styles.subtitle}>{t2("reportProblem")}</Text>
        </View>
        <LangPill />
      </View>

      {cameraOpen ? (
        <CameraView mode="burst" onCapture={addReportPhoto} onClose={() => setCameraOpen(false)} />
      ) : null}
      {viewing !== null && photos[viewing] ? (
        <PhotoViewer
          uri={photos[viewing]}
          onClose={() => setViewing(null)}
          onDelete={() => removeReportPhoto(viewing)}
        />
      ) : null}

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <View>
          <Text style={styles.label}>
            {p({ es: "TOMAR FOTOS", en: "TAKE PHOTOS" })}{" "}
            <Text style={photos.length > 0 ? styles.reqDone : styles.reqTag}>
              {photos.length > 0
                ? `✓ ${photos.length}`
                : `— ${p({ es: "OBLIGATORIA", en: "REQUIRED" })}`}
            </Text>
          </Text>
          {photos.length > 0 ? (
            <View style={styles.photoGrid}>
              {photos.map((uri, i) => (
                <View key={i} style={styles.photoThumbWrap}>
                  <Pressable onPress={() => setViewing(i)}>
                    <Image source={{ uri }} style={styles.photoThumb} />
                  </Pressable>
                  <Pressable onPress={() => removeReportPhoto(i)} style={styles.photoRemove} hitSlop={8}>
                    <Text style={styles.photoRemoveText}>✕</Text>
                  </Pressable>
                </View>
              ))}
              <Pressable onPress={() => setCameraOpen(true)} style={styles.photoMore}>
                <Text style={styles.photoMoreText}>📷{"\n"}+</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => setCameraOpen(true)}>
              <View style={styles.photoEmpty}>
                <Text style={styles.photoEmptyTitle}>
                  📷 {p({ es: "Tomar fotos", en: "Take photos" })}
                </Text>
                <Text style={styles.photoEmptySub}>
                  {p({ es: "Todas las que necesites", en: "As many as you need" })}
                </Text>
              </View>
            </Pressable>
          )}
        </View>

        <View>
          <Text style={styles.label}>
            {t("whereIsIt")} <Text style={styles.labelSub}>{t2("whereIsIt")} · {p({ es: "opcional", en: "optional" })}</Text>
          </Text>
          <TextInput
            value={detail}
            onChangeText={setDetail}
            placeholder={lang === "es" ? "Lado trasero — bota del tubo, canal…" : "Back side — pipe boot, gutter…"}
            placeholderTextColor="#9AA8B8"
            style={styles.input}
          />
        </View>

        <Text style={styles.label}>
          {p({ es: "NOTA", en: "NOTE" })}{" "}
          <Text style={note.trim() ? styles.reqDone : styles.reqTag}>
            {note.trim() ? "✓" : `— ${p({ es: "OBLIGATORIA", en: "REQUIRED" })}`}
          </Text>
        </Text>
        <VoiceNoteButton
          onText={(en, original) => {
            setNote((prev) => (prev ? `${prev}\n${en}` : en));
            setHeard((prev) => (prev ? `${prev}\n${original}` : original));
          }}
        />
        <Card style={{ gap: 8 }}>
          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            placeholder={
              lang === "es"
                ? "Habla con el micrófono o escribe aquí"
                : "Use the mic above or type here"
            }
            placeholderTextColor="#9AA8B8"
            style={[styles.input, { minHeight: 88, textAlignVertical: "top" }]}
          />
          <Text style={styles.noteTag}>{t("englishNote").toUpperCase()}</Text>
        </Card>

        <View>
          <Text style={styles.label}>
            {lang === "es" ? "¿Ya lo arreglaste?" : "Did you fix it already?"}{" "}
            <Text style={styles.labelSub}>
              {lang === "es" ? "Did you fix it already?" : "¿Ya lo arreglaste?"}
            </Text>
          </Text>
          <View style={styles.sides}>
            <Pressable
              onPress={() => setFixedOnSite(true)}
              style={[styles.side, fixedOnSite ? styles.sideFixed : null]}
            >
              <Text style={[styles.sideText, fixedOnSite ? styles.sideTextOn : null]}>
                {lang === "es" ? "Sí, lo arreglé" : "Yes, I fixed it"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setFixedOnSite(false)}
              style={[styles.side, !fixedOnSite ? styles.sideOn : null]}
            >
              <Text style={[styles.sideText, !fixedOnSite ? styles.sideTextOn : null]}>
                {lang === "es" ? "No, necesita cuadrilla" : "No, needs a crew"}
              </Text>
            </Pressable>
          </View>
          {fixedOnSite ? (
            <TextInput
              value={materials}
              onChangeText={setMaterials}
              placeholder={
                lang === "es"
                  ? "Materiales y tiempo: 2 botas, 30 min…"
                  : "Materials & time: 2 pipe boots, 30 min…"
              }
              placeholderTextColor="#9AA8B8"
              style={styles.input}
            />
          ) : null}
        </View>

        <TextInput
          value={originalCrew}
          onChangeText={setOriginalCrew}
          placeholder={
            lang === "es"
              ? "¿Qué cuadrilla hizo el trabajo? (si sabes, opcional)"
              : "Which crew did the original work? (if known, optional)"
          }
          placeholderTextColor="#9AA8B8"
          style={styles.input}
        />

        <BigButton
          bi={
            sending
              ? { es: "Enviando…", en: "Sending…" }
              : fixedOnSite
                ? { es: "Guardar lo que arreglé", en: "Save what I fixed" }
                : { es: "Enviar reporte", en: "Send report" }
          }
          color={fixedOnSite ? colors.greenDark : colors.orange}
          disabled={sending || missing.length > 0}
          onPress={send}
        />
        {missing.length > 0 ? (
          <Text style={styles.missing}>
            {p({ es: "Falta", en: "Missing" })}: {missing.join(" + ")} ·{" "}
            {s({ es: "Falta", en: "Missing" })}
          </Text>
        ) : (
          <Text style={styles.footnote}>
            {fixedOnSite
              ? lang === "es"
                ? "Queda documentado en JobTread — nadie tiene que regresar."
                : "Documented in JobTread — nobody has to come back."
              : `${t("pmAssigns")} · ${t2("pmAssigns")}`}
          </Text>
        )}
        <Text style={styles.footnote}>
          {p({
            es: "¿Más de un problema? Envía este y luego toca «Reportar otro problema».",
            en: "More than one problem? Send this one, then tap “Report another problem”.",
          })}
        </Text>
      </ScrollView>
    </SafeAreaView>
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
  photo: { width: "100%", height: 190, borderRadius: 16 },
  photoEmpty: {
    height: 190,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: "#B7C4D4",
    backgroundColor: "#FBFCFE",
    alignItems: "center",
    justifyContent: "center",
  },
  photoEmptyTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  photoEmptySub: { fontSize: 12, color: colors.muted },
  label: { fontSize: 13.5, fontWeight: "700", color: colors.ink, marginBottom: 7 },
  labelSub: { fontSize: 11, color: colors.faint, fontWeight: "400" },
  sides: { flexDirection: "row", gap: 7 },
  side: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#D9E1EB",
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  sideOn: { backgroundColor: colors.blue, borderColor: colors.blue },
  sideFixed: { backgroundColor: colors.greenDark, borderColor: colors.greenDark },
  sideText: { fontSize: 12.5, fontWeight: "700", color: colors.muted },
  sideTextOn: { color: "#fff" },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: "#D9E1EB",
    borderRadius: 10,
    padding: 11,
    fontSize: 14,
    color: colors.ink,
    marginTop: 8,
  },
  noteTag: { fontSize: 10, fontWeight: "700", color: colors.blue, letterSpacing: 0.4 },
  reqTag: { fontSize: 11, fontWeight: "700", color: colors.red },
  reqDone: { fontSize: 13, fontWeight: "700", color: colors.greenDark },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photoThumbWrap: { position: "relative" },
  photoThumb: { width: 84, height: 84, borderRadius: 12 },
  photoRemove: {
    position: "absolute",
    right: -6,
    top: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
  },
  photoRemoveText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  photoMore: {
    width: 84,
    height: 84,
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: "#B7C4D4",
    backgroundColor: "#FBFCFE",
    alignItems: "center",
    justifyContent: "center",
  },
  photoMoreText: { fontSize: 17, textAlign: "center", color: colors.muted, fontWeight: "700" },
  missing: { textAlign: "center", fontSize: 12.5, fontWeight: "700", color: colors.red },
  footnote: { textAlign: "center", fontSize: 11.5, color: "#66788C" },
  savedWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  savedBadge: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.greenTint,
    alignItems: "center",
    justifyContent: "center",
  },
  savedBadgeQueued: { backgroundColor: "#FBF0D9" },
  savedTitle: { fontSize: 24, fontWeight: "700", color: colors.ink, textAlign: "center" },
  savedSub: { fontSize: 13.5, color: colors.muted, textAlign: "center", marginBottom: 8 },
});
