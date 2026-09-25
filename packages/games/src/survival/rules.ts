/**
 * Survival-Finale rules as pure functions (client-safe, unit-tested).
 *
 * The server settles scores with these; the TV and the phones use the SAME
 * functions to show the live countdown between two server ticks, so what
 * people see and what is booked never drift apart.
 */
import { DANGER_LEVELS, SURVIVAL_CONFIG, type DangerLevel, type SurvivalConfig, type SurvivalPhaseConfig } from "./config";
import type { SurvivalRankingEntry, SurvivalScoreChange } from "./types";

const ms = (seconds: number) => Math.round(seconds * 1000);

/** Absolute server times of a question's thresholds. */
export function questionTimes(startedAt: number, phase: SurvivalPhaseConfig) {
  return {
    bonusUntil: startedAt + ms(phase.speedBonusThreshold),
    decayFrom: startedAt + ms(phase.scoreDecayThreshold),
    timeoutAt: startedAt + ms(phase.questionTimeout),
  };
}

// ── Start scores ────────────────────────────────────────────────────────

/**
 * Main-game points → life energy (once, at the start of the finale):
 *   startMin + (startMax − startMin) × (score / best) ^ startExponent, rounded to 10.
 * Best score ≤ 0 or everyone tied → everyone gets startMax; a score ≤ 0 → startMin.
 */
export function convertStartScores(
  scores: Readonly<Record<string, number>>,
  playerIds: readonly string[],
  config: Pick<SurvivalConfig, "startMin" | "startMax" | "startExponent" | "startRounding"> = SURVIVAL_CONFIG,
): Record<string, number> {
  const { startMin, startMax, startExponent, startRounding } = config;
  const of = (id: string) => (Number.isFinite(scores[id]) ? scores[id]! : 0);
  const best = Math.max(0, ...playerIds.map(of));
  const tied = playerIds.every((id) => of(id) === of(playerIds[0]!));
  const round = (n: number) => (startRounding > 0 ? Math.round(n / startRounding + 1e-9) * startRounding : Math.round(n));
  const out: Record<string, number> = {};
  for (const id of playerIds) {
    const score = of(id);
    if (best <= 0 || tied) out[id] = startMax;
    else if (score <= 0) out[id] = startMin;
    else {
      const share = startExponent === 1 ? score / best : Math.pow(score / best, startExponent);
      out[id] = round(startMin + (startMax - startMin) * share);
    }
  }
  return out;
}

// ── Scoring ─────────────────────────────────────────────────────────────

/** Full decay seconds after the threshold: 10.9 s → 0, 11.0 s → 1, 14.0 s → 4 (phase 1). */
export function decaySteps(elapsedMs: number, phase: SurvivalPhaseConfig): number {
  const t = Math.min(Math.max(0, elapsedMs), ms(phase.questionTimeout));
  const over = t - ms(phase.scoreDecayThreshold);
  return over > 0 ? Math.floor(over / 1000) : 0;
}

/** Points lost to thinking time, never past the timeout: floor(t − threshold) × perSecond. */
export function calculateTimeDecay(
  elapsedMs: number,
  phase: SurvivalPhaseConfig,
  config: Pick<SurvivalConfig, "scoreDecayPerSecond"> = SURVIVAL_CONFIG,
): number {
  return decaySteps(elapsedMs, phase) * config.scoreDecayPerSecond;
}

/**
 * What one answer does to a score. Wrong answers never get the bonus; the
 * decay until the answer is lost either way.
 */
export function calculateSurvivalScoreChange(
  input: { correct: boolean; responseMs: number; phase: SurvivalPhaseConfig },
  config: Pick<SurvivalConfig, "scoreDecayPerSecond" | "wrongAnswerPenalty"> = SURVIVAL_CONFIG,
): SurvivalScoreChange {
  const { correct, responseMs, phase } = input;
  const decay = calculateTimeDecay(responseMs, phase, config);
  const bonus = correct && responseMs <= ms(phase.speedBonusThreshold) ? phase.speedBonus : 0;
  const penalty = correct ? 0 : applyWrongAnswerPenalty(config);
  return { bonus, decay, penalty, drain: 0, total: bonus - decay - penalty };
}

/** Penalty for a wrong answer. */
export function applyWrongAnswerPenalty(config: Pick<SurvivalConfig, "wrongAnswerPenalty"> = SURVIVAL_CONFIG): number {
  return config.wrongAnswerPenalty;
}

/** No answer by the timeout: the full decay stays, plus the wrong-answer penalty. */
export function applyTimeoutPenalty(
  phase: SurvivalPhaseConfig,
  config: Pick<SurvivalConfig, "scoreDecayPerSecond" | "wrongAnswerPenalty"> = SURVIVAL_CONFIG,
): SurvivalScoreChange {
  const decay = calculateTimeDecay(ms(phase.questionTimeout), phase, config);
  const penalty = applyWrongAnswerPenalty(config);
  return { bonus: 0, decay, penalty, drain: 0, total: -decay - penalty };
}

