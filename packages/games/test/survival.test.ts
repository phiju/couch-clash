import type { EstimateQuestion, QuizQuestion } from "@couch-clash/content";
import type { ErrorCode, ModuleContext, ModuleInitOptions, ModulePlayer, ModuleUpdate } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { SURVIVAL_CONFIG, SURVIVAL_PHASES, type SurvivalConfig } from "../src/survival/config";
import { createSurvivalModule, type SurvivalModule, type SurvivalState } from "../src/survival/module";
import {
  applyTimeoutPenalty,
  calculateSurvivalScoreChange,
  calculateTimeDecay,
  convertStartScores,
  escalateByQuestions,
  getDangerLevel,
  getFinalRanking,
  liveSurvivalScore,
  type EscalationRule,
} from "../src/survival/rules";
import { defaultSuddenDeath } from "../src/survival/sudden-death";
import type { SurvivalEventType } from "../src/survival/types";

const T0 = 1_700_000_000_000;
const PHASE1 = SURVIVAL_PHASES[0]!;
const DEATH = SURVIVAL_PHASES[3]!;

function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function quiz(id: string): QuizQuestion {
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
  };
}

function estimate(id: string, answer: number): EstimateQuestion {
  return { id, text: `Schätzfrage ${id}?`, answer, unit: "", format: "number", ageRating: 6, tags: ["t"], difficulty: 1, alcohol: false, adult: false };
}

const QUIZ = Array.from({ length: 60 }, (_, i) => quiz(`s${i}`));
const EST = [estimate("e1", 100), estimate("e2", 50), estimate("e3", 10), estimate("e4", 7), estimate("e5", 3)];

interface HarnessOptions {
  config?: Partial<SurvivalConfig>;
  escalation?: EscalationRule;
  pool?: QuizQuestion[];
  init?: Partial<ModuleInitOptions> & { currentGameContentIds?: string[] };
  players?: ModulePlayer[];
}

/** Drives one finale like the room does (server clock only). */
class Finale {
  readonly mod: SurvivalModule;
  s: SurvivalState;
  phaseEndsAt: number | null;
  done = false;
  used: string[] = [];
  readonly players: ModulePlayer[];
  private readonly random = seeded();

  constructor(
    readonly scores: Record<string, number>,
    opts: HarnessOptions = {},
  ) {
    this.mod = createSurvivalModule({ pools: { quiz: opts.pool ?? QUIZ, estimate: EST }, config: opts.config, escalation: opts.escalation });
    this.players = opts.players ?? Object.keys(scores).map((id) => ({ id, connected: true, name: id.toUpperCase() }));
    const u = this.mod.init(this.ctx(T0), {
      questionCount: 1,
      scoring: this.mod.meta.scoring,
      excludeContentIds: [],
      ...opts.init,
    } as ModuleInitOptions);
    this.s = u.state;
    this.phaseEndsAt = u.phaseEndsAt;
  }

  ctx(now: number, players = this.players): ModuleContext {
    return { now, players, random: this.random, scores: this.scores };
  }

  private apply(u: ModuleUpdate<SurvivalState>) {
    this.s = u.state;
    this.phaseEndsAt = u.phaseEndsAt;
    if (u.done) this.done = true;
    this.used.push(...(u.usedContentIds ?? []));
  }

  get q() {
    return this.s.question!;
  }

  score(id: string) {
    return this.s.players.find((p) => p.id === id)!.score;
  }

  player(id: string) {
    return this.s.players.find((p) => p.id === id)!;
  }

  /** The room's alarm at `now` (or the host's "Weiter"). */
  timer(now = this.phaseEndsAt!) {
    this.apply(this.mod.onTimer(this.s, this.ctx(now)));
    return this;
  }

  /** Alarms until the next question is open. */
  toQuestion() {
    for (let i = 0; i < 20 && this.s.step !== "question" && !this.done; i++) this.timer();
    expect(this.s.step).toBe("question");
    return this;
  }

  /** Every alarm the module asks for until the question is over. */
  runQuestion() {
    while (this.s.step === "question") this.timer();
    return this;
  }

  /** Answer `afterMs` after the question became answerable. */
  answer(id: string, correct: boolean, afterMs: number): ErrorCode | null {
    const q = this.q;
    const value = correct ? q.question.correctIndex : (q.question.correctIndex + 1) % 4;
    const r = this.mod.handleAction(this.s, { type: "answer", value }, id, this.ctx(q.startedAt + afterMs));
    if ("error" in r) return r.error;
    this.apply(r);
    return null;
  }

  estimate(id: string, value: number, afterMs: number): ErrorCode | null {
    const r = this.mod.handleAction(this.s, { type: "estimate", value }, id, this.ctx(this.s.tiebreak!.startedAt + afterMs));
    if ("error" in r) return r.error;
    this.apply(r);
    return null;
  }

