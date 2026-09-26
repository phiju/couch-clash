/**
 * The host's voice: a text model writes the line, a speech provider says it.
 * Both are interfaces – the text comes from OpenAI, the voice from
 * ElevenLabs (or OpenAI, see VOICE_PROVIDER).
 */
export interface LinePrompt {
  /** Rules and style (never contains player input). */
  system: string;
  /** Facts for this line; player names only inside a quoted JSON data block. */
  user: string;
  /** Ask for a JSON object instead of plain text. */
  json?: boolean;
}

export interface TextProvider {
  generateLine(prompt: LinePrompt, options?: { signal?: AbortSignal }): Promise<string>;
}

export interface SpeechClip {
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * "expressive": welcome/start/finale (may use audio tags); "fast": time-critical
 * comments; "read": long read-outs that are new every time (e.g. every answer
 * of a Stadt-Land-Fluss letter) – its model is configurable.
 */
export type SpeechStyle = "expressive" | "fast" | "read";

export interface SpeechProvider {
  readonly id: "elevenlabs" | "openai";
  /** The speech model used for this style (cache key, credits). */
  modelFor(style: SpeechStyle): string;
  /** Whether the text model may add audio tags for this style. */
  supportsTags(style: SpeechStyle): boolean;
  /** The exact text that will be sent (unsupported tags removed) – used for the character budget. */
  prepare(text: string, style: SpeechStyle): string;
  /** Speaks an already prepared text. */
  speak(text: string, options: { style: SpeechStyle; speed: number; signal?: AbortSignal }): Promise<SpeechClip>;
}

export class VoiceProviderError extends Error {
  constructor(
    /** "unavailable": quota, key, payment, rate limit or voice missing → stop the voice for this room. */
    readonly reason: "error" | "refused" | "unavailable",
    message: string,
    /** Short error code for logs, e.g. "401 quota_exceeded". */
    readonly code: string = "",
  ) {
    super(message);
    this.name = "VoiceProviderError";
  }
}
