/**
 * Generic engine for question-based categories: question → reveal → next
 * question … → done. A concrete category only supplies how questions are
 * picked, how answers are validated and scored and what the public parts
 * of a question and its solution look like.
 */
import {
  REVEAL_ANSWER_MS,
  REVEAL_LEADERBOARD_MS,
  type CategoryMeta,
  type GameModule,
  type ModuleContext,
  type ModuleInitOptions,
  type ModuleUpdate,
  type RevealFacts,
  type ScoringSettings,
  type Viewer,
} from "@couch-clash/shared";
import { z } from "zod";
import { normalizeScoring, scoreAnswer, type BaseScoreInputs, type ScoreResult } from "../scoring";
import type { AnswerAction, QuestionRoundPublicState, QuestionRoundStep } from "./types";

export interface RecordedAnswer<TAnswer> {
  value: TAnswer;
  /** Server receive time. */
  at: number;
}

export interface QuestionRoundState<TQuestion, TAnswer> {
  questions: TQuestion[];
  index: number;
  step: QuestionRoundStep;
  questionStartedAt: number;
  stepEndsAt: number;
  answers: Record<string, RecordedAnswer<TAnswer>>;
  results: Record<string, ScoreResult> | null;
  scoring: ScoringSettings;
}

export interface QuestionRoundConfig<TQuestion extends { id: string }, TAnswer, TPublicQ, TSolution> {
  meta: CategoryMeta;
  answerSchema: z.ZodType<TAnswer>;
  /** Choose `count` questions (already prepared, e.g. options shuffled). */
  pickQuestions(ctx: ModuleContext, options: ModuleInitOptions): TQuestion[];
  /**
   * Input for the category's base score mode (quality of ONE answer, e.g.
   * `{ correct }` for "absolute"). Scoring itself is done by the engine.
   */
  baseScoreInput(question: TQuestion, answer: TAnswer): BaseScoreInputs[CategoryMeta["scoring"]["mode"]];
  /** What everyone may see while the question is open – never the answer. */
  publicQuestion(question: TQuestion): TPublicQ;
  /** The solution, shown at reveal. */
  solution(question: TQuestion): TSolution;
  /**
   * Plain-text descriptions for the host's commentary (server only):
   * the question, the correct answer and a player's answer.
   */
  /** Estimates: how far off an answer is, |answer − correct| / zeroRange (capped at 1 by the engine). */
  errorShare?(question: TQuestion, answer: TAnswer): number;
  describe?: {
    question(question: TQuestion): string;
    solution(question: TQuestion): string;
    answer(question: TQuestion, answer: TAnswer): string;
  };
}

export type QuestionRoundModule<TQuestion, TAnswer, TPublicQ, TSolution> = GameModule<
  QuestionRoundState<TQuestion, TAnswer>,
  AnswerAction<TAnswer>,
  QuestionRoundPublicState<TPublicQ, TAnswer, TSolution>
>;

export function createQuestionRoundModule<
  TQuestion extends { id: string },
  TAnswer,
  TPublicQ,
  TSolution,
