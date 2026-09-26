import { PIXELPANIK_FILE_SCORING, PIXELPANIK_MOTIFS } from "@couch-clash/content";
import {
  BOT_CONFIG,
  type GameModeSettings,
  type ModuleContext,
  type ModuleInitOptions,
  type ModuleUpdate,
  type ScoringSettings,
} from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { GAME_MODULES, normalizeScoring } from "../src";
import { allowedTypos, buildCatalog, isCorrectGuess, levenshtein, normalizeAnswer } from "../src/pixelpanik/match";
import { PIXELPANIK_CONFIG, pixelpanikMeta } from "../src/pixelpanik/meta";
import { isPartyMotif, motifFitsMode, spreadCategories, type PixelpanikState } from "../src/pixelpanik/module";
import { MOTIFS_WITH_IMAGES, pixelpanikWithImages as mod } from "./fixtures/pixelpanik-pool";

const T0 = 1_700_000_000_000;
const catalog = buildCatalog(PIXELPANIK_MOTIFS);
const byAnswer = (answer: string) => PIXELPANIK_MOTIFS.find((m) => m.answer === answer)!;
const right = (guess: string, answer: string) => isCorrectGuess(guess, byAnswer(answer).id, catalog);

function seeded(seed = 42) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

const family: GameModeSettings = { mode: "family", allow16: false, difficulty: "mixed" };
const kids: GameModeSettings = { mode: "kids", allow16: false, difficulty: "mixed" };
const party: GameModeSettings = { mode: "party", allow16: false, difficulty: "mixed" };

const PLAYERS = ["a", "b", "c"];
function ctx(now: number, ids = PLAYERS, random = seeded()): ModuleContext {
  return { now, random, players: ids.map((id) => ({ id, connected: true, name: id.toUpperCase() })) };
}

function options(mode: GameModeSettings, extra: Partial<ModuleInitOptions> = {}): ModuleInitOptions {
  return {
    questionCount: 5,
    scoring: normalizeScoring(pixelpanikMeta, pixelpanikMeta.scoring),
    excludeContentIds: [],
    mode,
    ...extra,
  };
}

function start(mode: GameModeSettings = family, extra: Partial<ModuleInitOptions> = {}, ids = PLAYERS) {
  return mod.init(ctx(T0, ids), options(mode, extra));
}

function act(u: ModuleUpdate<PixelpanikState>, player: string, action: unknown, now: number, ids = PLAYERS) {
  const r = mod.handleAction(u.state, mod.actionSchema.parse(action), player, ctx(now, ids));
  if ("error" in r) throw new Error(r.error);
  return r;
}

const answerOf = (s: PixelpanikState) => s.motifs[s.index]!.answer;

