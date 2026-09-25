/** Automatic replacement questions (admin "Rauswerfen"). */
export const GENERATION_CONFIG = {
  /** OpenAI chat model for writing and checking questions. */
  model: "gpt-4.1-mini",
  /** Writing + checking attempts per replacement. */
  maxAttempts: 3,
  /** Replacement jobs per UTC day (successful or not). */
  dailyLimit: 50,
  /** Similar questions (shared tags) passed to the model to avoid duplicates. */
  maxSimilar: 40,
  timeoutMs: 30_000,
} as const;
