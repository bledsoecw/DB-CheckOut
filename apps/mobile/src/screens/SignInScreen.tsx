import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { enterDemoMode, getAuthConfig, signInWithGoogle } from "../api";
import { useAuth } from "../auth";
import { LangPill } from "../components";
import { useLang } from "../i18n";
import { colors } from "../theme";

const GSI_SRC = "https://accounts.google.com/gsi/client";

type Gate = "loading" | "ready" | "offline" | "unconfigured";

/**
 * First-open gate: Sign in with Google, company accounts only. The Google
 * ID token is exchanged server-side for a long-lived session, so people
 * sign in about once a month per device. Web-only for now (the app ships
 * as a web app); a native build would use expo-auth-session here.
 */
export default function SignInScreen() {
  const { p } = useLang();
  const { setMode } = useAuth();
  const [gate, setGate] = useState<Gate>("loading");
  const [denied, setDenied] = useState(false);
  const buttonHost = useRef<View | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web") {
      setGate("unconfigured");
      return;
    }
    let cancelled = false;
    (async () => {
      let clientId: string | null = null;
      try {
        clientId = await getAuthConfig();
      } catch {
        if (!cancelled) setGate("offline");
        return;
      }
      if (cancelled) return;
      if (!clientId) {
        setGate("unconfigured");
        return;
      }
      try {
        await loadGsiScript();
        if (cancelled) return;
        const google = (globalThis as Record<string, any>)["google"];
        google.accounts.id.initialize({
          client_id: clientId,
          callback: async (response: { credential: string }) => {
            setDenied(false);
            const ok = await signInWithGoogle(response.credential);
            if (ok) setMode("google");
            else setDenied(true);
          },
        });
        // On web a react-native View ref is the underlying DOM element.
        google.accounts.id.renderButton(buttonHost.current as unknown as HTMLElement, {
          theme: "filled_blue",
          size: "large",
          shape: "pill",
          text: "signin_with",
          width: 280,
        });
        setGate("ready");
      } catch {
        if (!cancelled) setGate("offline");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setMode]);

  return (
    <SafeAreaView style={styles.root}>
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
          <Text style={styles.hint}>
            {p({
              es: "Entra con tu cuenta de Google de Deitemeyer Brothers.",
              en: "Sign in with your Deitemeyer Brothers Google account.",
            })}
          </Text>

          {/* Google renders its button into this view (kept mounted). */}
          <View ref={buttonHost} style={styles.googleHost} />

          {gate === "loading" ? (
            <Text style={styles.status}>{p({ es: "Cargando…", en: "Loading…" })}</Text>
          ) : null}
          {gate === "offline" ? (
            <Text style={styles.error}>
              {p({
                es: "Sin conexión con el servidor. Revisa el internet y recarga la página.",
                en: "Can't reach the server. Check the connection and reload the page.",
              })}
            </Text>
          ) : null}
          {gate === "unconfigured" ? (
            <Text style={styles.error}>
              {p({
                es: "El inicio de sesión aún no está configurado. Avísale a la oficina.",
                en: "Sign-in isn't configured yet. Let the office know.",
              })}
            </Text>
          ) : null}
          {denied ? (
            <Text style={styles.error}>
              {p({
                es: "Esa cuenta no tiene acceso. Usa tu cuenta del trabajo.",
                en: "That account doesn't have access. Use your work account.",
              })}
            </Text>
          ) : null}
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
    </SafeAreaView>
  );
}

let gsiPromise: Promise<void> | null = null;

function loadGsiScript(): Promise<void> {
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    const doc = (globalThis as Record<string, any>)["document"];
    if ((globalThis as Record<string, any>)["google"]?.accounts?.id) {
      resolve();
      return;
    }
    const script = doc.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gsiPromise = null;
      reject(new Error("Failed to load Google sign-in"));
    };
    doc.head.appendChild(script);
  });
  return gsiPromise;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
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
  form: { marginTop: 32, gap: 14, alignItems: "center" },
  hint: { fontSize: 14, color: colors.muted, textAlign: "center" },
  googleHost: { minHeight: 44, alignItems: "center" },
  status: { fontSize: 13, color: colors.faint },
  error: { fontSize: 13, color: colors.red, textAlign: "center" },
  demo: { alignItems: "center", padding: 20 },
  demoText: { fontSize: 13, fontWeight: "600", color: colors.blue },
});
