/**
 * Double or Nothing: pot per player, CASH OUT / BET before every question
 * from question 2 on, a ladder of ever harder questions (question n has level n).
 */
import { QUIZ_QUESTIONS_DE, type QuizQuestion } from "@couch-clash/content";
import {
  eligibleForMode,
  type GameModeSettings,
  type ModuleContext,
  type ModulePlayer,
  type ModuleUpdate,
  type ScoringSettings,
} from "@couch-clash/shared";
import { describe, expect, it, vi } from "vitest";
import { ladderLevel, planLadder } from "../src/double/ladder";
import { DOUBLE_CONFIG, doubleMeta, potAfterWin } from "../src/double/meta";
import { createDoubleModule, type DoubleGame } from "../src/double/module";
import type { KnowledgeState } from "../src/knowledge/engine";
import type { DoubleExtra } from "../src/knowledge/types";

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

/** Six questions per level (1–5) – child-friendly, so every mode can play them. */
function q(level: 1 | 2 | 3 | 4 | 5, n: number, extra: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    id: `l${level}-${n}`,
    text: `Frage ${level}-${n}?`,
    options: ["A", "B", "C", "D"],
    correctIndex: 0,
    ageRating: 6,
    tags: ["t"],
    difficulty: 1,
    level,
    kidsLevel: level,
    alcohol: false,
    adult: false,
    primaryCategory: "HISTORY",
    ...extra,
  };
}
const LEVELS = [1, 2, 3, 4, 5] as const;
const POOL: QuizQuestion[] = LEVELS.flatMap((l) => [1, 2, 3, 4, 5, 6].map((n) => q(l, n)));
const scoring = structuredClone(doubleMeta.scoring) as ScoringSettings;

type State = KnowledgeState<DoubleGame>;
type Update = ModuleUpdate<State>;

function unwrap(r: Update | { error: string }): Update {
  if ("error" in r) throw new Error(r.error);
  return r;
}

/** Drives one round with a running clock and records every score change. */
function game(options: { players?: ModulePlayer[]; count?: number; pool?: QuizQuestion[]; mode?: GameModeSettings; exclude?: string[] } = {}) {
  const mod = createDoubleModule(options.pool ?? POOL);
  let players = options.players ?? PLAYERS;
  let now = T0;
  const ctx = (): ModuleContext => ({ now, players, random: seeded(), scores: {} });
  let last: Update = mod.init(ctx(), {
    questionCount: options.count ?? 5,
    scoring,
    excludeContentIds: options.exclude ?? [],
    ...(options.mode ? { mode: options.mode } : {}),
  });
  const used = [...(last.usedContentIds ?? [])];
  const totals: Record<string, number> = {};
  const apply = (u: Update) => {
    last = u;
    for (const [id, p] of Object.entries(u.scoreDelta ?? {})) totals[id] = (totals[id] ?? 0) + p;
    used.push(...(u.usedContentIds ?? []));
    return u;
  };
  const api = {
    mod,
    get state() {
      return last.state;
    },
    get last() {
      return last;
    },
    totals,
    used,
    setPlayers(next: ModulePlayer[]) {
      players = next;
      now += 10;
      const r = mod.onPlayersChanged!(last.state, ctx());
      if (r) apply(r);
    },
    choose(id: string, choice: "cash" | "bet") {
      now += 10;
      return apply(unwrap(mod.handleAction(last.state, { type: "risk", choice }, id, ctx())));
    },
    tryAction(id: string, action: unknown) {
      now += 10;
      const r = mod.handleAction(last.state, action, id, ctx());
      if (!("error" in r)) apply(r);
      return r;
    },
    answer(id: string, right: boolean) {
      now += 10;
      const correct = last.state.questions[last.state.index]!.correctIndex;
      return apply(unwrap(mod.handleAction(last.state, { type: "answer", value: right ? correct : (correct + 1) % 4 }, id, ctx())));
    },
    /** The step's time runs out (or the host presses "Weiter"). */
    timer() {
      now = Math.max(now, last.state.stepEndsAt) + 1;
      return apply(mod.onTimer(last.state, ctx()));
    },
    /** Timers until the given step (or the end of the round). */
    until(step: State["step"]) {
      for (let i = 0; i < 10 && !last.done && last.state.step !== step; i++) api.timer();
    },
    view(viewer: { role: "host" } | { role: "guest" } | { role: "player"; playerId: string } = { role: "host" }) {
      return mod.toPublicState(last.state, viewer) as ReturnType<typeof mod.toPublicState> & { extra: DoubleExtra };
    },
    player(id: string) {
      return last.state.game.players[id]!;
    },
  };
  return api;
}