describe("answer check (typo tolerance)", () => {
  it("normalizes case, umlauts, accents, spaces, hyphens and articles", () => {
    expect(normalizeAnswer("  Der Eiffel-Turm! ")).toBe("eiffelturm");
    expect(normalizeAnswer("Österreich")).toBe("oesterreich");
    expect(normalizeAnswer("Großbritannien")).toBe("grossbritannien");
    expect(normalizeAnswer("Sagrada Família")).toBe("sagradafamilia");
    expect(normalizeAnswer("Citroën 2CV")).toBe("citroen2cv");
  });

  it("allows more typos for longer words", () => {
    expect([3, 4, 5, 6, 9, 10, 20].map(allowedTypos)).toEqual([0, 1, 1, 2, 2, 3, 3]);
    expect(levenshtein("kolloseum", "kolosseum")).toBe(2);
    expect(levenshtein("abc", "xyz12345", 2)).toBe(3);
  });

  it("accepts the typos from the brief", () => {
    expect(right("Kolloseum", "Kolosseum")).toBe(true);
    expect(right("eifelturm", "Eiffelturm")).toBe(true);
    expect(right("Kolosseum", "Kolosseum")).toBe(true);
    expect(right("koloseum", "Kolosseum")).toBe(true);
    expect(right("eiffel turm", "Eiffelturm")).toBe(true);
    expect(right("der eifelturm", "Eiffelturm")).toBe(true);
    expect(right("Freiheitsstatu", "Freiheitsstatue")).toBe(true);
    expect(right("Osterreich", "Österreich")).toBe(true);
    expect(right("golden gate", "Golden Gate Bridge")).toBe(true);
    expect(right("Pizzza", "Pizza")).toBe(true);
  });

  it("rejects wrong answers and things that are just close to another motif", () => {
    expect(right("Irland", "Island")).toBe(false);
    expect(right("Island", "Island")).toBe(true);
    expect(right("Schweden", "Schweiz")).toBe(false);
    expect(right("Big Ben", "Eiffelturm")).toBe(false);
    expect(right("UK", "USA")).toBe(false);
    expect(right("USS", "USA")).toBe(false);
    expect(right("", "Pizza")).toBe(false);
    expect(right("Turm", "Eiffelturm")).toBe(false);
  });

  it("every motif accepts its own answer and synonyms", () => {
    for (const m of PIXELPANIK_MOTIFS) {
      for (const term of [m.answer, ...m.synonyms]) expect(isCorrectGuess(term, m.id, catalog), `${m.id} ${term}`).toBe(true);
    }
  });

  it("a motif's answer never counts for a different motif (unless they share the word)", () => {
    for (const m of PIXELPANIK_MOTIFS) {
      for (const other of PIXELPANIK_MOTIFS) {
        if (other.id === m.id) continue;
        const shared = [other.answer, ...other.synonyms].some((t) => normalizeAnswer(t) === normalizeAnswer(m.answer));
        if (shared) continue;
        expect(isCorrectGuess(m.answer, other.id, catalog), `${m.answer} → ${other.answer}`).toBe(false);
      }
    }
  });
});

describe("content", () => {
  it("modes: kids motifs have four options, party motifs are only for the party", () => {
    const partyOnly = PIXELPANIK_MOTIFS.filter(isPartyMotif);
    expect(partyOnly.length).toBeGreaterThanOrEqual(pixelpanikMeta.questionsPerRound.max);
    expect(partyOnly.every((m) => m.modes.join() === "party")).toBe(true);
    const kidsMotifs = PIXELPANIK_MOTIFS.filter((m) => motifFitsMode(m, kids));
    expect(kidsMotifs.length).toBeGreaterThanOrEqual(pixelpanikMeta.questionsPerRound.max);
    expect(kidsMotifs.every((m) => m.kids_choices?.includes(m.answer))).toBe(true);
  });

  it("the points in motive.json match the category defaults", () => {
    expect(Object.values(PIXELPANIK_FILE_SCORING)).toEqual([200, 180, 150, 100, 50, 20]);
    expect(normalizeScoring(pixelpanikMeta, undefined).points).toMatchObject({ s1: 200, s2: 180, s3: 150, s4: 100, s5: 50, s6: 20 });
  });

  it("motifs without pictures are never played", () => {
    const real = GAME_MODULES.pixelpanik;
    const u = real.init(ctx(T0), options(family));
    expect(u.done ?? false).toBe(real.listContent!().length === 0);
    const withPictures = new Set(real.listContent!().map((e) => e.id));
    expect((u.state as PixelpanikState).motifs.every((m) => withPictures.has(m.id))).toBe(true);
    expect(real.listContent!().every((e) => (e.payload as { image?: unknown }).image)).toBe(true);
  });
});

