import { QUIZ_QUESTIONS_DE, type QuizQuestion } from "@couch-clash/content";
import {
  HOST_ACTOR_ID,
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_CATEGORY_LABELS,
  eligibleForMode,
  type GameModeSettings,
  type ModuleContext,
  type ModuleUpdate,
  type ModulePlayer,
  type ScoringSettings,
} from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { CATEGORY_METAS, GAME_MODULES, normalizeScoring } from "../src";
import { betMeta } from "../src/bet/meta";
import { createBetModule, type BetGame } from "../src/bet/module";
import { categoryPickMeta } from "../src/category-pick/meta";
import { PICKER_STRATEGY_FNS, createCategoryPickModule } from "../src/category-pick/module";
import { doubleMeta } from "../src/double/meta";
import { createDoubleModule, type DoubleGame } from "../src/double/module";
import { createEstimateModule } from "../src/estimate/module";
import { clampDelta, type KnowledgeModule, type KnowledgeState } from "../src/knowledge/engine";
import { selectQuestions, toKnowledgeQuestion } from "../src/knowledge/questions";
import { quizMeta } from "../src/quiz/meta";
import { createQuizModule } from "../src/quiz/module";
import { stealMeta } from "../src/steal/meta";
import { computeSteal, createStealModule, type StealGame } from "../src/steal/module";

const T0 = 1_700_000_000_000;

function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const PLAYERS: ModulePlayer[] = [
  { id: "a", connected: true, name: "Clara" },
  { id: "b", connected: true, name: "Max" },
  { id: "c", connected: true, name: "Philip" },
];

function ctx(now: number, scores: Record<string, number> = {}, players = PLAYERS, random = seeded()): ModuleContext {
  return { now, players, random, scores };
}

/** Small pool: one question per category, all child-friendly. */
function q(id: string, category: QuizQuestion["primaryCategory"], extra: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    id,
    text: `Frage ${id}?`,
    options: [`${id}-A`, `${id}-B`, `${id}-C`, `${id}-D`],
    correctIndex: 0,
    ageRating: 6,
    tags: ["t"],
    difficulty: 1,
    alcohol: false,
    adult: false,
    primaryCategory: category,
    ...extra,
  };
}

const POOL: QuizQuestion[] = KNOWLEDGE_CATEGORIES.flatMap((c) => [1, 2, 3].map((n) => q(`${c.toLowerCase().replace(/_/g, "-")}-${n}`, c)));

function scoringOf(meta: { scoring: ScoringSettings }): ScoringSettings {
  return structuredClone(meta.scoring) as ScoringSettings;
}

function unwrap<T>(r: ModuleUpdate<T> | { error: string }): ModuleUpdate<T> {
  if ("error" in r) throw new Error(r.error);
  return r;
}

type AnyState = KnowledgeState<unknown>;

/** Answers for everyone in `answers` ("right"/"wrong"), then the timer reveals. */
function answerAndReveal<G>(
  mod: KnowledgeModule<G>,
  state: KnowledgeState<G>,
  answers: Record<string, "right" | "wrong">,
  scores: Record<string, number> = {},
  players = PLAYERS,
) {
  const correct = state.questions[state.index]!.correctIndex;
  let s = state;
  let last: ModuleUpdate<KnowledgeState<G>> | null = null;
  for (const [id, how] of Object.entries(answers)) {
    last = unwrap(mod.handleAction(s, { type: "answer", value: how === "right" ? correct : (correct + 1) % 4 }, id, ctx(T0 + 1000, scores, players)));
    s = last.state;
  }
  if (s.step === "question") last = mod.onTimer(s, ctx(T0 + 30_000, scores, players));
  return last!;
}