  events(type?: SurvivalEventType) {
    return this.s.events.filter((e) => !type || e.type === type);
  }
}

// ═════════════════════════════════════════════════════════════════════════

describe("start scores", () => {
  it("2000 / 1200 / 600 / 90 → 1200 / 800 / 500 / 250", () => {
    expect(convertStartScores({ a: 2000, b: 1200, c: 600, d: 90 }, ["a", "b", "c", "d"])).toEqual({ a: 1200, b: 800, c: 500, d: 250 });
  });

  it("everyone tied → everyone startMax", () => {
    expect(convertStartScores({ a: 700, b: 700 }, ["a", "b"])).toEqual({ a: 1200, b: 1200 });
  });

  it("best score 0 → everyone startMax", () => {
    expect(convertStartScores({ a: 0, b: 0, c: -100 }, ["a", "b", "c"])).toEqual({ a: 1200, b: 1200, c: 1200 });
    expect(convertStartScores({}, ["a", "b"])).toEqual({ a: 1200, b: 1200 });
  });

  it("a negative (or 0) main-game score starts with startMin", () => {
    expect(convertStartScores({ a: 1000, b: -300, c: 0 }, ["a", "b", "c"])).toEqual({ a: 1200, b: 200, c: 200 });
  });

  it("all three values are configurable", () => {
    const cfg = { startMin: 100, startMax: 1000, startExponent: 0.5, startRounding: 10 };
    // 100 + 900 × sqrt(0.25) = 550
    expect(convertStartScores({ a: 400, b: 100 }, ["a", "b"], cfg)).toEqual({ a: 1000, b: 550 });
  });

  it("the finale keeps the main-game scores separately and never sends a scoreDelta", () => {
    const f = new Finale({ a: 2000, b: 90 });
    expect(f.player("a")).toMatchObject({ mainScore: 2000, startScore: 1200, score: 1200, lane: 0 });
    expect(f.player("b")).toMatchObject({ mainScore: 90, startScore: 250, score: 250, lane: 1 });
    expect(f.s.step).toBe("intro");
    expect(f.events().map((e) => e.type)).toEqual(["FINALE_STARTED", "FINAL_TWO"]);
    f.toQuestion();
    f.answer("a", true, 1000);
    const r = f.mod.handleAction(f.s, { type: "answer", value: f.q.question.correctIndex }, "b", f.ctx(f.q.startedAt + 2000));
    expect("scoreDelta" in r).toBe(false);
  });
});

describe("scoring (phase 1)", () => {
  const change = (correct: boolean, s: number) => calculateSurvivalScoreChange({ correct, responseMs: s * 1000, phase: PHASE1 });

  it.each([
    [2, 50],
    [3.2, 50],
    [5.0, 50],
    [5.1, 0],
    [7, 0],
    [8.4, 0],
    [10.0, 0],
    [10.9, 0],
    [11, -10],
    [14, -40],
    [15, -50],
  ])("correct after %s s → %s", (seconds, total) => {
    expect(change(true, seconds).total).toBe(total);
  });

  it("620 points: 3.2 s → 670, 5.0 s → 670, 8.4 s → 620", () => {
    expect(620 + change(true, 3.2).total).toBe(670);
    expect(620 + change(true, 5).total).toBe(670);
    expect(620 + change(true, 8.4).total).toBe(620);
  });

  it("wrong after 2 s: −200, no bonus", () => {
    expect(change(false, 2)).toEqual({ bonus: 0, decay: 0, penalty: 200, drain: 0, total: -200 });
  });

  it("wrong after 14 s: −40 decay, then −200 (500 → 260)", () => {
    expect(change(false, 14)).toEqual({ bonus: 0, decay: 40, penalty: 200, drain: 0, total: -240 });
    expect(500 + change(false, 14).total).toBe(260);
  });

  it("decay: floor(t − threshold) × 10, never past the timeout", () => {
    expect([10.9, 11, 14, 15, 20, 25].map((s) => calculateTimeDecay(s * 1000, PHASE1))).toEqual([0, 10, 40, 50, 100, 100]);
  });

  it("no answer by the timeout: −100 decay, then −200", () => {
    expect(applyTimeoutPenalty(PHASE1)).toEqual({ bonus: 0, decay: 100, penalty: 200, drain: 0, total: -300 });
  });

  it("the module books the same numbers (with live ticks in between)", () => {
    const f = new Finale({ a: 1000, b: 1000, c: 1000, d: 1000, e: 1000 }).toQuestion();
    f.answer("a", true, 3200);
    f.answer("b", true, 8400);
    // Live ticks at 10, 11, 12, 13 s (the room's alarms), then answers.
    for (const s of [10, 11, 12, 13]) f.timer(f.q.startedAt + s * 1000);
    expect(f.score("c")).toBe(1200 - 30);
    f.answer("c", false, 14_000);
    f.answer("d", true, 15_000);
    expect([f.score("a"), f.score("b"), f.score("c"), f.score("d")]).toEqual([1250, 1200, 960, 1150]);
    f.runQuestion();
    // e never answered: −100 decay (booked live), then −200.
    expect(f.score("e")).toBe(900);
    expect(f.q.changes.e).toEqual({ bonus: 0, decay: 100, penalty: 200, drain: 0, total: -300 });
    expect(f.q.timedOut).toEqual(["e"]);
    expect(f.q.endedAt).toBe(f.q.timeoutAt);
    expect(f.events("TIMEOUT")[0]?.playerIds).toEqual(["e"]);
    expect(f.events("FAST_CORRECT").map((e) => e.playerId)).toEqual(["a"]);
    expect(f.events("WRONG_ANSWER").map((e) => e.playerId)).toEqual(["c"]);
    expect(f.events("TIME_DECAY_STARTED")[0]).toMatchObject({ at: f.q.decayFrom, playerIds: ["c", "d", "e"] });
  });

  it("the question ends as soon as every living player has answered", () => {
    const f = new Finale({ a: 1000, b: 1000 }).toQuestion();
    f.answer("a", true, 1000);
    expect(f.s.step).toBe("question");
    f.answer("b", false, 2000);
    expect(f.s.step).toBe("reveal");
    expect(f.q.endedAt).toBe(f.q.startedAt + 2000);
  });

  it("server ticks: the decay threshold, then every full second, up to the timeout", () => {
    const f = new Finale({ a: 1000, b: 1000 }).toQuestion();
    f.answer("a", true, 1000);
    const ticks: number[] = [];
    while (f.s.step === "question") {
      ticks.push((f.phaseEndsAt! - f.q.startedAt) / 1000);
      f.timer();
    }
    expect(ticks).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });
});

