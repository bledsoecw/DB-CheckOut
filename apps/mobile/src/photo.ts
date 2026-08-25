import { Platform } from "react-native";

/**
 * Downscale a captured photo to a phone-network-friendly JPEG data URI
 * (~200-600KB) before it goes to the server. Web implementation; native
 * builds would use expo-image-manipulator instead. Falls back to the
 * original URI if anything goes wrong.
 */
export async function downscalePhoto(uri: string, maxDim = 1600, quality = 0.8): Promise<string> {
  if (Platform.OS !== "web") return uri;
  try {
    const g = globalThis as Record<string, any>;
    const img = new g.Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image load failed"));
      img.src = uri;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const canvas = g.document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality) as string;
  } catch {
    return uri;
  }
}