>(
  config: QuestionRoundConfig<TQuestion, TAnswer, TPublicQ, TSolution>,
): QuestionRoundModule<TQuestion, TAnswer, TPublicQ, TSolution> {
  type State = QuestionRoundState<TQuestion, TAnswer>;
  const questionMs = config.meta.secondsPerQuestion * 1000;

  const actionSchema = z.object({
    type: z.literal("answer"),
    value: config.answerSchema,
  }) as unknown as z.ZodType<AnswerAction<TAnswer>>;

  function openQuestion(state: State, index: number, now: number): ModuleUpdate<State> {
    const next: State = {
      ...state,
      index,
      step: "question",
      questionStartedAt: now,
      stepEndsAt: now + questionMs,
      answers: {},
      results: null,
    };
    return { state: next, phaseEndsAt: next.stepEndsAt };
  }

  /**
   * Every answer is scored on its own: base score from the answer quality,
   * speed modifier from the player's own response time vs. the time limit.
   * Players without an answer get nothing (they are not in `results`).
   */
  function scoreQuestion(state: State): Record<string, ScoreResult> {
    const question = state.questions[state.index]!;
    // Old rooms may carry an old settings shape – fall back to the defaults.
    const scoring = normalizeScoring(config.meta, state.scoring);
    const results: Record<string, ScoreResult> = {};
    for (const [id, a] of Object.entries(state.answers)) {
      results[id] = scoreAnswer(scoring, config.baseScoreInput(question, a.value), {
        responseTimeMs: a.at - state.questionStartedAt,
        timeLimitMs: questionMs,
      });
    }
    return results;
  }

  function reveal(state: State, now: number): ModuleUpdate<State> {
    const results = scoreQuestion(state);
    // Always set (even if empty): the room builds the leaderboard snapshot from it.
    const scoreDelta: Record<string, number> = {};
    for (const [id, r] of Object.entries(results)) if (r.finalScore > 0) scoreDelta[id] = r.finalScore;
    const next: State = { ...state, step: "reveal", stepEndsAt: now + REVEAL_ANSWER_MS, results };
    return { state: next, phaseEndsAt: next.stepEndsAt, scoreDelta };
  }

  function showLeaderboard(state: State, now: number): ModuleUpdate<State> {
    const next: State = { ...state, step: "leaderboard", stepEndsAt: now + REVEAL_LEADERBOARD_MS };
    return { state: next, phaseEndsAt: next.stepEndsAt };
  }

  /** Everyone who is connected has answered (disconnected players don't block). */
  function allAnswered(state: State, ctx: ModuleContext): boolean {
    const connected = ctx.players.filter((p) => p.connected);
    return connected.length > 0 && connected.every((p) => p.id in state.answers);
  }

  return {
    meta: config.meta,
    actionSchema,

    init(ctx, options) {
      const questions = config.pickQuestions(ctx, options);
      const initial: State = {
        questions,
        index: 0,
        step: "question",
        questionStartedAt: ctx.now,
        stepEndsAt: ctx.now,
        answers: {},
        results: null,
        scoring: normalizeScoring(config.meta, options.scoring),
      };
      if (questions.length === 0) return { state: initial, phaseEndsAt: null, done: true };
      return { ...openQuestion(initial, 0, ctx.now), usedContentIds: questions.map((q) => q.id) };
    },

    handleAction(state, action, playerId, ctx) {
      if (state.step !== "question") return { error: "WRONG_PHASE" };
      if (ctx.now > state.stepEndsAt) return { error: "TOO_LATE" };
      if (!ctx.players.some((p) => p.id === playerId)) return { error: "UNKNOWN_PLAYER" };
      if (playerId in state.answers) return { error: "ALREADY_ANSWERED" };
      const next: State = {
        ...state,
        answers: { ...state.answers, [playerId]: { value: action.value, at: ctx.now } },
      };
      if (allAnswered(next, ctx)) return reveal(next, ctx.now);
      return { state: next, phaseEndsAt: next.stepEndsAt };
    },

    onTimer(state, ctx) {
      if (state.step === "question") return reveal(state, ctx.now);
      if (state.step === "reveal") return showLeaderboard(state, ctx.now);
      const nextIndex = state.index + 1;
      if (nextIndex < state.questions.length) return openQuestion(state, nextIndex, ctx.now);
      return { state, phaseEndsAt: null, done: true };
    },

    onPlayersChanged(state, ctx) {
      if (state.step === "question" && allAnswered(state, ctx)) return reveal(state, ctx.now);
      return null;
    },

    progress(state) {
      return {
        index: state.index,
        total: state.questions.length,
        step: state.step,
        contentId: state.questions[state.index]?.id,
        revealed: state.step !== "question",
      };
    },

    toStats(state) {
      if (state.step === "question" || !state.results) return null;
      const question = state.questions[state.index]!;
      const maxPoints = Math.max(1, normalizeScoring(config.meta, state.scoring).maxPoints);
      let correct = 0;
      let sumResponseMs = 0;
      let sumErrorPct = 0;
      const entries = Object.entries(state.answers);
      for (const [id, a] of entries) {
        if ((state.results[id]?.baseScore ?? 0) / maxPoints >= 0.9) correct++;
        sumResponseMs += Math.max(0, a.at - state.questionStartedAt);
        if (config.errorShare) sumErrorPct += Math.min(1, Math.max(0, config.errorShare(question, a.value)));
      }
      return {
        contentId: question.id,
        answers: entries.length,
        correct,
        sumResponseMs,
        sumErrorPct: config.errorShare ? Math.round(sumErrorPct * 1000) / 1000 : null,
      };
    },

    revealFacts(state) {
      const describe = config.describe;
      if (!describe || state.step === "question" || !state.results) return null;
      const question = state.questions[state.index]!;
      const maxPoints = Math.max(1, normalizeScoring(config.meta, state.scoring).maxPoints);
      const answers: RevealFacts["answers"] = {};
      for (const [id, a] of Object.entries(state.answers)) {
        const result = state.results[id];
        const accuracy = Math.min(1, Math.max(0, (result?.baseScore ?? 0) / maxPoints));
        answers[id] = {
          text: describe.answer(question, a.value),
          // Estimates count as "right" when they are very close.
          correct: accuracy >= 0.9,
          accuracy: Math.round(accuracy * 100) / 100,
          points: result?.finalScore ?? 0,
          responseMs: Math.max(0, a.at - state.questionStartedAt),
        };
      }
      return { question: describe.question(question), correctAnswer: describe.solution(question), answers };
    },

    toPublicState(state, viewer: Viewer) {
      const question = state.questions[state.index]!;
      const own = viewer.role === "player" ? state.answers[viewer.playerId] : undefined;
      const revealed = state.step !== "question";
      return {
        step: state.step,
        index: state.index,
        total: state.questions.length,
        question: config.publicQuestion(question),
        questionStartedAt: state.questionStartedAt,
        stepEndsAt: state.stepEndsAt,
        answeredPlayerIds: Object.keys(state.answers),
        myAnswer: own ? own.value : null,
        reveal: revealed
          ? {
              solution: config.solution(question),
              answers: Object.fromEntries(
                Object.entries(state.answers).map(([id, a]) => [id, a.value]),
              ),
              results: state.results ?? {},
            }
          : null,
      };
    },
  };
}
