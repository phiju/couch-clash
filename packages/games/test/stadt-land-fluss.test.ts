import { SLF_DATA_DE } from "@couch-clash/content";
import type { GameModeSettings, ModuleContext, ModuleInitOptions, ModuleUpdate } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { normalizeScoring } from "../src";
import { judgeLetter, parseCheckReply, judgeAnswers } from "../src/stadt-land-fluss/judge";
import { SLF_DEFAULTS, slfMeta } from "../src/stadt-land-fluss/meta";
import { createSlfModule, planLetters, slfSettings, type SlfState } from "../src/stadt-land-fluss/module";
import { categoriesForMode, letterContentId } from "../src/stadt-land-fluss/pick";
import { parseGagReply, slfStandardLines } from "../src/stadt-land-fluss/script";
import { checkLetter, sameAnswer } from "../src/stadt-land-fluss/text";

function seeded(seed = 7) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

const MODES: Record<"kids" | "family" | "party", GameModeSettings> = {
  kids: { mode: "kids", allow16: false, difficulty: "mixed" },
  family: { mode: "family", allow16: true, difficulty: "mixed" },
  party: { mode: "party", allow16: false, difficulty: "mixed" },
};

const options = (mode: GameModeSettings, extra: Partial<ModuleInitOptions> = {}): ModuleInitOptions => ({
  questionCount: 3,
  scoring: normalizeScoring(slfMeta, slfMeta.scoring),
  excludeContentIds: [],
  mode,
  ...extra,
});

const PARTY_IDS = new Set(SLF_DATA_DE.categories.filter((c) => c.mode === "party").map((c) => c.id));
const POINTS = { only: 20, unique: 10, duplicate: 5, vote: 10 };

