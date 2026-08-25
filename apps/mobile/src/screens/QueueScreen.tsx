import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { QueueJob } from "@shared/types";
import { STATUS } from "@shared/jobtread";
import type { RootStackParamList } from "../../App";
import { getQueue, outboxCount } from "../api";
import { useAuth } from "../auth";
import { BigButton, Card, LangPill } from "../components";
import { useLang } from "../i18n";
import { colors } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Queue">;

export function directionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

export default function QueueScreen({ navigation }: Props) {
  const { t, t2, p } = useLang();
  const { mode, userName, signOut } = useAuth();
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [queued, setQueued] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setJobs(await getQueue());
      setQueued(await outboxCount());
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener("focus", load);
    return unsub;
  }, [navigation, load]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{t("myJobs")}</Text>
          <Text style={styles.subtitle}>
            {t2("myJobs")} · {jobs.length} {t("jobsToday")}
          </Text>
        </View>
        <LangPill />
      </View>

      {queued > 0 ? (
        <View style={styles.offline}>
          <Text style={styles.offlineTitle}>{t("offlineSaved")}</Text>
          <Text style={styles.offlineDetail}>
            {queued} · {t("offlineDetail")}
          </Text>
        </View>
      ) : null}

      <FlatList
        data={jobs}
        keyExtractor={(j) => j.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        ListFooterComponent={
          <View>
            <Text style={styles.footer}>{t("queueNote")}</Text>
            <Pressable onPress={signOut} style={styles.change} hitSlop={8}>
              <Text style={styles.changeText}>
                {mode === "demo"
                  ? p({ es: "Salir de la demostración", en: "Leave the demo" })
                  : `${p({ es: "Cerrar sesión", en: "Sign out" })}${userName ? ` · ${userName}` : ""}`}
              </Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => <JobCard job={item} navigation={navigation} />}
      />
    </SafeAreaView>
  );
}

function JobCard({ job, navigation }: { job: QueueJob; navigation: Props["navigation"] }) {
  const { t, p } = useLang();
  const isPunch = job.status === STATUS.punchList || job.status === STATUS.punchReview;
  return (
    <Card>
      <View style={styles.cardTop}>
        <View style={styles.badges}>
          <Text style={[styles.badge, isPunch ? styles.badgeOrange : styles.badgeBlue]}>
            {isPunch ? `${t("repairs").toUpperCase()} · ${job.openPunchCount}` : t("inspection").toUpperCase()}
          </Text>
          {job.isService ? (
            <Text style={[styles.badge, styles.badgeGreen]}>
              {p({ es: "SERVICIO", en: "SERVICE" })}
            </Text>
          ) : null}
        </View>
        <Text style={styles.number}>{job.number}</Text>
      </View>
      <Text style={styles.jobName}>{job.name}</Text>
      {job.address ? <Text style={styles.address}>{job.address}</Text> : null}
      {job.projectManager ? (
        <Text style={styles.meta}>PM · {job.projectManager}</Text>
      ) : null}
      <View style={styles.actions}>
        {job.address ? (
          <Pressable
            style={styles.directions}
            onPress={() => Linking.openURL(directionsUrl(job.address as string))}
          >
            <Text style={styles.directionsText}>{t("directions")}</Text>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <BigButton
            bi={isPunch ? { es: "Ver reparaciones", en: "See the repairs" } : { es: "Empezar", en: "Start" }}
            color={isPunch ? colors.orange : colors.blue}
            onPress={() =>
              isPunch
                ? navigation.navigate("PunchList", { jobId: job.id })
                : navigation.navigate("Job", { jobId: job.id })
            }
          />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  title: { fontSize: 24, fontWeight: "700", color: colors.ink },
  subtitle: { fontSize: 13, color: colors.muted },
  offline: {
    margin: 16,
    marginBottom: 0,
    backgroundColor: colors.amberTint,
    borderWidth: 1,
    borderColor: colors.amberBorder,
    borderRadius: 12,
    padding: 12,
  },
  offlineTitle: { fontSize: 13.5, fontWeight: "700", color: colors.amberInk },
  offlineDetail: { fontSize: 11.5, color: "#8A6A2B" },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  badges: { flexDirection: "row", gap: 6 },
  badge: {
    fontSize: 11,
    fontWeight: "700",
    borderRadius: 6,
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  badgeBlue: { backgroundColor: colors.blueTint, color: colors.blue },
  badgeOrange: { backgroundColor: colors.orangeTint, color: colors.orange },
  badgeGreen: { backgroundColor: colors.greenTint, color: colors.greenDark },
  number: { fontSize: 12, fontWeight: "600", color: colors.muted },
  jobName: { fontSize: 18, fontWeight: "700", color: colors.ink, marginTop: 8 },
  address: { fontSize: 13.5, color: colors.muted, marginTop: 2 },
  meta: { fontSize: 12, color: colors.muted, marginTop: 4 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12, alignItems: "stretch" },
  directions: {
    borderWidth: 1.5,
    borderColor: "#BBD0EC",
    borderRadius: 14,
    paddingHorizontal: 14,
    justifyContent: "center",
    minHeight: 56,
  },
  directionsText: { color: colors.blue, fontSize: 13.5, fontWeight: "700" },
  footer: { textAlign: "center", color: "#66788C", fontSize: 11.5, paddingVertical: 10 },
  change: { alignItems: "center", paddingVertical: 6 },
  changeText: { fontSize: 11.5, fontWeight: "600", color: colors.blue },
});
