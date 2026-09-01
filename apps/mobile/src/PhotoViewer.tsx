/** Full-screen look at one photo, with optional delete. */

import React from "react";
import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useLang } from "./i18n";
import { colors } from "./theme";

interface Props {
  uri: string;
  onClose: () => void;
  /** When given, a delete button removes the photo and closes the viewer. */
  onDelete?: () => void;
}

export default function PhotoViewer({ uri, onClose, onDelete }: Props) {
  const { p } = useLang();
  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Image source={{ uri }} style={styles.img} resizeMode="contain" />
        <Pressable onPress={onClose} style={styles.close} hitSlop={10}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        {onDelete ? (
          <Pressable
            onPress={() => {
              onDelete();
              onClose();
            }}
            style={styles.delete}
            hitSlop={8}
          >
            <Text style={styles.deleteText}>
              🗑 {p({ es: "Eliminar foto", en: "Delete photo" })}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  img: { flex: 1 },
  close: {
    position: "absolute",
    top: 18,
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { color: "#fff", fontSize: 20, fontWeight: "700" },
  delete: {
    position: "absolute",
    bottom: 28,
    alignSelf: "center",
    backgroundColor: colors.red,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  deleteText: { color: "#fff", fontSize: 14.5, fontWeight: "700" },
});
