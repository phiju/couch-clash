/**
 * ONE multiple-choice engine for every knowledge game.
 *
 * The engine only delivers the question, its four options, the correct
 * option and the players' answers (with server timestamps) – and runs the
 * per-question steps:
 *
 *   [pre-step of the game] → question → reveal → leaderboard → next …
 *
 * Everything game-specific lives in the game's own module (KnowledgeGame):
 * an optional pre-step (pick a category, NORMAL/DOUBLE, a wager), what
 * happens when a question starts (e.g. find the leader), and the scoring.
 * Timers are only `phaseEndsAt` (the room's alarm calls onTimer).
 */
import { QUIZ_QUESTIONS_DE, type QuizQuestion } from "@couch-clash/content";
import {
  botChoice,
  HOST_ACTOR_ID,
  REVEAL_ANSWER_MS,
  REVEAL_LEADERBOARD_MS,
  type BotContext,
  type CategoryMeta,
  type ErrorCode,
  type GameMode,
  type GameModule,
  type ModuleContext,
  type ModuleInitOptions,
  type ModuleUpdate,
  type ReadAloud,
  type RevealFacts,
  type ScoringSettings,
  type Viewer,
} from "@couch-clash/shared";
import { z } from "zod";
import { NO_ANSWER, normalizeScoring, type ScoreResult } from "../scoring";
import { pickKnowledgeQuestions, type PreparedQuizQuestion } from "./questions";
import type {
  KnowledgeAnswerAction,
  KnowledgePreStep,
  KnowledgePublicState,
  KnowledgeResult,
  KnowledgeStep,
} from "./types";

export const KNOWLEDGE_CONFIG = {
  /** No total score goes below this (risk games may take points away). */
  minScore: 0,
} as const;

export interface RecordedAnswer {
  /** Index of the chosen option. */
  value: number;
  /** Server receive time. */
  at: number;
}

export interface KnowledgeState<G> {
  /** Questions of this round (Kategorienvorgabe: drawn one by one after the pick). */
  questions: PreparedQuizQuestion[];
  total: number;
  index: number;
  step: KnowledgeStep;
  stepStartedAt: number;
  questionStartedAt: number;
  stepEndsAt: number;
  answers: Record<string, RecordedAnswer>;
  results: Record<string, KnowledgeResult> | null;
  scoring: ScoringSettings;
  /** Game mode (Kids → friendlier host lines). */
  mode: GameMode;
  /** The game's own state. */
  game: G;
}

/** A new question begins. `scores` are the current totals (fresh standings). */
export interface QuestionSlot {
  index: number;
  ctx: ModuleContext;
  scores: Readonly<Record<string, number>>;
}

export interface KnowledgeScoreInput<G> {
  game: G;
  question: PreparedQuizQuestion;
  answers: Readonly<Record<string, RecordedAnswer>>;
  /** Every player of the room (answered or not). */
  playerIds: readonly string[];
  /** Totals before this question. */
  scores: Readonly<Record<string, number>>;
  scoring: ScoringSettings;
  questionStartedAt: number;
  questionMs: number;
}

export interface KnowledgeScoreOutput<G> {
  /** Per player; `finalScore` may be negative. Missing players get 0. */
  results: Record<string, ScoreResult>;
  game?: G;
}

/** A step before every question (or some), played on the phones. */
export interface KnowledgePrePhase<G, A extends { type: string }> {
  step: KnowledgePreStep;
  seconds: number;
  /** Full action object incl. its `type` literal. */
  actionSchema: z.ZodType<A>;
  /** Is the step played before this question? Default: always. */
  active?(game: G, index: number): boolean;
  /** Who acts. The step ends early once every connected actor has acted. */
  actors(game: G, ctx: ModuleContext): string[];
  /** Who has acted (public: "hat entschieden" – never what). */
  acted(game: G): string[];
  act(game: G, action: A, actorId: string, ctx: ModuleContext): G | { error: ErrorCode };
  /** The step is over (all acted or time up): defaults for everyone missing. */
  finish(game: G, ctx: ModuleContext): G;
  /** Test bots: the bot's move in this step (it is an actor and hasn't acted yet). */
  bot?(game: G, botId: string, ctx: ModuleContext, bot: BotContext): A | null;
}

