import { VOICE_PROVIDER } from "./config";
import { createElevenLabsProvider } from "./elevenlabs";
import { createOpenAISpeechProvider, createOpenAITextProvider } from "./openai";
import type { SpeechProvider, TextProvider } from "./provider";

export interface VoiceEnv {
  OPENAI_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
}

/**
 * The one place that picks the providers: text always from OpenAI, the
 * voice from VOICE_PROVIDER. Null parts are simply not available.
 */
export function createVoiceProviders(
  env: VoiceEnv,
  provider: typeof VOICE_PROVIDER = VOICE_PROVIDER,
): { text: TextProvider | null; speech: SpeechProvider | null } {
  const text = env.OPENAI_API_KEY ? createOpenAITextProvider(env.OPENAI_API_KEY) : null;
  const speech =
    provider === "elevenlabs"
      ? env.ELEVENLABS_API_KEY
        ? createElevenLabsProvider(env.ELEVENLABS_API_KEY)
        : null
      : env.OPENAI_API_KEY
        ? createOpenAISpeechProvider(env.OPENAI_API_KEY)
        : null;
  return { text, speech };
}
