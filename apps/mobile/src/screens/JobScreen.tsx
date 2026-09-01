import React, { useEffect, useState } from "react";
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { JobDetail, ScopeDocument, ScopeSummary } from "@shared/types";
import { CLEANUP_FORM, INSPECTION_FORM } from "@shared/jobtread";
import type { RootStackParamList } from "../../App";
import { getJob, getScopeSummary } from "../api";
import CameraView from "../Camera";
import { BigButton, Card, LangPill } from "../components";
import { useLang } from "../i18n";
import PhotoViewer from "../PhotoViewer";
import { useVisit } from "../store";
import { useSpanish } from "../translate";
import { colors } from "../theme";
import { directionsUrl } from "./QueueScreen";

type Props = NativeStackScreenProps<RootStackParamList, "Job">;

export default function JobScreen({ navigation, route }: Props) {
  const { jobId } = route.params;
  const { t, t2, p } = useLang();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const { state } = useVisit(jobId);

  const load = React.useCallback(() => {
    getJob(jobId)
      .then((detail) => {
        setJob(detail);
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true));
  }, [jobId]);

  useEffect(() => navigation.addListener("focus", load), [navigation, load]);

  const inspectionDone = INSPECTION_FORM.optionFields.filter((f) => state.inspection[f]).length;
  const cleanupDone = CLEANUP_FORM.optionFields.filter((f) => state.cleanup[f]).length;
  const remaining =
    INSPECTION_FORM.optionFields.length - inspectionDone + CLEANUP_FORM.optionFields.length - cleanupDone;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.back} hitSlop={8}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{job?.name ?? "…"}</Text>
          <Text style={styles.subtitle}>
            {job?.number} {job?.isService ? "· Servicio " : ""}
            {job?.projectManager ? `· PM: ${job.projectManager}` : ""}
          </Text>
        </View>
        <LangPill />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {!job && loadFailed ? (
          <Card style={styles.offlineCard}>
            <Text style={styles.offlineTitle}>
              {p({ es: "Sin conexión y sin copia guardada", en: "No signal and no saved copy" })}
            </Text>
            <Text style={styles.offlineSub}>
              {p({
                es: "Abre este trabajo una vez con señal y quedará guardado en el teléfono.",
                en: "Open this job once with signal and it will stay saved on the phone.",
              })}
            </Text>
            <BigButton bi={{ es: "Reintentar", en: "Retry" }} onPress={load} />
          </Card>
        ) : null}

        {job?.address ? (
          <Card style={styles.addressCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.address}>{job.address}</Text>
            </View>
            <View style={{ width: 150 }}>
              <BigButton
                bi={{ es: "Cómo llegar", en: "Directions" }}
                onPress={() => Linking.openURL(directionsUrl(job.address as string))}
              />
            </View>
          </Card>
        ) : null}

        <PhotosCard jobId={jobId} />

        {job && job.soldScope.length > 0 ? <ScopeCard jobId={jobId} docs={job.soldScope} /> : null}

        <Tile
          title={{ es: "Inspección", en: "Inspection" }}
          progress={`${inspectionDone}/${INSPECTION_FORM.optionFields.length}`}
          color={colors.blue}
          onPress={() => navigation.navigate("Checklist", { jobId })}
        />
        <Tile
          title={{ es: "Limpieza", en: "Cleanup" }}
          progress={`${cleanupDone}/${CLEANUP_FORM.optionFields.length}`}
          color={colors.green}
          onPress={() => navigation.navigate("Cleanup", { jobId })}
        />
        <Tile
          title={{ es: "Reportar problema", en: "Report a problem" }}
          progress={state.reports.length > 0 ? `${state.reports.length}` : ""}
          color={colors.orange}
          onPress={() => navigation.navigate("Report", { jobId })}
        />
        {job && job.punchTasks.length > 0 ? (
          <Tile
            title={{ es: "Reparaciones", en: "Repairs" }}
            progress={`${job.punchTasks.filter((t) => t.progress >= 1).length}/${job.punchTasks.length}`}
            color={colors.orange}
            onPress={() => navigation.navigate("PunchList", { jobId })}
          />
        ) : null}

        <BigButton
          bi={{ es: "Terminar y enviar", en: "Finish & send" }}
          color={colors.greenDark}
          disabled={remaining > 0}
          onPress={() => navigation.navigate("Send", { jobId })}
        />
        <Text style={styles.footnote}>
          {remaining > 0
            ? `${remaining} ${t("itemsLeft")} / ${t2("itemsLeft")}`
            : `${t("sendToJobTread")} · ${t2("sendToJobTread")}`}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Job-condition photos, kept on the phone (they survive moving around the
 * app) and uploaded to JobTread when the visit is finished & sent.
 */