/** Deducted from every living player after each question (DEATH MODE). */
export function applyPhaseBaseDrain(phase: SurvivalPhaseConfig): number {
  return Math.max(0, phase.baseDrain);
}

/**
 * Live display between server ticks: the settled score minus the decay the
 * server has not booked yet. Same formula as the settlement, never below 0.
 */
export function liveSurvivalScore(input: {
  score: number;
  decayApplied: number;
  startedAt: number;
  now: number;
  phase: SurvivalPhaseConfig;
  answered: boolean;
  eliminated: boolean;
  scoreDecayPerSecond?: number;
}): number {
  if (input.answered || input.eliminated) return displayScore(input.score);
  const decay = calculateTimeDecay(input.now - input.startedAt, input.phase, {
    scoreDecayPerSecond: input.scoreDecayPerSecond ?? SURVIVAL_CONFIG.scoreDecayPerSecond,
  });
  return displayScore(input.score - Math.max(0, decay - input.decayApplied));
}

/** Scores are never shown below 0. */
export function displayScore(score: number): number {
  return Math.max(0, score);
}

// ── Danger levels ───────────────────────────────────────────────────────

export function getDangerLevel(
  score: number,
  config: Pick<SurvivalConfig, "danger" | "wrongAnswerPenalty"> = SURVIVAL_CONFIG,
): DangerLevel {
  const p = config.wrongAnswerPenalty;
  if (score <= 0) return "ELIMINATED";
  if (score <= config.danger.imminent * p) return "ELIMINATION_IMMINENT";
  if (score <= config.danger.critical * p) return "CRITICAL";
  if (score <= config.danger.warning * p) return "WARNING";
  return "SAFE";
}

/** 0 = SAFE … 4 = ELIMINATED. */
export function dangerRank(level: DangerLevel): number {
  return DANGER_LEVELS.indexOf(level);
}

// ── Phases ──────────────────────────────────────────────────────────────

export interface EscalationInput {
  /** Questions finished so far. */
  questionsPlayed: number;
  /** The phase until now – phases never go back. */
  currentPhaseIndex: number;
  /** Players alive now (for rules that escalate by player count). */
  aliveCount: number;
  config: Pick<SurvivalConfig, "questionsPerPhase" | "phases">;
}

/** Decides the phase for the NEXT question (called only between questions). */
export type EscalationRule = (input: EscalationInput) => number;

/** Default: the next phase after every `questionsPerPhase` questions; DEATH MODE stays. */
export const escalateByQuestions: EscalationRule = ({ questionsPlayed, currentPhaseIndex, config }) => {
  const last = config.phases.length - 1;
  const byCount = config.questionsPerPhase > 0 ? Math.floor(questionsPlayed / config.questionsPerPhase) : last;
  return Math.min(last, Math.max(currentPhaseIndex, byCount));
};

export function getCurrentPhase(
  phaseIndex: number,
  config: Pick<SurvivalConfig, "phases"> = SURVIVAL_CONFIG,
): SurvivalPhaseConfig {
  return config.phases[Math.min(Math.max(0, phaseIndex), config.phases.length - 1)]!;
}

// ── Survival state ──────────────────────────────────────────────────────

export interface SurvivalStanding {
  id: string;
  eliminatedAt: number | null;
  /** Kicked from the room – not ranked. */
  removed?: boolean;
  /** Lost the estimate tie-breaker: 0 = best of the losers. */
  tiebreakPlace?: number | null;
}

export function getAlivePlayers<T extends SurvivalStanding>(players: readonly T[]): T[] {
  return players.filter((p) => p.eliminatedAt === null && !p.removed);
}

/** The winner when exactly one player is left (never in a solo game). */
export function checkSurvivalWinner(players: readonly SurvivalStanding[], solo = false): string | null {
  if (solo) return null;
  const alive = getAlivePlayers(players);
  return alive.length === 1 ? alive[0]!.id : null;
}

/**
 * Places by elimination order: the winner first, the tie-breaker's losers by
 * their result, everyone else by who went out later. Players who went out at
 * exactly the same server time share a place.
 */
export function getFinalRanking(players: readonly SurvivalStanding[], winnerId: string | null): SurvivalRankingEntry[] {
  const ranked = players.filter((p) => !p.removed);
  const winner = ranked.filter((p) => p.id === winnerId);
  const rest = ranked.filter((p) => p.id !== winnerId);
  // Tie-breaker losers went out last (in the question everyone died in) – they come right after the winner.
  const key = (p: SurvivalStanding) => [p.tiebreakPlace != null ? 0 : 1, p.tiebreakPlace ?? 0, -(p.eliminatedAt ?? Infinity)] as const;
  const cmp = (a: SurvivalStanding, b: SurvivalStanding) => {
    const ka = key(a);
    const kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
  };
  const ordered = [...winner, ...rest.sort(cmp)];
  const out: SurvivalRankingEntry[] = [];
  ordered.forEach((p, i) => {
    const prev = ordered[i - 1];
    const shared = prev && prev.id !== winnerId && p.id !== winnerId && cmp(prev, p) === 0;
    out.push({ playerId: p.id, place: shared ? out[i - 1]!.place : i + 1 });
  });
  return out;
}