type Game = ReturnType<typeof game>;

/** Plays question `index` for one player: choose (from question 2 on), then answer. */
function play(g: Game, id: string, choice: "cash" | "bet", right: boolean) {
  if (g.state.step === "decide") {
    g.choose(id, choice);
    if (g.state.step === "decide") g.timer();
  }
  if (g.state.step === "showdown") g.timer();
  if (choice === "bet" && g.state.step === "question") {
    g.answer(id, right);
    if (g.state.step === "question") g.timer();
  }
}

const SOLO: ModulePlayer[] = [{ id: "a", connected: true, name: "Clara" }];

describe("pot formula: pot = 2 × pot + 100", () => {
  it("series 1–5: 100 → 300 → 700 → 1,500 → 3,100", () => {
    const pots: number[] = [];
    let pot = 0;
    for (let i = 0; i < 5; i++) pots.push((pot = potAfterWin(pot, 100)));
    expect(pots).toEqual([100, 300, 700, 1500, 3100]);
  });

  it("a full streak: the pot grows every question, 3,100 are credited automatically at the end", () => {
    const g = game({ players: SOLO });
    const pots: number[] = [];
    for (let index = 0; index < 5; index++) {
      expect(g.state.index).toBe(index);
      play(g, "a", "bet", true);
      expect(g.state.step).toBe("reveal");
      pots.push(g.player("a").pot);
      // Nothing is on the account before the end of the round.
      if (index < 4) expect(g.totals.a ?? 0).toBe(0);
      g.until(index < 4 ? "decide" : "leaderboard");
    }
    expect(pots).toEqual([100, 300, 700, 1500, 3100]);
    expect(g.totals).toEqual({ a: 3100 });
    expect(g.player("a")).toMatchObject({ status: "cashed_out", banked: 3100, auto: true });
    g.timer();
    expect(g.last.done).toBe(true);
  });

  it.each([
    [2, 100],
    [3, 300],
    [4, 700],
    [5, 1500],
  ])("cash out before question %i → exactly %i points, out for the rest of the round", (question, pot) => {
    const g = game({ players: SOLO });
    for (let index = 0; index < question - 1; index++) {
      play(g, "a", "bet", true);
      g.until("decide");
    }
    expect(g.state.index).toBe(question - 1);
    expect(g.player("a").pot).toBe(pot);
    const r = g.choose("a", "cash");
    // Everyone chose → the showdown, the pot goes onto the account right away.
    expect(r.state.step).toBe("showdown");
    expect(r.scoreDelta).toEqual({ a: pot });
    expect(g.player("a")).toMatchObject({ status: "cashed_out", banked: pot, auto: false });
    // Nobody is left: no empty question, the round is over.
    g.timer();
    expect(g.last.done).toBe(true);
    expect(g.totals).toEqual({ a: pot });
  });

  it.each([1, 2, 3, 4, 5])("wrong answer in question %i → pot 0, busted, no points", (question) => {
    const g = game({ players: SOLO });
    for (let index = 0; index < question - 1; index++) {
      play(g, "a", "bet", true);
      g.until("decide");
    }
    const before = g.player("a").pot;
    play(g, "a", "bet", false);
    expect(g.state.step).toBe("reveal");
    expect(g.player("a")).toMatchObject({ pot: 0, lost: before, status: "busted", banked: null });
    expect(g.state.results!.a).toMatchObject({ finalScore: 0, correct: false });
    g.until("decide");
    expect(g.last.done).toBe(true);
    expect(g.totals.a ?? 0).toBe(0);
  });

  it("the bonus is configurable", () => {
    const mod = createDoubleModule(POOL);
    const s = mod.init({ now: T0, players: SOLO, random: seeded() }, { questionCount: 3, scoring: { ...scoring, points: { bonus: 50 } }, excludeContentIds: [] });
    expect(s.state.game.bonus).toBe(50);
    expect(potAfterWin(potAfterWin(0, 50), 50)).toBe(150);
  });
});

