/**
 * Tap-to-record voice notes, shared by the inspection, cleanup and report
 * screens. A press-and-hold breaks the first time the browser shows its
 * mic permission prompt (the release lands while the prompt is up and the
 * recorder is left running), so this is a tap-to-start / tap-to-stop
 * toggle with a hard time cap and a size check before upload.
 */

import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { transcribeNote } from "./api";
import { Card } from "./components";
import { useLang } from "./i18n";
import { colors } from "./theme";
import { startRecording, voiceSupported, type ActiveRecording } from "./voice";

const MAX_SECONDS = 120;
// The server rejects encoded audio over ~5.6M chars (~4MB decoded).
const MAX_DATA_URI_LENGTH = 5_600_000;

type MicState = "idle" | "recording" | "transcribing";
interface Bi {
  es: string;
  en: string;
}

/** Mic card that records on tap and hands back the transcribed note. */
export function VoiceNoteButton({ onText }: { onText: (en: string, original: string) => void }) {
  const { t, t2, p, s } = useLang();
  const [mic, setMic] = useState<MicState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<Bi | null>(null);
  const recording = useRef<ActiveRecording | null>(null);

  useEffect(() => {
    if (mic !== "recording") return;
    setSeconds(0);
    const iv = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [mic]);

  useEffect(() => {
    if (mic === "recording" && seconds >= MAX_SECONDS) void stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, mic]);

  const start = async () => {
    setError(null);
    try {
      recording.current = await startRecording();
      setMic("recording");
    } catch {
      recording.current = null;
      setError({
        es: "Permite el micrófono en el navegador para dictar.",
        en: "Allow the microphone in the browser to dictate.",
      });
    }
  };

  const stop = async () => {
    const active = recording.current;
    recording.current = null;
    if (!active) return;
    setMic("transcribing");
    try {
      const dataUri = await active.stop();
      if (!dataUri) {
        setError({ es: "No se grabó nada — intenta otra vez.", en: "Nothing recorded — try again." });
        return;
      }
      if (dataUri.length > MAX_DATA_URI_LENGTH) {
        setError({
          es: "La nota es demasiado larga — grábala en partes.",
          en: "The note is too long — record it in pieces.",
        });
        return;
      }
      const { en, original } = await transcribeNote(dataUri);
      onText(en, original);
    } catch (err) {
      if (err instanceof TypeError) {
        // fetch itself failed — no connection to the server
        setError({
          es: "Sin señal — la nota no se transcribió. Intenta otra vez o escríbela.",
          en: "No signal — the note was not transcribed. Try again or type it.",
        });
      } else {
        const reason = err instanceof Error ? err.message : "";
        setError({
          es: `No se pudo transcribir. ${reason}`.trim(),
          en: `Could not transcribe. ${reason}`.trim(),
        });
      }
    } finally {
      setMic("idle");
    }
  };

  if (!voiceSupported()) return null;

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <View style={{ gap: 8 }}>
      <Pressable
        onPress={() => (mic === "idle" ? start() : mic === "recording" ? stop() : undefined)}
        disabled={mic === "transcribing"}
      >
        <Card style={[styles.micCard, mic === "recording" ? styles.micCardActive : null]}>
          <View style={[styles.mic, mic === "recording" ? styles.micActive : null]}>
            <Text style={styles.micIcon}>{mic === "recording" ? "⏹" : "🎤"}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.micTitle}>
              {mic === "recording"
                ? `${p({ es: "Grabando", en: "Recording" })} ${mmss} — ${t("tapToStop")}`
                : mic === "transcribing"
                  ? p({ es: "Escribiendo tu nota…", en: "Writing your note…" })
                  : t("tapAndSpeak")}
            </Text>
            <Text style={styles.micSub}>
              {mic === "idle" ? t("speakAnyLanguage") : mic === "recording" ? t2("tapToStop") : ""}
            </Text>
          </View>
        </Card>
      </Pressable>
      {error ? (
        <Text style={styles.micError}>
          {p(error)} · {s(error)}
        </Text>
      ) : null}
    </View>
  );
}

/** Mic plus the running note it feeds — the whole "Notas" block of a checklist. */
export function VoiceNotesSection({
  note,
  onChange,
}: {
  note: string;
  onChange: (text: string) => void;
}) {
  const { p } = useLang();
  return (
    <View style={{ gap: 10 }}>
      <VoiceNoteButton onText={(en) => onChange(note ? `${note}\n${en}` : en)} />
      {note ? (
        <Card style={{ gap: 6 }}>
          <View style={styles.noteHeader}>
            <Text style={styles.noteTitle}>
              {p({ es: "Nota para la oficina", en: "Note for the office" })}
            </Text>
            <Pressable onPress={() => onChange("")} hitSlop={8}>
              <Text style={styles.noteClear}>{p({ es: "Borrar", en: "Clear" })}</Text>
            </Pressable>
          </View>
          <Text style={styles.noteText}>{note}</Text>
          <Text style={styles.noteSub}>
            {p({ es: "Se envía en inglés con el formulario.", en: "Goes to JobTread with the form." })}
          </Text>
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  micCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  micCardActive: { borderColor: "#E5B6B0", backgroundColor: "#FDF4F3" },
  mic: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.navy,
    alignItems: "center",
    justifyContent: "center",
  },
  micActive: { backgroundColor: colors.red },
  micIcon: { fontSize: 22 },
  micTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  micSub: { fontSize: 11.5, color: colors.muted },
  micError: { fontSize: 12.5, color: colors.red, textAlign: "center" },
  noteHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  noteTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  noteClear: { fontSize: 12.5, fontWeight: "700", color: colors.red },
  noteText: { fontSize: 13.5, color: colors.ink, lineHeight: 19 },
  noteSub: { fontSize: 11, color: colors.faint },
});
