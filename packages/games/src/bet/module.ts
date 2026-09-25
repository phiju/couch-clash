/**
 * Bet: the category of the next question is shown, every player secretly
 * wagers (50 / 100 / 200 / own amount up to their maximum), then the
 * question. Correct → +wager, wrong or no answer → −wager (never below 0).
 */
import { QUIZ_QUESTIONS_DE, type QuizQuestion } from "@couch-clash/content";
import { z } from "zod";
import { BOT_CONFIG, botPick } from "@couch-clash/shared";
import { normalizeScoring, type ScoreResult } from "../scoring";
import {
  createKnowledgeModule,
  fixedResult,
  isCorrectAnswer,
  upfrontQuestions,
  type KnowledgeGame,
  type KnowledgeState,
} from "../knowledge/engine";
import { categoryLabel, isKids, namesOf, pickLine, sayLine, spokenName } from "../knowledge/lines";
import type { BetExtra } from "../knowledge/types";
import { BET_CONFIG, betMeta, type WagerLimitStrategy } from "./meta";

export interface BetGame {
  strategy: WagerLimitStrategy;
  defaultWager: number;
  wagerFloor: number;
  /** Highest wager per player for this question (fixed when it starts). */
  maxWagers: Record<string, number>;
  wagers: Record<string, number>;
  /** Wagered themselves (the others got the default). */
  placed: string[];
  names: Record<string, string>;
}

export interface WagerAction {
  type: "wager";
  amount: number;
}

/** Highest allowed wager. New rules are one entry here. */
export const WAGER_LIMITS: Record<WagerLimitStrategy, (score: number, floor: number) => number> = {
  SCORE_OR_FLOOR: (score, floor) => Math.max(Math.floor(score), floor),
};

export function maxWager(game: Pick<BetGame, "strategy" | "wagerFloor">, score: number): number {
  return Math.max(1, WAGER_LIMITS[game.strategy](score, game.wagerFloor));
}

/** No wager in time → the default (50), or the maximum if that is lower. */
export function defaultWager(game: Pick<BetGame, "defaultWager">, max: number): number {
  return Math.max(1, Math.min(game.defaultWager, max));
}

export const betGame: KnowledgeGame<BetGame, WagerAction> = {
  meta: betMeta,

  init(ctx, options, pool) {
    const points = normalizeScoring(betMeta, options.scoring).points ?? {};
    return {
      game: {
        strategy: "SCORE_OR_FLOOR",
        defaultWager: points.defaultWager ?? betMeta.scoring.points.defaultWager,
        wagerFloor: points.wagerFloor ?? betMeta.scoring.points.wagerFloor,
        maxWagers: {},
        wagers: {},
        placed: [],
        names: {},
      },
      questions: upfrontQuestions(ctx, options, pool, betMeta),
    };
  },

  startQuestion(game, { ctx, scores }) {
    const maxWagers: Record<string, number> = {};
    for (const p of ctx.players) maxWagers[p.id] = maxWager(game, scores[p.id] ?? 0);
    return { ...game, maxWagers, wagers: {}, placed: [], names: namesOf(ctx, ctx.players.map((p) => p.id)) };
  },

  pre: {
    step: "wager",
    seconds: BET_CONFIG.wagerSeconds,
    actionSchema: z.object({ type: z.literal("wager"), amount: z.number().int().min(1).max(1_000_000) }),
    actors: (game) => Object.keys(game.maxWagers),
    acted: (game) => game.placed,
    act(game, action, actorId) {
      const max = game.maxWagers[actorId];
      if (max === undefined) return { error: "UNKNOWN_PLAYER" };
      if (game.placed.includes(actorId)) return { error: "ALREADY_ANSWERED" };
      if (action.amount > max) return { error: "INVALID_MESSAGE" };
      return { ...game, wagers: { ...game.wagers, [actorId]: action.amount }, placed: [...game.placed, actorId] };
    },
    finish(game, ctx) {
      // Connected players without a wager bet the default; absent players sit this one out.
      const wagers = { ...game.wagers };
      for (const p of ctx.players) {
        const max = game.maxWagers[p.id];
        if (p.connected && max !== undefined && wagers[p.id] === undefined) wagers[p.id] = defaultWager(game, max);
      }
      return { ...game, wagers };
    },
    // 50 / 100 / 200 at random – never more than allowed.
    bot: (game, botId, _ctx, bot) => {
      const max = game.maxWagers[botId];
      if (max === undefined || max < 1) return null;
      return { type: "wager", amount: Math.min(max, botPick(BOT_CONFIG.wagers, bot.random) ?? 100) };
    },
  },

  score({ game, question, answers }) {
    const results: Record<string, ScoreResult> = {};
    for (const [id, wager] of Object.entries(game.wagers)) {
      results[id] = fixedResult(isCorrectAnswer(question, answers[id]) ? wager : -wager, wager);
    }
    return { results };
  },

  publicExtra(game, { viewer, revealed }): BetExtra {
    return {
      maxWagers: game.maxWagers,
      presets: BET_CONFIG.presets,
      defaultWager: game.defaultWager,
      wagers: revealed ? { ...game.wagers } : null,
      myWager: viewer.role === "player" ? (game.wagers[viewer.playerId] ?? null) : null,
    };
  },

  announce: (state) => announceBet(state),

  revealNotes(state) {
    const notes: Record<string, string> = {};
    for (const [id, wager] of Object.entries(state.game.wagers)) {
      const allIn = wager >= (state.game.maxWagers[id] ?? Infinity);
      notes[id] = allIn ? `hat ALL IN gesetzt (${wager} Punkte)` : `hat ${wager} Punkte gesetzt`;
    }
    return { notes };
  },
};

export function announceBet(state: KnowledgeState<BetGame>) {
  const kids = isKids(state.mode);
  const question = state.questions[state.index];
  if (state.step === "wager" && question) {
    const label = categoryLabel(question.category);
    const key = `wager:${state.index}`;
    return sayLine(
      key,
      kids
        ? `Nächste Kategorie: ${label}. Wie viele Punkte setzt ihr?`
        : pickLine([`Nächste Kategorie: ${label}. Wie viel ist euch euer Wissen wert?`, `${label}! Macht eure Einsätze.`], key),
    );
  }
  if (state.step === "reveal" && question) {
    const g = state.game;
    const allIn = Object.keys(g.wagers).filter((id) => g.placed.includes(id) && g.wagers[id]! >= (g.maxWagers[id] ?? Infinity));
    if (allIn.length === 0) return null;
    const key = `allin:${state.index}`;
    const id = pickLine(allIn, key);
    const n = spokenName(g.names[id]);
    const won = isCorrectAnswer(question, state.answers[id]);
    const text = won
      ? kids
        ? `Alles gesetzt und gewonnen – super, ${n}!`
        : `${n} geht ALL IN – und verdoppelt!`
      : kids
        ? `Alles gesetzt, ${n} – mutig! Nächstes Mal klappt's.`
        : `ALL IN und alles weg – tapfer, ${n}.`;
    return sayLine(key, text);
  }
  return null;
}

export function createBetModule(pool: readonly QuizQuestion[] = QUIZ_QUESTIONS_DE) {
  return createKnowledgeModule(betGame, pool);
}

export const betModule = createBetModule();