describe("flow", () => {
  it("question 1 without a choice; from question 2 CASH OUT / BET, then the showdown, then the question", () => {
    const g = game();
    expect(g.state.step).toBe("question");
    expect(g.view().extra).toMatchObject({ level: 1, maxLevel: 5, decisions: {} });
    for (const id of ["a", "b", "c"]) g.answer(id, true);
    expect(g.state.step).toBe("reveal");
    g.until("decide");
    expect(g.state.index).toBe(1);
    expect(g.view().extra.level).toBe(2);
    g.choose("a", "cash");
    g.choose("b", "bet");
    g.choose("c", "bet");
    expect(g.state.step).toBe("showdown");
    expect(g.last.scoreDelta).toEqual({ a: 100 });
    expect(g.view().extra.decisions).toEqual({ a: "cash", b: "bet", c: "bet" });
    g.timer();
    expect(g.state.step).toBe("question");
    // Cashed out: no more answers.
    expect(g.tryAction("a", { type: "answer", value: 0 })).toEqual({ error: "NOT_IN_PLAY" });
    expect(g.tryAction("a", { type: "risk", choice: "bet" })).toEqual({ error: "WRONG_PHASE" });
    // Only the two who bet are awaited.
    g.answer("b", true);
    g.answer("c", false);
    expect(g.state.step).toBe("reveal");
    expect(g.player("b")).toMatchObject({ pot: 300, status: "active" });
    expect(g.player("c")).toMatchObject({ pot: 0, lost: 100, status: "busted" });
    expect(g.player("a")).toMatchObject({ pot: 100, status: "cashed_out", banked: 100 });
    // Only b is left: busted and cashed-out players can't choose any more.
    g.until("decide");
    expect(g.tryAction("c", { type: "risk", choice: "bet" })).toEqual({ error: "NOT_IN_PLAY" });
    expect(g.tryAction("a", { type: "risk", choice: "bet" })).toEqual({ error: "NOT_IN_PLAY" });
    expect(g.view().actedPlayerIds).toEqual([]);
    g.choose("b", "bet");
    expect(g.state.step).toBe("showdown");
  });

  it("the choices stay secret until everyone has chosen – then they are uncovered together", () => {
    const g = game();
    for (const id of ["a", "b", "c"]) g.answer(id, true);
    g.until("decide");
    g.choose("a", "bet");
    expect(g.tryAction("a", { type: "risk", choice: "cash" })).toEqual({ error: "ALREADY_ANSWERED" });
    for (const viewer of [{ role: "host" } as const, { role: "guest" } as const, { role: "player", playerId: "b" } as const]) {
      const view = g.view(viewer);
      expect(view.extra.decisions).toBeNull();
      expect(view.extra.myDecision).toBe(viewer.role === "player" ? "none" : null);
      // Nothing else gives it away (status, pot, banked).
      expect(view.extra.players.a).toEqual({ pot: 100, status: "active", potBefore: 100, banked: null, lost: 0, auto: false });
      expect(JSON.stringify(view)).not.toContain('"bet"');
      expect(view.actedPlayerIds).toEqual(["a"]);
    }
    expect(g.view({ role: "player", playerId: "a" }).extra.myDecision).toBe("bet");
    g.choose("b", "cash");
    g.choose("c", "bet");
    expect(g.view({ role: "guest" }).extra.decisions).toEqual({ a: "bet", b: "cash", c: "bet" });
  });

  it("no choice in time → CASH OUT (the safe default)", () => {
    const g = game();
    for (const id of ["a", "b", "c"]) g.answer(id, true);
    g.until("decide");
    g.choose("a", "bet");
    const r = g.timer();
    expect(r.state.step).toBe("showdown");
    expect(r.scoreDelta).toEqual({ b: 100, c: 100 });
    expect(g.view().extra.decisions).toEqual({ a: "bet", b: "cash", c: "cash" });
  });

  it("everyone out before the last question → the round ends at once, no empty questions", () => {
    const g = game();
    g.answer("a", true);
    g.answer("b", false);
    g.answer("c", false);
    g.until("decide");
    g.choose("a", "bet");
    g.timer(); // showdown → question 2
    g.answer("a", false);
    expect(g.state.step).toBe("reveal");
    g.timer(); // leaderboard
    g.timer();
    expect(g.last.done).toBe(true);
    // Only the two questions played are marked as used.
    expect(g.used).toHaveLength(2);
  });

  it("whoever is still in after the last question gets the pot credited", () => {
    const g = game({ count: 3 });
    for (const id of ["a", "b", "c"]) g.answer(id, true);
    g.until("decide");
    g.choose("a", "bet");
    g.choose("b", "bet");
    g.choose("c", "cash");
    g.timer();
    g.answer("a", true);
    g.answer("b", true);
    g.until("decide");
    g.choose("a", "bet");
    g.choose("b", "bet");
    g.timer();
    g.answer("a", true);
    g.answer("b", false);
    expect(g.state.step).toBe("reveal");
    expect(g.last.scoreDelta).toEqual({ a: 700 });
    expect(g.totals).toEqual({ a: 700, c: 100 });
    expect(g.view().extra.players.a).toMatchObject({ status: "cashed_out", banked: 700, auto: true });
    g.timer();
    g.timer();
    expect(g.last.done).toBe(true);
  });
});