describe("one engine for all five knowledge games", () => {
  const modules = {
    quiz: createQuizModule(POOL),
    "category-pick": createCategoryPickModule(POOL),
    "double-or-nothing": createDoubleModule(POOL),
    bet: createBetModule(POOL),
    steal: createStealModule(POOL),
  };

  it("every game runs on the shared state and answer action", () => {
    for (const [id, mod] of Object.entries(modules)) {
      expect(mod.meta.id).toBe(id);
      expect(GAME_MODULES[id as keyof typeof GAME_MODULES].meta).toBe(mod.meta);
      expect(mod.actionSchema.safeParse({ type: "answer", value: 3 }).success).toBe(true);
      expect(mod.actionSchema.safeParse({ type: "answer", value: 4 }).success).toBe(false);
      const init = mod.init(ctx(T0), { questionCount: 3, scoring: scoringOf(mod.meta), excludeContentIds: [] });
      const state = init.state as AnyState;
      expect(state).toHaveProperty("game");
      expect(["question", "pick", "decide", "wager"]).toContain(state.step);
      expect(state.total).toBe(3);
      // The engine only exposes question, options, correct option (after the reveal) and answers.
      const pub = mod.toPublicState(init.state as never, { role: "host" });
      expect(JSON.stringify(pub)).not.toContain("correctIndex");
    }
  });

  it("the four new games play the quiz questions (content, stats, admin stay under 'quiz')", () => {
    for (const meta of [categoryPickMeta, doubleMeta, betMeta, stealMeta]) {
      expect(meta.contentPool).toBe("quiz");
      expect(GAME_MODULES[meta.id].listContent).toBeUndefined();
    }
    expect(GAME_MODULES.quiz.listContent).toBeDefined();
  });

  it("library order: Punktesammler, Wer ist am nächsten dran?, Kategorienvorgabe, Double or Nothing, Bet, Punkteklau, …", () => {
    expect(CATEGORY_METAS.map((m) => m.name).slice(0, 6)).toEqual([
      "Punktesammler",
      "Wer ist am nächsten dran?",
      "Kategorienvorgabe",
      "Double or Nothing",
      "Bet",
      "Punkteklau",
    ]);
    expect(CATEGORY_METAS.map((m) => m.emoji).slice(0, 6)).toEqual(["🧠", "📏", "🎯", "🎲", "💰", "🦹"]);
    expect(CATEGORY_METAS.map((m) => m.name as string)).not.toContain("Wissensfragen");
  });

  it("every game has meta for Zufall: explanation, timings, all modes", () => {
    for (const meta of [quizMeta, categoryPickMeta, doubleMeta, betMeta, stealMeta]) {
      expect(meta.description.length).toBeGreaterThan(10);
      expect(meta.announceIntro).toBe(true);
      expect(meta.estimatedSecondsPerQuestion).toBeGreaterThanOrEqual(meta.secondsPerQuestion);
      expect(meta.modes).toEqual(["kids", "family", "party"]);
    }
    // The pre-steps are part of the estimate.
    expect(categoryPickMeta.estimatedSecondsPerQuestion).toBeGreaterThan(quizMeta.estimatedSecondsPerQuestion);
    expect(betMeta.estimatedSecondsPerQuestion).toBeGreaterThan(quizMeta.estimatedSecondsPerQuestion);
  });

  it("cap: Punktesammler and Kategorienvorgabe are capped, the risk games are exempt", () => {
    expect(quizMeta).not.toHaveProperty("capExempt");
    expect(categoryPickMeta).not.toHaveProperty("capExempt");
    for (const meta of [doubleMeta, betMeta, stealMeta]) expect(meta.capExempt).toBe(true);
    // Punktesammler with a high base score is capped per question.
    const mod = createQuizModule(POOL);
    const scoring = { ...scoringOf(quizMeta), maxPoints: 500, perQuestionCap: 200 };
    const init = mod.init(ctx(T0), { questionCount: 3, scoring, excludeContentIds: [] });
    const r = answerAndReveal(mod, init.state, { a: "right" });
    expect(r.scoreDelta).toEqual({ a: 200 });
  });

  it("adapter: KnowledgeQuestion view model on top of the stored format", () => {
    const vm = toKnowledgeQuestion(QUIZ_QUESTIONS_DE[0]!);
    expect(vm.id).toBe(QUIZ_QUESTIONS_DE[0]!.id);
    expect(vm.answers).toHaveLength(4);
    expect(vm.answers.find((a) => a.id === vm.correctAnswerId)!.text).toBe(
      QUIZ_QUESTIONS_DE[0]!.options[QUIZ_QUESTIONS_DE[0]!.correctIndex],
    );
  });

  it("a Wissensfragen room saved by the old engine keeps playing", () => {
    const mod = createQuizModule(POOL);
    const init = mod.init(ctx(T0), { questionCount: 2, scoring: scoringOf(quizMeta), excludeContentIds: [] });
    // The state as the Wissensfragen engine stored it (without the newer fields).
    const old: Record<string, unknown> = { ...init.state };
    for (const key of ["total", "stepStartedAt", "mode", "game"]) delete old[key];
    const r = unwrap(mod.handleAction(old as never, { type: "answer", value: init.state.questions[0]!.correctIndex }, "a", ctx(T0 + 1000)));
    expect(r.state.step).toBe("question");
    const revealed = mod.onTimer(r.state, ctx(T0 + 20_000));
    expect(revealed.scoreDelta).toEqual({ a: 100 });
  });

  it("scores never go below 0", () => {
    expect(clampDelta(-200, 150)).toBe(-150);
    expect(clampDelta(-200, 0)).toBe(0);
    expect(clampDelta(-50, 150)).toBe(-50);
    expect(clampDelta(100, 0)).toBe(100);
  });
});