describe("picking the pictures", () => {
  it("Kids: only kids motifs · Familie: never party motifs · Party (mode-neutral): any motif, no party share", () => {
    expect(pixelpanikMeta.modeNeutral).toBe(true);
    const partyCounts = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      const k = mod.init(ctx(T0, PLAYERS, seeded(seed)), options(kids)).state;
      expect(k.motifs.every((m) => PIXELPANIK_MOTIFS.find((x) => x.id === m.id)!.modes.includes("kinder"))).toBe(true);
      expect(k.input).toBe("choice");
      const f = mod.init(ctx(T0, PLAYERS, seeded(seed)), options(family)).state;
      expect(f.motifs.some((m) => m.party)).toBe(false);
      expect(f.input).toBe("text");
      for (const n of [3, 5, 10]) {
        for (const partyShare of [undefined, 1] as const) {
          const mode: GameModeSettings = partyShare ? { ...party, partyShare } : party;
          const p = mod.init(ctx(T0, PLAYERS, seeded(seed)), options(mode, { questionCount: n })).state;
          expect(p.motifs).toHaveLength(n);
          expect(p.input).toBe("text");
          partyCounts.add(p.motifs.filter((m) => m.party).length);
        }
      }
    }
    // No quota: party motifs come up only as often as chance brings them (16 of 169) – even with "Party-Anteil" 100 %.
    expect(partyCounts.has(0)).toBe(true);
    expect(Math.max(...partyCounts)).toBeLessThan(10);
  });

  it("never the same motif twice in a session (room)", () => {
    const used: string[] = [];
    for (let round = 0; round < 12; round++) {
      const u = mod.init(ctx(T0, PLAYERS, seeded(round + 1)), options(family, { excludeContentIds: [...used], questionCount: 10 }));
      const ids = u.state.motifs.map((m) => m.id);
      expect(ids.some((id) => used.includes(id))).toBe(false);
      used.push(...(u.usedContentIds ?? []));
    }
    expect(new Set(used).size).toBe(used.length);
  });

  it("mixes the topics – no two pictures of the same topic in a row when avoidable", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { motifs } = mod.init(ctx(T0, PLAYERS, seeded(seed)), options(family, { questionCount: 10 })).state;
      for (let i = 1; i < motifs.length; i++) expect(motifs[i]!.category).not.toBe(motifs[i - 1]!.category);
    }
    const items = ["a", "a", "a", "b", "b", "c"].map((category) => ({ category }));
    expect(spreadCategories(items).map((x) => x.category).join("")).toBe("ababac");
  });

  it("difficulty mix weights the pick (leicht → mostly easy motifs)", () => {
    let easy = 0;
    let hard = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const mode: GameModeSettings = { ...family, difficulty: "easy" };
      for (const m of mod.init(ctx(T0, PLAYERS, seeded(seed)), options(mode)).state.motifs) {
        const d = PIXELPANIK_MOTIFS.find((x) => x.id === m.id)!.difficulty;
        if (d === "leicht") easy++;
        if (d === "schwer") hard++;
      }
    }
    expect(easy).toBeGreaterThan(hard * 2);
  });
});

