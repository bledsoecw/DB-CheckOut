import React, { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../App";
import { BigButton, Card, LangPill } from "../components";
import { useLang } from "../i18n";
import { downscalePhoto } from "../photo";
import { useVisit } from "../store";
import { colors } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Report">;

const SIDES = [
  { key: "front", es: "Frente", en: "Front" },
  { key: "back", es: "Atrás", en: "Back" },
  { key: "left", es: "Izquierda", en: "Left" },
  { key: "right", es: "Derecha", en: "Right" },
] as const;

export default function ReportScreen({ navigation, route }: Props) {
  const { jobId } = route.params;
  const { t, t2, lang } = useLang();
  const { addReport } = useVisit(jobId);
  const [side, setSide] = useState<string>("back");
  const [detail, setDetail] = useState("");
  const [note, setNote] = useState("");
  const [fixedOnSite, setFixedOnSite] = useState(false);
  const [materials, setMaterials] = useState("");
  const [originalCrew, setOriginalCrew] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
  };

  const send = async () => {
    const sideLabel = SIDES.find((s) => s.key === side);
    const location = `${sideLabel?.en ?? side}${detail ? ` — ${detail}` : ""}`;
    // Voice pipeline lands in M2: until then the typed note IS the English note.
    const photoBase64 = photoUri ? await downscalePhoto(photoUri) : undefined;
    addReport({
      location,
      englishNote: note.trim(),
      reportedBy: undefined,
      fixedOnSite: fixedOnSite || undefined,
      materialsNote: fixedOnSite && materials.trim() ? materials.trim() : undefined,
      originalCrew: originalCrew.trim() || undefined,
      photoBase64,
    });
    navigation.goBack();
  };

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

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Pressable onPress={takePhoto}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photo} />
          ) : (
            <View style={styles.photoEmpty}>
              <Text style={styles.photoEmptyTitle}>{t("takePhoto")}</Text>
              <Text style={styles.photoEmptySub}>{t2("takePhoto")}</Text>
            </View>
          )}
        </Pressable>

        <View>
          <Text style={styles.label}>
            {t("whereIsIt")} <Text style={styles.labelSub}>{t2("whereIsIt")}</Text>
          </Text>
          <View style={styles.sides}>
            {SIDES.map((s) => (
              <Pressable
                key={s.key}
                onPress={() => setSide(s.key)}
                style={[styles.side, side === s.key ? styles.sideOn : null]}
              >
                <Text style={[styles.sideText, side === s.key ? styles.sideTextOn : null]}>
                  {lang === "es" ? s.es : s.en}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={detail}
            onChangeText={setDetail}
            placeholder={lang === "es" ? "Detalle: bota del tubo, canal…" : "Detail: pipe boot, gutter…"}
            placeholderTextColor="#9AA8B8"
            style={styles.input}
          />
        </View>

        <Card style={{ gap: 8 }}>
          <Text style={styles.micHint}>
            {t("holdAndSpeak")} — {t("speakAnyLanguage")}
          </Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            placeholder={
              lang === "es"
                ? "Nota en inglés para la oficina (la voz llega en M2 — por ahora escribe)"
                : "English note for the office (voice lands in M2 — type for now)"
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
            fixedOnSite
              ? { es: "Guardar lo que arreglé", en: "Save what I fixed" }
              : { es: "Enviar reporte", en: "Send report" }
          }
          color={fixedOnSite ? colors.greenDark : colors.orange}
          disabled={note.trim().length === 0}
          onPress={send}
        />
        <Text style={styles.footnote}>
          {fixedOnSite
            ? lang === "es"
              ? "Queda documentado en JobTread — nadie tiene que regresar."
              : "Documented in JobTread — nobody has to come back."
            : `${t("pmAssigns")} · ${t2("pmAssigns")}`}
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
  micHint: { fontSize: 12.5, fontWeight: "600", color: colors.muted },
  noteTag: { fontSize: 10, fontWeight: "700", color: colors.blue, letterSpacing: 0.4 },
  footnote: { textAlign: "center", fontSize: 11.5, color: "#66788C" },
});
