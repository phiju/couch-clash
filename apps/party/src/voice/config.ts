/**
 * Everything about the host's voice in one place: text model, voice
 * provider, models, voice, timeouts and limits.
 */
/** Who speaks the lines. The text always comes from OpenAI. */
export const VOICE_PROVIDER: "elevenlabs" | "openai" = "elevenlabs";

/** ElevenLabs voice (not a secret). The key is the Worker secret ELEVENLABS_API_KEY. */
export const ELEVENLABS_VOICE_ID = "DQ4rTqXxHr077oQgsA9D";

/** Model ids as listed by GET /v1/models (checked against @elevenlabs/elevenlabs-js 2.69). */
export const ELEVENLABS_MODELS = {
  /** Welcome, game start, winner announcement: expressive, supports audio tags. */
  expressive: "eleven_v3",
  /** Leaderboard comments: must be ready within ~3 s. */
  fast: "eleven_flash_v2_5",
} as const;

export const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";

/**
 * Lively voice (stability ~0.35). eleven_v3 is built around the stability
 * presets 0.0 "creative" / 0.5 "natural" / 1.0 "robust", so it gets "natural".
 */
export const ELEVENLABS_VOICE_SETTINGS = {
  stability: { expressive: 0.5, fast: 0.35 },
  similarityBoost: 0.8,
  style: 0.6,
  useSpeakerBoost: true,
} as const;

/** Audio tags the text model may use for eleven_v3 lines (max 2 per line). */
export const AUDIO_TAG_WHITELIST = ["excited", "laughs", "gasps", "sarcastic", "whispers", "shouting"] as const;
export const MAX_AUDIO_TAGS = 2;

export const VOICE_CONFIG = {
  /** Small, fast text model without a reasoning step (answers within the 4 s budget). */
  textModel: "gpt-4.1-mini",
  /** OpenAI text-to-speech (only when VOICE_PROVIDER = "openai"). */
  openaiSpeechModel: "gpt-4o-mini-tts",
  openaiVoice: "ash",
  openaiStyle:
    "Enthusiastic 1970s German TV game show host. Warm, charming, a bit cheesy, big smile in the voice, lively pace, speaks German.",
  textTimeoutMs: 4_000,
  speechTimeoutMs: 8_000,
  /** Generated texts per room – after that only template lines. */
  maxLinesPerRoom: 60,
  /**
   * Characters sent to the voice service per room (the ElevenLabs free tier
   * has 10,000 per month). After that the host stays silent in this room.
   */
  charBudgetPerRoom: 3_000,
  /** Welcome lines waiting on the host screen at most; more names are merged into one line. */
  maxQueuedWelcomes: 3,
  /** A commentary line may keep the leaderboard up this much longer while it plays. */
  maxHoldExtensionMs: 3_000,
} as const;
