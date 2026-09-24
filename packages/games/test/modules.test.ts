import {
  REVEAL_ANSWER_MS,
  REVEAL_LEADERBOARD_MS,
  type ModuleContext,
  type ModulePlayer,
  type ScoringSettings,
} from "@couch-clash/shared";
import { ESTIMATE_QUESTIONS_DE, QUIZ_QUESTIONS_DE } from "@couch-clash/content";
import { describe, expect, it } from "vitest";
import { CATEGORY_METAS, GAME_MODULES, quizMeta } from "../src";
import { createEstimateModule } from "../src/estimate/module";
import type { QuestionRoundState } from "../src/question-round/engine";
import { createQuizModule, prepareQuizQuestion, type PreparedQuizQuestion } from "../src/quiz/module";
import { pickFresh } from "../src/random";

const T0 = 1_700_000_000_000;
const scoring: ScoringSettings = { basePoints: 100, speedBonus: true, minPercent: 10, estimateScale: "distance" };

function seeded(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function ctx(now: number, players: ModulePlayer[], random = seeded()): ModuleContext {
  return { now, players, random };
}

const ALL_ON: ModulePlayer[] = [
  { id: "a", connected: true },
  { id: "b", connected: true },
];

type QuizState = QuestionRoundState<PreparedQuizQuestion, number>;

function setup(players = ALL_ON, questionCount = 3) {
  const mod = createQuizModule();
  const init = mod.init(ctx(T0, players), { questionCount, scoring, excludeContentIds: [] });
  return { mod, init, state: init.state };
}

describe("registry", () => {
  it("has a module for every category meta and ids match", () => {
    for (const meta of CATEGORY_METAS) {
      const mod = GAME_MODULES[meta.id];
      expect(mod.meta).toBe(meta);
      expect(meta.questionsPerRound.min).toBeLessThanOrEqual(meta.questionsPerRound.default);
      expect(meta.questionsPerRound.default).toBeLessThanOrEqual(meta.questionsPerRound.max);
    }
  });

  it("has enough content for the maximum questions per round", () => {
    expect(QUIZ_QUESTIONS_DE.length).toBeGreaterThanOrEqual(GAME_MODULES.quiz.meta.questionsPerRound.max);
    expect(ESTIMATE_QUESTIONS_DE.length).toBeGreaterThanOrEqual(
      GAME_MODULES.estimate.meta.questionsPerRound.max,
    );
  });
});

describe("question round transitions", () => {
  it("init opens question 1 with the category timer", () => {
    const { init, state } = setup();
    expect(state.step).toBe("question");
    expect(state.index).toBe(0);
    expect(init.phaseEndsAt).toBe(T0 + quizMeta.secondsPerQuestion * 1000);
    expect(init.usedContentIds).toHaveLength(3);
  });

  it("question → reveal → leaderboard → next question → … → done", () => {
    const { mod, init } = setup(ALL_ON, 2);
    let s: QuizState = init.state;
    let now = T0 + 20_000;
    let u = mod.onTimer(s, ctx(now, ALL_ON));
    expect(u.state.step).toBe("reveal");
    expect(u.phaseEndsAt).toBe(now + REVEAL_ANSWER_MS);
    expect(u.scoreDelta).toEqual({}); // nobody answered, but always present
    s = u.state;
    u = mod.onTimer(s, ctx((now += REVEAL_ANSWER_MS), ALL_ON));
    expect(u.state.step).toBe("leaderboard");
    expect(u.phaseEndsAt).toBe(now + REVEAL_LEADERBOARD_MS);
    expect(u.scoreDelta).toBeUndefined(); // points are only awarded once
    u = mod.onTimer(u.state, ctx((now += REVEAL_LEADERBOARD_MS), ALL_ON));
    expect(u.state.step).toBe("question");
    expect(u.state.index).toBe(1);
    expect(u.state.answers).toEqual({});
    for (let i = 0; i < 2; i++) u = mod.onTimer(u.state, ctx((now += 1000), ALL_ON));
    expect(u.state.step).toBe("leaderboard");
    u = mod.onTimer(u.state, ctx((now += 1000), ALL_ON));
    expect(u.done).toBe(true);
    expect(u.phaseEndsAt).toBeNull();
  });

  it("keeps the solution visible during the leaderboard step", () => {
    const { mod, state } = setup();
    const revealed = mod.onTimer(state, ctx(T0 + 20_000, ALL_ON)).state;
    const board = mod.onTimer(revealed, ctx(T0 + 23_000, ALL_ON)).state;
    const pub = mod.toPublicState(board, { role: "host" });
    expect(pub.step).toBe("leaderboard");
    expect(pub.reveal?.solution.correctIndex).toBe(state.questions[0]!.correctIndex);
  });

  it("ends the question early when all connected players answered, and scores", () => {
    const { mod, state } = setup();
    const correct = state.questions[0]!.correctIndex;
    const r1 = mod.handleAction(state, { type: "answer", value: correct }, "a", ctx(T0 + 2000, ALL_ON));
    if ("error" in r1) throw new Error(r1.error);
    expect(r1.state.step).toBe("question");
    const r2 = mod.handleAction(r1.state, { type: "answer", value: (correct + 1) % 4 }, "b", ctx(T0 + 3000, ALL_ON));
    if ("error" in r2) throw new Error(r2.error);
    expect(r2.state.step).toBe("reveal");
    expect(r2.scoreDelta).toEqual({ a: 100 });
  });

  it("disconnected players don't block the early end", () => {
    const players = [
      { id: "a", connected: true },
      { id: "b", connected: false },
    ];
    const { mod, state } = setup(players);
    const r = mod.handleAction(state, { type: "answer", value: 0 }, "a", ctx(T0 + 1000, players));
    if ("error" in r) throw new Error(r.error);
    expect(r.state.step).toBe("reveal");
  });

  it("onPlayersChanged reveals when the last missing player disconnects", () => {
    const { mod, state } = setup();
    const r = mod.handleAction(state, { type: "answer", value: 0 }, "a", ctx(T0 + 1000, ALL_ON));
    if ("error" in r) throw new Error(r.error);
    const stillWaiting = mod.onPlayersChanged!(r.state, ctx(T0 + 2000, ALL_ON));
    expect(stillWaiting).toBeNull();
    const changed = mod.onPlayersChanged!(r.state, ctx(T0 + 2000, [ALL_ON[0]!, { id: "b", connected: false }]));
    expect(changed!.state.step).toBe("reveal");
  });

  it("does not reveal early when nobody is connected", () => {
    const { mod, state } = setup();
    const offline = ALL_ON.map((p) => ({ ...p, connected: false }));
    expect(mod.onPlayersChanged!(state, ctx(T0 + 1000, offline))).toBeNull();
  });

  it("rejects second answers, late answers, unknown players and answers during reveal", () => {
    const { mod, state } = setup();
    const r = mod.handleAction(state, { type: "answer", value: 0 }, "a", ctx(T0 + 1000, ALL_ON));
    if ("error" in r) throw new Error(r.error);
    expect(mod.handleAction(r.state, { type: "answer", value: 1 }, "a", ctx(T0 + 1500, ALL_ON))).toEqual({
      error: "ALREADY_ANSWERED",
    });
    expect(
      mod.handleAction(state, { type: "answer", value: 0 }, "b", ctx(T0 + 20_001, ALL_ON)),
    ).toEqual({ error: "TOO_LATE" });
    expect(mod.handleAction(state, { type: "answer", value: 0 }, "x", ctx(T0 + 1000, ALL_ON))).toEqual({
      error: "UNKNOWN_PLAYER",
    });
    const revealed = mod.onTimer(state, ctx(T0 + 20_000, ALL_ON)).state;
    expect(mod.handleAction(revealed, { type: "answer", value: 0 }, "b", ctx(T0 + 21_000, ALL_ON))).toEqual({
      error: "WRONG_PHASE",
    });
  });

  it("validates actions with zod", () => {
    const mod = createQuizModule();
    expect(mod.actionSchema.safeParse({ type: "answer", value: 2 }).success).toBe(true);
    expect(mod.actionSchema.safeParse({ type: "answer", value: 4 }).success).toBe(false);
    expect(mod.actionSchema.safeParse({ type: "answer", value: "1" }).success).toBe(false);
    const est = createEstimateModule();
    expect(est.actionSchema.safeParse({ type: "answer", value: 3.5 }).success).toBe(true);
    expect(est.actionSchema.safeParse({ type: "answer", value: Infinity }).success).toBe(false);
  });
});

describe("per-viewer public state never leaks answers", () => {
  it("hides the solution and others' answers before the reveal", () => {
    const { mod, state } = setup();
    const r = mod.handleAction(state, { type: "answer", value: 2 }, "a", ctx(T0 + 1000, ALL_ON));
    if ("error" in r) throw new Error(r.error);

    for (const viewer of [{ role: "host" } as const, { role: "guest" } as const, { role: "player", playerId: "b" } as const]) {
      const pub = mod.toPublicState(r.state, viewer);
      const json = JSON.stringify(pub);
      expect(json).not.toContain("correctIndex");
      expect(pub.reveal).toBeNull();
      expect(pub.myAnswer).toBeNull();
      expect(pub.answeredPlayerIds).toEqual(["a"]);
    }
    // The answering player sees only their own answer.
    const own = mod.toPublicState(r.state, { role: "player", playerId: "a" });
    expect(own.myAnswer).toBe(2);
    expect(own.reveal).toBeNull();
  });

  it("estimate: the correct number is not in the question state", () => {
    const est = createEstimateModule();
    const init = est.init(ctx(T0, ALL_ON), { questionCount: 5, scoring, excludeContentIds: [] });
    const q = (init.state as unknown as QuestionRoundState<{ answer: number; fact?: string }, number>).questions[0]!;
    const pub = JSON.stringify(est.toPublicState(init.state, { role: "host" }));
    expect(pub).not.toContain('"answer"');
    if (q.fact) expect(pub).not.toContain(q.fact);
  });

  it("shows solution, answers and results after the reveal", () => {
    const { mod, state } = setup();
    const r = mod.handleAction(state, { type: "answer", value: 2 }, "a", ctx(T0 + 1000, ALL_ON));
    if ("error" in r) throw new Error(r.error);
    const revealed = mod.onTimer(r.state, ctx(T0 + 20_000, ALL_ON)).state;
    const pub = mod.toPublicState(revealed, { role: "player", playerId: "b" });
    expect(pub.reveal!.solution.correctIndex).toBe(state.questions[0]!.correctIndex);
    expect(pub.reveal!.answers).toEqual({ a: 2 });
  });
});

describe("content selection", () => {
  it("never repeats a question within a round", () => {
    for (let seed = 1; seed < 30; seed++) {
      const mod = createQuizModule();
      const init = mod.init(ctx(T0, ALL_ON, seeded(seed)), {
        questionCount: 20,
        scoring,
        excludeContentIds: [],
      });
      const ids = init.state.questions.map((q) => q.id);
      expect(new Set(ids).size).toBe(20);
    }
  });

  it("prefers questions not played before in this room", () => {
    const pool = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}` }));
    const exclude = ["q0", "q1", "q2", "q3", "q4", "q5"];
    const picked = pickFresh(pool, 4, exclude, seeded()).map((q) => q.id);
    expect(picked.sort()).toEqual(["q6", "q7", "q8", "q9"]);
    // Not enough fresh questions → fills up with used ones, still no duplicates.
    const more = pickFresh(pool, 7, exclude, seeded()).map((q) => q.id);
    expect(new Set(more).size).toBe(7);
    expect(more.slice(0, 4).sort()).toEqual(["q6", "q7", "q8", "q9"]);
  });

  it("shuffles quiz options but keeps the correct answer", () => {
    const q = QUIZ_QUESTIONS_DE[0]!;
    const seen = new Set<number>();
    for (let seed = 1; seed < 40; seed++) {
      const p = prepareQuizQuestion(q, seeded(seed));
      expect(p.options[p.correctIndex]).toBe(q.options[q.correctIndex]);
      expect([...p.options].sort()).toEqual([...q.options].sort());
      seen.add(p.correctIndex);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
