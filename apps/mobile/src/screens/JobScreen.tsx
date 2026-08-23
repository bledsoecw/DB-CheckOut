import React, { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { JobDetail } from "@shared/types";
import { CLEANUP_FORM, INSPECTION_FORM } from "@shared/jobtread";
import type { RootStackParamList } from "../../App";
import { getJob } from "../api";
import { BigButton, Card, LangPill } from "../components";
import { useLang } from "../i18n";
import { useVisit } from "../store";
import { colors } from "../theme";
import { directionsUrl } from "./QueueScreen";

type Props = NativeStackScreenProps<RootStackParamList, "Job">;

export default function JobScreen({ navigation, route }: Props) {
  const { jobId } = route.params;
  const { t, t2 } = useLang();
  const [job, setJob] = useState<JobDetail | null>(null);
  const { state } = useVisit(jobId);

  useEffect(() => {
    const unsub = navigation.addListener("focus", () => {
      getJob(jobId).then(setJob).catch(() => {});
    });
    return unsub;
  }, [navigation, jobId]);

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
            {job?.number} {job?.projectManager ? `· PM: ${job.projectManager}` : ""}
          </Text>
        </View>
        <LangPill />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
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
  address: { fontSize: 14.5, fontWeight: "700", color: colors.ink },
  tile: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 18 },
  tileTitle: { fontSize: 18, fontWeight: "700", color: colors.ink },
  tileSub: { fontSize: 12, color: colors.faint },
  tileProgress: { fontSize: 16, fontWeight: "700" },
  chevron: { fontSize: 22, color: "#9AA8B8" },
  footnote: { textAlign: "center", fontSize: 11.5, color: "#66788C" },
});