describe("elimination", () => {
  it("score exactly 0 → eliminated", () => {
    const f = new Finale({ a: 1000, b: 1000, c: 0 }).toQuestion();
    expect(f.score("c")).toBe(200);
    f.answer("c", false, 1000);
    expect(f.player("c")).toMatchObject({ score: 0, danger: "ELIMINATED", eliminatedAt: f.q.startedAt + 1000, eliminatedQuestion: 1 });
    expect(f.events("ELIMINATED").map((e) => e.playerId)).toEqual(["c"]);
  });

  it("score below 0 → eliminated, shown as 0", () => {
    const f = new Finale({ a: 1000, b: 1000, c: 0 }).toQuestion();
    f.answer("c", false, 12_000);
    expect(f.score("c")).toBe(-20);
    const pub = f.mod.toPublicState(f.s, { role: "host" });
    expect(pub.players.find((p) => p.id === "c")).toMatchObject({ score: 0, eliminated: true });
  });

  it("no answer: the live decay eliminates before the timeout, at the exact second", () => {
    const f = new Finale({ a: 1000, b: 1000, c: 0 }, { config: { startMin: 50 } }).toQuestion();
    f.answer("a", true, 1000);
    f.answer("b", true, 1000);
    expect(f.score("c")).toBe(50);
    // The alarm comes late (17.3 s) – c still went out at 15 s.
    f.timer(f.q.startedAt + 17_300);
    expect(f.player("c")).toMatchObject({ score: 0, eliminatedAt: f.q.startedAt + 15_000 });
    expect(f.q.decayApplied.c).toBe(50);
    // Nobody left to wait for: the question is over before the timeout.
    expect(f.s.step).toBe("reveal");
    expect(f.q.timedOut).toEqual([]);
  });

  it("an eliminated player can't answer", () => {
    const f = new Finale({ a: 1000, b: 1000, c: 0 }).toQuestion();
    f.answer("c", false, 1000);
    f.answer("a", true, 1000);
    f.answer("b", true, 1000);
    f.toQuestion();
    expect(f.q.aliveAtStart).toEqual(["a", "b"]);
    expect(f.answer("c", true, 1000)).toBe("ELIMINATED");
  });

  it("an answer that arrives after the decay already took the player to 0 is rejected", () => {
    const f = new Finale({ a: 1000, b: 1000, c: 0 }, { config: { startMin: 50 } }).toQuestion();
    // No tick in between – the answer itself books the decay first.
    expect(f.answer("c", true, 16_000)).toBe("ELIMINATED");
  });

  it("a second answer to the same question is rejected (no double change)", () => {
    const f = new Finale({ a: 1000, b: 1000, c: 1000 }).toQuestion();
    f.answer("a", true, 1000);
    const before = structuredClone(f.s);
    expect(f.answer("a", true, 1500)).toBe("ALREADY_ANSWERED");
    expect(f.answer("a", false, 1500)).toBe("ALREADY_ANSWERED");
    expect(f.s).toEqual(before);
    expect(f.score("a")).toBe(1250);
  });

  it("placing follows the elimination order; the same moment shares a place", () => {
    const f = new Finale({ a: 2000, b: 1500, c: 1000, d: 0, e: 0 }).toQuestion();
    // Q1: d and e both answer wrong at the same ms (200 → 0).
    f.answer("d", false, 1000);
    f.answer("e", false, 1000);
    for (const id of ["a", "b", "c"]) f.answer(id, true, 1000);
    f.toQuestion();
    // c (700) goes out after four wrong answers.
    while (f.player("c").eliminatedAt === null) {
      f.answer("c", false, 1000);
      f.answer("a", true, 1000);
      f.answer("b", true, 1000);
      f.toQuestion();
    }
    expect(f.player("c").eliminatedQuestion).toBe(5);
    // b goes out later.
    while (f.player("b").eliminatedAt === null) {
      f.answer("b", false, 1000);
      f.answer("a", true, 1000);
      if (f.player("b").eliminatedAt === null) f.toQuestion();
    }
    f.timer();
    expect(f.s.step).toBe("winner");
    expect(f.s.winnerId).toBe("a");
    expect(f.s.ranking).toEqual([
      { playerId: "a", place: 1 },
      { playerId: "b", place: 2 },
      { playerId: "c", place: 3 },
      { playerId: "d", place: 4 },
      { playerId: "e", place: 4 },
    ]);
  });

  it("getFinalRanking: later out = better; exact same time shares the place", () => {
    const ranking = getFinalRanking(
      [
        { id: "w", eliminatedAt: null },
        { id: "x", eliminatedAt: 100 },
        { id: "y", eliminatedAt: 300 },
        { id: "z", eliminatedAt: 100 },
        { id: "k", eliminatedAt: 50, removed: true },
      ],
      "w",
    );
    expect(ranking).toEqual([
      { playerId: "w", place: 1 },
      { playerId: "y", place: 2 },
      { playerId: "x", place: 3 },
      { playerId: "z", place: 3 },
    ]);
  });
});

