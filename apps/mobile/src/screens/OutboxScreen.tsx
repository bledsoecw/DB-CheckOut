import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../App";
import { discardOutboxItem, flushOutbox, outboxItems, subscribeOutbox, type OutboxItem } from "../api";
import { BigButton, Card, LangPill } from "../components";
import { useLang } from "../i18n";
import { colors } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Outbox">;

/**
 * Everything saved on this phone that has not reached JobTread yet.
 * Pending items retry by themselves when signal returns; rejected items
 * show the server's reason and are never retried. Either can be discarded —
 * a pending one only after a second tap, because discarding is the one
 * thing here that loses work.
 */
export default function OutboxScreen({ navigation }: Props) {
  const { p } = useLang();
  const [, bump] = useState(0);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => subscribeOutbox(() => bump((n) => n + 1)), []);
  useEffect(
    () => () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    },
    [],
  );

  const items = outboxItems();
  const failed = items.filter((item) => item.status === "failed").length;
  const pending = items.length - failed;

  const sendNow = async () => {
    setSending(true);
    try {
      await flushOutbox();
    } finally {
      setSending(false);
    }
  };

  const discard = (item: OutboxItem) => {
    if (item.status === "failed" || confirming === item.id) {
      discardOutboxItem(item.id);
      setConfirming(null);
      return;
    }
    setConfirming(item.id);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirming(null), 4000);
  };

  const meta = (item: OutboxItem): string => {
    const when = new Date(item.queuedAt).toLocaleString();
    const tries =
      item.attempts > 1
        ? ` · ${item.attempts} ${p({ es: "intentos", en: "attempts" })}`
        : "";
    if (item.status === "failed") {
      return `${when} · ${p({ es: "rechazado — no se reintenta", en: "rejected — will not retry" })}${tries}`;
    }
    if (item.error) return `${when} · ${p({ es: "se reintentará", en: "will retry" })}${tries}`;
    return `${when} · ${p({ es: "esperando señal", en: "waiting for signal" })}${tries}`;
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.back} hitSlop={8}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{p({ es: "Por enviar", en: "Waiting to send" })}</Text>
          <Text style={styles.subtitle}>
            {items.length === 0
              ? p({ es: "Guardado en este teléfono", en: "Saved on this phone" })
              : `${pending} ${p({ es: "pendientes", en: "pending" })}${
                  failed > 0 ? ` · ${failed} ${p({ es: "rechazados", en: "rejected" })}` : ""
                }`}
          </Text>
        </View>
        <LangPill />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        {items.length === 0 ? (
          <Card>
            <Text style={styles.emptyTitle}>
              ✓ {p({ es: "Todo enviado a JobTread", en: "Everything sent to JobTread" })}
            </Text>
          </Card>
        ) : (
          <>
            {failed > 0 ? (
              <Text style={styles.failedHint}>
                {p({
                  es: "Lo rechazado no va a llegar aunque se reintente. Revisa el motivo y descártalo; si hace falta, vuelve a hacerlo en el trabajo.",
                  en: "Rejected items will not go through on retry. Read the reason and discard them; redo them on the job if needed.",
                })}
              </Text>
            ) : null}
            {items.map((item) => (
              <Card key={item.id} style={item.status === "failed" ? styles.failedCard : undefined}>
                <View style={styles.itemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemLabel}>{item.label}</Text>
                    <Text style={styles.itemMeta}>{meta(item)}</Text>
                    {item.error ? <Text style={styles.itemError}>{item.error}</Text> : null}
                  </View>
                  <Pressable
                    onPress={() => discard(item)}
                    hitSlop={8}
                    style={[styles.discard, confirming === item.id ? styles.discardConfirm : null]}
                  >
                    <Text style={styles.discardText}>
                      {confirming === item.id
                        ? p({ es: "¿Seguro? Toca otra vez", en: "Sure? Tap again" })
                        : p({ es: "Descartar", en: "Discard" })}
                    </Text>
                  </Pressable>
                </View>
              </Card>
            ))}
            {pending > 0 ? (
              <BigButton
                bi={
                  sending
                    ? { es: "Enviando…", en: "Sending…" }
                    : { es: "Enviar ahora", en: "Send now" }
                }
                disabled={sending}
                onPress={sendNow}
              />
            ) : null}
            <Text style={styles.footnote}>
              {p({
                es: "Lo pendiente también se envía solo cuando el teléfono recupera señal.",
                en: "Pending items also send by themselves when the phone gets signal back.",
              })}
            </Text>
          </>
        )}
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
  emptyTitle: { fontSize: 15, fontWeight: "700", color: colors.greenDark, textAlign: "center" },
  failedHint: { fontSize: 12.5, color: colors.red, fontWeight: "600", textAlign: "center" },
  failedCard: { borderColor: "#EFC7C2", backgroundColor: "#FDF4F3" },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  itemLabel: { fontSize: 14.5, fontWeight: "700", color: colors.ink },
  itemMeta: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
  itemError: { fontSize: 11.5, color: colors.red, marginTop: 4 },
  discard: {
    backgroundColor: "#F6E3E1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    maxWidth: 130,
  },
  discardConfirm: { backgroundColor: colors.red },
  discardText: { fontSize: 12.5, fontWeight: "700", color: colors.red, textAlign: "center" },
  footnote: { textAlign: "center", fontSize: 11.5, color: "#66788C" },
});
