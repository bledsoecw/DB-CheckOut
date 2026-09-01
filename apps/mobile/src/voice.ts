/**
 * Hold-to-speak audio capture for the web build, on the browser's
 * MediaRecorder. Safari records audio/mp4, Chrome/Android audio/webm —
 * both are formats Gemini accepts, so we just take the first one the
 * browser supports and ship the container type with the bytes.
 */

const MIME_CANDIDATES = ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"];

export function voiceSupported(): boolean {
  const g = globalThis as Record<string, any>;
  return typeof g.MediaRecorder === "function" && !!g.navigator?.mediaDevices?.getUserMedia;
}

export interface ActiveRecording {
  /** Stops the mic and resolves to an audio data URI (null when empty). */
  stop: () => Promise<string | null>;
}

export async function startRecording(): Promise<ActiveRecording> {
  const g = globalThis as Record<string, any>;
  const stream: MediaStream = await g.navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = MIME_CANDIDATES.find((m) => g.MediaRecorder.isTypeSupported?.(m));
  const recorder = new g.MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (e: { data: Blob }) => {
    if (e.data.size > 0) chunks.push(e.data);
  });

  const stopped = new Promise<void>((resolve) => recorder.addEventListener("stop", () => resolve()));
  recorder.start();

  return {
    stop: async () => {
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
      for (const track of stream.getTracks()) track.stop();
      if (chunks.length === 0) return null;
      const blob = new Blob(chunks);
      if (blob.size === 0) return null;
      // Build the data URI by hand: iOS Safari labels audio-only recordings
      // "video/mp4" (or nothing at all), and FileReader would bake that label
      // into the URI. The server requires audio/*.
      const type = audioMime(recorder.mimeType || blob.type || mimeType || "");
      return `data:${type};base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`;
    },
  };
}

/** Best audio/* label for whatever the browser called its recording. */
function audioMime(reported: string): string {
  const bare = reported.split(";")[0].trim().toLowerCase();
  if (bare.startsWith("audio/")) return bare;
  if (bare === "video/mp4") return "audio/mp4";
  if (bare === "video/webm") return "audio/webm";
  return "audio/mp4";
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
