/**
 * Kategorienvorgabe: before each question (or block of questions) the
 * player in last place picks the category from three cards. The category is
 * only a filter for the question pool; questions and scoring are the
 * Punktesammler's (+100 / 0).
 */
import { QUIZ_QUESTIONS_DE, type QuizQuestion } from "@couch-clash/content";
import {
  HOST_ACTOR_ID,
  KNOWLEDGE_CATEGORIES,
  type KnowledgeCategory,
  type ModuleContext,
} from "@couch-clash/shared";
import { z } from "zod";
import { createKnowledgeModule, isCorrectAnswer, type KnowledgeGame, type KnowledgeState } from "../knowledge/engine";
import { categoryLabel, isKids, namesOf, pickLine, pointsDative, sayLine, spokenName } from "../knowledge/lines";
import { knowledgePool, prepareQuizQuestion, questionsByCategory, selectQuestions } from "../knowledge/questions";
import { scoreCorrectAnswers } from "../knowledge/scoring";
import type { CategoryPickExtra, PickedBy } from "../knowledge/types";
import { shuffle } from "../random";
import { CATEGORY_PICK_CONFIG, categoryPickMeta, type PickerStrategy } from "./meta";

export interface CategoryPickGame {
  strategy: PickerStrategy;
  /** Question ids per category, not played recently first. */
  queues: Partial<Record<KnowledgeCategory, string[]>>;
  /** Generated questions in the queues (static ones are looked up in the pool). */
  extra: QuizQuestion[];
  pickerId: string | null;
  /** The picker's score when the block started (for the host's roast). */
  pickerScore: number;
  /** Everyone was tied (e.g. the game start) – the picker was drawn by lot. */
  byLot: boolean;
  offer: KnowledgeCategory[];
  selectedCategory: KnowledgeCategory | null;
  pickedBy: PickedBy | null;
  /** Names for the host's lines. */
  names: Record<string, string>;
}

export interface PickAction {
  type: "pick";
  category: KnowledgeCategory;
}

type Picker = (ctx: ModuleContext, scores: Readonly<Record<string, number>>) => { pickerId: string | null; byLot: boolean };

/** Who picks. New variants (e.g. the leader, round robin) are one entry here. */
export const PICKER_STRATEGY_FNS: Record<PickerStrategy, Picker> = {
  /** Last place (connected players first); a tie – e.g. the game start – is decided by lot. */
  LAST_PLACE: (ctx, scores) => {
    const connected = ctx.players.filter((p) => p.connected);
    const candidates = connected.length > 0 ? connected : ctx.players;
    if (candidates.length === 0) return { pickerId: null, byLot: false };
    const lowest = Math.min(...candidates.map((p) => scores[p.id] ?? 0));
    const last = candidates.filter((p) => (scores[p.id] ?? 0) === lowest);
    return { pickerId: last[Math.floor(ctx.random() * last.length)]!.id, byLot: last.length > 1 };
  },
  HOST: () => ({ pickerId: HOST_ACTOR_ID, byLot: false }),
};

const { questionsPerPick, offerSize } = CATEGORY_PICK_CONFIG;

const blockStart = (index: number) => index % questionsPerPick === 0;

/** Categories that can still fill a block (fallback: any with a question left). */
function offerable(queues: CategoryPickGame["queues"]): KnowledgeCategory[] {
  const full = KNOWLEDGE_CATEGORIES.filter((c) => (queues[c]?.length ?? 0) >= questionsPerPick);
  return full.length > 0 ? full : KNOWLEDGE_CATEGORIES.filter((c) => (queues[c]?.length ?? 0) > 0);
}

