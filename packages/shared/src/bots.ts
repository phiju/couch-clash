/**
 * Test bots ("🤖 Testspieler hinzufügen") – for testing and trying games
 * alone. Bots are normal players on the server (flag `bot`), always
 * connected, and act on their own after a short random delay. Each game
 * module decides WHAT a bot does (GameModule.botAction); the room decides
 * WHEN.
 */
export const BOT_CONFIG = {
  /** At most this many bots per room. */
  maxBots: 6,
  /** Random delay before a bot acts (ms). */
  minDelayMs: 1_000,
  maxDelayMs: 6_000,
  /** Multiple choice: share of correct answers. */
  correctRate: 0.6,
  /** Estimates: correct answer ± up to this share. */
  estimateSpread: 0.3,
  /** Wagers a bot picks from (Bet). */
  wagers: [50, 100, 200] as const,
} as const;

/** Bot names in order – the first free one is used. */
export const BOT_NAMES = ["Robo-Rudi", "Bot-Berta", "Chip-Charlie", "Byte-Bine", "Pixel-Paul", "Servo-Susi"] as const;

/** What a module gets to decide a bot's move. */
export interface BotContext {
  random: () => number;
  /** Multiple choice: probability of picking the right answer. */
  correctRate: number;
  /** Estimates: maximum relative deviation from the right answer. */
  estimateSpread: number;
}

/** A random element. */
export function botPick<T>(items: readonly T[], random: () => number): T | undefined {
  return items.length ? items[Math.min(items.length - 1, Math.floor(random() * items.length))] : undefined;
}

/** Multiple choice: the right index with `correctRate`, otherwise a random wrong one. */
export function botChoice(correctIndex: number, optionCount: number, bot: BotContext): number {
  if (optionCount <= 1 || bot.random() < bot.correctRate) return correctIndex;
  const wrong = Array.from({ length: optionCount }, (_, i) => i).filter((i) => i !== correctIndex);
  return botPick(wrong, bot.random) ?? correctIndex;
}

/** Estimates: the right answer ± up to `estimateSpread` (whole numbers from 10 on). */
export function botEstimate(answer: number, bot: BotContext): number {
  const value = answer * (1 + (bot.random() * 2 - 1) * bot.estimateSpread);
  return Math.abs(answer) >= 10 ? Math.round(value) : Math.round(value * 100) / 100;
}

/** Random delay before a bot acts. */
export function botDelayMs(random: () => number): number {
  return Math.round(BOT_CONFIG.minDelayMs + random() * (BOT_CONFIG.maxDelayMs - BOT_CONFIG.minDelayMs));
}
