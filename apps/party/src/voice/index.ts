import type { AccountUsage } from "@couch-clash/shared";
import { plainFetch, type FetchFor } from "../costs/meter";
import { VOICE_PROVIDER } from "./config";
import { createElevenLabsProvider, fetchElevenLabsUsage } from "./elevenlabs";
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
  /** Measured fetches for the cost overview. */
  fetchFor: FetchFor = plainFetch,
): { text: TextProvider | null; speech: SpeechProvider | null; usage: (() => Promise<AccountUsage | null>) | null } {
  const text = env.OPENAI_API_KEY ? createOpenAITextProvider(env.OPENAI_API_KEY, fetchFor("voice-text")) : null;
  const speech =
    provider === "elevenlabs"
      ? env.ELEVENLABS_API_KEY
        ? createElevenLabsProvider(env.ELEVENLABS_API_KEY, fetchFor("voice-speech"))
        : null
      : env.OPENAI_API_KEY
        ? createOpenAISpeechProvider(env.OPENAI_API_KEY, fetchFor("voice-speech"))
        : null;
  const key = env.ELEVENLABS_API_KEY;
  const usage = provider === "elevenlabs" && key ? () => fetchElevenLabsUsage(key) : null;
  return { text, speech, usage };
}