describe("stages and points (free text)", () => {
  it("six stages of 4 s, then the solution (5 s) and the leaderboard", () => {
    let u = start();
    expect(u.phaseEndsAt).toBe(T0 + 4_000);
    let now = T0;
    for (let stage = 1; stage < 6; stage++) {
      now += 4_000;
      u = mod.onTimer(u.state, ctx(now));
      expect(u.state.stage).toBe(stage);
      expect(u.state.step).toBe("stage");
    }
    now += 4_000;
    u = mod.onTimer(u.state, ctx(now));
    expect(u.state.step).toBe("reveal");
    expect(u.phaseEndsAt).toBe(now + PIXELPANIK_CONFIG.revealMs);
    expect(u.scoreDelta).toEqual({});
    u = mod.onTimer(u.state, ctx(now + 5_000));
    expect(u.state.step).toBe("leaderboard");
    u = mod.onTimer(u.state, ctx(now + 12_000));
    expect(u.state.index).toBe(1);
    expect(u.state.stage).toBe(0);
  });

  it("the stage duration comes from the host settings", () => {
    const scoring = normalizeScoring(pixelpanikMeta, { ...pixelpanikMeta.scoring, points: { ...pixelpanikMeta.scoring.points, stageSeconds: 7 } });
    expect(start(family, { scoring }).phaseEndsAt).toBe(T0 + 7_000);
    const silly = { ...scoring, points: { ...scoring.points, stageSeconds: 999 } } as ScoringSettings;
    expect(start(family, { scoring: silly }).phaseEndsAt).toBe(T0 + PIXELPANIK_CONFIG.maxStageSeconds * 1000);
  });

  it("points by the stage of the right answer – everyone right in the same stage gets the same", () => {
    let u = start();
    const answer = answerOf(u.state);
    u = act(u, "a", { type: "guess", text: answer }, T0 + 1_000);
    u = mod.onTimer(u.state, ctx(T0 + 4_000)); // stage 2
    u = mod.onTimer(u.state, ctx(T0 + 8_000)); // stage 3
    u = act(u, "b", { type: "guess", text: answer.toLowerCase() }, T0 + 9_000);
    expect(u.scoreDelta).toBeUndefined(); // secured, booked at the solution
    u = act(u, "c", { type: "guess", text: answer }, T0 + 9_500);
    expect(u.state.step).toBe("reveal"); // everyone done → solution right away
    expect(u.scoreDelta).toEqual({ a: 200, b: 150, c: 150 });
    const pub = mod.toPublicState(u.state, { role: "host" });
    expect(pub.reveal?.results.a).toMatchObject({ correct: true, stage: 0, points: 200 });
    expect(pub.reveal?.results.b).toMatchObject({ correct: true, stage: 2, points: 150 });
  });

  it("full resolution gives 20, nobody right gives nothing", () => {
    let u = start(family, {}, ["a"]);
    for (let i = 1; i <= 5; i++) u = mod.onTimer(u.state, ctx(T0 + i * 4_000, ["a"]));
    expect(u.state.stage).toBe(5);
    u = act(u, "a", { type: "guess", text: answerOf(u.state) }, T0 + 21_000, ["a"]);
    expect(u.scoreDelta).toEqual({ a: 20 });
    expect(u.state.events.map((e) => e.type)).toContain("LATE_CORRECT");
  });

  it("wrong = out for this picture (spectator), no second try; the picture ends once everyone is done", () => {
    let u = start();
    u = act(u, "a", { type: "guess", text: "Ganz was anderes" }, T0 + 500);
    expect(mod.toPublicState(u.state, { role: "player", playerId: "a" }).me?.status).toBe("out");
    const again = mod.handleAction(u.state, { type: "guess", text: answerOf(u.state) }, "a", ctx(T0 + 600));
    expect(again).toEqual({ error: "ALREADY_ANSWERED" });
    u = act(u, "b", { type: "guess", text: answerOf(u.state) }, T0 + 700);
    expect(u.state.step).toBe("stage");
    u = act(u, "c", { type: "guess", text: "Quatsch" }, T0 + 800);
    expect(u.state.step).toBe("reveal");
    expect(u.scoreDelta).toEqual({ b: 200 });
    expect(u.state.events.map((e) => e.type)).toEqual(["WRONG", "EARLY_CORRECT", "WRONG"]);
  });

  it("a right guess locks the player (points secured)", () => {
    let u = start();
    u = act(u, "a", { type: "guess", text: answerOf(u.state) }, T0 + 500);
    const me = mod.toPublicState(u.state, { role: "player", playerId: "a" });
    expect(me.me?.status).toBe("correct");
    expect(me.players.find((p) => p.id === "a")).toMatchObject({ status: "correct", points: 200 });
    expect(mod.handleAction(u.state, { type: "guess", text: "x" }, "a", ctx(T0 + 600))).toEqual({ error: "ALREADY_ANSWERED" });
  });

  it("the host picks on someone when nobody tried in stage 1; says 'Keiner' when nobody got it", () => {
    let u = start();
    u = mod.onTimer(u.state, ctx(T0 + 4_000));
    const quiet = u.state.events.at(-1)!;
    expect(quiet).toMatchObject({ type: "NOBODY_YET", stage: 1 });
    expect(PLAYERS).toContain(quiet.playerId);
    for (let i = 2; i <= 6; i++) u = mod.onTimer(u.state, ctx(T0 + i * 4_000));
    expect(u.state.events.at(-1)?.type).toBe("NOBODY");
  });

  it("disconnected players don't block the end of a picture", () => {
    let u = start();
    const answer = answerOf(u.state);
    u = act(u, "a", { type: "guess", text: answer }, T0 + 500);
    const r = mod.onPlayersChanged!(u.state, {
      now: T0 + 600,
      random: seeded(),
      players: [
        { id: "a", connected: true },
        { id: "b", connected: false },
        { id: "c", connected: false },
      ],
    });
    expect(r?.state.step).toBe("reveal");
  });
});

