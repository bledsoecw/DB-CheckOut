import React, { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { JobDetail } from "@shared/types";
import type { RootStackParamList } from "../../App";
import { getJob } from "../api";
import { BigButton, Card, LangPill } from "../components";
import { useLang } from "../i18n";
import { colors } from "../theme";
import { directionsUrl } from "./QueueScreen";

type Props = NativeStackScreenProps<RootStackParamList, "PunchList">;

export default function PunchListScreen({ navigation, route }: Props) {
  const { jobId } = route.params;
  const { t, t2 } = useLang();
  const [job, setJob] = useState<JobDetail | null>(null);

  useEffect(() => {
    const unsub = navigation.addListener("focus", () => {
      getJob(jobId).then(setJob).catch(() => {});
    });
    return unsub;
  }, [navigation, jobId]);

  const tasks = job?.punchTasks ?? [];
  const done = tasks.filter((task) => task.progress >= 1).length;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.back} hitSlop={8}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t("repairs")}</Text>
          <Text style={styles.subtitle}>
            {t2("repairs")} · {job?.name ?? ""}
          </Text>
        </View>
        <LangPill />
        <View style={styles.count}>
          <Text style={styles.countText}>
            {done}/{tasks.length}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        {job?.address ? (
          <Card style={styles.addressCard}>
            <Text style={styles.address}>{job.address}</Text>
            <View style={{ width: 140 }}>
              <BigButton
                bi={{ es: "Cómo llegar", en: "Directions" }}
                onPress={() => Linking.openURL(directionsUrl(job.address as string))}
              />
            </View>
          </Card>
        ) : null}

        {job && tasks.length === 0 ? (
          <Card>
            <Text style={styles.emptyTitle}>
              {`Sin reparaciones asignadas todavía`}
            </Text>
            <Text style={styles.emptyText}>
              {`La oficina convierte los reportes en órdenes de trabajo. · The office hasn't assigned any repairs for this job yet.`}
            </Text>
            <BigButton
              bi={{ es: "Ver el trabajo", en: "Open the job" }}
              onPress={() => navigation.navigate("Job", { jobId })}
            />
          </Card>
        ) : null}

        {tasks.map((task) => {
          const finished = task.progress >= 1;
          return (
            <Pressable
              key={task.id}
              disabled={finished}
              onPress={() => navigation.navigate("PunchItem", { jobId, taskId: task.id })}
            >
              <Card style={finished ? styles.doneCard : undefined}>
                <View style={styles.taskRow}>
                  <View style={[styles.dot, finished ? styles.dotDone : styles.dotOpen]}>
                    <Text style={{ color: "#fff", fontWeight: "700" }}>{finished ? "✓" : "›"}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.taskName, finished ? styles.taskNameDone : null]}>
                      {task.name.replace(/^REPORT: /, "")}
                    </Text>
                    {task.description ? (
                      <Text style={styles.taskDesc} numberOfLines={finished ? 1 : 3}>
                        {task.description}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </Card>
            </Pressable>
          );
        })}

        <Text style={styles.footnote}>
          {`Foto de antes y después en cada reparación · Before & after photo on every repair`}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 8 },
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
    backgroundColor: colors.orangeTint,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  countText: { color: colors.orange, fontSize: 16, fontWeight: "700" },
  addressCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: colors.ink, marginBottom: 4 },
  emptyText: { fontSize: 12.5, color: colors.muted, marginBottom: 12 },
  address: { flex: 1, fontSize: 14.5, fontWeight: "700", color: colors.ink },
  doneCard: { backgroundColor: "#F7FAF7", borderColor: "#D8EADB" },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  dot: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  dotDone: { backgroundColor: colors.green },
  dotOpen: { backgroundColor: colors.orange },
  taskName: { fontSize: 14.5, fontWeight: "700", color: colors.ink },
  taskNameDone: { color: "#3D5245" },
  taskDesc: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  footnote: { textAlign: "center", fontSize: 11.5, color: "#66788C" },
});