describe("Punktesammler (id quiz)", () => {
  it("+100 for a correct answer, 0 for wrong or none – speed bonus off by default", () => {
    expect(quizMeta.scoring.speedModifier.enabled).toBe(false);
    const mod = createQuizModule(POOL);
    const init = mod.init(ctx(T0), { questionCount: 3, scoring: scoringOf(quizMeta), excludeContentIds: [] });
    const r = answerAndReveal(mod, init.state, { a: "right", b: "wrong" });
    expect(r.scoreDelta).toEqual({ a: 100 });
    expect(r.state.results!.a).toMatchObject({ finalScore: 100, correct: true, speedModifier: 1 });
    expect(r.state.results!.b).toMatchObject({ finalScore: 0, correct: false });
    expect(r.state.results!.c).toBeUndefined();
  });

  it("the host can still switch the speed bonus on", () => {
    const mod = createQuizModule(POOL);
    const scoring = { ...scoringOf(quizMeta), speedModifier: { enabled: true, fastestMultiplier: 1.5, slowestMultiplier: 0.5 } };
    const init = mod.init(ctx(T0), { questionCount: 3, scoring, excludeContentIds: [] });
    const r = answerAndReveal(mod, init.state, { a: "right" }); // after 1 s of 20 s
    expect(r.scoreDelta).toEqual({ a: 145 });
  });

  it("old saved host settings for 'quiz' still load", () => {
    const oldShape = { mode: "absolute", maxPoints: 150, speedModifier: { enabled: true, fastestMultiplier: 1.5, slowestMultiplier: 0.5 } };
    expect(normalizeScoring(quizMeta, oldShape)).toMatchObject({ maxPoints: 150, speedModifier: { enabled: true } });
    // Pre-refactor shapes fall back to the (new) defaults.
    expect(normalizeScoring(quizMeta, { basePoints: 999, speedBonus: true })).toMatchObject({
      maxPoints: 100,
      speedModifier: { enabled: false },
    });
    expect(GAME_MODULES.quiz.meta.name).toBe("Punktesammler");
  });
});

describe("Wer ist am nächsten dran? (id estimate) – only renamed", () => {
  it("keeps id, scoring and settings", () => {
    const est = GAME_MODULES.estimate;
    expect(est.meta.id).toBe("estimate");
    expect(est.meta.name).toBe("Wer ist am nächsten dran?");
    expect(est.meta.emoji).toBe("📏");
    expect(est.meta.scoring).toEqual({
      mode: "proximity",
      maxPoints: 100,
      speedModifier: { enabled: false, fastestMultiplier: 1.5, slowestMultiplier: 0.5 },
    });
    expect(est.meta.secondsPerQuestion).toBe(30);
    expect(est.meta.questionsPerRound).toEqual({ min: 3, default: 6, max: 15 });
  });

  it("regression: the same answers still get the same points", () => {
    const est = createEstimateModule([
      { id: "e1", text: "Wie hoch ist der Eiffelturm?", ageRating: 6, tags: ["t"], difficulty: 1, answer: 330, unit: "m", format: "number", alcohol: false, adult: false },
      { id: "e2", text: "Wann fiel die Mauer?", ageRating: 6, tags: ["t"], difficulty: 1, answer: 1989, unit: "", format: "year", zeroRange: 50, alcohol: false, adult: false },
    ]);
    const players: ModulePlayer[] = ["a", "b", "c", "d"].map((id) => ({ id, connected: true }));
    const expected: Record<string, Record<string, number>> = {
      e1: { a: 97, b: 0, c: 100, d: 50 },
      e2: { a: 80, b: 0, c: 100, d: 98 },
    };
    const answers: Record<string, Record<string, number>> = {
      e1: { a: 320, b: 5000, c: 330, d: 165 },
      e2: { a: 1979, b: 1900, c: 1989, d: 1990 },
    };
    const init = est.init({ now: T0, players, random: seeded() }, { questionCount: 2, scoring: GAME_MODULES.estimate.meta.scoring, excludeContentIds: [] });
    let s = init.state;
    for (let i = 0; i < 2; i++) {
      const id = s.questions[s.index]!.id;
      let u: ModuleUpdate<typeof s> | null = null;
      for (const [pid, value] of Object.entries(answers[id]!)) {
        u = unwrap(est.handleAction(s, { type: "answer", value }, pid, { now: T0 + 4000, players, random: seeded() }));
        s = u.state;
      }
      expect(Object.fromEntries(Object.entries(s.results!).map(([k, r]) => [k, r.finalScore]))).toEqual(expected[id]);
      s = est.onTimer(est.onTimer(s, { now: T0, players, random: seeded() }).state, { now: T0, players, random: seeded() }).state;
    }
  });
});