describe("pressure levels", () => {
  /** Plays `n` questions where everyone answers right after 1 s. */
  function playEasy(f: Finale, n: number) {
    for (let i = 0; i < n; i++) {
      f.toQuestion();
      for (const p of f.q.aliveAtStart) f.answer(p, true, 1000);
    }
  }

  it("after 4 questions: phase 2 with 4 s / 8 s / 16 s", () => {
    const f = new Finale({ a: 1000, b: 1000 });
    playEasy(f, 4);
    expect(f.s.step).toBe("reveal");
    f.timer();
    expect(f.s.step).toBe("phase_change");
    expect(f.events("PHASE_CHANGED").at(-1)).toMatchObject({ phase: "phase2" });
    f.toQuestion();
    expect(f.q.number).toBe(5);
    expect([f.q.bonusUntil, f.q.decayFrom, f.q.timeoutAt].map((t) => t - f.q.startedAt)).toEqual([4000, 8000, 16000]);
    // 4.5 s is too slow for the bonus now; 9 s already costs 10.
    f.answer("a", true, 4500);
    f.answer("b", true, 9000);
    expect(f.q.changes.a?.total).toBe(0);
    expect(f.q.changes.b?.total).toBe(-10);
  });

  it("phase changes never happen during a running question", () => {
    let calls = 0;
    const escalation: EscalationRule = (input) => {
      calls++;
      return escalateByQuestions(input);
    };
    const f = new Finale({ a: 1000, b: 1000 }, { config: { questionsPerPhase: 1 }, escalation }).toQuestion();
    f.answer("a", true, 1000);
    for (let s = 10; s < 20; s++) f.timer(f.q.startedAt + s * 1000);
    // Ticks during the question never ask for the phase.
    expect(calls).toBe(0);
    expect(f.s.phaseIndex).toBe(0);
    expect(f.q.phaseIndex).toBe(0);
    f.runQuestion();
    f.timer();
    expect(calls).toBe(1);
    expect(f.s.step).toBe("phase_change");
    expect(f.s.phaseIndex).toBe(1);
  });

  it("DEATH MODE stays until the end", () => {
    const f = new Finale({ a: 1000, b: 1000 }, { config: { questionsPerPhase: 1 } });
    playEasy(f, 6);
    expect(f.s.phaseIndex).toBe(3);
    expect(f.events("PHASE_CHANGED").map((e) => e.phase)).toEqual(["phase2", "phase3", "death"]);
  });

  it("DEATH MODE: no speed bonus, −50 for every living player after each question", () => {
    const f = new Finale({ a: 1000, b: 1000, c: 0 }, { config: { phases: [DEATH] } }).toQuestion();
    f.answer("a", true, 500);
    f.answer("b", true, 3000);
    f.answer("c", false, 500);
    expect(f.q.changes.a).toEqual({ bonus: 0, decay: 0, penalty: 0, drain: 50, total: -50 });
    expect(f.q.changes.b).toEqual({ bonus: 0, decay: 0, penalty: 0, drain: 50, total: -50 });
    // c went out with the wrong answer – no drain for the eliminated.
    expect(f.q.changes.c).toEqual({ bonus: 0, decay: 0, penalty: 200, drain: 0, total: -200 });
    expect([f.score("a"), f.score("b")]).toEqual([1150, 1150]);
  });

  it("DEATH MODE always ends the finale, even when everyone always answers right", () => {
    const f = new Finale({ a: 3000, b: 2000, c: 1000 }, { config: { questionsPerPhase: 2 } });
    let questions = 0;
    while (!f.done && questions < 500) {
      if (f.s.step === "question") {
        questions++;
        for (const p of f.q.aliveAtStart) f.answer(p, true, 1000);
      } else if (f.s.step === "tiebreak") {
        f.s.tiebreak!.participants.forEach((p, i) => f.estimate(p, 90 + i, 1000));
      } else f.timer();
    }
    expect(f.done).toBe(true);
    expect(f.s.winnerId).not.toBeNull();
    expect(questions).toBeLessThan(100);
  });
});

