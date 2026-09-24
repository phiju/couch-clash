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
  type ScoringSettings,
  type Viewer,
} from "@couch-clash/shared";
import { z } from "zod";
import type { PointsBreakdown } from "../scoring";
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
  results: Record<string, PointsBreakdown> | null;
  scoring: ScoringSettings;
}

export interface QuestionRoundConfig<TQuestion extends { id: string }, TAnswer, TPublicQ, TSolution> {
  meta: CategoryMeta;
  answerSchema: z.ZodType<TAnswer>;
  /** Choose `count` questions (already prepared, e.g. options shuffled). */
  pickQuestions(ctx: ModuleContext, options: ModuleInitOptions): TQuestion[];
  score(
    question: TQuestion,
    answers: { id: string; value: TAnswer; at: number }[],
    scoring: ScoringSettings,
  ): Record<string, PointsBreakdown>;
  /** What everyone may see while the question is open – never the answer. */
  publicQuestion(question: TQuestion): TPublicQ;
  /** The solution, shown at reveal. */
  solution(question: TQuestion): TSolution;
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

  function reveal(state: State, now: number): ModuleUpdate<State> {
    const question = state.questions[state.index]!;
    const answers = Object.entries(state.answers).map(([id, a]) => ({ id, value: a.value, at: a.at }));
    const results = config.score(question, answers, state.scoring);
    // Always set (even if empty): the room builds the leaderboard snapshot from it.
    const scoreDelta: Record<string, number> = {};
    for (const [id, r] of Object.entries(results)) if (r.points > 0) scoreDelta[id] = r.points;
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
        scoring: options.scoring,
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