function PhotosCard({ jobId }: { jobId: string }) {
  const { p, s } = useLang();
  const { state, addVisitPhoto, removeVisitPhoto } = useVisit(jobId);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const photos = state.visitPhotos;

  return (
    <Card>
      {cameraOpen ? (
        <CameraView mode="burst" onCapture={addVisitPhoto} onClose={() => setCameraOpen(false)} />
      ) : null}
      {viewing !== null && photos[viewing] ? (
        <PhotoViewer
          uri={photos[viewing]}
          onClose={() => setViewing(null)}
          onDelete={() => removeVisitPhoto(viewing)}
        />
      ) : null}
      <View style={styles.photosHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.tileTitle}>{p({ es: "Fotos de la visita", en: "Visit photos" })}</Text>
          <Text style={styles.tileSub}>
            {s({ es: "Fotos de la visita", en: "Visit photos" })} ·{" "}
            {photos.length > 0
              ? `${photos.length} ${p({ es: "para enviar al terminar", en: "to send when you finish" })}`
              : p({ es: "se envían al terminar", en: "sent when you finish" })}
          </Text>
        </View>
        <Pressable onPress={() => setCameraOpen(true)} style={styles.photoAdd} hitSlop={8}>
          <Text style={styles.photoAddText}>{p({ es: "📷 Tomar fotos", en: "📷 Take photos" })}</Text>
        </Pressable>
      </View>
      {photos.length > 0 ? (
        <View style={styles.photoGrid}>
          {photos.map((uri, i) => (
            <Pressable key={i} onPress={() => setViewing(i)}>
              <Image source={{ uri }} style={styles.photoThumb} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function ScopeCard({ jobId, docs }: { jobId: string; docs: ScopeDocument[] }) {
  const { p, s, lang } = useLang();
  const [open, setOpen] = useState(false);
  const [openDocs, setOpenDocs] = useState<Record<string, boolean>>({});
  const [expandedLine, setExpandedLine] = useState<string | null>(null);
  const [summary, setSummary] = useState<ScopeSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    if (!open || summary) return;
    let on = true;
    setSummaryLoading(true);
    getScopeSummary(jobId)
      .then((result) => {
        if (!on) return;
        setSummary(result.summary);
        setSummaryError(result.error ?? null);
      })
      .finally(() => {
        if (on) setSummaryLoading(false);
      });
    return () => {
      on = false;
    };
  }, [open, summary, jobId]);

  // Line items of expanded documents get machine-translated in ES mode.
  const es = useSpanish(
    docs
      .filter((d) => openDocs[d.id])
      .flatMap((d) => d.lines.flatMap((l) => [l.name, l.description])),
    lang === "es",
  );

  return (
    <Card style={{ paddingVertical: 14 }}>
      <Pressable onPress={() => setOpen((o) => !o)} hitSlop={8}>
        <View style={styles.scopeHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.tileTitle}>{p({ es: "Trabajo vendido", en: "Sold scope" })}</Text>
            <Text style={styles.tileSub}>
              {s({ es: "Trabajo vendido", en: "Sold scope" })} · {docs.length}{" "}
              {p({ es: "documentos", en: "documents" })}
            </Text>
          </View>
          <Text style={styles.chevron}>{open ? "▾" : "›"}</Text>
        </View>
      </Pressable>

      {open ? (
        <View style={{ marginTop: 10 }}>
          {summary ? (
            <Text style={styles.scopeSummary}>{lang === "es" ? summary.es : summary.en}</Text>
          ) : summaryLoading ? (
            <Text style={styles.scopeSummaryLoading}>
              {p({ es: "Generando resumen…", en: "Generating summary…" })}
            </Text>
          ) : summaryError ? (
            <Text style={styles.scopeSummaryLoading}>
              {p({ es: "Resumen no disponible", en: "Summary unavailable" })} · {summaryError}
            </Text>
          ) : null}

          {docs.map((doc) => {
            const docOpen = openDocs[doc.id] === true;
            return (
              <View key={doc.id} style={styles.scopeDoc}>
                <View style={styles.scopeDocRow}>
                  <Pressable style={{ flex: 1 }} onPress={() => Linking.openURL(doc.jtUrl)} hitSlop={6}>
                    <Text style={styles.scopeDocLink}>
                      {doc.name}
                      {doc.number != null ? ` #${doc.number}` : ""} ↗
                    </Text>
                    <Text style={styles.scopeDocMeta}>
                      {doc.issueDate ?? ""} · {p({ es: "ver en JobTread", en: "review in JobTread" })}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setOpenDocs((prev) => ({ ...prev, [doc.id]: !docOpen }))}
                    hitSlop={8}
                    style={styles.scopeToggle}
                  >
                    <Text style={styles.scopeToggleText}>
                      {docOpen
                        ? p({ es: "Ocultar", en: "Hide" })
                        : `${doc.lines.length} ${p({ es: "partidas", en: "items" })} ›`}
                    </Text>
                  </Pressable>
                </View>

                {docOpen
                  ? doc.lines.map((line, i) => {
                      const key = `${doc.id}:${i}`;
                      const expanded = expandedLine === key;
                      return (
                        <Pressable
                          key={key}
                          onPress={() =>
                            line.description ? setExpandedLine(expanded ? null : key) : undefined
                          }
                        >
                          <View style={[styles.scopeLine, i > 0 ? styles.scopeLineDivider : null]}>
                            <Text style={styles.scopeLineName}>
                              {es(line.name)}
                              {line.description ? " …" : ""}
                            </Text>
                            {line.quantity != null ? (
                              <Text style={styles.scopeQty}>
                                {line.quantity} {line.unit ?? ""}
                              </Text>
                            ) : null}
                          </View>
                          {expanded && line.description ? (
                            <Text style={styles.scopeDesc}>{es(line.description)}</Text>
                          ) : null}
                        </Pressable>
                      );
                    })
                  : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

function Tile({
  title,
  progress,
  color,
  onPress,
}: {
  title: { es: string; en: string };
  progress: string;
  color: string;
  onPress: () => void;
}) {
  const { p, s } = useLang();
  return (
    <Pressable onPress={onPress}>
      <Card style={styles.tile}>
        <View style={{ flex: 1 }}>
          <Text style={styles.tileTitle}>{p(title)}</Text>
          <Text style={styles.tileSub}>{s(title)}</Text>
        </View>
        <Text style={[styles.tileProgress, { color }]}>{progress}</Text>
        <Text style={styles.chevron}>›</Text>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
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
  title: { fontSize: 19, fontWeight: "700", color: colors.ink },
  subtitle: { fontSize: 12, color: colors.muted },
  addressCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  offlineCard: { gap: 10 },
  offlineTitle: { fontSize: 15.5, fontWeight: "700", color: colors.ink },
  offlineSub: { fontSize: 12.5, color: colors.muted, lineHeight: 18 },
  address: { fontSize: 14.5, fontWeight: "700", color: colors.ink },
  tile: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 18 },
  scopeHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  scopeDoc: { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 10 },
  scopeDocRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  scopeDocLink: { fontSize: 14.5, fontWeight: "700", color: colors.blue },
  scopeDocMeta: { fontSize: 11.5, color: colors.faint, marginTop: 1 },
  scopeToggle: {
    backgroundColor: colors.blueTint,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  scopeToggleText: { fontSize: 12.5, fontWeight: "700", color: colors.blue },
  scopeSummary: { fontSize: 14.5, color: colors.ink, lineHeight: 21, marginBottom: 4 },
  scopeSummaryLoading: { fontSize: 12.5, color: colors.faint, fontStyle: "italic" },
  scopeLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 7,
  },
  scopeLineDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  photosHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  photoAdd: {
    backgroundColor: colors.blueTint,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  photoAddText: { color: colors.blue, fontSize: 14, fontWeight: "700" },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  photoThumb: { width: 72, height: 72, borderRadius: 10 },
  scopeLineName: { flex: 1, fontSize: 14, color: colors.ink },
  scopeQty: { fontSize: 13, fontWeight: "600", color: colors.muted },
  scopeDesc: { fontSize: 12.5, color: colors.muted, paddingBottom: 6, paddingLeft: 2 },
  tileTitle: { fontSize: 18, fontWeight: "700", color: colors.ink },
  tileSub: { fontSize: 12, color: colors.faint },
  tileProgress: { fontSize: 16, fontWeight: "700" },
  chevron: { fontSize: 22, color: "#9AA8B8" },
  footnote: { textAlign: "center", fontSize: 11.5, color: "#66788C" },
});
