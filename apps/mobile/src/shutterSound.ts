/**
 * Camera shutter sound, ported from DB Cam Mobile (M2.29 there). The click
 * plays through an <audio> ELEMENT, not Web Audio: iOS mutes Web Audio
 * output with the ring/silent switch, but media elements count as playback
 * — so the shutter sounds even on a muted phone, like CompanyCam. The WAV
 * is synthesized once (no asset to host); iOS also ignores
 * HTMLMediaElement.volume, so the loudness is baked into the samples.
 * The element must be unlocked by a completed user tap — prime() is called
 * from the tap that opens the camera and from each shutter press; a press
 * that lands before the unlock finishes plays as soon as it does.
 */

let sndEl: HTMLAudioElement | null = null;
let sndElOk = false;
let sndUri: string | null = null;
let sndPending = false;

/** Same ka-chick + beep as DB Cam, rendered offline. */
function renderShutter(): Float32Array {
  const sr = 24000;
  const n = Math.round(sr * 0.24);
  const out = new Float32Array(n);
  function tick(t0: number, freq: number, q: number, vol: number, dur: number) {
    // bandpass-filtered noise burst
    const w0 = (2 * Math.PI * freq) / sr;
    const al = Math.sin(w0) / (2 * q);
    const a0 = 1 + al;
    const b0 = al / a0;
    const b2 = -al / a0;
    const a1 = -2 * Math.cos(w0) / a0;
    const a2 = (1 - al) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const s0 = Math.round(t0 * sr);
    const len = Math.round((dur + 0.03) * sr);
    for (let k = 0; k < len && s0 + k < n; k++) {
      const t = k / sr;
      const env = t < dur ? vol * Math.pow(0.0008 / vol, t / dur) : 0;
      const x = (Math.random() * 2 - 1) * env;
      const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      out[s0 + k] += y * 3; // the filter eats most of the energy — bring it back
    }
  }
  function beep(t0: number, freq: number, vol: number, dur: number) {
    const s0 = Math.round(t0 * sr);
    const len = Math.round((dur + 0.02) * sr);
    for (let k = 0; k < len && s0 + k < n; k++) {
      const t = k / sr;
      const env = t < dur ? vol * Math.pow(0.001 / vol, t / dur) : 0;
      out[s0 + k] += Math.sin(2 * Math.PI * freq * t) * env;
    }
  }
  tick(0.005, 2600, 8, 0.9, 0.03);
  tick(0.065, 1000, 4, 0.8, 0.07);
  beep(0.025, 1650, 0.5, 0.09);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) {
    const g = 0.98 / peak;
    for (let i = 0; i < n; i++) out[i] *= g;
  }
  return out;
}

function wavUri(f: Float32Array, sr: number): string {
  const n = f.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const tag = (o: number, s: string) => {
    for (let k = 0; k < s.length; k++) v.setUint8(o + k, s.charCodeAt(k));
  };
  tag(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); tag(8, "WAVE");
  tag(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, f[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const by = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < by.length; i += 8192) {
    bin += String.fromCharCode(...by.subarray(i, i + 8192));
  }
  return `data:audio/wav;base64,${btoa(bin)}`;
}

/**
 * Unlock the audio element. Must run inside a user gesture; safe to call
 * repeatedly. Plays a silent wav first (no stray click), then swaps in the
 * real shutter; a press that beat the unlock plays right after it.
 */
export function primeShutterSound(): void {
  const g = globalThis as Record<string, any>;
  if (typeof g.Audio !== "function") return;
  try {
    if (!sndEl) {
      sndEl = new g.Audio(wavUri(new Float32Array(240), 24000)) as HTMLAudioElement;
      sndEl.setAttribute("playsinline", "");
      sndEl.preload = "auto";
    }
    if (!sndElOk) {
      const pr = sndEl.play();
      if (pr && pr.then) {
        pr.then(() => {
          try { sndEl?.pause(); } catch { /* already stopped */ }
          if (!sndUri) sndUri = wavUri(renderShutter(), 24000);
          if (sndEl) {
            sndEl.src = sndUri;
            try { sndEl.load(); } catch { /* best effort */ }
          }
          sndElOk = true;
          if (sndPending) {
            sndPending = false;
            playShutterSound();
          }
        }).catch(() => {});
      }
    }
  } catch { /* sound is never worth breaking capture */ }
}

export function playShutterSound(): void {
  if (!sndElOk || !sndEl) {
    sndPending = true;
    primeShutterSound();
    return;
  }
  try {
    sndEl.currentTime = 0;
    void sndEl.play()?.catch?.(() => {});
  } catch { /* ditto */ }
}
