import {
  ELEVENLABS_MODELS,
  ELEVENLABS_OUTPUT_FORMAT,
  ELEVENLABS_VOICE_ID,
  ELEVENLABS_VOICE_SETTINGS,
} from "./config";
import { VoiceProviderError, type SpeechProvider } from "./provider";
import { keepAllowedTags, stripTags } from "./tags";

const API = "https://api.elevenlabs.io/v1/text-to-speech";

/** Errors that mean "no voice for now": key, quota, payment, rate limit, voice missing. */
const UNAVAILABLE_STATUS = new Set([401, 402, 403, 429]);
const UNAVAILABLE_DETAIL = new Set([
  "quota_exceeded",
  "invalid_api_key",
  "missing_permissions",
  "payment_required",
  "too_many_concurrent_requests",
  "system_busy",
  "voice_not_found",
  "voice_not_available",
]);

/**
 * ElevenLabs text-to-speech: eleven_v3 (expressive, audio tags) for
 * welcome/start/finale, eleven_flash_v2_5 (fast, no tags) for comments.
 * Never logs texts – only status codes.
 */
export function createElevenLabsProvider(apiKey: string, fetchFn: typeof fetch = fetch): SpeechProvider {
  return {
    id: "elevenlabs",
    supportsTags: (style) => style === "expressive",
    prepare: (text, style) => (style === "expressive" ? keepAllowedTags(text) : stripTags(text)),

    async speak(text, { style, speed, signal }) {
      const url = `${API}/${ELEVENLABS_VOICE_ID}?output_format=${ELEVENLABS_OUTPUT_FORMAT}`;
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({
          text,
          model_id: ELEVENLABS_MODELS[style],
          language_code: "de",
          voice_settings: {
            stability: ELEVENLABS_VOICE_SETTINGS.stability[style],
            similarity_boost: ELEVENLABS_VOICE_SETTINGS.similarityBoost,
            style: ELEVENLABS_VOICE_SETTINGS.style,
            use_speaker_boost: ELEVENLABS_VOICE_SETTINGS.useSpeakerBoost,
            speed: Math.min(1.2, Math.max(0.7, speed)),
          },
        }),
        signal,
      });
      if (!res.ok) {
        let detail = "";
        try {
          const body = (await res.json()) as { detail?: { status?: string } | string };
          detail = typeof body.detail === "object" ? (body.detail?.status ?? "") : "";
        } catch {
          // no JSON body
        }
        const code = `${res.status}${detail ? ` ${detail}` : ""}`;
        const unavailable = UNAVAILABLE_STATUS.has(res.status) || UNAVAILABLE_DETAIL.has(detail);
        throw new VoiceProviderError(unavailable ? "unavailable" : "error", `ElevenLabs ${code}`, code);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0) throw new VoiceProviderError("error", "ElevenLabs empty", "empty");
      return { bytes, mimeType: "audio/mpeg" };
    },
  };
}