describe("Kategorienvorgabe", () => {
  const scoring = scoringOf(categoryPickMeta);
  const opts = { questionCount: 4, scoring, excludeContentIds: [] as string[] };

  it("the player in last place picks; the others can't", () => {
    const mod = createCategoryPickModule(POOL);
    const scores = { a: 300, b: 100, c: 200 };
    const init = mod.init(ctx(T0, scores), opts);
    const s = init.state;
    expect(s.step).toBe("pick");
    expect(s.game.pickerId).toBe("b");
    expect(s.game.byLot).toBe(false);
    expect(s.game.offer).toHaveLength(3);
    expect(new Set(s.game.offer).size).toBe(3);
    const pick = s.game.offer[1]!;
    expect(mod.handleAction(s, { type: "pick", category: pick }, "a", ctx(T0 + 500, scores))).toEqual({ error: "NOT_AUTHORIZED" });
    const notOffered = KNOWLEDGE_CATEGORIES.find((c) => !s.game.offer.includes(c))!;
    expect(mod.handleAction(s, { type: "pick", category: notOffered }, "b", ctx(T0 + 500, scores))).toEqual({ error: "INVALID_MESSAGE" });
    const r = unwrap(mod.handleAction(s, { type: "pick", category: pick }, "b", ctx(T0 + 500, scores)));
    // Picked → the question of that category starts right away.
    expect(r.state.step).toBe("question");
    expect(r.state.game.selectedCategory).toBe(pick);
    expect(r.state.game.pickedBy).toBe("picker");
    expect(r.state.questions[0]!.category).toBe(pick);
    expect(r.usedContentIds).toEqual([r.state.questions[0]!.id]);
    expect(mod.toPublicState(r.state, { role: "host" }).category).toBe(pick);
  });

  it("game start and ties: a random player among the last places (by lot)", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 40; seed++) {
      const r = PICKER_STRATEGY_FNS.LAST_PLACE(ctx(T0, {}, PLAYERS, seeded(seed * 100_003)), {});
      expect(r.byLot).toBe(true);
      seen.add(r.pickerId!);
    }
    expect(seen).toEqual(new Set(["a", "b", "c"]));
    const tied = new Set<string>();
    for (let seed = 1; seed < 40; seed++) {
      tied.add(PICKER_STRATEGY_FNS.LAST_PLACE(ctx(T0, {}, PLAYERS, seeded(seed * 100_003)), { a: 50, b: 50, c: 500 }).pickerId!);
    }
    expect(tied).toEqual(new Set(["a", "b"]));
  });

  it("the picker is determined fresh before every question", () => {
    const mod = createCategoryPickModule(POOL);
    let s = mod.init(ctx(T0, { a: 0, b: 100, c: 100 }), opts).state;
    expect(s.game.pickerId).toBe("a");
    s = mod.onTimer(s, ctx(T0 + 12_000, { a: 0, b: 100, c: 100 })).state; // pick timeout
    s = answerAndReveal(mod, s, { a: "right" }, { a: 0, b: 100, c: 100 }).state;
    s = mod.onTimer(s, ctx(T0 + 40_000)).state; // leaderboard
    s = mod.onTimer(s, ctx(T0 + 50_000, { a: 100, b: 100, c: 50 })).state; // next question
    expect(s.step).toBe("pick");
    expect(s.game.pickerId).toBe("c");
  });

  it("no pick in time → a random card from the offer", () => {
    const mod = createCategoryPickModule(POOL);
    const s = mod.init(ctx(T0, { a: 10, b: 20, c: 30 }), opts).state;
    const r = mod.onTimer(s, ctx(T0 + 12_000));
    expect(r.state.step).toBe("question");
    expect(r.state.game.pickedBy).toBe("random");
    expect(s.game.offer).toContain(r.state.game.selectedCategory);
    expect(r.state.questions[0]!.category).toBe(r.state.game.selectedCategory);
  });

  it("the picker's phone sees the cards, the others only who picks", () => {
    const mod = createCategoryPickModule(POOL);
    const s = mod.init(ctx(T0, { a: 10, b: 20, c: 30 }), opts).state;
    const pub = mod.toPublicState(s, { role: "player", playerId: "b" });
    expect(pub.question).toBeNull();
    expect(pub.extra).toMatchObject({ pickerId: "a", offer: s.game.offer, selectedCategory: null });
  });

  it("host strategy: the host screen picks", () => {
    const mod = createCategoryPickModule(POOL);
    const s = mod.init(ctx(T0), { ...opts, options: { hostPicks: true } }).state;
    expect(s.game.pickerId).toBe(HOST_ACTOR_ID);
    expect(mod.handleAction(s, { type: "pick", category: s.game.offer[0]! }, "a", ctx(T0))).toEqual({ error: "NOT_AUTHORIZED" });
    const r = unwrap(mod.handleAction(s, { type: "pick", category: s.game.offer[0]! }, HOST_ACTOR_ID, ctx(T0)));
    expect(r.state.game.selectedCategory).toBe(s.game.offer[0]);
  });

  it("scores like Punktesammler (+100 / 0)", () => {
    const mod = createCategoryPickModule(POOL);
    let s = mod.init(ctx(T0), opts).state;
    s = mod.onTimer(s, ctx(T0 + 12_000)).state;
    const r = answerAndReveal(mod, s, { a: "right", b: "wrong" });
    expect(r.scoreDelta).toEqual({ a: 100 });
  });

  it("offers only categories with questions for the mode's filter", () => {
    const pool = [
      q("sport-kids", "SPORTS"),
      q("music-kids", "MUSIC"),
      q("games-kids", "GAMES"),
      q("history-adult", "HISTORY", { ageRating: 12 }),
      q("science-hard", "SCIENCE", { difficulty: 3 }),
    ];
    const mod = createCategoryPickModule(pool);
    const kids: GameModeSettings = { mode: "kids", allow16: false, difficulty: "mixed" };
    const s = mod.init(ctx(T0), { ...opts, mode: kids }).state;
    expect([...s.game.offer].sort()).toEqual(["GAMES", "MUSIC", "SPORTS"]);
  });

  it("roast lines: pick, after the pick, own category wrong (Kids: friendly)", () => {
    const mod = createCategoryPickModule(POOL);
    const scores = { a: 0, b: 100, c: 200 };
    for (const mode of ["family", "kids"] as const) {
      const s0 = mod.init(ctx(T0, scores), { ...opts, mode: { mode, allow16: false, difficulty: "mixed" } }).state;
      const pickLine = mod.readAloud!(s0)!.items[0]!.text;
      expect(pickLine).toContain("Clara");
      const r = unwrap(mod.handleAction(s0, { type: "pick", category: s0.game.offer[0]! }, "a", ctx(T0, scores)));
      const after = mod.readAloud!(r.state)!.items[0]!.text;
      expect(after).toContain(KNOWLEDGE_CATEGORY_LABELS[s0.game.offer[0]!]);
      const wrong = answerAndReveal(mod, r.state, { a: "wrong" }, scores);
      const roast = mod.readAloud!(wrong.state)!.items[0]!.text;
      expect(roast).toContain("Clara");
      if (mode === "family") expect(roast).toBe("Selbst ausgesucht und trotzdem falsch – Respekt, Clara.");
      else expect(roast).not.toContain("Respekt");
      for (const line of [pickLine, after, roast]) expect(line.split(/\s+/).length).toBeLessThanOrEqual(14);
      const facts = mod.revealFacts!(wrong.state)!;
      expect(facts.answers.a!.note).toContain("selbst ausgesucht und trotzdem falsch");
    }
  });
});