describe("end of the finale", () => {
  it("one player left → the finale ends with the winner", () => {
    const f = new Finale({ a: 1000, b: 0 }).toQuestion();
    f.answer("b", false, 1000);
    f.answer("a", true, 1000);
    expect(f.s.step).toBe("reveal");
    f.timer();
    expect(f.s.step).toBe("winner");
    expect(f.s.winnerId).toBe("a");
    expect(f.events("WINNER")[0]?.playerId).toBe("a");
    f.timer();
    expect(f.done).toBe(true);
  });

  it("everyone left dies in the same question → sudden death: back with 100 in DEATH MODE", () => {
    const f = new Finale({ a: 0, b: 0, c: 0, d: 1000 }, { config: { startMax: 200 } }).toQuestion();
    // d goes out in Q1 (not part of the sudden death later).
    f.answer("d", false, 1000);
    // Right in 5–10 s: ±0, they stay at 200.
    for (const id of ["a", "b", "c"]) f.answer(id, true, 7000);
    expect(f.player("d").eliminatedAt).not.toBeNull();
    f.toQuestion();
    for (const id of ["a", "b", "c"]) f.answer(id, false, 1000 + ["a", "b", "c"].indexOf(id));
    expect(f.s.step).toBe("reveal");
    f.timer();
    expect(f.s.step).toBe("sudden_death");
    expect(f.s.suddenDeaths).toBe(1);
    expect(f.s.phaseIndex).toBe(3);
    expect(f.events("SUDDEN_DEATH")[0]).toMatchObject({ playerIds: ["a", "b", "c"], round: 1, score: 100 });
    for (const id of ["a", "b", "c"]) expect(f.player(id)).toMatchObject({ score: 100, eliminatedAt: null });
    // d was out before – d stays out.
    expect(f.player("d").eliminatedAt).not.toBeNull();
    f.toQuestion();
    expect(f.q.aliveAtStart).toEqual(["a", "b", "c"]);
    expect(f.q.timeoutAt - f.q.startedAt).toBe(8000);
  });

  it("after three sudden deaths, the next one goes to the estimate question (closest wins, earlier on a tie)", () => {
    const f = new Finale({ a: 0, b: 0, c: 1000 }, { config: { startMax: 200 } }).toQuestion();
    f.answer("c", false, 1000);
    f.answer("a", true, 7000);
    f.answer("b", true, 7000);
    for (let round = 1; round <= 4; round++) {
      f.toQuestion();
      f.answer("a", false, 1000);
      f.answer("b", false, 1000);
      f.timer();
      if (round <= 3) {
        expect(f.s.step).toBe("sudden_death");
        expect(f.s.suddenDeaths).toBe(round);
      }
    }
    expect(f.s.step).toBe("tiebreak");
    expect(f.events("TIEBREAK")[0]?.playerIds).toEqual(["a", "b"]);
    const correct = f.s.tiebreak!.question.answer;
    // Same distance – b answered earlier and wins.
    f.estimate("a", correct + 5, 3000);
    f.estimate("b", correct - 5, 2000);
    expect(f.s.step).toBe("tiebreak_reveal");
    f.timer();
    expect(f.s.step).toBe("winner");
    expect(f.s.winnerId).toBe("b");
    expect(f.s.ranking).toEqual([
      { playerId: "b", place: 1 },
      { playerId: "a", place: 2 },
      { playerId: "c", place: 3 },
    ]);
  });

  it("tie-breaker: nobody answers → a new estimate question", () => {
    const decision = defaultSuddenDeath.decide({ participants: ["a", "b"], occurrences: 3, config: SURVIVAL_CONFIG });
    expect(decision).toEqual({ kind: "tiebreak", playerIds: ["a", "b"] });
    const result = defaultSuddenDeath.resolveTiebreak({ participants: ["a", "b"], answers: {}, correct: 10 });
    expect(result.winnerId).toBeNull();
    expect(defaultSuddenDeath.resolveTiebreak({ participants: ["a", "b"], answers: { b: { value: 1000, at: 5 } }, correct: 10 }).winnerId).toBe("b");
  });

  it("solo: the finale ends when the only player is out", () => {
    const f = new Finale({ a: 0 }, { config: { startMax: 200 } }).toQuestion();
    expect(f.s.solo).toBe(true);
    f.answer("a", true, 1000);
    f.toQuestion();
    f.answer("a", false, 1000);
    f.answer("a", false, 1000);
    f.toQuestion();
    f.answer("a", false, 1000);
    expect(f.player("a").eliminatedAt).not.toBeNull();
    f.timer();
    expect(f.s.step).toBe("winner");
    expect(f.s.winnerId).toBeNull();
    expect(f.s.ranking).toEqual([{ playerId: "a", place: 1 }]);
  });
});

