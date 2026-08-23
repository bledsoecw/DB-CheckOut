/**
 * Voice pipeline: crew speech (Spanish, English, or mixed) -> verbatim
 * transcript + clean English note for the office.
 *
 * Not wired yet. The mobile app records audio and POSTs it here; this module
 * will run speech-to-text and then an LLM cleanup/translation pass (Claude),
 * returning both the verbatim text and the English work note. Until then the
 * app lets the crew review/edit a typed note, so nothing blocks on this.
 */

export interface VoiceResult {
  /** What was said, verbatim, in whatever language it was said. */
  heardText: string;
  /** Clean English note for the JT record. */
  englishNote: string;
}

export interface VoiceProvider {
  transcribe(audio: Buffer, mimeType: string): Promise<VoiceResult>;
}

export const notImplementedVoiceProvider: VoiceProvider = {
  async transcribe(): Promise<VoiceResult> {
    throw new Error("Voice pipeline not configured yet (see apps/sync/src/voice.ts)");
  },
};
