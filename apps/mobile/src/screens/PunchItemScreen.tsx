import React, { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { PunchTask } from "@shared/types";
import type { RootStackParamList } from "../../App";
import { completePunchTask, getJob } from "../api";
import { BigButton, Card, LangPill } from "../components";
import { useLang } from "../i18n";
import { useVisit } from "../store";
import { colors } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "PunchItem">;

export default function PunchItemScreen({ navigation, route }: Props) {
  const { jobId, taskId } = route.params;
  const { t, t2 } = useLang();
  const [task, setTask] = useState<PunchTask | null>(null);
  const [afterUri, setAfterUri] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const { setAfterPhoto } = useVisit(jobId);

  useEffect(() => {
    getJob(jobId)
      .then((job) => setTask(job.punchTasks.find((x) => x.id === taskId) ?? null))
      .catch(() => {});
  }, [jobId, taskId]);

  const takeAfterPhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (!result.canceled && result.assets[0]) {
      setAfterUri(result.assets[0].uri);
      setAfterPhoto(taskId);
    }
  };

  const finish = async () => {
    setSending(true);
    try {
      // TODO(M2): upload the AFTER photo as a JT file tied to this task.
      await completePunchTask(taskId, jobId);
      navigation.goBack();
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.back} hitSlop={8}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {task?.name.replace(/^REPORT: /, "") ?? "…"}
          </Text>
          <Text style={styles.subtitle}>{t("repairs")}</Text>
        </View>
        <LangPill />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Card style={{ gap: 6 }}>
          <Text style={styles.whatLabel}>
            {t("whatToDo")} <Text style={styles.whatLabelSub}>{t2("whatToDo")}</Text>
          </Text>
          <Text style={styles.description}>{task?.description ?? ""}</Text>
        </Card>

        <Pressable onPress={takeAfterPhoto}>
          {afterUri ? (
            <Image source={{ uri: afterUri }} style={styles.photo} />
          ) : (
            <View style={styles.photoEmpty}>
              <Text style={styles.photoEmptyTitle}>{t("afterPhoto")}</Text>
              <Text style={styles.photoEmptySub}>
                {t("afterPhotoRequired")} · {t2("afterPhotoRequired")}
              </Text>
            </View>
          )}
        </Pressable>

        <BigButton
          bi={{ es: "Terminado", en: "Done" }}
          color={colors.greenDark}
          disabled={!afterUri || sending}
          onPress={finish}
        />
        <Text style={styles.footnote}>
          {t("pmChecks")} · {t2("pmChecks")}
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
  title: { fontSize: 19, fontWeight: "700", color: colors.ink },
  subtitle: { fontSize: 12, color: colors.muted },
  whatLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 1, color: colors.orange },
  whatLabelSub: { color: "#9AA8B8", fontWeight: "600", letterSpacing: 0 },
  description: { fontSize: 15, color: colors.ink, lineHeight: 21 },
  photo: { width: "100%", height: 200, borderRadius: 16 },
  photoEmpty: {
    height: 120,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: "#B7C4D4",
    backgroundColor: "#FBFCFE",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  photoEmptyTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
  photoEmptySub: { fontSize: 11.5, color: colors.muted },
  footnote: { textAlign: "center", fontSize: 11.5, color: "#66788C" },
});