export interface KnowledgeGame<G, A extends { type: string } = never> {
  meta: CategoryMeta;
  /** The game's own state – plus the round's questions if they are not drawn one by one. */
  init(
    ctx: ModuleContext,
    options: ModuleInitOptions,
    pool: readonly QuizQuestion[],
  ): { game: G; questions?: PreparedQuizQuestion[] };
  /** Questions drawn one by one (after a pick). Null → nothing left, the round ends. */
  drawQuestion?(game: G, index: number, ctx: ModuleContext): { game: G; question: PreparedQuizQuestion } | null;
  /** A new question begins (before the pre-step). */
  startQuestion?(game: G, slot: QuestionSlot): G;
  pre?: KnowledgePrePhase<G, A>;
  score(input: KnowledgeScoreInput<G>): KnowledgeScoreOutput<G>;
  /** Public part for this viewer (hide secrets until the reveal). */
  publicExtra(game: G, view: { viewer: Viewer; step: KnowledgeStep; revealed: boolean }): unknown;
  /** What the host says now (roasts, explanations) – fixed lines, read aloud. */
  announce?(state: KnowledgeState<G>): ReadAloud | null;
  /** Extra facts for the host's commentary at the reveal. */
  revealNotes?(state: KnowledgeState<G>): { notes?: Record<string, string>; highlights?: string[] } | null;
}

export type KnowledgeModule<G> = GameModule<KnowledgeState<G>, unknown, KnowledgePublicState>;

const QUESTION_STEPS: readonly KnowledgeStep[] = ["question", "reveal", "leaderboard"];
const REVEALED_STEPS: readonly KnowledgeStep[] = ["reveal", "leaderboard"];

export function isCorrectAnswer(question: PreparedQuizQuestion, answer: RecordedAnswer | undefined): boolean {
  return answer !== undefined && answer.value === question.correctIndex;
}

/** Score after a delta, never below minScore (a score already below stays as is). */
export function clampDelta(delta: number, current: number, minScore: number = KNOWLEDGE_CONFIG.minScore): number {
  return Math.max(delta, Math.min(0, minScore - current));
}