describe("Kids (multiple choice)", () => {
  it("wrong option: greyed out for good, locked until the next stage – never out", () => {
    let u = start(kids);
    const motif = u.state.motifs[0]!;
    const wrong = [0, 1, 2, 3].find((i) => i !== motif.correctChoice)!;
    u = act(u, "a", { type: "choice", index: wrong }, T0 + 500);
    let me = mod.toPublicState(u.state, { role: "player", playerId: "a" }).me!;
    expect(me.status).toBe("locked");
    expect(me.wrongChoices).toEqual([wrong]);
    expect(mod.handleAction(u.state, { type: "choice", index: motif.correctChoice! }, "a", ctx(T0 + 600))).toEqual({ error: "ALREADY_ANSWERED" });

    u = mod.onTimer(u.state, ctx(T0 + 4_000));
    me = mod.toPublicState(u.state, { role: "player", playerId: "a" }).me!;
    expect(me.status).toBe("open");
    expect(me.wrongChoices).toEqual([wrong]);
    expect(mod.handleAction(u.state, { type: "choice", index: wrong }, "a", ctx(T0 + 4_100))).toEqual({ error: "ALREADY_ANSWERED" });

    u = act(u, "a", { type: "choice", index: motif.correctChoice! }, T0 + 4_500);
    expect(mod.toPublicState(u.state, { role: "player", playerId: "a" }).me!.status).toBe("correct");
    u = act(u, "b", { type: "choice", index: motif.correctChoice! }, T0 + 4_600);
    u = act(u, "c", { type: "choice", index: motif.correctChoice! }, T0 + 4_700);
    expect(u.state.step).toBe("reveal");
    expect(u.scoreDelta).toEqual({ a: 180, b: 180, c: 180 });
  });

  it("the four options are shuffled, include the answer and go to TV and phones", () => {
    const u = start(kids);
    const pub = mod.toPublicState(u.state, { role: "player", playerId: "a" });
    expect(pub.choices).toHaveLength(4);
    expect(pub.choices).toContain(answerOf(u.state));
  });
});

describe("anti-cheat: pictures", () => {
  it("the TV only ever gets the current stage – the full picture only from stage 6 on; phones get none", () => {
    let u = start();
    const stages = u.state.motifs[0]!.stages;
    for (let stage = 0; stage < 6; stage++) {
      const host = mod.toPublicState(u.state, { role: "host" });
      expect(host.image).toEqual({ url: stages[stage], size: [4, 8, 16, 32, 64, 0][stage] });
      const json = JSON.stringify(host);
      for (const later of stages.slice(stage + 1)) expect(json).not.toContain(later);
      for (const viewer of [{ role: "player", playerId: "a" }, { role: "guest" }] as const) {
        const pub = JSON.stringify(mod.toPublicState(u.state, viewer));
        for (const url of stages) expect(pub).not.toContain(url);
      }
      u = mod.onTimer(u.state, ctx(T0 + (stage + 1) * 4_000));
    }
    expect(mod.toPublicState(u.state, { role: "host" }).image?.url).toBe(stages[5]);
  });

  it("free text: the answer is not in any state before the solution", () => {
    const u = start();
    const answer = answerOf(u.state);
    for (const viewer of [{ role: "host" }, { role: "player", playerId: "a" }] as const) {
      expect(JSON.stringify(mod.toPublicState(u.state, viewer))).not.toContain(answer);
    }
  });

  it("stage files have unrelated names (the stand-ins, like the script's)", () => {
    const stages = MOTIFS_WITH_IMAGES[0]!.image!.stages;
    expect(new Set(stages).size).toBe(6);
  });
});

describe("bots", () => {
  it("guess once per picture (free text) and play Kids options", () => {
    const bot = { ...BOT_CONFIG, random: () => 0 };
    const u = start();
    expect(mod.botAction!(u.state, "a", ctx(T0), bot)).toEqual({ type: "guess", text: answerOf(u.state) });
    const k = start(kids);
    expect(mod.botAction!(k.state, "a", ctx(T0), bot)).toEqual({ type: "choice", index: k.state.motifs[0]!.correctChoice });
  });
});