export function categoryPickGame(pool: readonly QuizQuestion[]): KnowledgeGame<CategoryPickGame, PickAction> {
  const byId = new Map(pool.map((q) => [q.id, q]));
  const meta = categoryPickMeta;

  return {
    meta,

    init(ctx, options) {
      const candidates = knowledgePool(pool, options, meta);
      const byCategory = questionsByCategory(candidates);
      const excluded = new Set(options.excludeContentIds);
      const build = (freshOnly: boolean) => {
        const queues: CategoryPickGame["queues"] = {};
        for (const c of KNOWLEDGE_CATEGORIES) {
          const list = freshOnly ? byCategory[c].filter((q) => !excluded.has(q.id)) : byCategory[c];
          const ids = selectQuestions(list, options.questionCount, options, ctx.random).map((q) => q.id);
          if (ids.length > 0) queues[c] = ids;
        }
        return queues;
      };
      // Unplayed questions first; only if too few categories are left, played ones come back.
      let queues = build(true);
      if (offerable(queues).length < offerSize) queues = build(false);
      const queued = new Set(Object.values(queues).flat());
      const extra = candidates.filter((q) => !byId.has(q.id) && queued.has(q.id));
      const strategy: PickerStrategy = options.options?.hostPicks ? "HOST" : "LAST_PLACE";
      return {
        game: {
          strategy,
          queues,
          extra,
          pickerId: null,
          pickerScore: 0,
          byLot: false,
          offer: [],
          selectedCategory: null,
          pickedBy: null,
          names: {},
        },
      };
    },

    startQuestion(game, { index, ctx, scores }) {
      if (!blockStart(index)) return game;
      const { pickerId, byLot } = PICKER_STRATEGY_FNS[game.strategy](ctx, scores);
      return {
        ...game,
        pickerId,
        byLot,
        pickerScore: pickerId ? (scores[pickerId] ?? 0) : 0,
        offer: shuffle(offerable(game.queues), ctx.random).slice(0, offerSize),
        selectedCategory: null,
        pickedBy: null,
        names: pickerId ? namesOf(ctx, [pickerId]) : {},
      };
    },

    pre: {
      step: "pick",
      seconds: CATEGORY_PICK_CONFIG.pickSeconds,
      actionSchema: z.object({ type: z.literal("pick"), category: z.enum(KNOWLEDGE_CATEGORIES) }),
      active: (game, index) => blockStart(index) && game.offer.length > 0 && game.pickerId !== null,
      actors: (game) => (game.pickerId ? [game.pickerId] : []),
      acted: (game) => (game.pickedBy === "picker" && game.pickerId ? [game.pickerId] : []),
      act(game, action, actorId) {
        if (actorId !== game.pickerId) return { error: "NOT_AUTHORIZED" };
        if (game.pickedBy) return { error: "ALREADY_ANSWERED" };
        if (!game.offer.includes(action.category)) return { error: "INVALID_MESSAGE" };
        return { ...game, selectedCategory: action.category, pickedBy: "picker" };
      },
      finish(game, ctx) {
        if (game.selectedCategory || game.offer.length === 0) return game;
        // No pick in time → a random card.
        return { ...game, selectedCategory: game.offer[Math.floor(ctx.random() * game.offer.length)]!, pickedBy: "random" };
      },
    },

    drawQuestion(game, _index, ctx) {
      let category = game.selectedCategory;
      if (!category || !game.queues[category]?.length) {
        // Block continues in a category that ran dry → any category with questions left.
        const left = offerable(game.queues);
        if (left.length === 0) return null;
        category = left[Math.floor(ctx.random() * left.length)]!;
      }
      const [id, ...rest] = game.queues[category]!;
      const raw = byId.get(id!) ?? game.extra.find((q) => q.id === id);
      const queues = { ...game.queues, [category]: rest };
      if (!raw) return null;
      return { game: { ...game, queues }, question: prepareQuizQuestion(raw, ctx.random) };
    },

    score: scoreCorrectAnswers,

    publicExtra: (game): CategoryPickExtra => ({
      pickerId: game.pickerId,
      offer: game.offer,
      selectedCategory: game.selectedCategory,
      pickedBy: game.pickedBy,
      byLot: game.byLot,
    }),

    announce: (state) => announceCategoryPick(state),

    revealNotes(state) {
      const g = state.game;
      const question = state.questions[state.index];
      if (!question || g.pickedBy !== "picker" || !g.pickerId || !(g.pickerId in state.answers)) return null;
      const wrong = !isCorrectAnswer(question, state.answers[g.pickerId]);
      const label = categoryLabel(g.selectedCategory);
      return {
        notes: {
          [g.pickerId]: `hat die Kategorie ${label} selbst ausgesucht${wrong ? " und trotzdem falsch geantwortet" : " und richtig geantwortet"}`,
        },
      };
    },
  };
}

/** The host roasts the picker (Kids: friendly). */
export function announceCategoryPick(state: KnowledgeState<CategoryPickGame>) {
  const g = state.game;
  const kids = isKids(state.mode);
  const host = g.pickerId === HOST_ACTOR_ID;
  const name = spokenName(g.pickerId ? g.names[g.pickerId] : undefined);
  const key = (kind: string) => `${kind}:${state.index}:${g.pickerId ?? ""}`;

  if (state.step === "pick") {
    if (host) return sayLine(key("pick"), "Der Host sucht die Kategorie aus – Beschwerden bitte schriftlich!");
    if (g.byLot && g.pickerScore === 0 && state.index === 0) {
      return sayLine(key("pick"), `${name}, das Los hat entschieden: Du wählst die erste Kategorie!`);
    }
    const lines = kids
      ? [`${name}, du darfst dir die nächste Kategorie aussuchen!`, `Aufholjagd! ${name} sucht die Kategorie aus – viel Glück!`]
      : [
          `Im Ranking ganz hinten, bei der Kategoriewahl ganz vorn – ${name}, bitte!`,
          `Letzter Platz, erste Wahl. Das nennt man soziale Gerechtigkeit, ${name}.`,
          `${name}, du wählst. Nicht weil du gut bist – sondern weil du hinten liegst.`,
        ];
    return sayLine(key("pick"), pickLine(lines, key("pick")));
  }

  if (state.step === "question" && blockStart(state.index) && g.selectedCategory && !host) {
    const label = categoryLabel(g.selectedCategory);
    if (g.pickedBy === "random") {
      return sayLine(
        key("picked"),
        kids ? `Die Zeit ist um – der Zufall wählt ${label}!` : `Zu langsam, ${name} – der Zufall wählt ${label}.`,
      );
    }
    const lines = kids
      ? [`${label} – tolle Wahl, ${name}!`, `${label}! Da bin ich gespannt, ${name}.`]
      : [`${label}? Mutig für jemanden mit ${pointsDative(g.pickerScore)}.`, `${label} also. Mal sehen, ob sich das auszahlt, ${name}.`];
    return sayLine(key("picked"), pickLine(lines, key("picked")));
  }

  if (state.step === "reveal" && g.pickedBy === "picker" && g.pickerId && !host) {
    const question = state.questions[state.index];
    const answer = state.answers[g.pickerId];
    // Own category, answered – and wrong.
    if (question && answer && question.category === g.selectedCategory && !isCorrectAnswer(question, answer)) {
      return sayLine(
        key("own"),
        kids ? `Knapp daneben, ${name} – beim nächsten Mal klappt's bestimmt!` : `Selbst ausgesucht und trotzdem falsch – Respekt, ${name}.`,
      );
    }
  }
  return null;
}

export function createCategoryPickModule(pool: readonly QuizQuestion[] = QUIZ_QUESTIONS_DE) {
  return createKnowledgeModule(categoryPickGame(pool), pool);
}

export const categoryPickModule = createCategoryPickModule();
