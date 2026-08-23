import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { enterDemoMode, saveTeamCode } from "../api";
import { useAuth } from "../auth";
import { BigButton, LangPill } from "../components";
import { useLang } from "../i18n";
import { colors, radius } from "../theme";

/**
 * First-open gate: the crew types the team code (given by the office) once
 * per device. The code is verified against the server before it's stored.
 */
export default function TeamCodeScreen() {
  const { p } = useLang();
  const { setMode } = useAuth();
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async () => {
    if (checking || !code.trim()) return;
    setChecking(true);
    setFailed(false);
    const ok = await saveTeamCode(code);
    setChecking(false);
    if (ok) setMode("team");
    else setFailed(true);
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.top}>
          <LangPill />
        </View>
        <View style={styles.body}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>DB</Text>
          </View>
          <Text style={styles.appName}>DB CheckOut</Text>
          <Text style={styles.tagline}>
            {p({ es: "Inspecciones · Limpieza · Reparaciones", en: "Inspections · Cleanup · Repairs" })}
          </Text>

          <View style={styles.form}>
            <Text style={styles.label}>{p({ es: "Código del equipo", en: "Team code" })}</Text>
            <Text style={styles.hint}>
              {p({
                es: "Pídelo en la oficina. Solo se escribe una vez.",
                en: "Ask the office for it. You only type it once.",
              })}
            </Text>
            <TextInput
              style={[styles.input, failed ? styles.inputBad : null]}
              value={code}
              onChangeText={(v) => {
                setCode(v);
                setFailed(false);
              }}
              placeholder={p({ es: "Escribe el código aquí", en: "Type the code here" })}
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={submit}
            />
            {failed ? (
              <Text style={styles.error}>
                {p({
                  es: "Código incorrecto o sin conexión. Revísalo e intenta otra vez.",
                  en: "Wrong code or no connection. Check it and try again.",
                })}
              </Text>
            ) : null}
            <BigButton
              bi={
                checking
                  ? { es: "Verificando…", en: "Checking…" }
                  : { es: "Entrar", en: "Enter" }
              }
              onPress={submit}
              disabled={checking || !code.trim()}
            />
          </View>
        </View>
        <Pressable
          style={styles.demo}
          onPress={async () => {
            await enterDemoMode();
            setMode("demo");
          }}
        >
          <Text style={styles.demoText}>
            {p({ es: "Ver demostración (datos de ejemplo)", en: "See a demo (sample data)" })}
          </Text>
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  top: { flexDirection: "row", justifyContent: "flex-end", padding: 16 },
  body: { flex: 1, justifyContent: "center", paddingHorizontal: 24, maxWidth: 440, width: "100%", alignSelf: "center" },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: colors.navy,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  logoText: { color: "#fff", fontSize: 24, fontWeight: "700" },
  appName: {
    fontSize: 26,
    fontWeight: "700",
    color: colors.ink,
    textAlign: "center",
    marginTop: 12,
  },
  tagline: { fontSize: 13, color: colors.muted, textAlign: "center", marginTop: 2 },
  form: { marginTop: 32, gap: 10 },
  label: { fontSize: 16, fontWeight: "700", color: colors.ink },
  hint: { fontSize: 13, color: colors.muted, marginTop: -6 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.control,
    minHeight: 56,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.ink,
  },
  inputBad: { borderColor: colors.red },
  error: { fontSize: 13, color: colors.red },
  demo: { alignItems: "center", padding: 20 },
  demoText: { fontSize: 13, fontWeight: "600", color: colors.blue },
});
