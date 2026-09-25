import { SKURRIL_STORIES_DE, type SkurrilStory } from "@couch-clash/content";
import type { CategoryMeta, ModuleContext, ModulePlayer, ScoringSettings } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { GAME_MODULES } from "../src";
import { createBluffEngine } from "../src/bluff/engine";
import { EVENT_JUDGE_STYLE, LEXIKON_JUDGE_STYLE, judgePrompt, parseJudgeReply } from "../src/bluff/judge";
import { bluffMeta } from "../src/bluff/meta";
import { bluffModule, lexikonAdapter } from "../src/bluff/module";
import type { BluffAction, BluffPublicState } from "../src/bluff/types";
import { CATEGORY_METAS, planGame } from "../src/meta";
import { skurrilMeta } from "../src/skurril/meta";
import { createSkurrilModule, skurrilAdapter, skurrilModule, sourceDomain, SKURRIL_PARTY_SHARE, type SkurrilState } from "../src/skurril/module";

const T0 = 1_700_000_000_000;
const MARATHON: SkurrilStory = {
  id: "skurril-t1",
  context: "Beim Olympia-Marathon 1904 kam ein Läufer als Erster ins Ziel und wurde schon als Sieger gefeiert.",
  question: "Warum wurde er disqualifiziert?",
  answer: "Er war einen Teil der Strecke im Auto mitgefahren",
  fact: "Fred Lorz war nach 15 Kilometern erschöpft eingestiegen und später wieder ausgestiegen.",
  year: 1904,
  primaryCategory: "SPORTS",
  tags: ["olympia"],
  difficulty: 2,
  ageRating: 12,
  adult: false,
  source: "https://de.wikipedia.org/wiki/Olympische_Sommerspiele_1904/Marathon",
};
const SECOND: SkurrilStory = { ...MARATHON, id: "skurril-t2", year: null, answer: "In Kanada", question: "Wo?" };
const scoring: ScoringSettings = skurrilMeta.scoring;
const players = (ids: string[]): ModulePlayer[] => ids.map((id) => ({ id, connected: true }));
const ctx = (now: number, ps: ModulePlayer[], random = () => 0.999): ModuleContext => ({ now, players: ps, random });

