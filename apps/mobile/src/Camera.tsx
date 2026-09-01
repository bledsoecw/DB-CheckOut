/**
 * In-app camera, DB Cam style: a live rear-camera viewfinder with a big
 * shutter that captures the frame instantly — no OS "Retake / Use Photo"
 * confirmation. "burst" keeps the viewfinder open for shot after shot;
 * "single" hands back one photo and closes. If a live stream can't start
 * (permission denied, unsupported browser) it falls back to the OS camera
 * picker so photos are never blocked.
 */

import React, { useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useLang } from "./i18n";
import { downscalePhoto } from "./photo";
import { playShutterSound, primeShutterSound } from "./shutterSound";

const MAX_DIM = 1600;
const JPEG_QUALITY = 0.8;

interface Props {
  mode: "single" | "burst";
  /** One JPEG data URI per shutter press, already downscaled. */
  onCapture: (dataUri: string) => void;
  onClose: () => void;
}

export default function CameraView({ mode, onCapture, onClose }: Props) {
  const { p } = useLang();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const flashRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState(0);
  // The layer is sized in EXPLICIT PIXELS from the browser's reported
  // window size. iOS Safari's 100%/100vh/100dvh all disagreed with the
  // visible viewport at some point — the letterboxed preview and tap
  // targets sitting below their pixels came from exactly that. The
  // window's innerWidth/innerHeight (what useWindowDimensions reports,
  // updated on rotation) is the one measurement iOS gets right.
  const { width, height } = useWindowDimensions();
  const landscape = width > height;

  const stopStream = () => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  };

  useEffect(() => {
    let cancelled = false;
    const g = globalThis as Record<string, any>;

    const fallbackPicker = async () => {
      // No live stream possible — the OS camera picker still gets the photo.
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (perm.granted) {
        const result = await ImagePicker.launchCameraAsync({ quality: 0.6 });
        if (!result.canceled && result.assets[0]) {
          onCapture(await downscalePhoto(result.assets[0].uri));
        }
      }
      onClose();
    };

    const start = async () => {
      try {
        const stream: MediaStream = await g.navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        setReady(true);
      } catch {
        if (!cancelled) void fallbackPicker();
      }
    };

    // The tap that opened the camera is a completed gesture — unlock the
    // shutter sound on it.
    primeShutterSound();
    if (g.navigator?.mediaDevices?.getUserMedia) void start();
    else void fallbackPicker();

    return () => {
      cancelled = true;
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Element.animate restarts reliably even while the main thread is busy
  // encoding the previous shot — a CSS-class toggle got swallowed in
  // bursts (DB Cam lesson: only the first picture of a series flashed).
  const flashScreen = () => {
    const f = flashRef.current;
    if (f?.animate) f.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 260, easing: "ease-out" });
  };

  const shutter = () => {
    const video = videoRef.current;
    if (!video || !ready || busyRef.current || video.videoWidth === 0) return;
    busyRef.current = true;
    try {
      const g = globalThis as Record<string, any>;
      const scale = Math.min(1, MAX_DIM / Math.max(video.videoWidth, video.videoHeight));
      const canvas = g.document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUri = canvas.toDataURL("image/jpeg", JPEG_QUALITY) as string;
      playShutterSound();
      flashScreen();
      onCapture(dataUri);
      if (mode === "single") {
        stopStream();
        onClose();
        return;
      }
      setCount((n) => n + 1);
    } finally {
      busyRef.current = false;
    }
  };

  const close = () => {
    stopStream();
    onClose();
  };

  ensureCamCss();

  return (
    <Modal visible animationType="none" onRequestClose={close}>
      {React.createElement(
        "div",
        {
          id: "dbco-cam",
          style: {
            position: "fixed",
            top: 0,
            left: 0,
            width: `${width}px`,
            height: `${height}px`,
            background: "#000",
            overflow: "hidden",
          },
        },
        React.createElement("video", {
          ref: videoRef,
          autoPlay: true,
          playsInline: true,
          muted: true,
        }),
        React.createElement("div", {
          ref: flashRef,
          style: {
            position: "absolute",
            inset: 0,
            background: "#fff",
            opacity: 0,
            pointerEvents: "none",
            zIndex: 2,
          },
        }),
        <View key="top" style={styles.topBar}>
          <Pressable onPress={close} style={styles.closeBtn} hitSlop={10}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
          {mode === "burst" && count > 0 ? (
            <View style={styles.countPill}>
              <Text style={styles.countText}>
                {count} {p({ es: count === 1 ? "foto" : "fotos", en: count === 1 ? "photo" : "photos" })}
              </Text>
            </View>
          ) : (
            <View />
          )}
          {landscape && mode === "burst" ? (
            <Pressable onPress={close} hitSlop={10} style={styles.doneBtn}>
              <Text style={styles.doneText}>{p({ es: "Listo", en: "Done" })}</Text>
            </Pressable>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>,
        landscape ? (
          <Pressable
            key="land-shutter"
            onPress={shutter}
            // Right edge, centered at 75% of the real window height —
            // halfway between center and the bottom edge, in pixels.
            style={[
              styles.shutterOuter,
              { position: "absolute", right: 22, top: Math.round(height * 0.75) - 38, zIndex: 3 },
            ]}
            hitSlop={16}
          >
            <View style={styles.shutterInner} />
          </Pressable>
        ) : (
          <View key="bottom" style={styles.bottomBar}>
            <View style={styles.sideSlot}>
              {mode === "burst" ? (
                <Pressable onPress={close} hitSlop={10}>
                  <Text style={styles.doneText}>{p({ es: "Listo", en: "Done" })}</Text>
                </Pressable>
              ) : null}
            </View>
            <Pressable onPress={shutter} style={styles.shutterOuter} hitSlop={12}>
              <View style={styles.shutterInner} />
            </Pressable>
            <View style={styles.sideSlot} />
          </View>
        ),
        !ready ? (
          <View key="load" style={styles.loading}>
            <Text style={styles.loadingText}>{p({ es: "Abriendo cámara…", en: "Opening camera…" })}</Text>
          </View>
        ) : null,
      )}
    </Modal>
  );
}

/**
 * The video fills its pixel-sized parent and crops to cover. The parent's
 * size is inline pixels (see the render) — never viewport units, which iOS
 * Safari resolves against the wrong viewport.
 */
function ensureCamCss(): void {
  const g = globalThis as Record<string, any>;
  const doc = g.document;
  if (!doc || doc.getElementById("dbco-cam-css")) return;
  const style = doc.createElement("style");
  style.id = "dbco-cam-css";
  style.textContent =
    "#dbco-cam video{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;background:#000}";
  doc.head.appendChild(style);
}

const styles = StyleSheet.create({
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    paddingTop: 20,
    zIndex: 3,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { color: "#fff", fontSize: 20, fontWeight: "700" },
  countPill: {
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  countText: { color: "#fff", fontSize: 13.5, fontWeight: "700" },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 28,
    paddingBottom: 30,
    paddingTop: 16,
    zIndex: 3,
  },
  doneBtn: {
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  sideSlot: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  shutterOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 5,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: "#fff" },
  doneText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  loading: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  loadingText: { color: "#9AA8B8", fontSize: 14 },
});