describe("Double or Nothing", () => {
  const scoring = scoringOf(doubleMeta);

  function setup(decisions: Record<string, "normal" | "double">) {
    const mod = createDoubleModule(POOL);
    let s = mod.init(ctx(T0), { questionCount: 3, scoring, excludeContentIds: [] }).state;
    expect(s.step).toBe("decide");
    for (const [id, mode] of Object.entries(decisions)) {
      const r = unwrap(mod.handleAction(s, { type: "risk", mode }, id, ctx(T0 + 500)));
      s = r.state;
    }
    if (s.step === "decide") s = mod.onTimer(s, ctx(T0 + 8000)).state;
    return { mod, s };
  }

  it("all four cases: NORMAL right/wrong, DOUBLE right/wrong", () => {
    const { mod, s } = setup({ a: "normal", b: "normal", c: "double" });
    expect(s.step).toBe("question");
    const r = answerAndReveal(mod, s, { a: "right", b: "wrong", c: "right" }, { a: 0, b: 0, c: 0 });
    expect(r.scoreDelta).toEqual({ a: 100, c: 200 });
    const { mod: mod2, s: s2 } = setup({ a: "double" });
    const r2 = answerAndReveal(mod2, s2, { a: "wrong" }, { a: 500 });
    expect(r2.scoreDelta).toEqual({ a: -200 });
    expect(r2.state.results!.a).toMatchObject({ finalScore: -200, correct: false });
  });

  it("DOUBLE without an answer counts as wrong; the total never goes below 0", () => {
    const { mod, s } = setup({ a: "double", b: "double" });
    const r = answerAndReveal(mod, s, { b: "wrong" }, { a: 50, b: 0 });
    expect(r.scoreDelta).toEqual({ a: -50 });
    expect(r.state.results!.b!.finalScore).toBe(0);
  });

  it("no decision → NORMAL (timeout)", () => {
    const { mod, s } = setup({});
    const r = answerAndReveal(mod, s, { a: "right", b: "wrong" });
    expect(r.scoreDelta).toEqual({ a: 100 });
    const pub = mod.toPublicState(r.state, { role: "host" });
    expect(pub.extra).toMatchObject({ decisions: {} });
  });

  it("decisions stay secret until the reveal; the step ends when everyone decided", () => {
    const mod = createDoubleModule(POOL);
    let s: KnowledgeState<DoubleGame> = mod.init(ctx(T0), { questionCount: 3, scoring, excludeContentIds: [] }).state;
    s = unwrap(mod.handleAction(s, { type: "risk", mode: "double" }, "a", ctx(T0))).state;
    expect(mod.handleAction(s, { type: "risk", mode: "normal" }, "a", ctx(T0))).toEqual({ error: "ALREADY_ANSWERED" });
    const other = mod.toPublicState(s, { role: "player", playerId: "b" });
    expect(other.extra).toMatchObject({ decisions: null, myDecision: null });
    expect(other.actedPlayerIds).toEqual(["a"]);
    expect(mod.toPublicState(s, { role: "player", playerId: "a" }).extra).toMatchObject({ myDecision: "double" });
    s = unwrap(mod.handleAction(s, { type: "risk", mode: "normal" }, "b", ctx(T0))).state;
    s = unwrap(mod.handleAction(s, { type: "risk", mode: "normal" }, "c", ctx(T0))).state;
    expect(s.step).toBe("question");
    const r = answerAndReveal(mod, s, { a: "right" });
    expect(mod.toPublicState(r.state, { role: "guest" }).extra).toMatchObject({ decisions: { a: "double", b: "normal", c: "normal" } });
    expect(mod.readAloud!(r.state)!.items[0]!.text).toContain("Clara");
  });

  it("amounts are configurable", () => {
    const mod = createDoubleModule(POOL);
    const custom = { ...scoring, points: { normal: 50, double: 300, doubleLoss: 100 } };
    let s = mod.init(ctx(T0), { questionCount: 3, scoring: custom, excludeContentIds: [] }).state;
    s = unwrap(mod.handleAction(s, { type: "risk", mode: "double" }, "a", ctx(T0))).state;
    s = mod.onTimer(s, ctx(T0 + 8000)).state;
    expect(answerAndReveal(mod, s, { a: "right", b: "right" }).scoreDelta).toEqual({ a: 300, b: 50 });
  });
});

