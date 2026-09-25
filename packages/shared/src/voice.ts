/**
 * The host mascot's voice: short lines generated on the party server (text
 * model → text-to-speech) and played on the host device only.
 */
import { z } from "zod";

export const COMMENT_FREQUENCIES = ["selten", "normal", "oft"] as const;
export type CommentFrequency = (typeof COMMENT_FREQUENCIES)[number];

/** "Frechheit" of the commentary. */
export const CHEEKINESS_LEVELS = ["nett", "frech", "gnadenlos"] as const;
export type Cheekiness = (typeof CHEEKINESS_LEVELS)[number];

/** "Sprechtempo" of the host. */
export const SPEECH_TEMPOS = ["normal", "schnell", "turbo"] as const;
export type SpeechTempo = (typeof SPEECH_TEMPOS)[number];

export const VoiceSettingsSchema = z.object({
  /** "🎙️ Moderator spricht" */
  enabled: z.boolean(),
  frequency: z.enum(COMMENT_FREQUENCIES),
  cheekiness: z.enum(CHEEKINESS_LEVELS),
  /**
   * Kids' categories (age rating < 12) switch the commentary to "nett"
   * automatically – unless the host explicitly keeps the chosen level.
   */
  cheekinessOverride: z.boolean(),
  // Optional for screens loaded before "Sprechtempo" existed (deploy window).
  tempo: z.enum(SPEECH_TEMPOS).default("schnell"),
});
export type VoiceSettings = z.output<typeof VoiceSettingsSchema>;

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: true,
  frequency: "normal",
  cheekiness: "frech",
  cheekinessOverride: false,
  tempo: "schnell",
};

/** TTS speed per tempo (ElevenLabs allows up to 1.2). */
export const TEMPO_SPEED: Record<SpeechTempo, number> = { normal: 1.0, schnell: 1.15, turbo: 1.2 };
/** Extra playback rate on the host (pitch preserved) – only "turbo". */
export const TEMPO_PLAYBACK_RATE: Record<SpeechTempo, number> = { normal: 1, schnell: 1, turbo: 1.1 };

/** Why the host's voice is silent in this room (shown to the host), null = available. */
export type VoiceStatus = "ok" | "unavailable" | "budget";

/** Categories below this age rating are "kids' categories". */
export const KIDS_AGE_RATING_LIMIT = 12;

export type HostLineKind = "welcome" | "start" | "comment" | "finale" | "test" | "read";

/** One thing the host says. Sent to host screens only. */
export interface HostLine {
  id: string;
  kind: HostLineKind;
  /** What he says (not displayed – there are no speech bubbles). */
  text: string;
  /** Speech on the party worker (prefix with its HTTP URL). */
  audioPath: string;
  /** Playback rate on the host (pitch preserved), 1 = as generated. */
  playbackRate: number;
  /** Drop the line if it could not start within this time after arriving (commentary). */
  staleAfterMs: number | null;
  /** Read-aloud lines: which item is being read (the category highlights it). */
  cue?: string;
}

/** Host screen → server: playback progress (queue and leaderboard hold). */
export const VoiceEventSchema = z.object({
  type: z.literal("voice_event"),
  lineId: z.string().min(1).max(64),
  event: z.enum(["started", "ended"]),
  /** Server time when the audio will end (only with "started"). */
  endsAt: z.number().finite().optional(),
});


/** Plain-German hint for a voice-service error code (shown to the host). */
export function voiceErrorHint(code: string | null): string {
  if (!code) return "ElevenLabs hat die Anfrage abgelehnt.";
  if (/quota_exceeded/.test(code)) return "Das ElevenLabs-Kontingent ist aufgebraucht.";
  if (/invalid_api_key/.test(code)) return "Der ElevenLabs-Schlüssel ist ungültig – Secret ELEVENLABS_API_KEY prüfen.";
  if (/missing_permissions/.test(code) || /^403/.test(code))
    return "Dem ElevenLabs-Schlüssel fehlt die Berechtigung „Text to Speech“ – in ElevenLabs beim API-Key freischalten.";
  if (/voice_not_found|voice_not_available/.test(code))
    return "Die Stimme ist in diesem ElevenLabs-Konto nicht verfügbar – in ElevenLabs zu „My Voices“ hinzufügen.";
  if (/^402|payment/.test(code)) return "ElevenLabs verlangt ein passendes Abo für diese Anfrage (Stimme oder Modell).";
  if (/^429|too_many|system_busy/.test(code)) return "ElevenLabs ist gerade ausgelastet oder zu viele Anfragen gleichzeitig.";
  if (/^401/.test(code)) return "ElevenLabs lehnt den Schlüssel ab – Secret ELEVENLABS_API_KEY prüfen.";
  return "ElevenLabs hat die Anfrage abgelehnt.";
}
