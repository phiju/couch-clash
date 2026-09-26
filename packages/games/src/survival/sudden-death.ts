/**
 * What happens when every player still alive goes into the slime in the
 * same question. Its own module behind one interface, so the rule can be
 * swapped later without touching the finale.
 *
 * Default: everyone involved comes back with `suddenDeathScore` in DEATH MODE;
 * after `maxSuddenDeathRounds` of those, an estimate question decides
 * (closest answer wins, the earlier answer on an exact tie).
 */
import { deathPhaseIndex, type SurvivalConfig } from "./config";

export interface SuddenDeathInput {
  /** Players alive when the question started – all of them went out in it. */
  participants: readonly string[];
  /** Sudden deaths so far in this finale. */
  occurrences: number;
  config: Pick<SurvivalConfig, "suddenDeathScore" | "maxSuddenDeathRounds" | "phases">;
}

export type SuddenDeathDecision =
  | { kind: "revive"; playerIds: string[]; score: number; phaseIndex: number; round: number }
  | { kind: "tiebreak"; playerIds: string[] };

export interface TiebreakAnswer {
  value: number;
  /** Server receive time. */
  at: number;
}

export interface TiebreakInput {
  participants: readonly string[];
  answers: Readonly<Record<string, TiebreakAnswer>>;
  correct: number;
}

export interface TiebreakResult {
  /** Null: nobody answered – the tie-breaker is repeated. */
  winnerId: string | null;
  /** Participants best → worst: answers by distance, then time; non-answerers last. */
  order: string[];
  /** Participants without an answer. */
  unanswered: string[];
}

export interface SuddenDeathRule {
  decide(input: SuddenDeathInput): SuddenDeathDecision;
  resolveTiebreak(input: TiebreakInput): TiebreakResult;
}

export const defaultSuddenDeath: SuddenDeathRule = {
  decide({ participants, occurrences, config }) {
    const playerIds = [...participants];
    if (occurrences >= config.maxSuddenDeathRounds) return { kind: "tiebreak", playerIds };
    return {
      kind: "revive",
      playerIds,
      score: config.suddenDeathScore,
      phaseIndex: deathPhaseIndex(config),
      round: occurrences + 1,
    };
  },

  resolveTiebreak({ participants, answers, correct }) {
    const answered = participants.filter((id) => answers[id] && Number.isFinite(answers[id].value));
    const unanswered = participants.filter((id) => !answered.includes(id));
    const order = [...answered].sort((a, b) => {
      const x = answers[a]!;
      const y = answers[b]!;
      return Math.abs(x.value - correct) - Math.abs(y.value - correct) || x.at - y.at;
    });
    return { winnerId: order[0] ?? null, order: [...order, ...unanswered], unanswered };
  },
};
