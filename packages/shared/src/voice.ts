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
});
export type VoiceSettings = z.infer<typeof VoiceSettingsSchema>;

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: true,
  frequency: "normal",
  cheekiness: "frech",
  cheekinessOverride: false,
};

/** Categories below this age rating are "kids' categories". */
export const KIDS_AGE_RATING_LIMIT = 12;

export type HostLineKind = "welcome" | "start" | "comment" | "finale";

/** One thing the host says. Sent to host screens only. */
export interface HostLine {
  id: string;
  kind: HostLineKind;
  /** Subtitle (always shown). */
  text: string;
  /** Speech on the party worker (prefix with its HTTP URL), null → subtitle only. */
  audioPath: string | null;
  /** Drop the line if it could not start within this time after arriving (commentary). */
  staleAfterMs: number | null;
}

/** Host screen → server: playback progress (queue and leaderboard hold). */
export const VoiceEventSchema = z.object({
  type: z.literal("voice_event"),
  lineId: z.string().min(1).max(64),
  event: z.enum(["started", "ended"]),
  /** Server time when the audio will end (only with "started"). */
  endsAt: z.number().finite().optional(),
});

/** Seconds a subtitle-only line stays visible. */
export function readingTimeMs(text: string): number {
  return Math.min(7000, Math.max(2500, 1200 + text.length * 55));
}
