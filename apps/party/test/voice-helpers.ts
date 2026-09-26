import { vi } from "vitest";
import { ELEVENLABS_MODELS } from "../src/voice/config";
import type { SpeechProvider } from "../src/voice/provider";
import { keepAllowedTags, stripTags } from "../src/voice/tags";

/** Mocked ElevenLabs-like voice: tags only for "expressive". Never calls a real API. */
export function mockSpeech(
  impl: SpeechProvider["speak"] = async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/mpeg" }),
): SpeechProvider & { speak: ReturnType<typeof vi.fn> } {
  return {
    id: "elevenlabs",
    modelFor: (style) => ELEVENLABS_MODELS[style],
    supportsTags: (style) => style === "expressive",
    prepare: (text, style) => (style === "expressive" ? keepAllowedTags(text) : stripTags(text)),
    speak: vi.fn(impl),
  };
}
