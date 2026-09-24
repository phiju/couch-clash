/**
 * SPEED MODIFIER – optional multiplier on top of any base score.
 *
 * Default strategy "timeLimit": measured against the question's time limit,
 * so each player's modifier depends only on their own response time.
 *   speedPosition = clamp(responseTime, 0, timeLimit) / timeLimit
 *   modifier      = fastest − speedPosition × (fastest − slowest)
 *
 * Other strategies (e.g. relative fastest-vs-slowest) can be added to the
 * registry without touching the base score code.
 */
import type { SpeedModifierSettings } from "@couch-clash/shared";

export interface SpeedContext {
  /** Server receive time − question start (ms). */
  responseTimeMs: number;
  /** Question time limit (ms). */
  timeLimitMs: number;
}

type SpeedStrategy = (ctx: SpeedContext, settings: SpeedModifierSettings) => number;

export const SPEED_STRATEGIES = {
  timeLimit: ({ responseTimeMs, timeLimitMs }, { fastestMultiplier, slowestMultiplier }) => {
    if (!(timeLimitMs > 0)) return slowestMultiplier;
    const t = Number.isFinite(responseTimeMs) ? Math.min(timeLimitMs, Math.max(0, responseTimeMs)) : timeLimitMs;
    const position = t / timeLimitMs;
    return fastestMultiplier - position * (fastestMultiplier - slowestMultiplier);
  },
} satisfies Record<string, SpeedStrategy>;

export type SpeedStrategyId = keyof typeof SPEED_STRATEGIES;

/** 1.0 when disabled; otherwise rounded to 2 decimals (what the UI shows is what counts). */
export function calculateSpeedModifier(
  responseTimeMs: number,
  timeLimitMs: number,
  settings: SpeedModifierSettings,
  strategy: SpeedStrategyId = "timeLimit",
): number {
  if (!settings.enabled) return 1;
  const value = SPEED_STRATEGIES[strategy]({ responseTimeMs, timeLimitMs }, settings);
  return Math.round(Math.max(0, value) * 100) / 100;
}