describe("connections", () => {
  it("losing the connection during the choice → CASH OUT; the step doesn't wait for them", () => {
    const g = game();
    for (const id of ["a", "b", "c"]) g.answer(id, true);
    g.until("decide");
    g.choose("a", "bet");
    g.choose("b", "bet");
    g.setPlayers(PLAYERS.map((p) => (p.id === "c" ? { ...p, connected: false } : p)));
    expect(g.state.step).toBe("showdown");
    expect(g.last.scoreDelta).toEqual({ c: 100 });
    expect(g.player("c")).toMatchObject({ status: "cashed_out", banked: 100 });
  });

  it("losing the connection during the question after BET → counts as wrong", () => {
    const g = game();
    for (const id of ["a", "b", "c"]) g.answer(id, true);
    g.until("decide");
    for (const id of ["a", "b", "c"]) g.choose(id, "bet");
    g.timer();
    g.answer("a", true);
    g.answer("b", true);
    g.setPlayers(PLAYERS.map((p) => (p.id === "c" ? { ...p, connected: false } : p)));
    // Everyone still connected has answered → the reveal.
    expect(g.state.step).toBe("reveal");
    expect(g.player("c")).toMatchObject({ pot: 0, lost: 100, status: "busted" });
  });

  it("players joining later only watch (they can't choose or answer)", () => {
    const g = game();
    const late = [...PLAYERS, { id: "d", connected: true, name: "Dora" }];
    g.setPlayers(late);
    expect(g.tryAction("d", { type: "answer", value: 0 })).toEqual({ error: "NOT_IN_PLAY" });
    for (const id of ["a", "b", "c"]) g.answer(id, true);
    g.until("decide");
    expect(g.tryAction("d", { type: "risk", choice: "bet" })).toEqual({ error: "NOT_IN_PLAY" });
    expect(g.view().extra.players.d).toBeUndefined();
  });

  it("bots only choose while in the round and only answer after BET", () => {
    const g = game();
    const bot = { random: seeded(3), accuracy: 1 } as never;
    const botCtx = { now: T0, players: PLAYERS, random: seeded() };
    expect(g.mod.botAction!(g.state, "a", botCtx, bot)).toMatchObject({ type: "answer" });
    for (const id of ["a", "b", "c"]) g.answer(id, true);
    g.until("decide");
    expect(g.mod.botAction!(g.state, "a", botCtx, bot)).toMatchObject({ type: "risk" });
    g.choose("a", "cash");
    g.choose("b", "bet");
    g.choose("c", "bet");
    g.timer();
    expect(g.mod.botAction!(g.state, "a", botCtx, bot)).toBeNull();
    expect(g.mod.botAction!(g.state, "b", botCtx, bot)).toMatchObject({ type: "answer" });
  });
});

