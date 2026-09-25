import { FUEHRERSCHEIN_QUESTIONS_DE } from "@couch-clash/content";
import { eligibleForMode, type GameModeSettings, type ModuleContext, type ModulePlayer, type SceneMedia } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { FUEHRERSCHEIN_CONFIG, GAME_MODULES, fuehrerscheinMeta } from "../src";
import { buildExam, examDurationMs, examFacts, examStampDelayMs } from "../src/fuehrerschein/exam";
import { createFuehrerscheinModule } from "../src/fuehrerschein/module";
import { allActors, driveOrder } from "../src/fuehrerschein/order";
import { kindOf, pickMixed } from "../src/fuehrerschein/pick";
import type { FuehrerscheinPublicState } from "../src/fuehrerschein/types";
import type { QuestionRoundState } from "../src/question-round/engine";
import type { PreparedQuizQuestion } from "../src/quiz/module";

const T0 = 1_700_000_000_000;
const kids: GameModeSettings = { mode: "kids", allow16: false, difficulty: "mixed" };
const family: GameModeSettings = { mode: "family", allow16: false, difficulty: "mixed" };

function seeded(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const players: ModulePlayer[] = [
  { id: "a", connected: true },
  { id: "b", connected: true },
];
const ctx = (now: number, random = seeded()): ModuleContext => ({ now, players, random });
type State = QuestionRoundState<PreparedQuizQuestion, number>;

const scenes = FUEHRERSCHEIN_QUESTIONS_DE.filter((q) => q.media?.kind === "scene");

describe("Führerschein: registry + meta", () => {
  it("is registered with the quiz's scoring and 5–10 questions (default 8)", () => {
    expect(GAME_MODULES.fuehrerschein.meta).toBe(fuehrerscheinMeta);
    expect(fuehrerscheinMeta.questionsPerRound).toEqual({ min: 5, default: 8, max: 10 });
    expect(fuehrerscheinMeta.scoring).toEqual(GAME_MODULES.quiz.meta.scoring);
    expect(fuehrerscheinMeta.modes).toEqual(["kids", "family", "party"]);
    expect(fuehrerscheinMeta.secondsPerQuestion).toBe(15);
    expect(FUEHRERSCHEIN_CONFIG.sceneSeconds).toBe(20);
  });
});

describe("Führerschein: drive order at the reveal", () => {
  it("every scene's answer names its actors; the order contains everyone exactly once", () => {
    expect(scenes).toHaveLength(40);
    for (const q of scenes) {
      const scene = q.media as SceneMedia;
      const order = driveOrder(scene, q.text, q.options[q.correctIndex]!);
      expect(order, q.id).not.toBeNull();
      expect([...order!].sort(), q.id).toEqual(allActors(scene).sort());
    }
  });

  const scene = (vehicles: SceneMedia["vehicles"], pedestrians?: SceneMedia["pedestrians"]): SceneMedia => ({
    kind: "scene",
    arms: ["N", "E", "S", "W"],
    signs: {},
    priorityPath: null,
    vehicles,
    ...(pedestrians ? { pedestrians } : {}),
  });
  const car = (id: "rot" | "blau" | "grün" | "gelb", from: "N" | "E" | "S" | "W") => ({ id, type: "car" as const, color: id, from, turn: "straight" as const });

  it("an order answer is played as given", () => {
    const s = scene([car("rot", "S"), car("blau", "E"), car("grün", "N")]);
    expect(driveOrder(s, "In welcher Reihenfolge fahren sie?", "Grün, Blau, Rot")).toEqual(["grün", "blau", "rot"]);
  });

  it("'Wer darf zuerst' → the named vehicle first", () => {
    const s = scene([car("rot", "S"), car("blau", "E")]);
    expect(driveOrder(s, "Wer darf zuerst fahren?", "Das blaue Auto")).toEqual(["blau", "rot"]);
  });

  it("'Wer muss warten' → the waiting vehicle goes last", () => {
    const s = scene([car("rot", "W"), car("grün", "S")]);
    expect(driveOrder(s, "Kreuzung ohne Schilder. Wer muss warten?", "Das rote Auto")).toEqual(["grün", "rot"]);
  });

  it("pedestrians: named first, or walking while the waiting car waits", () => {
    const s = scene([{ ...car("rot", "S"), turn: "right" }], [{ at: "E", crossing: true }]);
    expect(driveOrder(s, "Wer darf zuerst?", "Der Fußgänger")).toEqual(["ped:E", "rot"]);
    const s2 = scene([{ ...car("rot", "S"), turn: "left" }, car("blau", "N")], [{ at: "W", crossing: true }]);
    expect(driveOrder(s2, "Wer muss warten?", "Nur das rote Auto")).toEqual(["ped:W", "blau", "rot"]);
  });

  it("colour words do not match inside other words", () => {
    const s = scene([car("rot", "S"), car("blau", "E")]);
    expect(driveOrder(s, "Wer darf zuerst?", "Wer zuerst angekommen ist")).toBeNull();
  });
});

describe("Führerschein: question selection", () => {
  it("mixes text, sign and scene evenly", () => {
    const counts = { text: 0, sign: 0, scene: 0 };
    const picked = pickMixed(FUEHRERSCHEIN_QUESTIONS_DE, { questionCount: 9, excludeContentIds: [] }, seeded(3));
    for (const q of picked) counts[kindOf(q)]++;
    expect(counts).toEqual({ text: 3, sign: 3, scene: 3 });
    // Never the same type twice in a row while all three are available.
    for (let i = 1; i < picked.length; i++) expect(kindOf(picked[i]!)).not.toBe(kindOf(picked[i - 1]!));
  });

  it("8 questions: 3/3/2 in some order, no duplicates", () => {
    const picked = pickMixed(FUEHRERSCHEIN_QUESTIONS_DE, { questionCount: 8, excludeContentIds: [] }, seeded(9));
    const counts = ["text", "sign", "scene"].map((k) => picked.filter((q) => kindOf(q) === k).length).sort();
    expect(counts).toEqual([2, 3, 3]);
    expect(new Set(picked.map((q) => q.id)).size).toBe(8);
  });

  it("Kids: only ageRating 6 questions, still a full round (few scenes are filled up)", () => {
    const eligible = FUEHRERSCHEIN_QUESTIONS_DE.filter((q) => eligibleForMode(q, kids, fuehrerscheinMeta));
    expect(eligible).toHaveLength(26);
    for (const q of eligible) expect(q.ageRating).toBe(6);
    const mod = createFuehrerscheinModule();
    for (const seed of [1, 2, 3, 4]) {
      const init = mod.init(ctx(T0, seeded(seed)), { questionCount: 10, scoring: fuehrerscheinMeta.scoring, excludeContentIds: [], mode: kids });
      const ids = (init.state as State).questions.map((q) => q.id);
      expect(ids).toHaveLength(10);
      for (const id of ids) expect(FUEHRERSCHEIN_QUESTIONS_DE.find((q) => q.id === id)!.ageRating).toBe(6);
    }
  });

  it("Familie gets all 155", () => {
    expect(FUEHRERSCHEIN_QUESTIONS_DE.filter((q) => eligibleForMode(q, family, fuehrerscheinMeta))).toHaveLength(155);
  });
});

describe("Führerschein: round flow", () => {
  function playRound(questionCount: number, answer: (q: PreparedQuizQuestion, playerId: string) => number) {
    const mod = createFuehrerscheinModule();
    let now = T0;
    let update = mod.init(ctx(now), { questionCount, scoring: fuehrerscheinMeta.scoring, excludeContentIds: [], mode: family });
    const seen: { step: string; ms: number; media: string }[] = [];
    for (let guard = 0; guard < 100 && !update.done; guard++) {
      const state = update.state as State;
      const q = state.questions[state.index]!;
      seen.push({ step: state.step, ms: (update.phaseEndsAt ?? now) - now, media: q.media?.kind ?? "text" });
      if (state.step === "question") {
        for (const p of players) {
          const r = mod.handleAction(update.state, { type: "answer", value: answer(q, p.id) }, p.id, ctx(now + 1000));
          if ("error" in r) throw new Error(r.error);
          update = r;
        }
        now += 1000;
        continue;
      }
      now = update.phaseEndsAt ?? now;
      update = mod.onTimer(update.state, ctx(now));
    }
    return { mod, update, seen };
  }

  it("15 s for text and sign questions, 20 s for scenes; longer reveal for scenes", () => {
    const { seen } = playRound(9, (q) => q.correctIndex);
    const questions = seen.filter((s) => s.step === "question");
    expect(questions).toHaveLength(9);
    for (const s of questions) expect(s.ms).toBe(s.media === "scene" ? 20_000 : 15_000);
    // The reveal comes right after everyone answered.
    const reveals = seen.filter((s) => s.step === "reveal");
    for (const s of reveals) expect(s.ms).toBe(s.media === "scene" ? FUEHRERSCHEIN_CONFIG.sceneRevealMs : FUEHRERSCHEIN_CONFIG.revealMs);
  });

  it("public state: media while the question is open, explanation + drive order only at the reveal", () => {
    const mod = createFuehrerscheinModule(scenes.slice(0, 1));
    const init = mod.init(ctx(T0), { questionCount: 5, scoring: fuehrerscheinMeta.scoring, excludeContentIds: [] });
    const open = mod.toPublicState(init.state, { role: "host" }) as FuehrerscheinPublicState;
    expect(open.question.media?.kind).toBe("scene");
    expect(JSON.stringify(open)).not.toContain("explanation");
    expect(JSON.stringify(open)).not.toContain("driveOrder");
    const revealed = mod.onTimer(init.state, ctx(T0 + 20_000));
    const pub = mod.toPublicState(revealed.state, { role: "host" }) as FuehrerscheinPublicState;
    expect(pub.reveal?.solution.explanation).toBe(scenes[0]!.explanation);
    expect(pub.reveal?.solution.driveOrder).toEqual(["blau", "rot"]);
  });

  it("the round ends after the exam result step", () => {
    const { update, seen } = playRound(8, (q) => q.correctIndex);
    expect(seen.filter((s) => s.step === "summary")).toHaveLength(1);
    expect(seen.at(-1)!.step).toBe("summary");
    expect(update.done).toBe(true);
  });

  it("summary step shows the exam results per player and facts for the host", () => {
    const mod = createFuehrerscheinModule();
    let now = T0;
    let update = mod.init(ctx(now), { questionCount: 5, scoring: fuehrerscheinMeta.scoring, excludeContentIds: [] });
    let bWrong = 0;
    while ((update.state as State).step !== "summary") {
      const state = update.state as State;
      if (state.step === "question") {
        const q = state.questions[state.index]!;
        update = mod.handleAction(update.state, { type: "answer", value: q.correctIndex }, "a", ctx(now)) as typeof update;
        const b = bWrong++ < 2 ? (q.correctIndex + 1) % 4 : q.correctIndex; // b: 3 of 5 = 60 %
        update = mod.handleAction(update.state, { type: "answer", value: b }, "b", ctx(now)) as typeof update;
        continue;
      }
      now = update.phaseEndsAt!;
      update = mod.onTimer(update.state, ctx(now));
    }
    expect(update.scoreDelta).toBeUndefined();
    const pub = mod.toPublicState(update.state, { role: "player", playerId: "a" }) as FuehrerscheinPublicState;
    expect(pub.summary?.results).toEqual([
      { playerId: "a", correct: 5, total: 5, passed: true },
      { playerId: "b", correct: 3, total: 5, passed: false },
    ]);
    expect(update.phaseEndsAt! - now).toBe(examDurationMs(pub.summary!));
    const facts = mod.summaryFacts!(update.state)!;
    expect(facts.players.map((p) => p.verdict)).toEqual(["bestanden", "durchgefallen"]);
    expect(facts.highlights).toContain("Nur eine Person hat bestanden.");
    const done = mod.onTimer(update.state, ctx(update.phaseEndsAt!));
    expect(done.done).toBe(true);
  });

  it("reveal facts: roast hint for a wrong scene answer, TÜV line when all are right", () => {
    const mod = createFuehrerscheinModule(scenes.slice(0, 1));
    let u = mod.init(ctx(T0), { questionCount: 5, scoring: fuehrerscheinMeta.scoring, excludeContentIds: [] });
    const q = (u.state as State).questions[0]!;
    u = mod.handleAction(u.state, { type: "answer", value: q.correctIndex }, "a", ctx(T0)) as typeof u;
    u = mod.handleAction(u.state, { type: "answer", value: (q.correctIndex + 1) % 4 }, "b", ctx(T0)) as typeof u;
    expect(mod.revealFacts!(u.state)!.highlights!.join(" ")).toContain("Führerschein freiwillig ab");
    let v = mod.init(ctx(T0), { questionCount: 5, scoring: fuehrerscheinMeta.scoring, excludeContentIds: [] });
    v = mod.handleAction(v.state, { type: "answer", value: q.correctIndex }, "a", ctx(T0)) as typeof v;
    v = mod.handleAction(v.state, { type: "answer", value: q.correctIndex }, "b", ctx(T0)) as typeof v;
    expect(mod.revealFacts!(v.state)!.highlights!.join(" ")).toContain("TÜV");
  });
});

describe("Führerschein: exam rule", () => {
  const two = [
    { id: "a", connected: true },
    { id: "b", connected: false },
  ];
  it("passed from 70 % right; players without answers fail", () => {
    const exam = buildExam({ players: two, correctCounts: { a: 7 }, total: 10 });
    expect(exam.results.map((r) => r.passed)).toEqual([true, false]);
    expect(buildExam({ players: two, correctCounts: { a: 6 }, total: 10 }).results[0]!.passed).toBe(false);
    expect(buildExam({ players: two, correctCounts: { a: 6, b: 6 }, total: 8 }).results.map((r) => r.passed)).toEqual([true, true]);
  });

  it("facts: all passed / nobody passed", () => {
    expect(examFacts(buildExam({ players: two, correctCounts: { a: 8, b: 8 }, total: 8 })).highlights).toContain("Alle haben bestanden.");
    expect(examFacts(buildExam({ players: two, correctCounts: {}, total: 8 })).highlights).toContain("Niemand hat bestanden.");
  });

  it("stamps come faster with many players, and the step is long enough for all of them", () => {
    expect(examStampDelayMs(1, 3) - examStampDelayMs(0, 3)).toBeGreaterThan(examStampDelayMs(1, 12) - examStampDelayMs(0, 12));
    for (const n of [1, 4, 8, 12, 20]) {
      const exam = buildExam({ players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, connected: true })), correctCounts: {}, total: 8 });
      expect(examStampDelayMs(n - 1, n) + 1_500).toBeLessThanOrEqual(examDurationMs(exam));
    }
  });
});
