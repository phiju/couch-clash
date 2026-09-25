/**
 * Punkteklau: before every question the leader is determined fresh from the
 * totals (ties → all of them). Everyone answers.
 * - Leader correct → protected (+defendBonus), nobody steals from them.
 * - Leader wrong / no answer → every other player who answered correctly
 *   steals `steal` points from them; per question at most the leader's score
 *   (more thieves than points → split evenly, rounded down).
 * - Several leaders: each thief's `steal` is split evenly between the
 *   leaders who were wrong.
 * - Nobody has points yet → plays like Punktesammler (+correct).
 * - Everyone is a leader (alone, or all tied) → nobody could steal: also
 *   plays like Punktesammler ("Solo: kein Klau möglich").
 * Wrong answers of the others: 0.
 */
import { QUIZ_QUESTIONS_DE, type QuizQuestion } from "@couch-clash/content";
import type { ModuleContext } from "@couch-clash/shared";
import { normalizeScoring, type ScoreResult } from "../scoring";
import {
  createKnowledgeModule,
  fixedResult,
  isCorrectAnswer,
  upfrontQuestions,
  type KnowledgeGame,
  type KnowledgeScoreInput,
  type KnowledgeState,
} from "../knowledge/engine";
import { isKids, joinNames, namesOf, pickLine, sayLine, spokenName } from "../knowledge/lines";
import type { StealExtra, StealOutcome } from "../knowledge/types";
import { stealMeta, type TargetStrategy } from "./meta";

export interface StealPoints {
  steal: number;
  defendBonus: number;
  correct: number;
}

export interface StealGame {
  strategy: TargetStrategy;
  points: StealPoints;
  targetIds: string[];
  targetScore: number;
  outcome: StealOutcome | null;
  names: Record<string, string>;
  /** Everyone leads – no heist possible this question (see StealExtra). Missing in older rooms. */
  noHeist?: "solo" | "tied" | null;
}

type TargetFn = (ctx: ModuleContext, scores: Readonly<Record<string, number>>) => string[];

export const TARGET_STRATEGY_FNS: Record<TargetStrategy, TargetFn> = {
  /** Everyone with the highest total – nobody while all are at 0. */
  CURRENT_LEADER: (ctx, scores) => {
    if (ctx.players.length === 0) return [];
    const best = Math.max(...ctx.players.map((p) => scores[p.id] ?? 0));
    if (!(best > 0)) return [];
    return ctx.players.filter((p) => (scores[p.id] ?? 0) === best).map((p) => p.id);
  },
};

/** The heist, pure: who loses and who gains how much. */
export function computeSteal(
  input: Pick<KnowledgeScoreInput<unknown>, "question" | "answers" | "playerIds" | "scores">,
  targetIds: readonly string[],
  points: StealPoints,
): { results: Record<string, ScoreResult>; outcome: StealOutcome | null } {
  const { question, answers, playerIds, scores } = input;
  const correct = (id: string) => isCorrectAnswer(question, answers[id]);
  const results: Record<string, ScoreResult> = {};

  if (targetIds.length === 0) {
    // No leader yet: plain quiz.
    for (const id of Object.keys(answers)) results[id] = fixedResult(correct(id) ? points.correct : 0, points.correct);
    return { results, outcome: null };
  }

  const targets = new Set(targetIds);
  const wrongTargets = targetIds.filter((id) => !correct(id));
  const thieves = playerIds.filter((id) => !targets.has(id) && correct(id));
  const stolen: Record<string, number> = {};
  const lost: Record<string, number> = {};

  for (const id of targetIds) {
    if (correct(id)) results[id] = fixedResult(points.defendBonus, points.defendBonus);
  }
  if (wrongTargets.length > 0 && thieves.length > 0) {
    // Each thief's amount is split between the wrong leaders.
    const perTarget = Math.floor(points.steal / wrongTargets.length);
    for (const target of wrongTargets) {
      const available = Math.max(0, scores[target] ?? 0);
      // More thieves than points → split evenly (rounded down), never more than the leader has.
      const each = perTarget * thieves.length > available ? Math.floor(available / thieves.length) : perTarget;
      if (each <= 0) continue;
      lost[target] = (lost[target] ?? 0) + each * thieves.length;
      for (const thief of thieves) stolen[thief] = (stolen[thief] ?? 0) + each;
    }
  }
  for (const id of Object.keys(answers)) results[id] ??= fixedResult(0, 0);
  for (const [id, amount] of Object.entries(stolen)) results[id] = fixedResult(amount, amount);
  for (const [id, amount] of Object.entries(lost)) results[id] = fixedResult(-amount, amount);
  return { results, outcome: { defended: Object.keys(lost).length === 0, stolen, lost } };
}

