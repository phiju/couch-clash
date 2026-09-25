import { ESTIMATE_QUESTIONS_DE, QUIZ_QUESTIONS_DE } from "@couch-clash/content";
import type { ModuleContext, ModulePlayer, ScoringSettings } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { createEstimateModule } from "../src/estimate/module";
import { createQuizModule } from "../src/quiz/module";

const T0 = 1_700_000_000_000;
const scoring: ScoringSettings = {
  mode: "absolute",
  maxPoints: 100,
  speedModifier: { enabled: false, fastestMultiplier: 1.5, slowestMultiplier: 0.5 },
};
const PLAYERS: ModulePlayer[] = [
  { id: "a", connected: true },
  { id: "b", connected: true },
  { id: "c", connected: true },
];
const ctx = (now: number, random = () => 0.3): ModuleContext => ({ now, players: PLAYERS, random });

type AnswerModule<S> = { handleAction: (s: S, a: { type: "answer"; value: number }, p: string, c: ModuleContext) => unknown };

function answer<S>(mod: AnswerModule<S>, s: S, value: number, p: string, at: number): S {
  const r = mod.handleAction(s, { type: "answer", value }, p, ctx(at)) as { state: S } | { error: string };
  if ("error" in r) throw new Error(r.error);
  return r.state;
}

describe("toStats", () => {
  it("quiz: counts answers, correct ones and response time – no names", () => {
    const mod = createQuizModule();
    let s = mod.init(ctx(T0), { questionCount: 3, scoring, excludeContentIds: [] }).state;
    expect(mod.toStats!(s)).toBeNull(); // not revealed yet
    const correct = s.questions[0]!.correctIndex;
    s = answer(mod, s, correct, "a", T0 + 2000);
    s = answer(mod, s, (correct + 1) % 4, "b", T0 + 4000);
    s = answer(mod, s, correct, "c", T0 + 6000);
    expect(s.step).toBe("reveal");
    const stats = mod.toStats!(s)!;
    expect(stats).toEqual({ contentId: s.questions[0]!.id, answers: 3, correct: 2, sumResponseMs: 12_000, sumErrorPct: null });
    expect(JSON.stringify(stats)).not.toMatch(/"a"|"b"|"c"/);
    expect(mod.progress!(s)).toMatchObject({ contentId: s.questions[0]!.id, revealed: true });
  });

  it("nobody answered → zero answers after the timer", () => {
    const mod = createQuizModule();
    const s = mod.init(ctx(T0), { questionCount: 3, scoring, excludeContentIds: [] }).state;
    const revealed = mod.onTimer(s, ctx(T0 + 60_000)).state;
    expect(mod.toStats!(revealed)).toMatchObject({ answers: 0, correct: 0, sumResponseMs: 0 });
  });

  it("estimate: sums the error share, capped at 100 %", () => {
    const q = { ...ESTIMATE_QUESTIONS_DE[0]!, answer: 100, zeroRange: undefined, format: "number" as const };
    const mod = createEstimateModule([q]);
    let s = mod.init(ctx(T0), { questionCount: 1, scoring, excludeContentIds: [] }).state;
    s = answer(mod, s, 100, "a", T0 + 1000); // exact
    s = answer(mod, s, 150, "b", T0 + 1000); // 50 % off
    s = answer(mod, s, 1000, "c", T0 + 1000); // 900 % off → capped at 1
    const stats = mod.toStats!(s)!;
    expect(stats.correct).toBe(1);
    expect(stats.sumErrorPct).toBe(1.5);
  });
});

describe("blocked and generated content", () => {
  it("never selects a blocked question", () => {
    const pool = QUIZ_QUESTIONS_DE.slice(0, 6);
    const mod = createQuizModule(pool);
    const blocked = new Set(pool.slice(0, 3).map((q) => q.id));
    for (let seed = 0; seed < 30; seed++) {
      const s = mod.init(ctx(T0, () => (seed * 0.031) % 1), {
        questionCount: 3,
        scoring,
        excludeContentIds: [],
        blockedContentIds: blocked,
      }).state;
      for (const q of s.questions) expect(blocked.has(q.id)).toBe(false);
    }
  });

  it("merges valid generated questions and skips invalid ones", () => {
    const mod = createQuizModule(QUIZ_QUESTIONS_DE.slice(0, 1));
    const generated = {
      id: "quiz-gen-abc",
      text: "Welche Farbe hat eine reife Banane?",
      ageRating: 6,
      tags: ["essen"],
      difficulty: 1,
      options: ["Gelb", "Blau", "Lila", "Schwarz"],
      correctIndex: 0,
    };
    const invalid = { ...generated, id: "quiz-gen-bad", options: ["A", "A", "B", "C"] };
    const s = mod.init(ctx(T0), {
      questionCount: 3,
      scoring,
      excludeContentIds: [],
      extraContent: [generated, invalid, "garbage"],
    }).state;
    expect(s.questions.map((q) => q.id).sort()).toEqual([QUIZ_QUESTIONS_DE[0]!.id, "quiz-gen-abc"].sort());
    expect(mod.listContent!([generated, invalid]).map((e) => e.id)).toContain("quiz-gen-abc");
    expect(mod.parseContent!(invalid).ok).toBe(false);
    expect(mod.parseContent!(generated).ok).toBe(true);
  });

  it("a generated question can be blocked too", () => {
    const mod = createQuizModule(QUIZ_QUESTIONS_DE.slice(0, 3));
    const generated = {
      id: "quiz-gen-x",
      text: "Wie viele Tage hat eine Woche?",
      ageRating: 6,
      tags: ["wissen"],
      difficulty: 1,
      options: ["7", "5", "6", "8"],
      correctIndex: 0,
    };
    const s = mod.init(ctx(T0), {
      questionCount: 4,
      scoring,
      excludeContentIds: [],
      extraContent: [generated],
      blockedContentIds: new Set(["quiz-gen-x"]),
    }).state;
    expect(s.questions.map((q) => q.id)).not.toContain("quiz-gen-x");
  });

  it("estimate entries show the formatted answer and use the error metric", () => {
    const entries = createEstimateModule().listContent!();
    expect(entries).toHaveLength(ESTIMATE_QUESTIONS_DE.length);
    expect(entries[0]).toMatchObject({ id: "estimate-001", errorMetric: true });
    expect(entries[0]!.answer).toContain("330");
  });
});