describe("difficulty ladder", () => {
  const levelsOf = (g: Game) => g.state.questions.map((x) => ladderLevel(POOL.find((p) => p.id === x.id)!, "family"));

  it("question n has level n", () => {
    const g = game({ players: SOLO });
    for (let index = 0; index < 5; index++) {
      play(g, "a", "bet", true);
      g.until("decide");
    }
    expect(levelsOf(g)).toEqual([1, 2, 3, 4, 5]);
    expect(g.state.game.ladder.map((s) => s.level)).toEqual([1, 2, 3, 4, 5]);
  });

  it("the level is shown before every choice (TV and phones)", () => {
    const g = game();
    for (const id of ["a", "b", "c"]) g.answer(id, true);
    g.until("decide");
    expect(g.view({ role: "host" }).extra.level).toBe(2);
    expect(g.view({ role: "player", playerId: "a" }).extra.level).toBe(2);
  });

  it("fallback: a level played out → the next lower one, never below the previous question", () => {
    const pool = POOL.filter((x) => x.level !== 4);
    const steps = planLadder(pool, 5, { excludeContentIds: [] }, seeded());
    expect(steps.map((s) => s.level)).toEqual([1, 2, 3, 3, 5]);
    // Unplayed questions first: a played-out level drops to the one below …
    const played = POOL.filter((x) => x.level === 3).map((x) => x.id);
    expect(planLadder(POOL, 5, { excludeContentIds: played }, seeded()).map((s) => s.level)).toEqual([1, 2, 2, 4, 5]);
    // … but never below the previous question: then a played one of the level comes back.
    const played2 = POOL.filter((x) => x.level === 2 || x.level === 3).map((x) => x.id);
    const again = planLadder(POOL, 5, { excludeContentIds: played2 }, seeded());
    expect(again.map((s) => s.level)).toEqual([1, 1, 1, 4, 5]);
  });

  it("never falling, for any gaps in the pool", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const random = seeded(seed);
      const pool = POOL.filter(() => random() < 0.3);
      const steps = planLadder(pool, 5, { excludeContentIds: pool.filter(() => random() < 0.5).map((x) => x.id) }, random);
      for (let i = 1; i < steps.length; i++) expect(steps[i]!.level).toBeGreaterThanOrEqual(steps[i - 1]!.level);
      expect(new Set(steps.map((s) => s.question.id)).size).toBe(steps.length);
    }
  });

  it("levels are relative to the mode: Kids play the kids level", () => {
    const pool = LEVELS.flatMap((l) => [1, 2].map((n) => q(l, n, { kidsLevel: (6 - l) as 1 | 2 | 3 | 4 | 5 })));
    const kids: GameModeSettings = { mode: "kids", allow16: false, difficulty: "mixed" };
    const steps = planLadder(pool, 5, { excludeContentIds: [], mode: kids }, seeded());
    expect(steps.map((s) => s.question.kidsLevel)).toEqual([1, 2, 3, 4, 5]);
    expect(steps.map((s) => s.question.level)).toEqual([5, 4, 3, 2, 1]);
  });

  it("questions without a level (generated) fall back to their difficulty", () => {
    expect(ladderLevel({ difficulty: 1 }, "family")).toBe(2);
    expect(ladderLevel({ difficulty: 3 }, "kids")).toBe(4);
    expect(ladderLevel({ difficulty: 3, level: 5, kidsLevel: 1 }, "kids")).toBe(1);
  });

  const modes: GameModeSettings[] = [
    { mode: "kids", allow16: false, difficulty: "mixed" },
    { mode: "family", allow16: true, difficulty: "mixed" },
    { mode: "party", allow16: true, difficulty: "mixed" },
  ];

  it.each(modes)("the shipped pool has at least 10 questions per level in $mode mode", (mode) => {
    const pool = QUIZ_QUESTIONS_DE.filter((x) => eligibleForMode(x, mode, doubleMeta));
    const counts = LEVELS.map((l) => pool.filter((x) => ladderLevel(x, mode.mode) === l).length);
    for (const n of counts) expect(n).toBeGreaterThanOrEqual(10);
  });

  it.each(modes)("$mode mode: a real round climbs 1 → 5", (mode) => {
    for (const seed of [1, 2, 3]) {
      const pool = QUIZ_QUESTIONS_DE.filter((x) => eligibleForMode(x, mode, doubleMeta));
      expect(planLadder(pool, 5, { excludeContentIds: [], mode }, seeded(seed)).map((s) => s.level)).toEqual([1, 2, 3, 4, 5]);
    }
  });

  it("party mode: the party share still comes up (shared partySlots), logged when a level has none", () => {
    const party: GameModeSettings = { mode: "party", allow16: true, difficulty: "mixed" };
    const adult = LEVELS.flatMap((l) => [1, 2].map((n) => q(l, n + 10, { adult: true, ageRating: 18 })));
    const steps = planLadder([...POOL, ...adult], 5, { excludeContentIds: [], mode: party }, seeded());
    expect(steps.filter((s) => s.question.adult)).toHaveLength(2);
    const log = vi.fn();
    const none = planLadder(POOL, 5, { excludeContentIds: [], mode: party, log }, seeded());
    expect(none).toHaveLength(5);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("party pool"), expect.objectContaining({ label: "double-or-nothing", wanted: 2 }));
  });

  it("at most five questions per round", () => {
    expect(doubleMeta.questionsPerRound.max).toBe(DOUBLE_CONFIG.maxLevel);
    const g = game({ count: 9 });
    expect(g.state.total).toBe(5);
  });
});