export const stealGame: KnowledgeGame<StealGame> = {
  meta: stealMeta,

  init(ctx, options, pool) {
    const p = normalizeScoring(stealMeta, options.scoring).points ?? {};
    const d = stealMeta.scoring.points;
    return {
      game: {
        strategy: "CURRENT_LEADER",
        points: { steal: p.steal ?? d.steal, defendBonus: p.defendBonus ?? d.defendBonus, correct: p.correct ?? d.correct },
        targetIds: [],
        targetScore: 0,
        outcome: null,
        names: {},
        noHeist: null,
      },
      questions: upfrontQuestions(ctx, options, pool, stealMeta),
    };
  },

  // Fresh before every question: the standings change during the game.
  startQuestion(game, { ctx, scores }) {
    const leaders = TARGET_STRATEGY_FNS[game.strategy](ctx, scores);
    // The only possible targets would be the answering players themselves.
    const everyoneLeads = leaders.length > 0 && ctx.players.every((p) => leaders.includes(p.id));
    const noHeist = everyoneLeads ? (ctx.players.length === 1 ? "solo" : "tied") : null;
    const targetIds = noHeist ? [] : leaders;
    return {
      ...game,
      noHeist,
      targetIds,
      targetScore: targetIds.length > 0 ? (scores[targetIds[0]!] ?? 0) : 0,
      outcome: null,
      names: namesOf(ctx, ctx.players.map((p) => p.id)),
    };
  },

  score(input) {
    const { results, outcome } = computeSteal(input, input.game.targetIds, input.game.points);
    return { results, game: { ...input.game, outcome } };
  },

  publicExtra: (game, { revealed }): StealExtra => ({
    targetIds: game.targetIds,
    targetScore: game.targetScore,
    outcome: revealed ? game.outcome : null,
    noHeist: game.noHeist ?? null,
  }),

  announce: (state) => announceSteal(state),

  revealNotes(state) {
    const outcome = state.game.outcome;
    if (!outcome) return null;
    const notes: Record<string, string> = {};
    for (const id of state.game.targetIds) {
      notes[id] = outcome.lost[id] ? `war Spitzenreiter und wurde um ${outcome.lost[id]} Punkte beklaut` : "war Spitzenreiter und hat sich verteidigt";
    }
    for (const [id, amount] of Object.entries(outcome.stolen)) notes[id] = `hat dem Spitzenreiter ${amount} Punkte geklaut`;
    return { notes };
  },
};

export function announceSteal(state: KnowledgeState<StealGame>) {
  const g = state.game;
  if (g.targetIds.length === 0) return null;
  const kids = isKids(state.mode);
  const names = g.targetIds.map((id) => spokenName(g.names[id]));
  const who = joinNames(names);
  const many = names.length > 1;
  if (state.step === "question") {
    const key = `target:${state.index}`;
    return sayLine(
      key,
      kids
        ? `${who} ${many ? "liegen" : "liegt"} vorne – wer schnappt sich ein paar Punkte?`
        : many
          ? `${who}, ihr werdet beklaut – außer ihr wisst es!`
          : pickLine(
              [`${who}, du wirst beklaut – außer du weißt es!`, `Achtung, ${who}: ${g.targetScore.toLocaleString("de-DE")} Punkte im Visier!`],
              key,
            ),
    );
  }
  if (state.step === "reveal" && g.outcome) {
    const key = `heist:${state.index}`;
    const total = Object.values(g.outcome.lost).reduce((a, b) => a + b, 0);
    const thieves = Object.keys(g.outcome.stolen).length;
    if (g.outcome.defended) {
      const wrong = g.targetIds.filter((id) => !isCorrectAnswer(state.questions[state.index]!, state.answers[id]));
      if (wrong.length > 0) return sayLine(key, kids ? `Glück gehabt, ${who}!` : `Falsch, aber niemand konnte klauen – Glück gehabt, ${who}.`);
      return sayLine(key, kids ? `Super verteidigt, ${who}!` : `Abgewehrt! ${who} ${many ? "wissen" : "weiß"} es und ${many ? "behalten" : "behält"} alles.`);
    }
    if (kids) return sayLine(key, thieves === 1 ? `Ein Punktedieb schnappt sich ${total} Punkte!` : `${thieves} Punktediebe schnappen sich ${total} Punkte!`);
    return sayLine(
      key,
      thieves >= 3 || total >= 300
        ? `Großer Raubzug! ${thieves} Diebe erleichtern ${who} um ${total} Punkte.`
        : `Erwischt! ${who} ${many ? "verlieren" : "verliert"} ${total} Punkte.`,
    );
  }
  return null;
}

export function createStealModule(pool: readonly QuizQuestion[] = QUIZ_QUESTIONS_DE) {
  return createKnowledgeModule(stealGame, pool);
}

export const stealModule = createStealModule();
