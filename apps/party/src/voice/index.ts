import { createOpenAISpeechProvider, createOpenAITextProvider } from "./openai";
import type { SpeechProvider, TextProvider } from "./provider";

/** The one place that picks the providers (e.g. ElevenLabs for the voice later). */
export function createVoiceProviders(env: { OPENAI_API_KEY?: string }): {
  text: TextProvider;
  speech: SpeechProvider;
} | null {
  if (!env.OPENAI_API_KEY) return null;
  return {
    text: createOpenAITextProvider(env.OPENAI_API_KEY),
    speech: createOpenAISpeechProvider(env.OPENAI_API_KEY),
  };
}