describe("host", () => {
  const read = (g: Game) => g.mod.readAloud!(g.state)?.items.map((i) => i.text).join(" ") ?? "";

  it("announces the level; from level 4 on with a warning", () => {
    const g = game({ players: SOLO });
    play(g, "a", "bet", true);
    g.until("decide");
    expect(read(g)).toContain("Stufe 2");
    expect(read(g)).not.toContain("fies");
    play(g, "a", "bet", true);
    g.until("decide");
    play(g, "a", "bet", true);
    g.until("decide");
    expect(g.view().extra.level).toBe(4);
    expect(read(g)).toContain("fies");
  });

  it("one player left: all or nothing", () => {
    const g = game({ players: SOLO });
    play(g, "a", "bet", true);
    g.until("decide");
    expect(read(g)).toMatch(/Alles oder nichts|allein/);
  });

  it("comments on the showdown (who bets, who cashes out) and on big losses", () => {
    const g = game();
    for (const id of ["a", "b", "c"]) g.answer(id, true);
    g.until("decide");
    g.choose("a", "cash");
    g.choose("b", "bet");
    g.choose("c", "bet");
    const line = read(g);
    expect(line).toContain("Clara");
    expect(line).toMatch(/Max|Rest/);
    g.timer();
    g.answer("b", true);
    g.answer("c", true);
    g.until("decide");
    g.choose("b", "bet");
    g.choose("c", "bet");
    g.timer();
    g.answer("b", true);
    g.answer("c", false);
    // Philip loses a pot of 300.
    expect(read(g)).toContain("Philip");
    expect(read(g)).toMatch(/300/);
    const facts = g.mod.revealFacts!(g.state)!;
    expect(facts.answers.c!.note).toContain("verloren");
    expect(facts.highlights?.[0]).toContain("Schwierigkeitsstufe 3");
  });

  it("kids get friendly lines", () => {
    const g = game({ mode: { mode: "kids", allow16: false, difficulty: "mixed" } });
    for (const id of ["a", "b", "c"]) g.answer(id, true);
    g.until("decide");
    for (const id of ["a", "b", "c"]) g.choose(id, "cash");
    expect(read(g)).not.toContain("Feigling");
  });
});
