import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../App";
import { discardOutboxItem, flushOutbox, outboxItems, subscribeOutbox } from "../api";
import { BigButton, Card, LangPill } from "../components";
import { useLang } from "../i18n";
import { colors } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Outbox">;

/**
 * Everything saved on this phone that has not reached JobTread yet.
 * Pending items retry automatically when signal returns; failed items
 * show the server's reason and can be discarded.
 */
export default function OutboxScreen({ navigation }: Props) {
  const { p } = useLang();
  const [, bump] = useState(0);
  const [sending, setSending] = useState(false);

  useEffect(() => subscribeOutbox(() => bump((n) => n + 1)), []);

  const items = outboxItems();

  const sendNow = async () => {
    setSending(true);
    try {
      await flushOutbox();
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
          <Text style={styles.title}>{p({ es: "Por enviar", en: "Waiting to send" })}</Text>
          <Text style={styles.subtitle}>
            {p({ es: "Guardado en este teléfono", en: "Saved on this phone" })}
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
            {items.map((item) => (
              <Card key={item.id} style={item.status === "failed" ? styles.failedCard : undefined}>
                <View style={styles.itemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemLabel}>{item.label}</Text>
                    <Text style={styles.itemMeta}>
                      {new Date(item.queuedAt).toLocaleString()}
                      {item.status === "failed"
                        ? ` · ${p({ es: "falló", en: "failed" })}`
                        : ` · ${p({ es: "esperando señal", en: "waiting for signal" })}`}
                    </Text>
                    {item.error ? <Text style={styles.itemError}>{item.error}</Text> : null}
                  </View>
                  {item.status === "failed" ? (
                    <Pressable onPress={() => discardOutboxItem(item.id)} hitSlop={8} style={styles.discard}>
                      <Text style={styles.discardText}>{p({ es: "Descartar", en: "Discard" })}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </Card>
            ))}
            <BigButton
              bi={
                sending
                  ? { es: "Enviando…", en: "Sending…" }
                  : { es: "Enviar ahora", en: "Send now" }
              }
              disabled={sending}
              onPress={sendNow}
            />
            <Text style={styles.footnote}>
              {p({
                es: "También se envía solo cuando el teléfono recupera señal.",
                en: "Also sends automatically when the phone gets signal back.",
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
  },
  discardText: { fontSize: 12.5, fontWeight: "700", color: colors.red },
  footnote: { textAlign: "center", fontSize: 11.5, color: "#66788C" },
});