export function createKnowledgeModule<G, A extends { type: string } = never>(
  def: KnowledgeGame<G, A>,
  pool: readonly QuizQuestion[] = QUIZ_QUESTIONS_DE,
): KnowledgeModule<G> {
  type State = KnowledgeState<G>;
  const questionMs = def.meta.secondsPerQuestion * 1000;
  const pre = def.pre;

  const answerSchema = z.object({ type: z.literal("answer"), value: z.number().int().min(0).max(3) });
  const actionSchema = (pre ? z.union([answerSchema, pre.actionSchema]) : answerSchema) as z.ZodType<unknown>;

  /** Rooms saved by an older version (the Wissensfragen engine) lack the newer fields. */
  function upgrade(raw: State): State {
    if (raw.game !== undefined && raw.total !== undefined) return raw;
    return {
      ...raw,
      total: raw.total ?? raw.questions.length,
      stepStartedAt: raw.stepStartedAt ?? raw.questionStartedAt,
      mode: raw.mode ?? "family",
      game: (raw.game ?? null) as G,
    };
  }

  function update(state: State, extra?: Partial<ModuleUpdate<State>>): ModuleUpdate<State> {
    return { state, phaseEndsAt: state.stepEndsAt, ...extra };
  }

  function done(state: State): ModuleUpdate<State> {
    return { state, phaseEndsAt: null, done: true };
  }

  function openSlot(state: State, index: number, ctx: ModuleContext): ModuleUpdate<State> {
    let next: State = { ...state, index, answers: {}, results: null };
    if (def.startQuestion) next = { ...next, game: def.startQuestion(next.game, { index, ctx, scores: ctx.scores ?? {} }) };
    if (pre && (pre.active?.(next.game, index) ?? true)) {
      next = { ...next, step: pre.step, stepStartedAt: ctx.now, stepEndsAt: ctx.now + pre.seconds * 1000 };
      return update(next);
    }
    return openQuestion(next, ctx);
  }

  function openQuestion(state: State, ctx: ModuleContext): ModuleUpdate<State> {
    let next = state;
    let usedContentIds: string[] | undefined;
    if (!next.questions[next.index]) {
      const drawn = def.drawQuestion?.(next.game, next.index, ctx) ?? null;
      if (!drawn) return done(next);
      next = { ...next, game: drawn.game, questions: [...next.questions.slice(0, next.index), drawn.question] };
      usedContentIds = [drawn.question.id];
    }
    next = {
      ...next,
      step: "question",
      stepStartedAt: ctx.now,
      questionStartedAt: ctx.now,
      stepEndsAt: ctx.now + questionMs,
    };
    return update(next, usedContentIds ? { usedContentIds } : undefined);
  }

  function endPre(state: State, ctx: ModuleContext): ModuleUpdate<State> {
    return openQuestion({ ...state, game: pre ? pre.finish(state.game, ctx) : state.game }, ctx);
  }

  function reveal(state: State, ctx: ModuleContext): ModuleUpdate<State> {
    const question = state.questions[state.index]!;
    const scores = ctx.scores ?? {};
    const out = def.score({
      game: state.game,
      question,
      answers: state.answers,
      playerIds: ctx.players.map((p) => p.id),
      scores,
      // Old rooms may carry an old settings shape – fall back to the defaults.
      scoring: normalizeScoring(def.meta, state.scoring),
      questionStartedAt: state.questionStartedAt,
      questionMs,
    });
    const results: Record<string, KnowledgeResult> = {};
    // Always set (even if empty): the room builds the leaderboard snapshot from it.
    const scoreDelta: Record<string, number> = {};
    for (const id of new Set([...Object.keys(state.answers), ...Object.keys(out.results)])) {
      const r = out.results[id] ?? NO_ANSWER;
      const finalScore = clampDelta(r.finalScore, scores[id] ?? 0);
      results[id] = {
        ...r,
        finalScore,
        answered: id in state.answers,
        correct: isCorrectAnswer(question, state.answers[id]),
      };
      if (finalScore !== 0) scoreDelta[id] = finalScore;
    }
    const next: State = {
      ...state,
      game: out.game ?? state.game,
      step: "reveal",
      stepStartedAt: ctx.now,
      stepEndsAt: ctx.now + REVEAL_ANSWER_MS,
      results,
    };
    return update(next, { scoreDelta });
  }

  function showLeaderboard(state: State, now: number): ModuleUpdate<State> {
    return update({ ...state, step: "leaderboard", stepStartedAt: now, stepEndsAt: now + REVEAL_LEADERBOARD_MS });
  }

  /** Everyone who is connected has answered (disconnected players don't block). */
  function allAnswered(state: State, ctx: ModuleContext): boolean {
    const connected = ctx.players.filter((p) => p.connected);
    return connected.length > 0 && connected.every((p) => p.id in state.answers);
  }

  /** Every connected actor of the pre-step has acted (the host counts as connected). */
  function allActed(state: State, ctx: ModuleContext): boolean {
    if (!pre) return true;
    const connected = new Set(ctx.players.filter((p) => p.connected).map((p) => p.id));
    const need = pre.actors(state.game, ctx).filter((id) => id === HOST_ACTOR_ID || connected.has(id));
    const acted = new Set(pre.acted(state.game));
    return need.length > 0 && need.every((id) => acted.has(id));
  }

  function answer(state: State, value: number, playerId: string, ctx: ModuleContext) {
    if (state.step !== "question") return { error: "WRONG_PHASE" as const };
    if (ctx.now > state.stepEndsAt) return { error: "TOO_LATE" as const };
    if (!ctx.players.some((p) => p.id === playerId)) return { error: "UNKNOWN_PLAYER" as const };
    if (playerId in state.answers) return { error: "ALREADY_ANSWERED" as const };
    const next: State = { ...state, answers: { ...state.answers, [playerId]: { value, at: ctx.now } } };
    if (allAnswered(next, ctx)) return reveal(next, ctx);
    return update(next);
  }

  return {
    meta: def.meta,
    actionSchema,

    init(ctx, options) {
      const { game, questions = [] } = def.init(ctx, options, pool);
      const initial: State = {
        questions,
        total: def.drawQuestion ? options.questionCount : questions.length,
        index: 0,
        step: "question",
        stepStartedAt: ctx.now,
        questionStartedAt: ctx.now,
        stepEndsAt: ctx.now,
        answers: {},
        results: null,
        scoring: normalizeScoring(def.meta, options.scoring),
        mode: options.mode?.mode ?? "family",
        game,
      };
      if (initial.total === 0) return done(initial);
      const first = openSlot(initial, 0, ctx);
      const used = [...questions.map((q) => q.id), ...(first.usedContentIds ?? [])];
      return { ...first, usedContentIds: used };
    },

    handleAction(raw, action, playerId, ctx) {
      const state = upgrade(raw);
      const typed = action as KnowledgeAnswerAction | A;
      if (typed.type === "answer") return answer(state, (typed as KnowledgeAnswerAction).value, playerId, ctx);
      if (!pre || state.step !== pre.step) return { error: "WRONG_PHASE" };
      if (ctx.now > state.stepEndsAt) return { error: "TOO_LATE" };
      if (playerId !== HOST_ACTOR_ID && !ctx.players.some((p) => p.id === playerId)) return { error: "UNKNOWN_PLAYER" };
      const game = pre.act(state.game, typed as A, playerId, ctx);
      if (typeof game === "object" && game !== null && "error" in game) return game;
      const next: State = { ...state, game: game as G };
      if (allActed(next, ctx)) return endPre(next, ctx);
      return update(next);
    },

    onTimer(raw, ctx) {
      const state = upgrade(raw);
      if (pre && state.step === pre.step) return endPre(state, ctx);
      if (state.step === "question") return reveal(state, ctx);
      if (state.step === "reveal") return showLeaderboard(state, ctx.now);
      const nextIndex = state.index + 1;
      if (nextIndex < state.total) return openSlot(state, nextIndex, ctx);
      return done(state);
    },

    onPlayersChanged(raw, ctx) {
      const state = upgrade(raw);
      if (pre && state.step === pre.step && allActed(state, ctx)) return endPre(state, ctx);
      if (state.step === "question" && allAnswered(state, ctx)) return reveal(state, ctx);
      return null;
    },

    progress(raw) {
      const state = upgrade(raw);
      const visible = QUESTION_STEPS.includes(state.step);
      return {
        index: state.index,
        total: state.total,
        step: state.step,
        contentId: visible ? state.questions[state.index]?.id : undefined,
        revealed: REVEALED_STEPS.includes(state.step),
      };
    },

    botAction(raw, botId, ctx, bot) {
      const state = upgrade(raw);
      if (pre && state.step === pre.step) {
        if (!pre.actors(state.game, ctx).includes(botId) || pre.acted(state.game).includes(botId)) return null;
        return pre.bot?.(state.game, botId, ctx, bot) ?? null;
      }
      const question = state.questions[state.index];
      if (state.step !== "question" || !question || botId in state.answers) return null;
      return { type: "answer", value: botChoice(question.correctIndex, question.options.length, bot) };
    },

    toStats(raw, exclude) {
      const state = upgrade(raw);
      const question = state.questions[state.index];
      if (!question || !REVEALED_STEPS.includes(state.step) || !state.results) return null;
      const entries = Object.entries(state.answers)
        .filter(([id]) => !exclude?.has(id))
        .map(([, a]) => a);
      if (exclude?.size && entries.length === 0) return null;
      return {
        contentId: question.id,
        answers: entries.length,
        correct: entries.filter((a) => a.value === question.correctIndex).length,
        sumResponseMs: entries.reduce((sum, a) => sum + Math.max(0, a.at - state.questionStartedAt), 0),
        sumErrorPct: null,
      };
    },

    revealFacts(raw) {
      const state = upgrade(raw);
      const question = state.questions[state.index];
      if (!question || !REVEALED_STEPS.includes(state.step) || !state.results) return null;
      const extra = def.revealNotes?.(state) ?? null;
      const answers: RevealFacts["answers"] = {};
      for (const [id, a] of Object.entries(state.answers)) {
        const correct = a.value === question.correctIndex;
        const note = extra?.notes?.[id];
        answers[id] = {
          text: question.options[a.value] ?? "",
          correct,
          accuracy: correct ? 1 : 0,
          points: state.results[id]?.finalScore ?? 0,
          responseMs: Math.max(0, a.at - state.questionStartedAt),
          ...(note ? { note } : {}),
        };
      }
      return {
        question: question.text,
        correctAnswer: question.options[question.correctIndex] ?? "",
        answers,
        ...(extra?.highlights?.length ? { highlights: extra.highlights } : {}),
        ...(question.partyItem ? { partyItem: true } : {}),
      };
    },

    readAloud(raw) {
      return def.announce?.(upgrade(raw)) ?? null;
    },

    toPublicState(raw, viewer: Viewer): KnowledgePublicState {
      const state = upgrade(raw);
      const question = state.questions[state.index];
      const revealed = REVEALED_STEPS.includes(state.step);
      const own = viewer.role === "player" ? state.answers[viewer.playerId] : undefined;
      return {
        step: state.step,
        index: state.index,
        total: state.total,
        stepStartedAt: state.stepStartedAt,
        questionStartedAt: state.questionStartedAt,
        stepEndsAt: state.stepEndsAt,
        category: question?.category ?? null,
        question: question && QUESTION_STEPS.includes(state.step) ? { text: question.text, options: question.options } : null,
        answeredPlayerIds: Object.keys(state.answers),
        actedPlayerIds: pre && state.step === pre.step ? pre.acted(state.game) : [],
        myAnswer: own ? own.value : null,
        reveal:
          revealed && question
            ? {
                correctIndex: question.correctIndex,
                answers: Object.fromEntries(Object.entries(state.answers).map(([id, a]) => [id, a.value])),
                results: state.results ?? {},
              }
            : null,
        extra: def.publicExtra(state.game, { viewer, step: state.step, revealed }),
      };
    },
  };
}

/** Questions picked for the whole round (Punktesammler, Double or Nothing, Bet, Punkteklau). */
export function upfrontQuestions(
  ctx: ModuleContext,
  options: ModuleInitOptions,
  pool: readonly QuizQuestion[],
  meta: CategoryMeta,
): PreparedQuizQuestion[] {
  return pickKnowledgeQuestions(options, ctx.random, meta, pool);
}

/** Current total of a player (missing = 0). */
export function scoreOf(scores: Readonly<Record<string, number>>, id: string): number {
  return scores[id] ?? 0;
}

/** A plain result for a fixed number of points (no speed modifier). */
export function fixedResult(points: number, base = Math.abs(points)): ScoreResult {
  return { baseScore: base, speedModifier: 1, finalScore: points };
}
