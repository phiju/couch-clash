import type { BluffWord } from "@couch-clash/content";
import type { ModuleContext, ModulePlayer, ScoringSettings } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { calculateBaseScore, scoreAnswer } from "../src/scoring";
import { bluffMeta, BLUFF_CONFIG } from "../src/bluff/meta";
import { cleanDefinition, createBluffModule, type BluffState } from "../src/bluff/module";
import type { BluffAction } from "../src/bluff/types";
import { GAME_MODULES } from "../src";

const T0 = 1_700_000_000_000;
const WORD: BluffWord = {
  id: "bluff-t1",
  article: "das",
  word: "Kummet",
  definition: "gepolsterter Halsring für Zugpferde",
  ageRating: 12,
  tags: ["sprache"],
  difficulty: 3,
  alcohol: false,
  adult: false,
};
const WORD2: BluffWord = { ...WORD, id: "bluff-t2", word: "Pütz", definition: "Eimer" };
const scoring: ScoringSettings = bluffMeta.scoring;

const players = (ids: string[], connected = true): ModulePlayer[] => ids.map((id) => ({ id, connected }));
/** random() = 0 → shuffle keeps a predictable order. */
const ctx = (now: number, ps: ModulePlayer[], random = () => 0.999): ModuleContext => ({ now, players: ps, random });

function setup(ids = ["a", "b", "c"], words = [WORD, WORD2], aiDecoys = false) {
  const mod = createBluffModule(words);
  const ps = players(ids);
  const init = mod.init(ctx(T0, ps), { questionCount: words.length, scoring, excludeContentIds: [], options: { aiDecoys } });
  let state = init.state;
  let now = T0;
  const act = (playerId: string, action: BluffAction, dt = 1000) => {
    now += dt;
    const r = mod.handleAction(state, action, playerId, ctx(now, ps));
    if ("error" in r) return r.error;
    state = r.state;
    return r;
  };
  const timer = () => {
    now += 1;
    const u = mod.onTimer(state, ctx(now, ps));
    state = u.state;
    return u;
  };
  const resolve = (result: unknown) => {
    const task = mod.pendingTask!(state)!;
    const u = mod.resolveTask!(state, task.id, result, ctx(now, ps));
    if (u) state = u.state;
    return u;
  };
  return { mod, ps, init, get state() { return state; }, set state(s: BluffState) { state = s; }, act, timer, resolve, get now() { return now; } };
}

/** Judge reply for s1.. in submission order. */
const reply = (...entries: [string, string?, number?][]) => ({
  results: entries.map(([verdict, text, group], i) => ({ id: `s${i + 1}`, verdict, text, group: group ?? i + 1 })),
});

const optionOf = (s: BluffState, author: string) => s.options!.findIndex((o) => o.authors.includes(author));
const correctOf = (s: BluffState) => s.options!.findIndex((o) => o.correct);

describe("bluff scoring strategy", () => {
  const points = { find: 100, know: 100, fool: 100 };
  const base = { found: false, knew: false, pickers: 0, realPickers: 0, eligibleVoters: 3, points };
  const score = (over: Partial<typeof base>) => calculateBaseScore("bluff", { ...base, ...over }, 100);

  it("the fooling bonus scales with the share of players fooled (the spec examples)", () => {
    // 4 players, Philip's bluff fools 2 of the 3 others → +67
    expect(score({ pickers: 2, eligibleVoters: 3 })).toBe(67);
    // 10 players, fools 5 of 9 → +56 (instead of +250)
    expect(score({ pickers: 5, eligibleVoters: 9 })).toBe(56);
    // found the real one AND fooled all others → 100 + 100
    expect(score({ found: true, pickers: 3 })).toBe(200);
    // knew it, 3 of 3 voters pick the real one → 100 + 100; 1 of 3 → 100 + 33
    expect(score({ knew: true, realPickers: 3 })).toBe(200);
    expect(score({ knew: true, realPickers: 1 })).toBe(133);
  });

  it("nobody else could vote → no bonus, no division by zero", () => {
    expect(score({ pickers: 0, eligibleVoters: 0 })).toBe(0);
    expect(score({ knew: true, realPickers: 0, eligibleVoters: 0 })).toBe(100);
  });

  it("the per-question cap (default 200) is applied on top, also with bigger amounts", () => {
    const scoring = { ...bluffMeta.scoring, points: { find: 100, know: 100, fool: 150 } };
    const r = scoreAnswer(scoring, { ...base, found: true, pickers: 3, points: scoring.points }, { responseTimeMs: 0, timeLimitMs: 1 });
    expect(r.baseScore).toBe(250);
    expect(r.finalScore).toBe(200);
  });

  it("meta: speed modifier off, registered", () => {
    expect(bluffMeta.scoring.speedModifier.enabled).toBe(false);
    expect(bluffMeta.scoringFields).not.toContain("speedModifier");
    expect(GAME_MODULES.bluff.meta).toBe(bluffMeta);
  });
});