describe("Bet", () => {
  const scoring = scoringOf(betMeta);

  function start(scores: Record<string, number>) {
    const mod = createBetModule(POOL);
    const s = mod.init(ctx(T0, scores), { questionCount: 3, scoring, excludeContentIds: [] }).state;
    return { mod, s };
  }

  it("shows the category before the wager, the question only afterwards", () => {
    const { mod, s } = start({});
    expect(s.step).toBe("wager");
    const pub = mod.toPublicState(s, { role: "player", playerId: "a" });
    expect(pub.category).toBe(s.questions[0]!.category);
    expect(pub.question).toBeNull();
    expect(mod.readAloud!(s)!.items[0]!.text).toContain(KNOWLEDGE_CATEGORY_LABELS[s.questions[0]!.category!]);
  });

  it("max wager = max(score, 100): a 0-score player may bet 100; above the max is rejected", () => {
    const { mod, s } = start({ a: 0, b: 40, c: 350 });
    expect(s.game.maxWagers).toEqual({ a: 100, b: 100, c: 350 });
    expect(mod.handleAction(s, { type: "wager", amount: 101 }, "a", ctx(T0))).toEqual({ error: "INVALID_MESSAGE" });
    expect(mod.actionSchema.safeParse({ type: "wager", amount: 0 }).success).toBe(false);
    expect(mod.actionSchema.safeParse({ type: "wager", amount: 12.5 }).success).toBe(false);
    const r = unwrap(mod.handleAction(s, { type: "wager", amount: 100 }, "a", ctx(T0)));
    expect(r.state.game.wagers.a).toBe(100);
  });

  it("presets, custom amount and ALL IN: correct +wager, wrong −wager, never below 0", () => {
    const scores = { a: 0, b: 40, c: 350 };
    const { mod, s: s0 } = start(scores);
    let s: KnowledgeState<BetGame> = s0;
    for (const [id, amount] of [["a", 100], ["b", 73], ["c", 350]] as const) {
      s = unwrap(mod.handleAction(s, { type: "wager", amount }, id, ctx(T0, scores))).state;
    }
    expect(s.step).toBe("question");
    const r = answerAndReveal(mod, s, { a: "right", b: "wrong", c: "wrong" }, scores);
    // a wins 100; b loses 73 but only has 40; c goes ALL IN and loses everything.
    expect(r.scoreDelta).toEqual({ a: 100, b: -40, c: -350 });
    expect(mod.toPublicState(r.state, { role: "host" }).extra).toMatchObject({ wagers: { a: 100, b: 73, c: 350 } });
    expect(mod.revealFacts!(r.state)!.answers.c!.note).toContain("ALL IN");
    expect(mod.readAloud!(r.state)!.items[0]!.text).toContain("Philip");
  });

  it("no wager in time → 50 (or the maximum if lower); no answer → −wager", () => {
    const { mod, s } = start({ a: 500 });
    const lowFloor = createBetModule(POOL).init(ctx(T0, { a: 0 }), {
      questionCount: 3,
      scoring: { ...scoring, points: { defaultWager: 50, wagerFloor: 30 } },
      excludeContentIds: [],
    }).state;
    const timed = mod.onTimer(s, ctx(T0 + 12_000, { a: 500 })).state;
    expect(timed.game.wagers).toEqual({ a: 50, b: 50, c: 50 });
    expect(mod.onTimer(lowFloor, ctx(T0 + 12_000, { a: 0 })).state.game.wagers.a).toBe(30);
    const r = answerAndReveal(mod, timed, { a: "right" }, { a: 500, b: 100, c: 0 });
    expect(r.scoreDelta).toEqual({ a: 50, b: -50 });
  });

  it("wagers stay secret until the reveal", () => {
    const { mod, s } = start({ a: 500 });
    const r = unwrap(mod.handleAction(s, { type: "wager", amount: 200 }, "a", ctx(T0)));
    expect(mod.toPublicState(r.state, { role: "player", playerId: "b" }).extra).toMatchObject({ wagers: null, myWager: null });
    expect(mod.toPublicState(r.state, { role: "player", playerId: "a" }).extra).toMatchObject({ myWager: 200 });
    expect(mod.handleAction(r.state, { type: "wager", amount: 50 }, "a", ctx(T0))).toEqual({ error: "ALREADY_ANSWERED" });
  });

  it("disconnected players sit a question out instead of losing the default wager", () => {
    const players: ModulePlayer[] = [PLAYERS[0]!, { ...PLAYERS[1]!, connected: false }];
    const mod = createBetModule(POOL);
    const s = mod.init(ctx(T0, {}, players), { questionCount: 3, scoring, excludeContentIds: [] }).state;
    const timed = mod.onTimer(s, ctx(T0 + 12_000, {}, players)).state;
    expect(timed.game.wagers).toEqual({ a: 50 });
  });
});

