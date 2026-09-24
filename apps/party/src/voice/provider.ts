/**
 * The host's voice: a text model writes the line, a speech model says it.
 * Both are interfaces so the voice can move to e.g. ElevenLabs without
 * touching game code – implement `SpeechProvider` and change `index.ts`.
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

export interface SpeechProvider {
  speak(text: string, options?: { signal?: AbortSignal }): Promise<SpeechClip>;
}

export class VoiceProviderError extends Error {
  constructor(readonly reason: "error" | "refused", message: string) {
    super(message);
    this.name = "VoiceProviderError";
  }
}
