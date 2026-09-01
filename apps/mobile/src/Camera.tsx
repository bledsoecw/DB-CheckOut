/**
 * In-app camera, DB Cam style: a live rear-camera viewfinder with a big
 * shutter that captures the frame instantly — no OS "Retake / Use Photo"
 * confirmation. "burst" keeps the viewfinder open for shot after shot;
 * "single" hands back one photo and closes. If a live stream can't start
 * (permission denied, unsupported browser) it falls back to the OS camera
 * picker so photos are never blocked.
 */

import React, { useEffect, useRef, useState } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
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
  const [lastShot, setLastShot] = useState<string | null>(null);
  // One-handed landscape: the controls move to a right-edge column so the
  // shutter sits under the right thumb (DB Cam behavior).
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
      setLastShot(dataUri);
    } finally {
      busyRef.current = false;
    }
  };

  const close = () => {
    stopStream();
    onClose();
  };

  return (
    <Modal visible animationType="fade" onRequestClose={close}>
      <View style={styles.root}>
        {React.createElement("video", {
        ref: videoRef,
        autoPlay: true,
        playsInline: true,
        muted: true,
        style: {
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          backgroundColor: "#000",
        },
      })}
      {React.createElement("div", {
        ref: flashRef,
        style: {
          position: "absolute",
          inset: 0,
          background: "#fff",
          opacity: 0,
          pointerEvents: "none",
          zIndex: 2,
        },
      })}

      <View style={styles.topBar}>
        <Pressable onPress={close} style={styles.closeBtn} hitSlop={10}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        {mode === "burst" && count > 0 ? (
          <View style={styles.countPill}>
            <Text style={styles.countText}>
              {count} {p({ es: count === 1 ? "foto" : "fotos", en: count === 1 ? "photo" : "photos" })}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={landscape ? styles.rightBar : styles.bottomBar}>
        <View style={styles.thumbSlot}>
          {mode === "burst" ? (
            <Pressable onPress={close} hitSlop={10}>
              <Text style={styles.doneText}>{p({ es: "Listo", en: "Done" })}</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={shutter} style={styles.shutterOuter} hitSlop={12}>
          <View style={styles.shutterInner} />
        </Pressable>
        <View style={styles.thumbSlot}>
          {lastShot ? <Image source={{ uri: lastShot }} style={styles.thumb} /> : null}
        </View>
      </View>

        {!ready ? (
          <View style={styles.loading}>
            <Text style={styles.loadingText}>{p({ es: "Abriendo cámara…", en: "Opening camera…" })}</Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
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
  rightBar: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 28,
    paddingRight: 22,
    paddingLeft: 12,
    zIndex: 3,
  },
  thumbSlot: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  thumb: { width: 52, height: 52, borderRadius: 10, borderWidth: 2, borderColor: "#fff" },
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