describe("bluff flow", () => {
  it("write → check → present → vote → reveal → solution → leaderboard → next word", () => {
    const t = setup();
    expect(t.state.step).toBe("write");
    expect(t.init.phaseEndsAt).toBe(T0 + 60_000);
    t.act("a", { type: "define", text: "ein Vogel" });
    t.act("b", { type: "define", text: "ein Hut" });
    expect(t.state.step).toBe("write");
    t.act("c", { type: "define", text: "ein Tanz" }); // everyone wrote → early end
    expect(t.state.step).toBe("check");
    expect(t.mod.pendingTask!(t.state)).toMatchObject({ id: "bluff-check:0", kind: "llm_json", timeoutMs: 6000, model: "strong" });
    t.resolve(reply(["bluff"], ["bluff"], ["bluff"]));
    expect(t.state.step).toBe("present");
    expect(t.state.options).toHaveLength(4);
    expect(t.mod.readAloud!(t.state)!.items.map((i) => i.text[0])).toEqual(["A", "B", "C", "D"]);
    const presentEnd = t.state.stepEndsAt;
    expect(presentEnd - t.state.stepStartedAt).toBe(BLUFF_CONFIG.presentLeadMs + 4 * BLUFF_CONFIG.presentMsPerOption);
    t.timer();
    expect(t.state.step).toBe("vote");
    expect(t.state.stepEndsAt - t.state.stepStartedAt).toBe(30_000);
    const correct = correctOf(t.state);
    t.act("a", { type: "vote", option: correct });
    t.act("b", { type: "vote", option: optionOf(t.state, "a") });
    const u = t.act("c", { type: "vote", option: optionOf(t.state, "a") }); // everyone voted → reveal
    expect(t.state.step).toBe("reveal");
    // a: right vote 100 + fooled b and c 2 × 50
    expect(typeof u !== "string" && u.scoreDelta).toEqual({ a: 200 });
    expect(t.state.results!.b).toMatchObject({ votedCorrect: false, fooled: 0, finalScore: 0 });
    t.timer();
    expect(t.state.step).toBe("solution");
    t.timer();
    expect(t.state.step).toBe("leaderboard");
    t.timer();
    expect(t.state).toMatchObject({ step: "write", index: 1, submissions: {}, votes: {}, options: null });
  });

  it("merged definitions: every author gets the full scaled bonus", () => {
    const t = setup(["a", "b", "c", "d"]);
    t.act("a", { type: "define", text: "Halsband für Hunde" });
    t.act("b", { type: "define", text: "Halsband fuer Hunde" });
    t.act("c", { type: "define", text: "ein Kuchen" });
    t.act("d", { type: "define", text: "ein Boot" });
    t.resolve(reply(["bluff", "Halsband für Hunde", 1], ["bluff", "Halsband für Hunde", 1], ["bluff", undefined, 2], ["bluff", undefined, 3]));
    expect(t.state.options).toHaveLength(4); // merged + 2 + real
    const merged = optionOf(t.state, "a");
    expect(t.state.options![merged]!.authors).toEqual(["a", "b"]);
    t.timer(); // → vote
    t.act("c", { type: "vote", option: merged });
    t.act("d", { type: "vote", option: merged });
    expect(t.act("a", { type: "vote", option: merged })).toBe("OWN_ANSWER");
    expect(t.act("b", { type: "vote", option: merged })).toBe("OWN_ANSWER");
    t.act("a", { type: "vote", option: correctOf(t.state) });
    t.act("b", { type: "vote", option: optionOf(t.state, "c") });
    expect(t.state.step).toBe("reveal");
    // 4 voters → 3 others per author; c and d fell for the merged option.
    expect(t.state.results!.a!.finalScore).toBe(100 + 67);
    expect(t.state.results!.b!.finalScore).toBe(67);
    expect(t.state.results!.a).toMatchObject({ fooled: 2, eligibleVoters: 3, foolBonus: 67 });
    expect(t.state.results!.c!.finalScore).toBe(33); // fooled b: 1 of 3
    expect(t.state.results!.d!.finalScore).toBe(0);
  });

  it("an essentially correct definition: +100, not shown, no vote", () => {
    const t = setup();
    t.act("a", { type: "define", text: "Halsring für Pferde" });
    t.act("b", { type: "define", text: "ein Hut" });
    t.act("c", { type: "define", text: "ein Tanz" });
    t.resolve(reply(["correct"], ["bluff"], ["bluff"]));
    expect(t.state.knewIt).toEqual(["a"]);
    expect(t.state.options!.map((o) => o.text)).not.toContain("Halsring für Pferde");
    const pub = t.mod.toPublicState(t.state, { role: "player", playerId: "a" });
    expect(pub).toMatchObject({ iKnewIt: true, canVote: false });
    t.timer(); // vote
    expect(t.act("a", { type: "vote", option: 0 })).toBe("WRONG_PHASE");
    t.act("b", { type: "vote", option: correctOf(t.state) });
    t.act("c", { type: "vote", option: optionOf(t.state, "b") }); // a doesn't block the early end
    expect(t.state.step).toBe("reveal");
    // a knew it: 100 + 1 of 2 voters picked the real one → +50
    expect(t.state.results!.a).toMatchObject({ knewIt: true, finalScore: 150, knowPoints: 100, knowBonus: 50, realPickers: 1 });
    // b found it (100) and fooled c, the only other voter (+100)
    expect(t.state.results!.b!.finalScore).toBe(200);
  });

  it("offensive submissions are not shown and earn nothing; typos fixed", () => {
    const t = setup();
    t.act("a", { type: "define", text: "ein Vogl aus den Alpen" });
    t.act("b", { type: "define", text: "etwas Gemeines" });
    t.act("c", { type: "define", text: "ein Tanz" });
    t.resolve(reply(["bluff", "ein Vogel aus den Alpen"], ["offensive"], ["bluff"]));
    expect(t.state.rejected).toEqual(["b"]);
    // Same look for all options: capital first letter.
    expect(t.state.options!.map((o) => o.text).sort()).toEqual(["Gepolsterter Halsring für Zugpferde", "Ein Tanz", "Ein Vogel aus den Alpen"].sort());
    // b can still vote (no own option)
    expect(t.mod.toPublicState(t.state, { role: "player", playerId: "b" }).canVote).toBe(true);
  });

  it("AI timeout: everything shown as written (identical texts still merged)", () => {
    const t = setup();
    t.act("a", { type: "define", text: "ein Hut" });
    t.act("b", { type: "define", text: "Ein  Hut!" });
    t.act("c", { type: "define", text: WORD.definition }); // literally the real one
    t.timer(); // check timed out
    expect(t.state.step).toBe("present");
    expect(t.state.knewIt).toEqual(["c"]);
    expect(t.state.options).toHaveLength(2);
    expect(t.state.options!.find((o) => !o.correct)!.authors).toEqual(["a", "b"]);
  });

  it("a null or broken AI reply falls back too", () => {
    const t = setup();
    t.act("a", { type: "define", text: "ein Hut" });
    t.act("b", { type: "define", text: "ein Boot" });
    t.act("c", { type: "define", text: "ein Tanz" });
    t.resolve({ results: [{ id: "s1", verdict: "correct" }] }); // incomplete → ignored
    expect(t.state.knewIt).toEqual([]);
    expect(t.state.options).toHaveLength(4);
  });

  it("an outdated task result is ignored", () => {
    const t = setup();
    t.act("a", { type: "define", text: "ein Hut" });
    t.act("b", { type: "define", text: "ein Boot" });
    t.act("c", { type: "define", text: "ein Tanz" });
    expect(t.mod.resolveTask!(t.state, "bluff-check:7", reply(), ctx(t.now, t.ps))).toBeNull();
    t.timer();
    expect(t.mod.resolveTask!(t.state, "bluff-check:0", reply(), ctx(t.now, t.ps))).toBeNull();
  });

  it("nobody submitted: only the real definition, no check, no voting", () => {
    const t = setup();
    t.timer(); // writing time over
    expect(t.state.step).toBe("present");
    expect(t.mod.pendingTask!(t.state)).toBeNull();
    expect(t.state.options).toEqual([{ text: "Gepolsterter Halsring für Zugpferde", correct: true, authors: [] }]);
    expect(t.mod.readAloud!(t.state)!.items[0]!.text).toBe("Die Erklärung lautet: Gepolsterter Halsring für Zugpferde");
    const u = t.timer();
    expect(t.state.step).toBe("reveal");
    expect(u.scoreDelta).toEqual({});
  });

  it("everyone knew it: nothing to vote on, points as usual", () => {
    const t = setup(["a", "b"]);
    t.act("a", { type: "define", text: "Halsring" });
    t.act("b", { type: "define", text: "Ring um den Hals von Pferden" });
    t.resolve(reply(["correct"], ["correct"]));
    t.timer();
    expect(t.state.step).toBe("reveal");
    expect(t.state.results).toMatchObject({ a: { finalScore: 100 }, b: { finalScore: 100 } });
  });

  it("only one player left: can vote for the real one only if there are other options", () => {
    const t = setup(["a"]);
    t.act("a", { type: "define", text: "ein Hut" });
    t.resolve(reply(["bluff"]));
    t.timer();
    // a's own option + the real one: a may vote (for the real one)
    expect(t.state.step).toBe("vote");
    expect(t.act("a", { type: "vote", option: optionOf(t.state, "a") })).toBe("OWN_ANSWER");
    t.act("a", { type: "vote", option: correctOf(t.state) });
    expect(t.state.results!.a!.finalScore).toBe(100);
  });

  it("players who wrote nothing can still vote", () => {
    const t = setup();
    t.act("a", { type: "define", text: "ein Hut" });
    t.act("b", { type: "define", text: "ein Boot" });
    t.timer(); // c wrote nothing
    t.resolve(reply(["bluff"], ["bluff"]));
    t.timer();
    t.act("c", { type: "vote", option: optionOf(t.state, "a") });
    expect(t.state.results).toBeNull();
    t.act("a", { type: "vote", option: correctOf(t.state) });
    t.act("b", { type: "vote", option: correctOf(t.state) });
    expect(t.state.results!.c).toMatchObject({ finalScore: 0, votedCorrect: false });
    expect(t.state.results!.a!.finalScore).toBe(150);
  });

  it("rejects wrong phases, second submissions, empty texts, bad options", () => {
    const t = setup();
    expect(t.act("a", { type: "vote", option: 0 })).toBe("WRONG_PHASE");
    expect(t.act("a", { type: "define", text: "   " })).toBe("INVALID_MESSAGE");
    t.act("a", { type: "define", text: "ein Hut" });
    expect(t.act("a", { type: "define", text: "doch was anderes" })).toBe("ALREADY_ANSWERED");
    expect(t.act("zz", { type: "define", text: "x" })).toBe("UNKNOWN_PLAYER");
    t.act("b", { type: "define", text: "ein Boot" });
    t.act("c", { type: "define", text: "ein Tanz" });
    t.resolve(reply(["bluff"], ["bluff"], ["bluff"]));
    t.timer();
    expect(t.act("a", { type: "vote", option: 9 })).toBe("INVALID_MESSAGE");
    t.act("a", { type: "vote", option: correctOf(t.state) });
    expect(t.act("a", { type: "vote", option: optionOf(t.state, "b") })).toBe("ALREADY_ANSWERED");
  });

  it("disconnected players don't block writing or voting", () => {
    const mod = createBluffModule([WORD]);
    const ps = players(["a", "b", "c"]);
    let s = mod.init(ctx(T0, ps), { questionCount: 1, scoring, excludeContentIds: [] }).state;
    const r = mod.handleAction(s, { type: "define", text: "ein Hut" }, "a", ctx(T0 + 1, ps));
    if ("error" in r) throw new Error(r.error);
    s = r.state;
    const gone = [{ id: "a", connected: true }, { id: "b", connected: false }, { id: "c", connected: false }];
    expect(mod.onPlayersChanged!(s, ctx(T0 + 2, gone))!.state.step).toBe("check");
  });

  it("an author who disconnects keeps the option – the others can still fall for it", () => {
    const g = setup(["a", "b", "c"]);
    g.act("a", { type: "define", text: "ein Hut" });
    g.act("b", { type: "define", text: "ein Boot" });
    g.act("c", { type: "define", text: "ein Tanz" });
    g.resolve(null);
    g.timer(); // present → vote
    const options = g.state.options!;
    const ofA = optionOf(g.state, "a");
    // a's phone is gone: the option stays, a just can't vote.
    const gone = [{ id: "a", connected: false }, { id: "b", connected: true }, { id: "c", connected: true }];
    expect(g.mod.onPlayersChanged!(g.state, ctx(g.now + 1, gone))).toBeNull();
    expect(g.state.options).toEqual(options);
    const vb = g.mod.handleAction(g.state, { type: "vote", option: ofA }, "b", ctx(g.now + 2, gone));
    if ("error" in vb) throw new Error(vb.error);
    const vc = g.mod.handleAction(vb.state, { type: "vote", option: ofA }, "c", ctx(g.now + 3, gone));
    if ("error" in vc) throw new Error(vc.error);
    // Everyone connected voted → reveal; a fooled both.
    expect(vc.state.step).toBe("reveal");
    expect(vc.state.results!.a!.fooled).toBe(2);
  });

  it("options look alike: capital first letter, no full stop", async () => {
    const { displayDefinition } = await import("../src/bluff/module");
    expect(displayDefinition("eitler Mann.")).toBe("Eitler Mann");
    expect(displayDefinition("Überstrumpf")).toBe("Überstrumpf");
  });

  it("cleans submissions: one line, max 80 characters", () => {
    expect(cleanDefinition("  ein\n\tHut\u0000 ")).toBe("ein Hut");
    expect(cleanDefinition("x".repeat(120))).toHaveLength(80);
  });
});

