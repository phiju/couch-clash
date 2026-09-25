/**
 * Double or Nothing: before every question each player secretly picks
 * NORMAL or DOUBLE (no decision → NORMAL), then the question as usual.
 *   NORMAL: correct +100, wrong 0
 *   DOUBLE: correct +200, wrong or no answer −200   (all configurable)
 */
import { QUIZ_QUESTIONS_DE, type QuizQuestion } from "@couch-clash/content";
import { z } from "zod";
import { normalizeScoring, type ScoreResult } from "../scoring";
import {
  createKnowledgeModule,
  fixedResult,
  isCorrectAnswer,
  upfrontQuestions,
  type KnowledgeGame,
  type KnowledgeState,
} from "../knowledge/engine";
import { isKids, namesOf, pickLine, sayLine, spokenName } from "../knowledge/lines";
import type { DoubleExtra, RiskMode } from "../knowledge/types";
import { DOUBLE_CONFIG, doubleMeta } from "./meta";

export interface DoubleGame {
  /** Decisions made this question (missing → NORMAL). */
  decisions: Record<string, RiskMode>;
  points: DoubleExtra["points"];
  names: Record<string, string>;
}

export interface RiskAction {
  type: "risk";
  mode: RiskMode;
}

export const riskModeOf = (game: DoubleGame, id: string): RiskMode => game.decisions[id] ?? "normal";

export function doublePoints(points: Record<string, number> | undefined): DoubleExtra["points"] {
  const d = doubleMeta.scoring.points;
  return {
    normal: points?.normal ?? d.normal,
    double: points?.double ?? d.double,
    doubleLoss: points?.doubleLoss ?? d.doubleLoss,
  };
}

export const doubleGame: KnowledgeGame<DoubleGame, RiskAction> = {
  meta: doubleMeta,

  init: (ctx, options, pool) => ({
    game: { decisions: {}, points: doublePoints(normalizeScoring(doubleMeta, options.scoring).points), names: {} },
    questions: upfrontQuestions(ctx, options, pool, doubleMeta),
  }),

  startQuestion: (game, { ctx }) => ({ ...game, decisions: {}, names: namesOf(ctx, ctx.players.map((p) => p.id)) }),

  pre: {
    step: "decide",
    seconds: DOUBLE_CONFIG.decideSeconds,
    actionSchema: z.object({ type: z.literal("risk"), mode: z.enum(["normal", "double"]) }),
    actors: (_game, ctx) => ctx.players.map((p) => p.id),
    acted: (game) => Object.keys(game.decisions),
    act(game, action, actorId, ctx) {
      if (!ctx.players.some((p) => p.id === actorId)) return { error: "UNKNOWN_PLAYER" };
      if (actorId in game.decisions) return { error: "ALREADY_ANSWERED" };
      return { ...game, decisions: { ...game.decisions, [actorId]: action.mode } };
    },
    // No decision → NORMAL (riskModeOf).
    finish: (game) => game,
    bot: (_game, _botId, _ctx, bot) => ({ type: "risk", mode: bot.random() < 0.5 ? "normal" : "double" }),
  },

  score({ game, question, answers, playerIds }) {
    const points = game.points;
    const results: Record<string, ScoreResult> = {};
    for (const id of playerIds) {
      const correct = isCorrectAnswer(question, answers[id]);
      if (riskModeOf(game, id) === "double") {
        results[id] = fixedResult(correct ? points.double : -points.doubleLoss);
      } else if (id in answers) {
        results[id] = fixedResult(correct ? points.normal : 0);
      }
    }
    return { results };
  },

  publicExtra(game, { viewer, revealed }): DoubleExtra {
    return {
      decisions: revealed ? { ...game.decisions } : null,
      myDecision: viewer.role === "player" ? (game.decisions[viewer.playerId] ?? null) : null,
      points: game.points,
    };
  },

  announce: (state) => announceDouble(state),

  revealNotes(state) {
    const notes: Record<string, string> = {};
    for (const [id, mode] of Object.entries(state.game.decisions)) {
      if (mode === "double") notes[id] = "hat auf DOUBLE gesetzt (doppelt gewinnen oder doppelt verlieren)";
    }
    return { notes };
  },
};

/** Reveal: the most dramatic DOUBLE of the question. */
export function announceDouble(state: KnowledgeState<DoubleGame>) {
  if (state.step !== "reveal") return null;
  const question = state.questions[state.index];
  const doubled = Object.keys(state.game.decisions).filter((id) => state.game.decisions[id] === "double");
  if (!question || doubled.length === 0) return null;
  const key = `double:${state.index}`;
  const winners = doubled.filter((id) => isCorrectAnswer(question, state.answers[id]));
  const losers = doubled.filter((id) => !winners.includes(id));
  const kids = isKids(state.mode);
  const name = (id: string) => spokenName(state.game.names[id]);
  if (losers.length > 0 && (winners.length === 0 || pickLine([0, 1], key) === 0)) {
    const n = name(pickLine(losers, key));
    return sayLine(
      key,
      kids
        ? pickLine([`Schade, ${n} – beim Verdoppeln gibt's auch mal ein Minus.`, `Mutig war's, ${n}! Nächstes Mal klappt's.`], key)
        : pickLine([`Doppelt gewagt, doppelt verloren – ${n}, das tat weh.`, `${n} setzt auf DOUBLE … und nichts. Autsch.`], key),
    );
  }
  const n = name(pickLine(winners, key));
  return sayLine(
    key,
    kids
      ? pickLine([`Mutig, ${n}! Doppelt gesetzt – und geschafft!`, `Super, ${n}! Doppelte Punkte für dich!`], key)
      : pickLine([`${n} geht aufs Ganze – und kassiert doppelt!`, `DOUBLE und richtig – ${n}, du Zocker!`], key),
  );
}

export function createDoubleModule(pool: readonly QuizQuestion[] = QUIZ_QUESTIONS_DE) {
  return createKnowledgeModule(doubleGame, pool);
}

export const doubleModule = createDoubleModule();
