import type { BluffWord } from "@couch-clash/content";
import type { ModuleContext, ModulePlayer, ScoringSettings } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { calculateBaseScore } from "../src/scoring";
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
};
const WORD2: BluffWord = { ...WORD, id: "bluff-t2", word: "Pütz", definition: "Eimer" };
const scoring: ScoringSettings = bluffMeta.scoring;

const players = (ids: string[], connected = true): ModulePlayer[] => ids.map((id) => ({ id, connected }));
/** random() = 0 → shuffle keeps a predictable order. */
const ctx = (now: number, ps: ModulePlayer[], random = () => 0.999): ModuleContext => ({ now, players: ps, random });

function setup(ids = ["a", "b", "c"], words = [WORD, WORD2]) {
  const mod = createBluffModule(words);
  const ps = players(ids);
  const init = mod.init(ctx(T0, ps), { questionCount: words.length, scoring, excludeContentIds: [] });
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
  it("adds up: right vote, fooled players, correct definition – not capped", () => {
    expect(calculateBaseScore("bluff", { votedCorrect: true, knewIt: false, fooled: 0 }, 100)).toBe(100);
    expect(calculateBaseScore("bluff", { votedCorrect: false, knewIt: false, fooled: 3 }, 100)).toBe(150);
    expect(calculateBaseScore("bluff", { votedCorrect: true, knewIt: false, fooled: 2 }, 100)).toBe(200);
    expect(calculateBaseScore("bluff", { votedCorrect: false, knewIt: true, fooled: 0 }, 100)).toBe(100);
    expect(calculateBaseScore("bluff", { votedCorrect: false, knewIt: false, fooled: 0 }, 100)).toBe(0);
    // Configurable via maxPoints and shares.
    expect(calculateBaseScore("bluff", { votedCorrect: true, knewIt: false, fooled: 1, perFooledShare: 1 }, 200)).toBe(400);
  });

  it("meta: speed modifier off, 2+ players, registered", () => {
    expect(bluffMeta.scoring.speedModifier.enabled).toBe(false);
    expect(bluffMeta.scoringFields).not.toContain("speedModifier");
    expect(bluffMeta.minPlayers).toBe(2);
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

  it("merged definitions: every author gets +50 per vote", () => {
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
    expect(t.state.results!.a!.finalScore).toBe(100 + 2 * 50);
    expect(t.state.results!.b!.finalScore).toBe(2 * 50);
    expect(t.state.results!.c!.finalScore).toBe(50); // fooled b
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
    expect(t.state.results!.a).toMatchObject({ knewIt: true, finalScore: 100 });
    expect(t.state.results!.b!.finalScore).toBe(150);
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