describe("Stadt, Land, Fluss – content and picking", () => {
  it("has every category from the spec, typed fakt / kreativ, per mode", () => {
    const count = (mode: string, type: string) => SLF_DATA_DE.categories.filter((c) => c.mode === mode && c.type === type).length;
    expect(count("kinder", "fakt")).toBe(11);
    expect(count("kinder", "kreativ")).toBe(3);
    expect(count("familie", "fakt")).toBe(11);
    expect(count("familie", "kreativ")).toBe(4);
    expect(count("party", "kreativ")).toBe(21);
    expect(count("party", "fakt")).toBe(0);
  });

  it("party categories NEVER come up outside Party mode (pool and 300 planned rounds each)", () => {
    expect(categoriesForMode(SLF_DATA_DE, "kids").some((c) => PARTY_IDS.has(c.id))).toBe(false);
    expect(categoriesForMode(SLF_DATA_DE, "family").some((c) => PARTY_IDS.has(c.id))).toBe(false);
    for (const mode of [MODES.kids, MODES.family]) {
      for (let seed = 1; seed <= 300; seed++) {
        const rounds = planLetters(SLF_DATA_DE, options(mode, { questionCount: 6 }), seeded(seed), 6);
        for (const r of rounds) expect(r.categories.filter((c) => PARTY_IDS.has(c.id))).toEqual([]);
      }
    }
  });

  it("Kids: only kids categories · Familie: family + kids · Party: family + party, at least 2 of 4 from party", () => {
    for (let seed = 1; seed <= 100; seed++) {
      for (const r of planLetters(SLF_DATA_DE, options(MODES.kids), seeded(seed), 3)) {
        expect(r.categories).toHaveLength(3);
        expect(r.categories.every((c) => c.mode === "kinder")).toBe(true);
      }
      for (const r of planLetters(SLF_DATA_DE, options(MODES.family), seeded(seed), 4)) {
        expect(r.categories.every((c) => c.mode === "kinder" || c.mode === "familie")).toBe(true);
      }
      for (const r of planLetters(SLF_DATA_DE, options(MODES.party), seeded(seed), 4)) {
        expect(r.categories).toHaveLength(4);
        expect(r.categories.every((c) => c.mode === "familie" || c.mode === "party")).toBe(true);
        expect(r.categories.filter((c) => c.mode === "party").length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("every letter has at least one kreativ category (for the vote) and no category twice", () => {
    for (const mode of Object.values(MODES)) {
      for (let seed = 1; seed <= 50; seed++) {
        for (const r of planLetters(SLF_DATA_DE, options(mode), seeded(seed), 4)) {
          expect(r.categories.some((c) => c.type === "kreativ")).toBe(true);
          expect(new Set(r.categories.map((c) => c.id)).size).toBe(r.categories.length);
        }
      }
    }
  });

  it("letters: Kids never C, Q, X, Y; never twice in a game", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const letters = planLetters(SLF_DATA_DE, options(MODES.kids, { questionCount: 6 }), seeded(seed), 3).map((r) => r.letter);
      expect(letters.filter((l) => "CQXY".includes(l))).toEqual([]);
      expect(new Set(letters).size).toBe(6);
      // A second round in the same game: none of these letters again.
      const again = planLetters(
        SLF_DATA_DE,
        options(MODES.kids, { questionCount: 6, currentGameContentIds: letters.map(letterContentId) }),
        seeded(seed + 1),
        3,
      ).map((r) => r.letter);
      expect(again.filter((l) => letters.includes(l))).toEqual([]);
    }
  });

  it("round length, categories and points come from the host settings (Kids have their own)", () => {
    const scoring = normalizeScoring(slfMeta, {
      ...slfMeta.scoring,
      points: { ...slfMeta.scoring.points, only: 30, vote: 15, categoriesAdults: 5, secondsAdults: 45, categoriesKids: 2, secondsKids: 120, stopSeconds: 7 },
    });
    expect(slfSettings(scoring, "party")).toMatchObject({ categories: 5, writeMs: 45_000, stopMs: 7_000, points: { only: 30, vote: 15 } });
    expect(slfSettings(scoring, "kids")).toMatchObject({ categories: 2, writeMs: 120_000 });
    expect(slfSettings(slfMeta.scoring, "family")).toMatchObject({ categories: 4, writeMs: 60_000, stopMs: 10_000 });
    expect(slfSettings(slfMeta.scoring, "kids")).toMatchObject({ categories: 3, writeMs: 90_000 });
  });

  it("the fixed lines (letters A–Z, Stopp, time's up, nobody, vote) can be cached up front", () => {
    const lines = slfStandardLines("family", [..."ABC"], 10);
    expect(lines).toContain("Der Buchstabe ist: A!");
    expect(lines).toContain("Stopp! Noch 10 Sekunden für alle anderen!");
    expect(lines).toContain("Zeit ist um – Stifte weg!");
  });
});

describe("Stadt, Land, Fluss – checking", () => {
  it("first letter: articles ignored, umlauts count as their vowel", () => {
    expect(checkLetter("der Rhein", "R")).toBe("ok");
    expect(checkLetter("der Rhein", "D")).toBe("maybe");
    expect(checkLetter("Die Hard", "D")).toBe("maybe");
    expect(checkLetter("Ägypten", "A")).toBe("ok");
    expect(checkLetter("Österreich", "O")).toBe("ok");
    expect(checkLetter("Kanada", "C")).toBe("no");
    expect(checkLetter("B", "B")).toBe("no");
    expect(checkLetter("  schwarzwaldt ", "S")).toBe("ok");
  });

  it("spelling variants are the same answer", () => {
    expect(sameAnswer("Muenchen", "München")).toBe(true);
    expect(sameAnswer("der Rhein", "Rhein")).toBe(true);
    expect(sameAnswer("Schwarzwaldt", "Schwarzwald")).toBe(true);
    expect(sameAnswer("Bonn", "Born")).toBe(false);
  });

  const categories = [
    { label: "Stadt", type: "fakt" as const },
    { label: "Sexspielzeug", type: "kreativ" as const },
  ];

  it("points: only valid 20, unique 10, shared 5 (also spelling variants), empty / wrong letter / invalid 0", () => {
    const order = ["a", "b", "c", "d", "e"];
    // Stadt with M.
    const stadt = { a: ["München"], b: ["Muenchen"], c: ["Mainz"], d: ["Mumpitzhausen"], e: ["Berlin"] };
    const sent = judgeAnswers(1, stadt, order, "M");
    expect(sent.map((s) => s.text)).toEqual(["München", "Muenchen", "Mainz", "Mumpitzhausen"]);
    const reply = {
      results: [
        { id: "a1", valid: true, normalized: "München", duplicateGroup: "muc" },
        { id: "a2", valid: true, normalized: "München", duplicateGroup: "muc-2" },
        { id: "a3", valid: true, normalized: "Mainz", duplicateGroup: "mainz" },
        { id: "a4", valid: false, normalized: "Mumpitzhausen", duplicateGroup: "x", note: "erfunden" },
      ],
    };
    const ai = parseCheckReply(reply, sent);
    expect(ai).not.toBeNull();
    const judged = judgeLetter({ letter: "M", categories: [categories[0]!], order, answers: stadt, ai, points: POINTS });
    expect(judged.a![0]).toMatchObject({ verdict: "valid", points: 5, duplicate: true });
    expect(judged.b![0]).toMatchObject({ verdict: "valid", points: 5, duplicate: true });
    expect(judged.c![0]).toMatchObject({ verdict: "valid", points: 10, duplicate: false });
    expect(judged.d![0]).toMatchObject({ verdict: "invalid", points: 0 });
    expect(judged.e![0]).toMatchObject({ verdict: "letter", points: 0 });

    // Sexspielzeug (kreativ) with D: everything with D counts – "Dildoh" is the same as "Dildo"; the only valid → 20.
    const kreativ = { a: ["Dildo"], b: ["Dildo"], c: ["Duschkopf"], d: [""], e: ["Dildoh"] };
    const sentK = judgeAnswers(1, kreativ, order, "D");
    const aiK = parseCheckReply(
      { results: sentK.map((s) => ({ id: s.key, valid: true, normalized: s.text === "Duschkopf" ? "Duschkopf" : "Dildo", duplicateGroup: s.text === "Duschkopf" ? "d2" : "d1", typo: s.text === "Dildoh" })) },
      sentK,
    );
    const k = judgeLetter({ letter: "D", categories: [categories[1]!], order, answers: kreativ, ai: aiK, points: POINTS });
    expect(k.a![0]!.points).toBe(5);
    expect(k.e![0]).toMatchObject({ points: 5, typo: true });
    expect(k.c![0]!.points).toBe(10);
    expect(k.d![0]).toMatchObject({ verdict: "empty", points: 0 });

    const alone = judgeLetter({ letter: "D", categories: [categories[1]!], order: ["a", "b"], answers: { a: ["Dildo"], b: [""] }, ai: null, points: POINTS });
    expect(alone.a![0]).toMatchObject({ points: 20, only: true });
  });

  it("an unusable AI reply → only the first letter counts (fakt answers are not checked for plausibility)", () => {
    const sent = judgeAnswers(1, { a: ["Mumpitzhausen"], b: ["München"] }, ["a", "b"], "M");
    expect(parseCheckReply({ results: [{ id: "a1", valid: true }] }, sent)).toBeNull();
    expect(parseCheckReply("kaputt", sent)).toBeNull();
    const judged = judgeLetter({ letter: "M", categories: [categories[0]!], order: ["a", "b"], answers: { a: ["Mumpitzhausen"], b: ["München"] }, ai: null, points: POINTS });
    expect(judged.a![0]!.points).toBe(10);
    expect(judged.b![0]!.points).toBe(10);
  });

  it("the AI never makes a wrong letter valid; offensive answers are censored", () => {
    const answers = { a: ["Kanada", "Mist"] };
    const sent = judgeAnswers(2, answers, ["a"], "M");
    expect(sent).toHaveLength(1);
    const ai = parseCheckReply({ results: [{ id: "a1", valid: true, offensive: true }] }, sent);
    const judged = judgeLetter({ letter: "M", categories, order: ["a"], answers, ai, points: POINTS });
    expect(judged.a![0]!.verdict).toBe("letter");
    expect(judged.a![1]).toMatchObject({ verdict: "censored", points: 0 });
  });

  it("gags: names filled in for the tokens, unknown tokens and gags without a player are dropped", () => {
    const names = new Map([
      ["P1", "Philip"],
      ["P2", "Max"],
    ]);
    const gags = parseGagReply(
      {
        gags: [
          { category: "c1", gag: "P2, wir müssen reden." },
          { category: "c2", gag: "P7 hat gewonnen." },
          { category: "c3", gag: "Tolle Runde." },
        ],
      },
      3,
      names,
    );
    expect(gags.get(0)).toBe("Max, wir müssen reden.");
    expect(gags.has(1)).toBe(false);
    expect(gags.has(2)).toBe(false);
  });
});

// ── The round flow ────────────────────────────────────────────────────

const START = 1_700_000_000_000;

function harness(ids: string[], mode: GameModeSettings = MODES.family) {
  const module = createSlfModule();
  let now = START;
  const connected = new Set(ids);
  const names: Record<string, string> = { a: "Philip", b: "Tina", c: "Max" };
  const random = seeded(3);
  const ctx = (): ModuleContext => ({
    now,
    random,
    players: ids.map((id) => ({ id, connected: connected.has(id), name: names[id] ?? id })),
  });
  let update: ModuleUpdate<SlfState> = module.init(ctx(), options(mode, { questionCount: 2 }));
  const scores: Record<string, number> = {};
  const apply = (u: ModuleUpdate<SlfState>) => {
    for (const [p, d] of Object.entries(u.scoreDelta ?? {})) scores[p] = (scores[p] ?? 0) + d;
    update = u;
    return u;
  };
  return {
    module,
    get state() {
      return update.state;
    },
    get update() {
      return update;
    },
    scores,
    at: (t: number) => (now = t),
    now: () => now,
    ctx,
    disconnect: (id: string) => connected.delete(id),
    act(id: string, action: unknown) {
      const r = module.handleAction(update.state, module.actionSchema.parse(action), id, ctx());
      if ("error" in r) return r.error;
      apply(r);
      return null;
    },
    timer() {
      now = Math.max(now, update.phaseEndsAt ?? now);
      return apply(module.onTimer(update.state, ctx()));
    },
    resolve(result: unknown) {
      const task = module.pendingTask!(update.state)!;
      const r = module.resolveTask!(update.state, task.id, result, ctx());
      if (r) apply(r);
      return task;
    },
  };
}

describe("Stadt, Land, Fluss – round flow", () => {
  it("Stopp! needs every field filled; then everyone else has 10 s – the same end for all screens", () => {
    const h = harness(["a", "b", "c"]);
    expect(h.state.step).toBe("intro");
    h.timer();
    expect(h.state.step).toBe("write");
    const n = h.state.rounds[0]!.categories.length;
    const L = h.state.rounds[0]!.letter;
    h.at(START + 20_000);
    expect(h.act("a", { type: "stop", answers: [`${L}a`] })).toBe("INVALID_MESSAGE");
    expect(h.act("a", { type: "stop", answers: Array(n).fill(`${L}xyz`) })).toBeNull();
    expect(h.state.stop).toEqual({ playerId: "a", at: START + 20_000 });
    expect(h.update.phaseEndsAt).toBe(START + 20_000 + SLF_DEFAULTS.stopSeconds * 1000);
    expect(h.module.toPublicState(h.state, { role: "player", playerId: "b" }).stepEndsAt).toBe(START + 30_000);
    expect(h.module.toPublicState(h.state, { role: "host" }).stepEndsAt).toBe(START + 30_000);
    // A second stop does nothing; the others can still type until the end.
    expect(h.act("b", { type: "stop", answers: Array(n).fill(`${L}b`) })).toBe("TOO_LATE");
    h.at(START + 29_000);
    expect(h.act("c", { type: "answers", answers: [`${L}c`] })).toBeNull();
    h.at(START + 30_001);
    expect(h.act("c", { type: "answers", answers: [`${L}cc`] })).toBe("TOO_LATE");
    h.timer();
    expect(h.state.step).toBe("check");
  });

  it("a stop never makes the writing longer", () => {
    const h = harness(["a", "b"]);
    h.timer();
    const n = h.state.rounds[0]!.categories.length;
    h.at(h.state.stepEndsAt - 3_000);
    h.act("a", { type: "stop", answers: Array(n).fill(`${h.state.rounds[0]!.letter}x`) });
    expect(h.state.stepEndsAt).toBe(h.state.stepStartedAt + 60_000);
  });

  it("a player who drops out keeps the answers saved so far; the host reads every player's answer", () => {
    const h = harness(["a", "b", "c"]);
    h.timer();
    const round = h.state.rounds[0]!;
    const L = round.letter;
    h.act("a", { type: "answers", answers: round.categories.map((_, i) => `${L}alpha${i}`) });
    h.act("b", { type: "answers", answers: [`${L}beta`] });
    h.disconnect("b");
    h.timer();
    expect(h.state.step).toBe("check");
    // AI fails → first letter only, no gags.
    h.resolve(null);
    expect(h.state.step).toBe("reveal");
    const pub = h.module.toPublicState(h.state, { role: "host" });
    expect(pub.reveal!.aiChecked).toBe(false);
    const all = pub.reveal!.categories.map((c) => c.script).join(" ");
    expect(all).toContain(`${L}beta`);
    expect(all).toContain("Max hat nichts");
    for (const c of pub.reveal!.categories) {
      expect(c.answers.map((x) => x.playerId)).toEqual(["a", "b", "c"]);
      for (const name of ["Philip", "Tina", "Max"]) expect(c.script).toContain(name);
    }
    expect(pub.reveal!.categories[0]!.answers[1]).toMatchObject({ text: `${L}beta`, verdict: "valid" });
  });

  it("nobody has anything in a category → the host's own line", () => {
    const h = harness(["a", "b"]);
    h.timer();
    h.timer();
    // Nothing to check → straight to the reveal.
    expect(h.state.step).toBe("reveal");
    const read = h.module.readAloud!(h.state)!;
    expect(read.items.some((i) => !("long" in i) && /niemand|keiner|nichts/i.test(i.text))).toBe(true);
  });

  it("full letter: AI check + gags, vote for the funniest kreativ answer (never your own), +10, points booked at the tally", () => {
    const h = harness(["a", "b", "c"], MODES.party);
    h.timer();
    const round = h.state.rounds[0]!;
    const L = round.letter;
    const creative = round.categories.findIndex((c) => c.type === "kreativ");
    const answers = {
      a: round.categories.map((_, i) => (i === creative ? `${L}ildo` : `${L}aaa${i}`)),
      b: round.categories.map((_, i) => (i === creative ? `${L}ildo` : "")),
      c: round.categories.map((_, i) => (i === creative ? `${L}uschkopf` : `${L}ccc${i}`)),
    };
    for (const [id, a] of Object.entries(answers)) h.act(id, { type: "answers", answers: a });
    h.timer();
    const check = h.module.pendingTask!(h.state)!;
    expect(check.model).toBe("strong");
    // Names never go to the text model.
    expect(check.input.user).not.toMatch(/Philip|Tina|Max/);
    const sent = judgeAnswers(round.categories.length, h.state.answers, h.state.participants, L);
    h.resolve({ results: sent.map((s) => ({ id: s.key, valid: true, normalized: s.text, duplicateGroup: s.text })) });
    expect(h.state.step).toBe("script");
    const script = h.module.pendingTask!(h.state)!;
    expect(script.input.user).not.toMatch(/Philip|Tina|Max/);
    h.resolve({ gags: round.categories.map((_, i) => ({ category: `c${i + 1}`, gag: "P3, wir müssen reden." })) });
    expect(h.state.step).toBe("reveal");
    const reveal = h.module.readAloud!(h.state)!;
    expect(reveal.items).toHaveLength(round.categories.length);
    expect(reveal.items[creative]!.text).toMatch(new RegExp(`Philip (sagt|schreibt|nimmt) ${L}ildo, Tina \\1 ${L}ildo, Max \\1 ${L}uschkopf\\.`));
    expect(reveal.items[creative]!.text).toMatch(/Max, wir müssen reden\.$/);
    // Points on the TV already, not booked yet.
    expect(h.scores).toEqual({});

    h.timer();
    expect(h.state.step).toBe("vote");
    const pubA = h.module.toPublicState(h.state, { role: "player", playerId: "a" });
    const own = pubA.myCandidates;
    expect(own.length).toBeGreaterThan(0);
    expect(h.act("a", { type: "vote", candidate: own[0]! })).toBe("OWN_ANSWER");
    const duschkopf = pubA.candidates!.findIndex((c) => c.text === `${L}uschkopf`);
    const dildo = pubA.candidates!.findIndex((c) => c.text === `${L}ildo`);
    expect(h.act("a", { type: "vote", candidate: duschkopf })).toBeNull();
    expect(h.act("b", { type: "vote", candidate: duschkopf })).toBeNull();
    expect(h.act("c", { type: "vote", candidate: dildo })).toBeNull();
    // Everyone voted → tally right away.
    expect(h.state.step).toBe("tally");
    const tally = h.state.tally!;
    expect(tally.winners.map((w) => w.playerId)).toEqual(["c"]);
    expect(tally.points.c!.vote).toBe(10);
    expect(h.module.readAloud!(h.state)!.items[0]!.text).toBe(`Die witzigste Antwort: ${L}uschkopf – von Max!`);
    // Dildo shared (a, b): 5 each; Duschkopf unique: 10 + vote 10.
    expect(h.scores.b).toBe(5);
    expect(h.scores.c).toBe(tally.points.c!.total);
    expect(h.scores.a).toBe(tally.points.a!.total);

    h.timer();
    expect(h.state.step).toBe("leaderboard");
    h.timer();
    expect(h.state.step).toBe("intro");
    expect(h.state.index).toBe(1);
    expect(h.state.rounds[1]!.letter).not.toBe(L);
  });

  it("a tie between different answers: every winning answer is named, each author +10", () => {
    const h = harness(["a", "b"]);
    h.timer();
    const round = h.state.rounds[0]!;
    const L = round.letter;
    const creative = round.categories.findIndex((c) => c.type === "kreativ");
    const own = (tag: string) => round.categories.map((_, i) => (i === creative ? `${L}${tag}` : ""));
    h.act("a", { type: "answers", answers: own("ackel") });
    h.act("b", { type: "answers", answers: own("ummel") });
    h.timer();
    h.resolve(null);
    h.timer();
    expect(h.state.step).toBe("vote");
    const idx = (text: string) => h.state.candidates!.findIndex((c) => c.text === text);
    h.act("a", { type: "vote", candidate: idx(`${L}ummel`) });
    h.act("b", { type: "vote", candidate: idx(`${L}ackel`) });
    expect(h.state.step).toBe("tally");
    expect(h.state.tally!.winners.map((w) => w.playerId)).toEqual(["a", "b"]);
    expect(h.state.tally!.points.a!.vote).toBe(10);
    expect(h.state.tally!.points.b!.vote).toBe(10);
    expect(h.module.readAloud!(h.state)!.items[0]!.text).toBe(
      `Gleichstand! Die witzigsten Antworten: ${L}ackel – von Philip; und ${L}ummel – von Tina!`,
    );
  });

  it("before the reveal nobody sees other players' answers", () => {
    const h = harness(["a", "b"]);
    h.timer();
    h.act("a", { type: "answers", answers: ["Geheim"] });
    const b = h.module.toPublicState(h.state, { role: "player", playerId: "b" });
    const host = h.module.toPublicState(h.state, { role: "host" });
    expect(JSON.stringify(b)).not.toContain("Geheim");
    expect(JSON.stringify(host)).not.toContain("Geheim");
    expect(h.module.toPublicState(h.state, { role: "player", playerId: "a" }).myAnswers![0]).toBe("Geheim");
  });
});