describe("bluff public state never leaks", () => {
  it("no authors or real definition before the reveal; own option marked", () => {
    const t = setup();
    t.act("a", { type: "define", text: "ein Hut" });
    t.act("b", { type: "define", text: "ein Boot" });
    t.act("c", { type: "define", text: "ein Tanz" });
    const writing = JSON.stringify(t.mod.toPublicState(t.state, { role: "player", playerId: "b" }));
    expect(writing).not.toContain(WORD.definition);
    expect(writing).not.toContain("ein Hut"); // others' texts
    t.resolve(reply(["bluff"], ["bluff"], ["bluff"]));
    t.timer();
    const host = t.mod.toPublicState(t.state, { role: "host" });
    expect(host.reveal).toBeNull();
    expect(JSON.stringify(host)).not.toMatch(/authors|correct/);
    const b = t.mod.toPublicState(t.state, { role: "player", playerId: "b" });
    expect(b.myOptions).toEqual([optionOf(t.state, "b")]);
    expect(b.mySubmission).toBe("ein Boot");
    t.act("a", { type: "vote", option: correctOf(t.state) });
    expect(t.mod.toPublicState(t.state, { role: "host" })).toMatchObject({ votedPlayerIds: ["a"], myVote: null });
  });

  it("reveal shows authors, voters and the real one; progress + stats", () => {
    const t = setup();
    t.act("a", { type: "define", text: "ein Hut" });
    t.act("b", { type: "define", text: "ein Boot" });
    t.act("c", { type: "define", text: "ein Tanz" });
    t.resolve(reply(["bluff"], ["bluff"], ["bluff"]));
    t.timer();
    t.act("a", { type: "vote", option: optionOf(t.state, "b") });
    t.act("b", { type: "vote", option: correctOf(t.state) });
    t.act("c", { type: "vote", option: optionOf(t.state, "b") });
    const pub = t.mod.toPublicState(t.state, { role: "host" });
    expect(pub.reveal!.options[optionOf(t.state, "b")]).toMatchObject({ authors: ["b"], voters: ["a", "c"] });
    expect(pub.reveal!.correctIndex).toBe(correctOf(t.state));
    expect(t.mod.progress!(t.state)).toMatchObject({ step: "reveal", revealed: true, contentId: WORD.id });
    expect(t.mod.toStats!(t.state)).toMatchObject({ contentId: WORD.id, answers: 3, correct: 1, extra: { fooledVotes: 2 } });
    const facts = t.mod.revealFacts!(t.state)!;
    expect(facts.correctAnswer).toBe(WORD.definition);
    expect(facts.answers.b).toMatchObject({ correct: true, points: 200, note: "hat 2 Mitspieler mit der erfundenen Erklärung reingelegt" });
  });
});