function setup(stories = [MARATHON, SECOND], ids = ["a", "b", "c", "d"]) {
  const mod = createSkurrilModule(stories);
  const ps = players(ids);
  let state = mod.init(ctx(T0, ps), { questionCount: stories.length, scoring, excludeContentIds: [] }).state;
  let now = T0;
  const act = (playerId: string, action: BluffAction) => {
    now += 1000;
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
  return { mod, act, timer, resolve, get state(): SkurrilState { return state; } };
}

const view = (mod: ReturnType<typeof createSkurrilModule>, state: SkurrilState, playerId?: string): BluffPublicState =>
  mod.toPublicState(state, playerId ? { role: "player", playerId } : { role: "host" });

describe("one bluff engine, two games", () => {
  it("both games are registered and run on the same engine", () => {
    expect(GAME_MODULES.bluff).toBe(bluffModule);
    expect(GAME_MODULES.skurril).toBe(skurrilModule);
    expect(Object.keys(skurrilModule).sort()).toEqual(Object.keys(bluffModule).sort());
    // Same engine, different adapters: the engine can build either game.
    expect(createBluffEngine(skurrilAdapter).meta).toBe(skurrilMeta);
    expect(createBluffEngine(lexikonAdapter).meta).toBe(bluffMeta);
  });

  it("the Bluff-Lexikon keeps its question, judge input and scoring", () => {
    const words = [{ id: "w", article: "der" as const, word: "Borborygmus", definition: "Hörbares Knurren im Bauch", ageRating: 12 as const, tags: ["x"], difficulty: 2 as const, alcohol: false, adult: false }];
    const state = bluffModule.init(ctx(T0, players(["a", "b"])), { questionCount: 1, scoring: bluffMeta.scoring, excludeContentIds: [], extraContent: words }).state;
    expect(bluffModule.toPublicState(state, { role: "host" }).question).toMatch(/ist …\?$/);
    const prompt = judgePrompt("der Borborygmus", "Hörbares Knurren im Bauch", [{ key: "s1", text: "magenknurren" }]);
    expect(prompt.system.split("\n")[0]).toBe(LEXIKON_JUDGE_STYLE.intro);
    expect(prompt.system).toContain("Wort „Zipperlein“");
    expect(prompt.system).not.toContain("Skurrile");
    expect(JSON.parse(prompt.user.split("\n")[1]!)).toEqual({
      word: "der Borborygmus",
      realDefinition: "Hörbares Knurren im Bauch",
      submissions: [{ id: "s1", text: "magenknurren" }],
    });
    expect(bluffMeta.modes).toEqual(["family", "party"]);
    expect(bluffMeta.secondsPerQuestion).toBe(60);
  });
});

describe("Skurrile Ereignisse meta", () => {
  it("own game: Kids/Familie/Party, 2+ players, 75 s writing, 3–10 stories, Bluff-Lexikon scoring", () => {
    expect(skurrilMeta).toMatchObject({ id: "skurril", name: "Skurrile Ereignisse", emoji: "🤯", minPlayers: 2, secondsPerQuestion: 75 });
    expect(skurrilMeta.modes).toEqual(["kids", "family", "party"]);
    expect(skurrilMeta.questionsPerRound).toEqual({ min: 3, default: 5, max: 10 });
    expect(skurrilMeta.scoring).toEqual(bluffMeta.scoring);
    expect(skurrilMeta.scoringPoints.map((p) => [p.id, p.default])).toEqual(bluffMeta.scoringPoints.map((p) => [p.id, p.default]));
    expect(skurrilMeta.scoringFields).toEqual(bluffMeta.scoringFields);
    expect(skurrilMeta.estimatedSecondsPerQuestion).toBeGreaterThan(bluffMeta.estimatedSecondsPerQuestion);
  });

  it("comes right after the Bluff-Lexikon in the library", () => {
    const ids = CATEGORY_METAS.map((m) => m.id);
    expect(ids.indexOf("skurril")).toBe(ids.indexOf("bluff") + 1);
  });

  it("Zufall: offered to kids too, but never both bluff games in 15 minutes", () => {
    const metas = CATEGORY_METAS as readonly CategoryMeta[];
    const pools = Object.fromEntries(metas.map((m) => [m.id, 500]));
    let kidsGotIt = false;
    for (let seed = 1; seed <= 100; seed++) {
      let s = seed * 7919;
      const random = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
      const short = planGame({ mode: "family", targetMinutes: 15, categories: metas, pools, random, playerCount: 4 }).rounds.map((r) => r.categoryId);
      expect(short.includes("bluff") && short.includes("skurril"), short.join(",")).toBe(false);
      const kids = planGame({ mode: "kids", targetMinutes: 45, categories: metas, pools, random, playerCount: 4 }).rounds.map((r) => r.categoryId);
      expect(kids).not.toContain("bluff");
      kidsGotIt ||= kids.includes("skurril");
    }
    expect(kidsGotIt).toBe(true);
  });
});

describe("skurril adapter", () => {
  it("prompt, real answer and reveal extra", () => {
    expect(skurrilAdapter.promptText(MARATHON)).toBe("Warum wurde er disqualifiziert?");
    expect(skurrilAdapter.story!(MARATHON)).toEqual({ context: MARATHON.context, year: 1904 });
    expect(skurrilAdapter.readPrompt!(MARATHON)).toBe(`${MARATHON.context} Warum wurde er disqualifiziert?`);
    expect(skurrilAdapter.realAnswer(MARATHON)).toBe("Er war einen Teil der Strecke im Auto mitgefahren");
    expect(skurrilAdapter.revealLead(MARATHON)).toBe("Die Wahrheit:");
    expect(skurrilAdapter.revealExtra!(MARATHON)).toEqual({ fact: MARATHON.fact, source: "de.wikipedia.org" });
    expect(skurrilAdapter.placeholder).toBe("z. B. Er ist unterwegs eingeschlafen");
  });

  it("source domain: without www, null for garbage", () => {
    expect(sourceDomain("https://www.guinnessworldrecords.com/news/x")).toBe("guinnessworldrecords.com");
    expect(sourceDomain("kaputt")).toBeNull();
  });

  it("admin catalog: context + question, answer and source link", () => {
    const entry = skurrilModule.listContent!().find((e) => e.id === "skurril-kids-001")!;
    const story = SKURRIL_STORIES_DE.find((s) => s.id === "skurril-kids-001")!;
    expect(entry.text).toBe(`${story.context} ${story.question}`);
    expect(entry.answer).toBe(story.answer);
    expect(entry.source).toBe(story.source);
    expect(skurrilModule.parseContent!({ ...story, adult: true }).ok).toBe(false);
  });
});

describe("mode filters and party mix", () => {
  const init = (mode: "kids" | "family" | "party", questionCount: number, seed = 0.42) => {
    let s = seed;
    const random = () => (s = (s * 9301 + 49297) % 233280 / 233280);
    return skurrilModule.init(ctx(T0, players(["a", "b"]), random), {
      questionCount,
      scoring,
      excludeContentIds: [],
      mode: { mode, allow16: false, difficulty: "mixed" },
    }).state.words;
  };

  it("Kids: only stories rated 6 (any difficulty)", () => {
    const kids = init("kids", 10);
    expect(kids).toHaveLength(10);
    expect(kids.every((s) => s.ageRating === 6 && !s.adult)).toBe(true);
    const all = new Set<string>();
    for (let i = 1; i < 30; i++) for (const s of init("kids", 10, i / 31)) all.add(s.id);
    expect([...all].some((id) => SKURRIL_STORIES_DE.find((s) => s.id === id)!.difficulty > 1)).toBe(true);
  });

  it("Familie: up to 12, never a party story", () => {
    for (let i = 1; i < 20; i++) {
      const family = init("family", 10, i / 23);
      expect(family.every((s) => s.ageRating <= 12 && !s.adult)).toBe(true);
    }
  });

  it("Party: family pool plus about 30 % party stories, spread out", () => {
    expect(SKURRIL_PARTY_SHARE).toBe(0.3);
    const party = init("party", 10);
    expect(party).toHaveLength(10);
    expect(party.filter((s) => s.adult)).toHaveLength(3);
    expect(party.map((s, i) => (s.adult ? i : -1)).filter((i) => i >= 0)).toEqual([1, 4, 7]);
    expect(init("party", 5).filter((s) => s.adult)).toHaveLength(2);
  });
});

describe("event judge", () => {
  it("prompt: event rules, the German few-shots and the story as data", () => {
    const g = setup();
    g.act("a", { type: "define", text: "ist mit dem Auto gefahren" });
    g.act("b", { type: "define", text: "hat abgekürzt" });
    g.act("c", { type: "define", text: "ist mit dem Zug gefahren" });
    g.act("d", { type: "define", text: "er is eingeschlafen unterwegs lol" });
    const task = g.mod.pendingTask!(g.state)!;
    expect(task).toMatchObject({ id: "skurril-check:0", kind: "llm_json", model: "strong" });
    const { system, user } = task.input;
    expect(system.split("\n")[0]).toBe(EVENT_JUDGE_STYLE.intro);
    expect(system).toContain("KERN-Ereignis");
    expect(system).toContain("„hat abgekürzt“ → bluff");
    expect(system).toContain("„ist mit dem Zug gefahren“ → bluff");
    expect(system).toContain("„ist mit dem Auto gefahren“ → correct");
    expect(system).toContain("DERSELBEN grammatischen Form");
    expect(system).not.toContain("Zipperlein");
    expect(JSON.parse(user.split("\n")[1]!)).toEqual({
      context: MARATHON.context,
      question: MARATHON.question,
      realAnswer: MARATHON.answer,
      submissions: [
        { id: "s1", text: "ist mit dem Auto gefahren" },
        { id: "s2", text: "hat abgekürzt" },
        { id: "s3", text: "ist mit dem Zug gefahren" },
        { id: "s4", text: "er is eingeschlafen unterwegs lol" },
      ],
    });
  });

  it("mocked model: the car answer knew it, the vague and the different ones are bluffs", () => {
    const g = setup();
    g.act("a", { type: "define", text: "ist mit dem Auto gefahren" });
    g.act("b", { type: "define", text: "hat abgekürzt" });
    g.act("c", { type: "define", text: "ist mit dem Zug gefahren" });
    g.act("d", { type: "define", text: "er is eingeschlafen unterwegs lol" });
    g.resolve({
      results: [
        { id: "s1", verdict: "correct", confidence: 0.9, reason: "gleicher Kern", polished: "Er ist mit dem Auto gefahren", sameIdea: true, group: 1 },
        { id: "s2", verdict: "bluff", confidence: 0.8, reason: "zu vage", polished: "Er hat abgekürzt", sameIdea: true, group: 2 },
        { id: "s3", verdict: "bluff", confidence: 0.9, reason: "anderes Detail", polished: "Er ist mit dem Zug gefahren", sameIdea: true, group: 3 },
        { id: "s4", verdict: "bluff", confidence: 0.9, reason: "anders", polished: "Er ist unterwegs eingeschlafen", sameIdea: true, group: 4 },
      ],
    });
    expect(g.state.step).toBe("present");
    expect(g.state.knewIt).toEqual(["a"]);
    expect(g.state.options!.map((o) => o.text).sort()).toEqual(
      ["Er hat abgekürzt", "Er ist mit dem Zug gefahren", "Er ist unterwegs eingeschlafen", "Er war einen Teil der Strecke im Auto mitgefahren"].sort(),
    );
  });

  it("polishing: unusable texts fall back to the local cleanup; unsure 'correct' is a bluff", () => {
    const subs = [
      { key: "s1", text: "weil der hund das gefressen hat!!" },
      { key: "s2", text: "ne gummiente glaub ich 🦆" },
      { key: "s3", text: "mit dem auto" },
    ];
    const judged = parseJudgeReply(
      {
        results: [
          { id: "s1", verdict: "bluff", polished: "Weil der Hund es gefressen hat!", sameIdea: true, group: 1 },
          { id: "s2", verdict: "bluff", polished: "Eine gelbe Gummiente, die ein Kapitän über Bord geworfen hat und die jahrelang trieb", sameIdea: true, group: 2 },
          { id: "s3", verdict: "correct", confidence: 0.4, polished: "Mit dem Auto", sameIdea: true, group: 3 },
        ],
      },
      subs,
    )!;
    expect(judged.get("s1")!.text).toBe("Weil der hund das gefressen hat");
    expect(judged.get("s2")!.text).toBe("Ne gummiente");
    expect(judged.get("s3")!.verdict).toBe("bluff");
  });

  it("no answer from the model in time: local check, texts shown as written (cleaned)", () => {
    const g = setup();
    g.act("a", { type: "define", text: "Er war einen Teil der Strecke im Auto mitgefahren" });
    g.act("b", { type: "define", text: "hat abgekürzt!!" });
    g.act("c", { type: "define", text: "hat abgekürzt" });
    g.act("d", { type: "define", text: "Zug" });
    g.timer(); // check → present without the AI
    expect(g.state.knewIt).toEqual(["a"]);
    const fakes = g.state.options!.filter((o) => !o.correct);
    expect(fakes.map((o) => o.text).sort()).toEqual(["Hat abgekürzt", "Zug"]);
    expect(fakes.find((o) => o.text === "Hat abgekürzt")!.authors.sort()).toEqual(["b", "c"]);
  });
});

describe("Skurrile Ereignisse flow", () => {
  it("story on TV and phone, voice reads it, reveal with the truth, fact and source; same scoring", () => {
    const g = setup(undefined, ["a", "b", "c"]);
    const write = view(g.mod, g.state, "a");
    expect(write.story).toEqual({ context: MARATHON.context, year: 1904 });
    expect(write.question).toBe(MARATHON.question);
    expect(write.placeholder).toBe("z. B. Er ist unterwegs eingeschlafen");
    expect(write.reveal).toBeNull();
    expect(JSON.stringify(write)).not.toContain(MARATHON.answer);
    expect(g.mod.readAloud!(g.state)).toEqual({ key: "prompt:0", items: [{ cue: "prompt", text: `${MARATHON.context} ${MARATHON.question}` }] });

    g.act("a", { type: "define", text: "Er ist eingeschlafen" });
    g.act("b", { type: "define", text: "Er ist mit dem Zug gefahren" });
    g.act("c", { type: "define", text: "Er hatte falsche Schuhe" });
    g.resolve(null);
    expect(g.mod.readAloud!(g.state)!.key).toBe("present:0");
    g.timer(); // present → vote
    const s = g.state;
    const real = s.options!.findIndex((o) => o.correct);
    const ofB = s.options!.findIndex((o) => o.authors.includes("b"));
    g.act("a", { type: "vote", option: ofB });
    g.act("b", { type: "vote", option: real });
    const last = g.act("c", { type: "vote", option: ofB });
    expect(g.state.step).toBe("reveal");
    // b: found the truth (+100) and fooled 2 of 2 (+100) → 200; others 0.
    expect(last).toMatchObject({ scoreDelta: { b: 200 } });

    const reveal = view(g.mod, g.state).reveal!;
    expect(reveal.lead).toBe("Die Wahrheit:");
    expect(reveal.definition).toBe(MARATHON.answer);
    expect(reveal.extra).toEqual({ fact: MARATHON.fact, source: "de.wikipedia.org" });

    const facts = g.mod.revealFacts!(g.state)!;
    expect(facts.question).toBe(`${MARATHON.context} ${MARATHON.question}`);
    expect(facts.correctAnswer).toBe(MARATHON.answer);
    expect(facts.answers.b!.note).toBe("hat 2 Mitspieler mit der erfundenen Antwort reingelegt");
    expect(facts.highlights?.[0]).toContain("dabei");

    expect(g.mod.toStats!(g.state)).toMatchObject({ contentId: "skurril-t1", answers: 3, correct: 1, extra: { fooledVotes: 2 } });
    expect(g.mod.progress!(g.state)).toMatchObject({ contentId: "skurril-t1", revealed: true });

    g.timer(); // solution
    g.timer(); // leaderboard
    g.timer(); // next story
    expect(g.state.step).toBe("write");
    expect(view(g.mod, g.state).story).toEqual({ context: SECOND.context, year: null });
  });

  it("knew the story: note for the host", () => {
    const g = setup(undefined, ["a", "b"]);
    g.act("a", { type: "define", text: "Er war einen Teil der Strecke im Auto mitgefahren" });
    g.act("b", { type: "define", text: "Er hatte falsche Schuhe" });
    g.resolve(null);
    g.timer(); // present → vote
    g.act("b", { type: "vote", option: g.state.options!.findIndex((o) => o.correct) });
    expect(g.mod.revealFacts!(g.state)!.answers.a!.note).toBe("kannte die wahre Geschichte");
  });

  it("the Bluff-Lexikon has no story and no read-out while writing", () => {
    const state = bluffModule.init(ctx(T0, players(["a", "b"])), { questionCount: 1, scoring: bluffMeta.scoring, excludeContentIds: [] }).state;
    expect(bluffModule.toPublicState(state, { role: "host" }).story).toBeUndefined();
    expect(bluffModule.readAloud!(state)).toBeNull();
  });
});