describe("Punkteklau", () => {
  const scoring = scoringOf(stealMeta);
  const points = { steal: 100, defendBonus: 0, correct: 100 };

  function setup(scores: Record<string, number>, players = PLAYERS) {
    const mod = createStealModule(POOL);
    const s = mod.init(ctx(T0, scores, players), { questionCount: 3, scoring, excludeContentIds: [] }).state;
    return { mod, s };
  }

  it("leader wrong → every correct player steals 100 from the leader", () => {
    const { mod, s } = setup({ a: 1500, b: 200, c: 100 });
    expect(s.game.targetIds).toEqual(["a"]);
    expect(mod.toPublicState(s, { role: "host" }).extra).toMatchObject({ targetIds: ["a"], targetScore: 1500 });
    expect(mod.readAloud!(s)!.items[0]!.text).toMatch(/Clara/);
    const r = answerAndReveal(mod, s, { a: "wrong", b: "right", c: "right" }, { a: 1500, b: 200, c: 100 });
    expect(r.scoreDelta).toEqual({ a: -200, b: 100, c: 100 });
    expect(r.state.game.outcome).toEqual({ defended: false, stolen: { b: 100, c: 100 }, lost: { a: 200 } });
  });

  it("leader correct → protected, nobody steals (defend bonus configurable)", () => {
    const { mod, s } = setup({ a: 500, b: 200, c: 100 });
    const r = answerAndReveal(mod, s, { a: "right", b: "right", c: "right" }, { a: 500, b: 200, c: 100 });
    expect(r.scoreDelta).toEqual({});
    expect(r.state.game.outcome?.defended).toBe(true);
    const bonus = computeSteal(
      { question: s.questions[0]!, answers: { a: { value: s.questions[0]!.correctIndex, at: 0 } }, playerIds: ["a", "b"], scores: { a: 500 } },
      ["a"],
      { ...points, defendBonus: 50 },
    );
    expect(bonus.results.a!.finalScore).toBe(50);
  });

  it("no answer from the leader counts as wrong; wrong answers of others: 0", () => {
    const { mod, s } = setup({ a: 500, b: 200, c: 100 });
    const r = answerAndReveal(mod, s, { b: "right", c: "wrong" }, { a: 500, b: 200, c: 100 });
    expect(r.scoreDelta).toEqual({ a: -100, b: 100 });
  });

  it("total stolen is capped at the leader's score – split evenly between the thieves", () => {
    const players: ModulePlayer[] = ["a", "b", "c", "d", "e"].map((id) => ({ id, connected: true, name: id }));
    const scores = { a: 150, b: 0, c: 0, d: 0, e: 0 };
    const { mod, s } = setup(scores, players);
    const r = answerAndReveal(mod, s, { a: "wrong", b: "right", c: "right", d: "right", e: "right" }, scores, players);
    // 4 thieves × 100 > 150 → 37 each (rounded down), the leader loses 148.
    expect(r.scoreDelta).toEqual({ a: -148, b: 37, c: 37, d: 37, e: 37 });
  });

  it("tied leaders: both are targets; a thief's amount is split between the wrong ones", () => {
    const scores = { a: 300, b: 300, c: 0 };
    const { mod, s } = setup(scores);
    expect(s.game.targetIds).toEqual(["a", "b"]);
    const r = answerAndReveal(mod, s, { a: "wrong", b: "wrong", c: "right" }, scores);
    expect(r.scoreDelta).toEqual({ a: -50, b: -50, c: 100 });
    const { mod: mod2, s: s2 } = setup(scores);
    const r2 = answerAndReveal(mod2, s2, { a: "right", b: "wrong", c: "right" }, scores);
    // a is protected, c steals the full amount from b.
    expect(r2.scoreDelta).toEqual({ b: -100, c: 100 });
  });

  it("nobody has points → plays like Punktesammler (+100)", () => {
    const { mod, s } = setup({ a: 0, b: 0, c: 0 });
    expect(s.game.targetIds).toEqual([]);
    const r = answerAndReveal(mod, s, { a: "right", b: "wrong" });
    expect(r.scoreDelta).toEqual({ a: 100 });
    expect(r.state.game.outcome).toBeNull();
  });

  it("the leader is determined fresh before every question", () => {
    const { mod, s } = setup({ a: 300, b: 100, c: 0 });
    expect(s.game.targetIds).toEqual(["a"]);
    const revealed = answerAndReveal(mod, s, { a: "wrong", b: "right", c: "right" }, { a: 300, b: 100, c: 0 });
    const board = mod.onTimer(revealed.state, ctx(T0 + 40_000));
    // The room applied the delta: a 100, b 200, c 100 → b leads now.
    const next = mod.onTimer(board.state, ctx(T0 + 50_000, { a: 100, b: 200, c: 100 }));
    expect(next.state.step).toBe("question");
    expect((next.state as KnowledgeState<StealGame>).game.targetIds).toEqual(["b"]);
    expect((next.state as KnowledgeState<StealGame>).game.targetScore).toBe(200);
  });
});