describe("KI-Lügen ergänzen (AI decoys)", () => {
  const DECOYS = ["Ein Werkzeug zum Hufeisen-Biegen", "Eine Mütze für Kutscher", "Ein Kartenspiel aus Tirol", "Ein Kuchen"];
  const withDecoys = (results: ReturnType<typeof reply>["results"], decoys: unknown[] = DECOYS) => ({ results, decoys });

  it("solo: the player's bluff + decoys up to 3 wrong options; find points only, a decoy gives 0", () => {
    const t = setup(["solo"], [WORD, WORD2], true);
    t.act("solo", { type: "define", text: "ein Pferdegeschirr für Kinder" });
    expect(t.state.step).toBe("check");
    const task = t.mod.pendingTask!(t.state)!;
    expect(task.input.system).toContain(`genau ${BLUFF_CONFIG.minWrongOptions} glaubwürdige, aber FALSCHE Antworten`);
    expect(task.timeoutMs).toBe(6_000);
    t.resolve(withDecoys(reply(["bluff", "Ein Pferdegeschirr für Kinder"]).results));
    const options = t.state.options!;
    expect(options).toHaveLength(4);
    expect(options.filter((o) => o.decoy).map((o) => o.text)).toEqual(DECOYS.slice(0, 2));
    expect(options.filter((o) => o.decoy).every((o) => o.authors.length === 0 && !o.correct)).toBe(true);
    t.timer(); // present → vote
    expect(t.state.step).toBe("vote");
    const decoy = options.findIndex((o) => o.decoy);
    t.act("solo", { type: "vote", option: decoy });
    expect(t.state.step).toBe("reveal");
    expect(t.state.results!.solo).toMatchObject({ finalScore: 0, votedCorrect: false, fooled: 0, foolBonus: 0 });
    const pub = t.mod.toPublicState(t.state, { role: "host" });
    expect(pub.reveal!.options[decoy]).toMatchObject({ decoy: true, authors: [], voters: ["solo"] });
    // Next word: the real one → find points (nobody else to fool).
    for (let i = 0; i < 3; i++) t.timer();
    t.act("solo", { type: "define", text: "Wassereimer" });
    t.resolve(withDecoys(reply(["correct"]).results));
    expect(t.state.knewIt).toEqual(["solo"]);
  });

  it("solo, the real one found: find points, no fool bonus", () => {
    const t = setup(["solo"], [WORD], true);
    t.act("solo", { type: "define", text: "ein Pferdegeschirr für Kinder" });
    t.resolve(withDecoys(reply(["bluff", "Ein Pferdegeschirr für Kinder"]).results));
    t.timer();
    t.act("solo", { type: "vote", option: t.state.options!.findIndex((o) => o.correct) });
    expect(t.state.results!.solo).toMatchObject({ finalScore: 100, findPoints: 100, foolBonus: 0 });
  });

  it("2 players: one decoy fills up to 3 wrong options; fooling a player still counts, decoys fool nobody", () => {
    const t = setup(["a", "b"], [WORD], true);
    t.act("a", { type: "define", text: "Ein Hut" });
    t.act("b", { type: "define", text: "Eine Suppe" });
    t.resolve(withDecoys(reply(["bluff", "Ein Hut"], ["bluff", "Eine Suppe"]).results));
    expect(t.state.options!.filter((o) => o.decoy)).toHaveLength(1);
    expect(t.state.options!.filter((o) => !o.correct)).toHaveLength(3);
    t.timer();
    const idx = (text: string) => t.state.options!.findIndex((o) => o.text === text);
    t.act("a", { type: "vote", option: idx("Eine Suppe") }); // fooled by b
    t.act("b", { type: "vote", option: t.state.options!.findIndex((o) => o.decoy) }); // fooled by the host
    expect(t.state.results!.b).toMatchObject({ fooled: 1, foolBonus: 100, findPoints: 0 });
    expect(t.state.results!.a).toMatchObject({ fooled: 0, foolBonus: 0, finalScore: 0 });
  });

  it("enough player bluffs → no decoys asked for or used", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const t = setup(ids, [WORD], true);
    ids.forEach((id, i) => t.act(id, { type: "define", text: `Bluff Nummer ${i + 1} über Pferde` }));
    expect(t.mod.pendingTask!(t.state)!.input.system).not.toContain("decoys");
    t.resolve(withDecoys(reply(...ids.map((_, i) => ["bluff", `Bluff Nummer ${i + 1} über Pferde`] as [string, string])).results));
    expect(t.state.options!.some((o) => o.decoy)).toBe(false);
  });

  it("nobody wrote anything: the check still runs for decoys, then everyone votes", () => {
    const t = setup(["a"], [WORD], true);
    t.timer(); // writing time over
    expect(t.state.step).toBe("check");
    expect(t.mod.pendingTask!(t.state)!.input.user).toContain('"submissions":[]');
    t.resolve({ results: [], decoys: DECOYS });
    expect(t.state.options!.filter((o) => o.decoy)).toHaveLength(3);
    t.timer();
    expect(t.state.step).toBe("vote");
  });

  it("AI timeout: the available options only (real + the player's bluff)", () => {
    const t = setup(["solo"], [WORD], true);
    t.act("solo", { type: "define", text: "Ein Hut" });
    t.timer(); // check timed out
    expect(t.state.options!.map((o) => !!o.decoy)).toEqual([false, false]);
    t.timer();
    expect(t.state.step).toBe("vote");
    expect(t.mod.toPublicState(t.state, { role: "player", playerId: "solo" }).canVote).toBe(true);
  });

  it("host option off: never asks for decoys, nobody wrote → straight to the real one", () => {
    const t = setup(["solo"], [WORD], false);
    t.timer();
    expect(t.state.step).toBe("present");
    expect(t.state.options).toHaveLength(1);
  });

  it("decoys are validated: not the real answer, no duplicates, no emojis/!, not too long", async () => {
    const { parseDecoys } = await import("../src/bluff/judge");
    const raw = {
      decoys: [
        "Gepolsterter Halsring für Zugpferde.",
        "Ein Hut",
        "ein hut",
        "Tolle Sache!",
        "Pferd 🐴",
        "x".repeat(81),
        42,
        "Eine Mütze für Kutscher.",
      ],
    };
    expect(parseDecoys(raw, WORD.definition, ["Ein Hut"])).toEqual(["Eine Mütze für Kutscher"]);
    expect(parseDecoys({ nope: 1 }, WORD.definition)).toEqual([]);
    expect(parseDecoys(null, WORD.definition)).toEqual([]);
    expect(bluffMeta.options.find((o) => o.id === "aiDecoys")).toMatchObject({ default: true });
  });
});