describe("robustness", () => {
  it("decay is booked once, however many ticks come (idempotent)", () => {
    const once = new Finale({ a: 1000, b: 1000 }).toQuestion();
    const many = new Finale({ a: 1000, b: 1000 }).toQuestion();
    for (const f of [once, many]) f.answer("a", true, 1000);
    once.timer(once.q.startedAt + 15_000);
    for (const ms of [10_000, 11_000, 11_000, 11_500, 12_000, 12_000, 14_999, 15_000, 15_000]) many.timer(many.q.startedAt + ms);
    expect(many.score("b")).toBe(once.score("b"));
    expect(many.score("b")).toBe(1150);
    expect(many.q.decayApplied.b).toBe(50);
  });

  it("the live display uses the same formula as the settlement", () => {
    const f = new Finale({ a: 1000, b: 700 }).toQuestion();
    f.answer("a", true, 1000);
    f.timer(f.q.startedAt + 12_000);
    for (const ms of [12_400, 13_000, 13_999, 16_000, 19_500]) {
      const pub = f.mod.toPublicState(f.s, { role: "host" }).players.find((p) => p.id === "b")!;
      const live = liveSurvivalScore({ ...pub, startedAt: f.q.startedAt, now: f.q.startedAt + ms, phase: PHASE1 });
      const settled = new Finale({ a: 1000, b: 700 }).toQuestion();
      settled.answer("a", true, 1000);
      settled.timer(settled.q.startedAt + ms);
      expect(live).toBe(settled.score("b"));
    }
  });

  it("refresh / reconnect: same timer, decay keeps running, no second bonus", () => {
    const f = new Finale({ a: 1000, b: 1000 }).toQuestion();
    f.answer("a", true, 1000);
    const startedAt = f.q.startedAt;
    // a's phone reloads: it only gets the state again – nothing restarts.
    const offline = f.players.map((p) => (p.id === "a" ? { ...p, connected: false } : p));
    expect(f.mod.onPlayersChanged!(f.s, f.ctx(startedAt + 4000, offline))).toBeNull();
    const view = f.mod.toPublicState(f.s, { role: "player", playerId: "a" });
    expect(view.question).toMatchObject({ startedAt, timeoutAt: startedAt + 20_000 });
    expect(view.myAnswer).toBe(f.q.question.correctIndex);
    expect(f.answer("a", true, 4500)).toBe("ALREADY_ANSWERED");
    // b disconnected: the decay still runs and the timeout still comes.
    f.runQuestion();
    expect(f.score("a")).toBe(1250);
    expect(f.score("b")).toBe(900);
  });

  it("a kicked player leaves the finale without blocking the question", () => {
    const f = new Finale({ a: 1000, b: 1000, c: 1000 }).toQuestion();
    f.answer("a", true, 1000);
    f.answer("b", true, 1000);
    const u = f.mod.onPlayersChanged!(f.s, f.ctx(f.q.startedAt + 3000, f.players.filter((p) => p.id !== "c")))!;
    expect(u.state.step).toBe("reveal");
    expect(f.mod.toPublicState(u.state, { role: "host" }).players.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("late joiners and unknown ids can't answer", () => {
    const f = new Finale({ a: 1000, b: 1000 }).toQuestion();
    const late = [...f.players, { id: "z", connected: true }];
    const r = f.mod.handleAction(f.s, { type: "answer", value: 0 }, "z", f.ctx(f.q.startedAt + 1000, late));
    expect(r).toEqual({ error: "UNKNOWN_PLAYER" });
  });

  it("no answers or the right option leak before the reveal", () => {
    const f = new Finale({ a: 1000, b: 1000 }).toQuestion();
    f.answer("a", false, 1000);
    const host = f.mod.toPublicState(f.s, { role: "host" });
    const b = f.mod.toPublicState(f.s, { role: "player", playerId: "b" });
    for (const view of [host, b]) {
      expect(view.reveal).toBeNull();
      expect(view.myAnswer).toBeNull();
      expect(JSON.stringify(view)).not.toContain("correctIndex");
    }
    // The −200 is public right away (the TV shows the drop).
    expect(host.players.find((p) => p.id === "a")?.change?.total).toBe(-200);
  });

  it("questions never repeat in a finale and never come from the running game; tiers: fresh → earlier games → AI → last resort", () => {
    const pool = ["p1", "p2", "p3", "p4", "p5"].map(quiz);
    const f = new Finale(
      { a: 1000, b: 1000 },
      {
        pool,
        config: { aiRefillBelow: 3, aiMaxRequests: 1 },
        init: { excludeContentIds: ["p1", "p2", "p3"], currentGameContentIds: ["p3"] },
      },
    );
    const played: string[] = [];
    const playOne = () => {
      f.toQuestion();
      played.push(f.q.contentId);
      f.answer("a", true, 1000);
      f.answer("b", true, 1000);
    };
    playOne();
    playOne();
    // Fresh ones first (p4, p5), then earlier games (p1, p2) – never p3 (running game).
    expect(played.slice(0, 2).sort()).toEqual(["p4", "p5"]);
    // The queue ran low: an AI refill is requested in the background (the game doesn't wait).
    const task = f.mod.pendingTask!(f.s)!;
    expect(task).toMatchObject({ kind: "llm_json", id: "survival-questions-1" });
    playOne();
    playOne();
    expect(played.slice(2).sort()).toEqual(["p1", "p2"]);
    const r = f.mod.resolveTask!(
      f.s,
      task.id,
      {
        questions: [
          { text: "Wie viele Beine hat eine Spinne?", options: ["8", "6", "10", "4"], correctIndex: 0 },
          { text: "kaputt", options: ["x"] },
          { text: "Frage p1?", options: ["a", "b", "c", "d"], correctIndex: 1 },
        ],
      },
      f.ctx(f.phaseEndsAt!),
    )!;
    f.s = r.state;
    expect(f.mod.pendingTask!(f.s)).toBeNull();
    playOne();
    expect(played.at(-1)).toBe("survival-ai-1-0");
    expect(new Set(played).size).toBe(played.length);
    expect(played).not.toContain("p3");
    // Everything used and no more AI: the finale still never hangs (oldest question of the finale again).
    playOne();
    expect(played.at(-1)).toBe(played[0]);
    expect(f.used).not.toContain("p3");
  });

  it("test bots answer questions and estimates", () => {
    const f = new Finale({ a: 1000, b: 1000 }).toQuestion();
    const bot = { random: seeded(3), correctRate: 1, estimateSpread: 0 };
    expect(f.mod.botAction!(f.s, "a", f.ctx(f.q.startedAt), bot)).toEqual({ type: "answer", value: f.q.question.correctIndex });
    f.answer("a", true, 1000);
    expect(f.mod.botAction!(f.s, "a", f.ctx(f.q.startedAt), bot)).toBeNull();
  });
});

describe("danger levels", () => {
  it("defaults by wrong answers left: SAFE > 600 ≥ WARNING > 400 ≥ CRITICAL > 200 ≥ IMMINENT > 0 ≥ ELIMINATED", () => {
    expect([601, 600, 401, 400, 201, 200, 1, 0, -50].map((s) => getDangerLevel(s))).toEqual([
      "SAFE",
      "WARNING",
      "WARNING",
      "CRITICAL",
      "CRITICAL",
      "ELIMINATION_IMMINENT",
      "ELIMINATION_IMMINENT",
      "ELIMINATED",
      "ELIMINATED",
    ]);
  });

  it("events on the way down, COMEBACK on the way back up", () => {
    const f = new Finale({ a: 1000, b: 500 }).toQuestion();
    // b starts at 700 (SAFE) → wrong → 500 WARNING
    f.answer("b", false, 1000);
    f.answer("a", true, 1000);
    f.toQuestion();
    f.answer("b", false, 1000); // 300 CRITICAL
    f.answer("a", true, 1000);
    expect(f.events("WARNING").map((e) => e.playerId)).toEqual(["b"]);
    expect(f.events("CRITICAL").map((e) => e.playerId)).toEqual(["b"]);
    for (let i = 0; i < 3; i++) {
      f.toQuestion();
      f.answer("b", true, 1000);
      f.answer("a", true, 1000);
    }
    // 300 → 350 → 400 → 450 (WARNING again)
    expect(f.score("b")).toBe(450);
    expect(f.events("COMEBACK").map((e) => e.playerId)).toEqual(["b"]);
  });

  it("MULTIPLE_PLAYERS_CRITICAL when a second player drops into CRITICAL", () => {
    const f = new Finale({ a: 1000, b: 400, c: 400 }).toQuestion();
    // b, c: 600 each → wrong → 400 CRITICAL
    f.answer("b", false, 1000);
    f.answer("c", false, 1000);
    f.answer("a", true, 1000);
    expect(f.events("MULTIPLE_PLAYERS_CRITICAL")[0]?.playerIds).toEqual(["b", "c"]);
  });

  it("FINAL_TWO when the third-to-last player goes out", () => {
    const f = new Finale({ a: 1000, b: 1000, c: 0 }).toQuestion();
    f.answer("c", false, 1000);
    f.answer("a", true, 1000);
    f.answer("b", true, 1000);
    expect(f.events("FINAL_TWO")[0]?.playerIds).toEqual(["a", "b"]);
  });
});

describe("start sequence and the way to the ceremony (presentation timing)", () => {
  const C = SURVIVAL_CONFIG;

  it("rules → launch (moderator opens, then the ride) → first question; scores unchanged", () => {
    const f = new Finale({ a: 2000, b: 1200, c: 90 });
    expect(f.phaseEndsAt).toBe(T0 + C.introMs);
    let pub = f.mod.toPublicState(f.s, { role: "host" });
    expect(pub.launch).toEqual({ riseAt: null, riseMs: C.riseMs });

    f.timer(); // rules over
    expect(f.s.step).toBe("launch");
    expect(f.events().slice(-2).map((e) => e.type)).toEqual(["LAUNCH", "SCORES_CONVERTED"]);
    const launchAt = T0 + C.introMs;
    // Safety net: the ride starts at the latest when the moderator's line would be over.
    expect(f.phaseEndsAt).toBe(launchAt + C.launchPauseMs + C.launchLineMaxMs);

    // The room moves on when his line ended (here: right away → still the 1 s pause first).
    f.timer(launchAt + 200);
    expect(f.s.step).toBe("launch");
    expect(f.s.launchRiseAt).toBe(launchAt + C.launchPauseMs);
    expect(f.phaseEndsAt).toBe(launchAt + C.launchPauseMs + C.riseMs);
    pub = f.mod.toPublicState(f.s, { role: "host" });
    expect(pub.launch).toEqual({ riseAt: launchAt + C.launchPauseMs, riseMs: C.riseMs });
    // Presentation only: the start scores are the converted ones from the beginning.
    expect(pub.players.map((p) => p.score)).toEqual([1200, 800, 250]);

    f.timer(); // the ride is over → the first question right away
    expect(f.s.step).toBe("question");
    expect(f.q.startedAt).toBe(launchAt + C.launchPauseMs + C.riseMs);
    expect(f.mod.toPublicState(f.s, { role: "host" }).launch).toBeNull();
  });

  it("a line that ends late starts the ride then", () => {
    const f = new Finale({ a: 2000, b: 1200 });
    f.timer();
    const launchAt = T0 + C.introMs;
    f.timer(launchAt + 4_200);
    expect(f.s.launchRiseAt).toBe(launchAt + 4_200);
  });

  it("after the last elimination: no extra wait, then the winner step with the safety time", () => {
    const f = new Finale({ a: 2000, b: 90 }); // a 1200, b 250
    f.toQuestion();
    f.answer("a", true, 6_000);
    f.answer("b", false, 6_000); // 250 → 50
    f.runQuestion();
    expect(f.s.step).toBe("reveal");
    expect(f.phaseEndsAt! - f.s.stepStartedAt).toBe(C.revealMs);
    f.toQuestion();
    f.answer("a", true, 6_000);
    const outAt = f.q.startedAt + 6_500;
    expect(f.answer("b", false, 6_500)).toBeNull(); // 50 → out, the question ends at once
    expect(f.s.step).toBe("reveal");
    // Only until the car is under the slime – not the full reveal.
    expect(f.phaseEndsAt).toBe(Math.max(outAt + C.finalRevealMinMs, outAt + C.eliminationAnimMs));
    expect(f.phaseEndsAt! - f.s.stepStartedAt).toBeLessThan(C.revealMs);
    f.timer();
    expect(f.s.step).toBe("winner");
    expect(f.s.winnerId).toBe("a");
    expect(f.phaseEndsAt).toBe(f.s.stepStartedAt + C.winnerMs);
  });
});
