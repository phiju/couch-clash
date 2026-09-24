/**
 * Everything about the host's voice in one place: models, voice, style,
 * timeouts and limits. Swap providers in `index.ts`.
 */
export const VOICE_CONFIG = {
  /** Small, fast text model without a reasoning step (answers within the 4 s budget). */
  textModel: "gpt-4.1-mini",
  /** Steerable text-to-speech model. */
  speechModel: "gpt-4o-mini-tts",
  voice: "ash",
  /** How he speaks (passed to the TTS model). */
  style:
    "Enthusiastic 1970s German TV game show host. Warm, charming, a bit cheesy, big smile in the voice, lively pace, speaks German.",
  textTimeoutMs: 4_000,
  speechTimeoutMs: 8_000,
  /** Generated lines (text + speech) per room – after that only template lines. */
  maxLinesPerRoom: 60,
  /** Welcome lines waiting on the host screen at most; more names are merged into one line. */
  maxQueuedWelcomes: 3,
  /** A commentary line may keep the leaderboard up this much longer while it plays. */
  maxHoldExtensionMs: 3_000,
} as const;