describe("party share", () => {
  const family = Array.from({ length: 40 }, (_, i) => q(`fam-${i}`, "HISTORY"));
  const party = Array.from({ length: 40 }, (_, i) => q(`party-${i}`, "HISTORY", { adult: true, ageRating: 18 }));
  const partyMode: GameModeSettings = { mode: "party", allow16: false, difficulty: "mixed" };

  it("party mode: ~30 % party questions when there are enough", () => {
    const picked = selectQuestions([...family, ...party], 10, { mode: partyMode, excludeContentIds: [] }, seeded());
    expect(picked).toHaveLength(10);
    expect(picked.filter((x) => x.adult)).toHaveLength(3);
  });

  it("not enough party questions → the family pool fills up (none yet: all family)", () => {
    const few = selectQuestions([...family, ...party.slice(0, 1)], 10, { mode: partyMode, excludeContentIds: [] }, seeded());
    expect(few.filter((x) => x.adult)).toHaveLength(1);
    expect(few).toHaveLength(10);
    const none = selectQuestions(family, 10, { mode: partyMode, excludeContentIds: [] }, seeded());
    expect(none).toHaveLength(10);
  });

  it("the share is configurable; family/kids never get party questions", () => {
    expect(selectQuestions([...family, ...party], 10, { mode: partyMode, excludeContentIds: [] }, seeded(), 0.5).filter((x) => x.adult)).toHaveLength(5);
    const mod = createQuizModule([...family, ...party]);
    for (const mode of ["family", "kids"] as const) {
      const s = mod.init(ctx(T0), {
        questionCount: 10,
        scoring: scoringOf(quizMeta),
        excludeContentIds: [],
        mode: { mode, allow16: true, difficulty: "mixed" },
      }).state;
      expect(s.questions.every((x) => x.id.startsWith("fam-"))).toBe(true);
    }
  });

  it("kids mode plays the child-friendly questions via eligibleForMode", () => {
    const kids: GameModeSettings = { mode: "kids", allow16: false, difficulty: "mixed" };
    const mod = createQuizModule();
    const s = mod.init(ctx(T0), { questionCount: 20, scoring: scoringOf(quizMeta), excludeContentIds: [], mode: kids }).state;
    const byId = new Map(QUIZ_QUESTIONS_DE.map((x) => [x.id, x]));
    for (const x of s.questions) expect(eligibleForMode(byId.get(x.id)!, kids, quizMeta)).toBe(true);
    expect(QUIZ_QUESTIONS_DE.filter((x) => eligibleForMode(x, kids, quizMeta)).length).toBeGreaterThan(250);
  });
});
