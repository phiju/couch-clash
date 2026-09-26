import type { AccountUsage } from "@couch-clash/shared";
import { plainFetch, type FetchFor } from "../costs/meter";
import { ELEVENLABS_MODELS, ELEVENLABS_READ_MODELS, VOICE_PROVIDER } from "./config";
import { createElevenLabsProvider, fetchElevenLabsUsage } from "./elevenlabs";
import { createOpenAISpeechProvider, createOpenAITextProvider } from "./openai";
import type { SpeechProvider, SpeechStyle, TextProvider } from "./provider";

export interface VoiceEnv {
  OPENAI_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  /** Worker variable: speech model for long read-outs (one of ELEVENLABS_READ_MODELS). */
  ELEVENLABS_READ_MODEL?: string;
}

/** The ElevenLabs models per style – "read" from ELEVENLABS_READ_MODEL when it names a known model. */
export function elevenLabsModels(env: Pick<VoiceEnv, "ELEVENLABS_READ_MODEL">): Record<SpeechStyle, string> {
  const wanted = env.ELEVENLABS_READ_MODEL?.trim();
  const read = ELEVENLABS_READ_MODELS.find((m) => m === wanted);
  if (wanted && !read) console.warn("voice: unknown ELEVENLABS_READ_MODEL – using the default");
  return { ...ELEVENLABS_MODELS, ...(read ? { read } : {}) };
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
        ? createElevenLabsProvider(env.ELEVENLABS_API_KEY, fetchFor("voice-speech"), elevenLabsModels(env))
        : null
      : env.OPENAI_API_KEY
        ? createOpenAISpeechProvider(env.OPENAI_API_KEY, fetchFor("voice-speech"))
        : null;
  const key = env.ELEVENLABS_API_KEY;
  const usage = provider === "elevenlabs" && key ? () => fetchElevenLabsUsage(key) : null;
  return { text, speech, usage };
}
