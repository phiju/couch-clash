import { MUSIK_TEST_SONGS, type Song } from "@couch-clash/content";
import type { GameModeSettings, ModuleContext, ModuleInitOptions, ModuleUpdate } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { GAME_MODULES, normalizeScoring } from "../src";
import { artistTerms, checkArtist, isBorderline, matchesTerms, memberTerms, titleTerms } from "../src/musik/match";
import { MUSIK_CONFIG, musikMeta } from "../src/musik/meta";
import { createMusikModule, songPool, type MusikState } from "../src/musik/module";
import { eligibleSongs, kidsChoices, planRound } from "../src/musik/plan";
import { buzzPoints, scoreYears } from "../src/musik/scoring";

const T0 = 1_750_000_000_000;
const family: GameModeSettings = { mode: "family", allow16: false, difficulty: "mixed" };
const kids: GameModeSettings = { mode: "kids", allow16: false, difficulty: "mixed" };
const party: GameModeSettings = { mode: "party", allow16: false, difficulty: "mixed" };

function seeded(seed = 42) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

/** Deezer songs (previews come from the task) next to the local test songs. */
const deezer = (n: number, patch: Partial<Song> = {}): Song => ({
  ...MUSIK_TEST_SONGS[0]!,
  id: `song-dz-${n}`,
  title: `Deezer Song ${n}`,
  titleAliases: [],
  artist: `Band ${n}`,
  artistAliases: [],
  mainArtists: [`Band ${n}`],
  members: [],
  provider: "deezer",
  providerTrackId: String(1000 + n),
  previewUrl: null,
  originalYear: 1980 + n,
  genres: ["80er"],
  modes: ["family", "party"],
  ...patch,
});
const POOL: Song[] = [...MUSIK_TEST_SONGS, ...Array.from({ length: 10 }, (_, i) => deezer(i + 1))];
const mod = createMusikModule({ songs: POOL });

const PLAYERS = ["a", "b", "c"];
function ctx(now: number, ids = PLAYERS, random = seeded()): ModuleContext {
  return { now, random, players: ids.map((id) => ({ id, connected: true, name: id.toUpperCase() })) };
}

function options(mode: GameModeSettings, extra: Partial<ModuleInitOptions> = {}): ModuleInitOptions {
  return { questionCount: 6, scoring: normalizeScoring(musikMeta, musikMeta.scoring), excludeContentIds: [], mode, ...extra };
}

/** Round with only this question type. */
const only = (type: "title" | "artist" | "year") => ({
  options: { typeTitle: type === "title", typeArtist: type === "artist", typeYear: type === "year" },
});

function previewsFor(u: ModuleUpdate<MusikState>) {
  const task = mod.pendingTask!(u.state);
  if (task?.kind !== "song_previews") throw new Error("no preview task");
  return Object.fromEntries(task.input.tracks.map((t) => [t.songId, t.previewUrl ?? `https://cdn.example/${t.trackId}.mp3?token=x`]));
}

/** init → previews → announce → play */
function playing(mode = family, extra: Partial<ModuleInitOptions> = {}, ids = PLAYERS): ModuleUpdate<MusikState> {
  const init = mod.init(ctx(T0, ids), options(mode, extra));
  const loaded = mod.resolveTask!(init.state, `${init.state.roundKey}:previews`, previewsFor(init), ctx(T0 + 100, ids))!;
  expect(loaded.state.step).toBe("announce");
  const play = mod.onTimer(loaded.state, ctx(T0 + 3_000, ids));
  expect(play.state.step).toBe("play");
  return play;
}

function act(u: ModuleUpdate<MusikState>, player: string, action: unknown, now: number, ids = PLAYERS) {
  const r = mod.handleAction(u.state, mod.actionSchema.parse(action), player, ctx(now, ids));
  if ("error" in r) throw new Error(r.error);
  return r;
}
function refused(u: ModuleUpdate<MusikState>, player: string, action: unknown, now: number) {
  const r = mod.handleAction(u.state, mod.actionSchema.parse(action), player, ctx(now));
  return "error" in r ? r.error : null;
}
const song = (s: MusikState) => s.slots[s.index]!.song;

describe("answer check", () => {
  const s = MUSIK_TEST_SONGS;
  it("normalizes case, umlauts, punctuation, feat. and version brackets; articles optional", () => {
    const terms = titleTerms("Über den Wolken (Remastered 2009)", []);
    expect(matchesTerms("ueber den wolken", terms)).toBe(true);
    expect(matchesTerms("Über den Wolken!", terms)).toBe(true);
    const hosen = artistTerms("Die Toten Hosen", [], ["Die Toten Hosen"]);
    expect(matchesTerms("Toten Hosen", hosen)).toBe(true);
    expect(matchesTerms("die toten hosen", hosen)).toBe(true);
  });

  it("tolerates typos by length and uses aliases", () => {
    const terms = titleTerms("Skandal im Sperrbezirk", ["Skandal"]);
    expect(matchesTerms("Skandal im Sperbezirk", terms)).toBe(true);
    expect(matchesTerms("Skandal", terms)).toBe(true);
    expect(matchesTerms("Sperrgebiet", terms)).toBe(false);
    expect(matchesTerms("Hey", titleTerms("Hey Baby", []))).toBe(false);
  });

  it("brackets at the start are optional", () => {
    expect(matchesTerms("Died in your arms", titleTerms("(I Just) Died in Your Arms", []))).toBe(true);
  });

  it("duets: each main artist counts; a band member gives partial points", () => {
    const duet = s.find((x) => x.mainArtists.length > 1)!;
    const terms = { artist: artistTerms(duet.artist, duet.artistAliases, duet.mainArtists), members: [] };
    expect(checkArtist("Frequenz", terms)).toBe("full");
    expect(checkArtist("Amplitude", terms)).toBe("full");
    const band = { artist: artistTerms("Modern Talking", [], ["Modern Talking"]), members: memberTerms(["Dieter Bohlen", "Thomas Anders"]) };
    expect(checkArtist("modern talking", band)).toBe("full");
    expect(checkArtist("Dieter Bohlen", band)).toBe("partial");
    expect(checkArtist("Nena", band)).toBeNull();
  });

  it("a featured guest alone is not the artist", () => {
    const terms = artistTerms("Bausa feat. Joshi Mizu", [], ["Bausa"]);
    expect(matchesTerms("Bausa", terms)).toBe(true);
    expect(matchesTerms("Joshi Mizu", terms)).toBe(false);
  });

  it("borderline answers (for the optional AI check)", () => {
    const terms = titleTerms("Atemlos durch die Nacht", []);
    expect(isBorderline("Atemlos", terms)).toBe(true);
    expect(isBorderline("Atemlos durch die Nacht", terms)).toBe(false);
    expect(isBorderline("Hulapalu", terms)).toBe(false);
  });
});

describe("scoring", () => {
  const p = { fast: 200, slow: 50, fastSeconds: 5, yearExact: 200, year1: 150, year2: 100, year5: 50, yearClosest: 50 };
  it("buzz: 200 in the first 5 s, falling to 50 at the clip's end", () => {
    expect(buzzPoints(0, 30_000, p)).toBe(200);
    expect(buzzPoints(5_000, 30_000, p)).toBe(200);
    expect(buzzPoints(17_500, 30_000, p)).toBe(125);
    expect(buzzPoints(30_000, 30_000, p)).toBe(50);
  });

  it("year: exact 200 · ±1 150 · ±2 100 · ±5 50 · else 0", () => {
    expect(scoreYears({ a: 1985, b: 1986, c: 1983, d: 1980, e: 1970 }, 1985, p)).toEqual({
      points: { a: 200, b: 150, c: 100, d: 50, e: 0 },
      closest: [],
    });
  });

  it("year: nobody exact → the closest get the bonus (ties too)", () => {
    expect(scoreYears({ a: 1987, b: 1983, c: 1995 }, 1985, p)).toEqual({ points: { a: 150, b: 150, c: 0 }, closest: ["a", "b"] });
    expect(scoreYears({ a: 1970 }, 1985, p)).toEqual({ points: { a: 50 }, closest: ["a"] });
  });
});

describe("planning", () => {
  const all = { title: 1, artist: 1, year: 1 };
  it("never the same type twice in a row and never a song twice", () => {
    for (let seed = 1; seed < 30; seed++) {
      const slots = planRound(POOL, { count: 10, weights: all, gameIds: new Set(), sessionIds: new Set(), random: seeded(seed) });
      expect(slots).toHaveLength(10);
      slots.forEach((s, i) => i > 0 && expect(s.type).not.toBe(slots[i - 1]!.type));
      expect(new Set(slots.map((s) => s.candidates[0]!.id)).size).toBe(10);
    }
  });

  it("year only with verified years; a small pool makes a type rarer", () => {
    const fewYears = POOL.map((s, i) => (i < 2 ? s : { ...s, yearVerified: false }));
    let years = 0;
    for (let seed = 1; seed < 20; seed++) {
      const slots = planRound(fewYears, { count: 9, weights: all, gameIds: new Set(), sessionIds: new Set(), random: seeded(seed) });
      for (const s of slots) if (s.type === "year") expect(s.candidates.every((c) => c.yearVerified)).toBe(true);
      years += slots.filter((s) => s.type === "year").length;
    }
    expect(years / 19).toBeLessThanOrEqual(2);
  });

  it("weights: a weight of 0 switches a type off", () => {
    const slots = planRound(POOL, { count: 6, weights: { title: 1, artist: 0, year: 1 }, gameIds: new Set(), sessionIds: new Set(), random: seeded(3) });
    expect(slots.every((s) => s.type !== "artist")).toBe(true);
  });

  it("songs of this game never, earlier games only when needed", () => {
    const ids = POOL.map((s) => s.id);
    const slots = planRound(POOL, { count: 5, weights: all, gameIds: new Set(ids.slice(0, 15)), sessionIds: new Set(), random: seeded(1) });
    expect(slots.every((s) => !ids.slice(0, 15).includes(s.candidates[0]!.id))).toBe(true);
    const session = planRound(POOL, { count: 3, weights: all, gameIds: new Set(), sessionIds: new Set(ids.slice(0, 10)), random: seeded(1) });
    expect(session.every((s) => !ids.slice(0, 10).includes(s.candidates[0]!.id))).toBe(true);
  });

  it("genres and modes filter the pool (none picked = Zufall)", () => {
    expect(eligibleSongs(POOL, { mode: "kids", genres: new Set() }).every((s) => s.modes.includes("kids"))).toBe(true);
    expect(eligibleSongs(POOL, { mode: "family", genres: new Set(["ndw"]) }).map((s) => s.id)).toEqual(["song-test-bass-boogie"]);
    expect(eligibleSongs(POOL, { mode: "family", genres: new Set() }).some((s) => s.id === "song-test-piep-polonaise")).toBe(false);
    expect(eligibleSongs(POOL, { mode: "party", genres: new Set() }).some((s) => s.id === "song-test-piep-polonaise")).toBe(true);
  });

  it("kids: four different titles, one right, same genre first", () => {
    const pool = eligibleSongs(POOL, { mode: "kids", genres: new Set() });
    const { choices, correct } = kidsChoices(pool[0]!, pool, seeded(2));
    expect(choices).toHaveLength(4);
    expect(new Set(choices).size).toBe(4);
    expect(choices[correct]).toBe(pool[0]!.title);
  });
});

describe("round start", () => {
  it("asks the room for fresh previews first and plays only songs that have one", () => {
    const init = mod.init(ctx(T0), options(family, only("title")));
    expect(init.state.step).toBe("loading");
    const task = mod.pendingTask!(init.state)!;
    expect(task.kind).toBe("song_previews");
    const previews = previewsFor(init);
    // The first planned song has no preview → a spare plays instead.
    const first = init.state.pending[0]!.candidates[0]!.song.id;
    previews[first] = null as unknown as string;
    const loaded = mod.resolveTask!(init.state, task.id, previews, ctx(T0 + 50))!;
    expect(loaded.state.slots.map((s) => s.song.id)).not.toContain(first);
    expect(loaded.usedContentIds).toEqual(loaded.state.slots.map((s) => s.song.id));
    expect(loaded.state.slots.every((s) => s.song.previewUrl)).toBe(true);
  });

  it("no previews (timeout) → the local test songs still play", () => {
    const init = mod.init(ctx(T0), options(family, only("title")));
    const next = mod.onTimer(init.state, ctx(T0 + 20_000));
    expect(next.state.slots.every((s) => s.song.provider === "local")).toBe(true);
  });

  it("an empty pool ends the round right away", () => {
    const empty = createMusikModule({ songs: [] }).init(ctx(T0), options(family));
    expect(empty.done).toBe(true);
  });

  it("announces the question type before the song", () => {
    const init = mod.init(ctx(T0), options(family));
    const loaded = mod.resolveTask!(init.state, `${init.state.roundKey}:previews`, previewsFor(init), ctx(T0))!;
    expect(loaded.phaseEndsAt).toBe(T0 + MUSIK_CONFIG.announceMs);
    expect(loaded.state.events.at(-1)).toMatchObject({ type: "ANNOUNCE" });
    const pub = mod.toPublicState(loaded.state, { role: "player", playerId: "a" });
    expect(pub.typeInfo.label).toBeTruthy();
  });
});

describe("buzzer (title)", () => {
  it("the first buzz at the server wins, the music pauses, others are refused", () => {
    const play = playing(family, only("title"));
    const buzz = act(play, "b", { type: "buzz" }, T0 + 3_000 + 4_000);
    expect(buzz.state.step).toBe("answer");
    expect(buzz.state.clip!.pausedAt).toBe(4_000);
    expect(buzz.phaseEndsAt).toBe(T0 + 7_000 + 10_000);
    expect(refused(buzz, "a", { type: "buzz" }, T0 + 7_001)).toBe("BUZZER_TAKEN");
    expect(refused(buzz, "a", { type: "answer", text: "x" }, T0 + 7_001)).toBe("WRONG_PHASE");
  });

  it("right answer: points by the clip position (pauses don't count)", () => {
    const play = playing(family, only("title"));
    const buzz = act(play, "a", { type: "buzz" }, T0 + 3_000 + 3_000);
    const right = act(buzz, "a", { type: "answer", text: song(buzz.state).title.toUpperCase() }, T0 + 20_000);
    expect(right.state.step).toBe("reveal");
    expect(right.scoreDelta).toEqual({ a: 200 });
    expect(right.state.events.at(-1)).toMatchObject({ type: "FAST_CORRECT", playerId: "a" });
  });

  it("wrong → locked out for this song, the music goes on where it stopped, others may buzz", () => {
    const play = playing(family, only("title"));
    const buzz = act(play, "a", { type: "buzz" }, T0 + 3_000 + 8_000);
    const wrong = act(buzz, "a", { type: "answer", text: "Völlig falsch" }, T0 + 15_000);
    expect(wrong.state.step).toBe("play");
    expect(wrong.state.clip).toMatchObject({ pausedAt: null, startedAt: T0 + 15_000 - 8_000 });
    expect(wrong.phaseEndsAt).toBe(T0 + 15_000 + 22_000);
    expect(refused(wrong, "a", { type: "buzz" }, T0 + 16_000)).toBe("ALREADY_ANSWERED");
    const b = act(wrong, "b", { type: "buzz" }, T0 + 17_000);
    expect(b.state.clip!.pausedAt).toBe(10_000);
    const right = act(b, "b", { type: "answer", text: song(b.state).title }, T0 + 18_000);
    expect(right.scoreDelta!.b).toBe(buzzPoints(10_000, 30_000, { fast: 200, slow: 50, fastSeconds: 5 }));
  });

  it("answer timeout counts as wrong; minus points only when switched on", () => {
    const scoring = normalizeScoring(musikMeta, { ...musikMeta.scoring, points: { ...musikMeta.scoring.points, wrongBuzz: 25 } });
    const play = playing(family, { ...only("title"), scoring }, ["a"]);
    const buzz = act(play, "a", { type: "buzz" }, T0 + 4_000, ["a"]);
    const timeout = mod.onTimer(buzz.state, ctx(T0 + 15_000, ["a"]));
    // The only player is out → solution, −25.
    expect(timeout.state.step).toBe("reveal");
    expect(timeout.scoreDelta).toEqual({ a: -25 });
  });

  it("nobody by the clip's end → solution with cover, title, artist", () => {
    const play = playing(family, only("title"));
    const end = mod.onTimer(play.state, ctx(T0 + 3_000 + 30_000));
    expect(end.state.step).toBe("reveal");
    expect(end.scoreDelta).toEqual({});
    const pub = mod.toPublicState(end.state, { role: "player", playerId: "a" });
    expect(pub.reveal).toMatchObject({ title: song(end.state).title, artist: song(end.state).artist });
    expect(end.state.events.at(-1)).toMatchObject({ type: "NOBODY" });
  });

  it("phones never get the audio or the title before the solution", () => {
    const play = playing(family, only("title"));
    const phone = mod.toPublicState(play.state, { role: "player", playerId: "a" });
    const tv = mod.toPublicState(play.state, { role: "host" });
    expect(phone.clip!.url).toBeNull();
    expect(tv.clip!.url).toMatch(/^(\/test-audio|https:)/);
    expect(JSON.stringify(phone)).not.toContain(song(play.state).title);
    expect(JSON.stringify(tv)).not.toContain(song(play.state).title);
  });
});

describe("buzzer (artist)", () => {
  it("a band member gives partial points", () => {
    const withMembers = createMusikModule({ songs: [MUSIK_TEST_SONGS.find((s) => s.members.length)!] });
    const init = withMembers.init(ctx(T0), options(family, { ...only("artist"), questionCount: 3 }));
    const loaded = withMembers.onTimer(init.state, ctx(T0 + 20_000));
    const play = withMembers.onTimer(loaded.state, ctx(T0 + 23_000));
    const buzz = withMembers.handleAction(play.state, { type: "buzz" }, "a", ctx(T0 + 24_000)) as ModuleUpdate<MusikState>;
    const member = song(buzz.state).memberTerms.length ? MUSIK_TEST_SONGS.find((s) => s.id === song(buzz.state).id)!.members[0]! : "";
    const r = withMembers.handleAction(buzz.state, { type: "answer", text: member }, "a", ctx(T0 + 25_000)) as ModuleUpdate<MusikState>;
    expect(r.state.events.at(-1)).toMatchObject({ type: "PARTIAL" });
    expect(r.scoreDelta).toEqual({ a: 100 });
  });
});

describe("optional AI check", () => {
  it("borderline answers wait for the model; null (timeout) = wrong", () => {
    const play = playing(family, { options: { typeTitle: true, typeArtist: false, typeYear: false, aiCheck: true } });
    const title = song(play.state).title;
    const buzz = act(play, "a", { type: "buzz" }, T0 + 4_000);
    const close = act(buzz, "a", { type: "answer", text: `${title} xyz abc` }, T0 + 5_000);
    expect(close.state.step).toBe("checking");
    const task = mod.pendingTask!(close.state)!;
    expect(task.kind).toBe("llm_json");
    const yes = mod.resolveTask!(close.state, task.id, { correct: true }, ctx(T0 + 6_000))!;
    expect(yes.state.step).toBe("reveal");
    expect(yes.scoreDelta!.a).toBe(200);
    const no = mod.resolveTask!(close.state, task.id, null, ctx(T0 + 6_000))!;
    expect(no.state.step).toBe("play");
    expect(no.state.runs.a!.lockedOut).toBe(true);
  });

  it("off by default: no task", () => {
    const play = playing(family, only("title"));
    const buzz = act(play, "a", { type: "buzz" }, T0 + 4_000);
    const r = act(buzz, "a", { type: "answer", text: `${song(buzz.state).title} xyz abc` }, T0 + 5_000);
    expect(r.state.step).toBe("play");
  });
});

describe("year", () => {
  it("title and artist shown, everyone tips once, solved when all are in", () => {
    const play = playing(family, only("year"));
    const pub = mod.toPublicState(play.state, { role: "player", playerId: "a" });
    expect(pub.input).toBe("year");
    expect(pub.shown).toEqual({ title: song(play.state).title, artist: song(play.state).artist });
    expect(play.phaseEndsAt).toBe(T0 + 3_000 + 20_000);
    const year = song(play.state).year!;
    let u = act(play, "a", { type: "year", year }, T0 + 5_000);
    expect(refused(u, "a", { type: "year", year: 1999 }, T0 + 5_500)).toBe("ALREADY_ANSWERED");
    u = act(u, "b", { type: "year", year: year + 3 }, T0 + 6_000);
    expect(mod.toPublicState(u.state, { role: "host" }).players.filter((p) => p.answered)).toHaveLength(2);
    u = act(u, "c", { type: "year", year: year - 30 }, T0 + 7_000);
    expect(u.state.step).toBe("reveal");
    expect(u.scoreDelta).toEqual({ a: 200, b: 50 });
    expect(u.state.events.at(-1)).toMatchObject({ type: "YEAR_BULLSEYE", playerId: "a" });
    const reveal = mod.toPublicState(u.state, { role: "host" }).reveal!;
    expect(reveal.yearTips).toEqual({ a: year, b: year + 3, c: year - 30 });
  });

  it("only verified years are asked", () => {
    for (let seed = 1; seed < 10; seed++) {
      const init = mod.init(ctx(T0, PLAYERS, seeded(seed)), options(family, only("year")));
      for (const p of init.state.pending) expect(p.candidates.every((c) => c.song.yearVerified)).toBe(true);
    }
  });
});

describe("kids", () => {
  it("title only, four options, no timer, the clip loops", () => {
    const play = playing(kids, { options: { typeTitle: false, typeArtist: true, typeYear: true } });
    expect(play.state.slots.every((s) => s.type === "title")).toBe(true);
    expect(play.phaseEndsAt).toBeNull();
    const pub = mod.toPublicState(play.state, { role: "player", playerId: "a" });
    expect(pub.input).toBe("choice");
    expect(pub.choices).toHaveLength(4);
    expect(pub.clip!.loop).toBe(true);
    expect(pub.stepEndsAt).toBeNull();
  });

  it("answers change until the solution; the TV sees who answered, not what", () => {
    const play = playing(kids);
    const correct = play.state.slots[0]!.kids!.correct;
    const wrongIndex = (correct + 1) % 4;
    let u = act(play, "a", { type: "choice", index: wrongIndex }, T0 + 5_000);
    u = act(u, "a", { type: "choice", index: correct }, T0 + 6_000);
    const tv = mod.toPublicState(u.state, { role: "host" });
    expect(tv.players.find((p) => p.id === "a")!.answered).toBe(true);
    expect(JSON.stringify(tv.players)).not.toContain(String(correct));
    u = act(u, "b", { type: "choice", index: wrongIndex }, T0 + 7_000);
    expect(u.phaseEndsAt).toBeNull();
    u = act(u, "c", { type: "choice", index: correct }, T0 + 8_000);
    // Everyone in → the solution follows a moment later (no countdown).
    expect(u.state.step).toBe("play");
    expect(u.phaseEndsAt).toBe(T0 + 8_000 + MUSIK_CONFIG.kidsSettleMs);
    u = act(u, "b", { type: "choice", index: correct }, T0 + 8_500);
    const reveal = mod.onTimer(u.state, ctx(T0 + 9_500));
    expect(reveal.scoreDelta).toEqual({ a: 100, b: 100, c: 100 });
    expect(reveal.state.events.at(-1)).toMatchObject({ type: "KIDS_ALL_RIGHT" });
  });

  it("the host can solve any time; no minus points", () => {
    const play = playing(kids);
    const wrong = (play.state.slots[0]!.kids!.correct + 1) % 4;
    const u = act(play, "a", { type: "choice", index: wrong }, T0 + 5_000);
    const reveal = mod.onTimer(u.state, ctx(T0 + 60_000));
    expect(reveal.state.step).toBe("reveal");
    expect(reveal.scoreDelta).toEqual({});
  });
});

describe("module registry & content", () => {
  it("is registered and lists songs for the admin page", () => {
    expect(GAME_MODULES.musik.meta.id).toBe("musik");
    const entries = mod.listContent!();
    expect(entries.length).toBe(POOL.length);
    expect(mod.parseContent!(POOL[0]).ok).toBe(true);
  });

  it("extra content: admin overrides and test songs", () => {
    const pool = songPool([POOL[0]!], [{ kind: "song-override", id: POOL[0]!.id, originalYear: 1999 }, MUSIK_TEST_SONGS[1], { junk: true }]);
    expect(pool).toHaveLength(2);
    expect(pool[0]!.originalYear).toBe(1999);
  });

  it("test bots play a whole round", () => {
    let u = playing(family, { questionCount: 4 });
    const bot = { random: seeded(9), correctRate: 0.6, estimateSpread: 0.3 };
    for (let t = T0 + 4_000, guard = 0; !u.done && guard < 500; guard++, t += 1_000) {
      let moved = false;
      for (const id of PLAYERS) {
        const action = mod.botAction!(u.state, id, ctx(t), bot);
        if (!action) continue;
        const r = mod.handleAction(u.state, mod.actionSchema.parse(action), id, ctx(t));
        if (!("error" in r)) {
          u = r;
          moved = true;
        }
      }
      if (!moved && u.phaseEndsAt !== null && t >= u.phaseEndsAt) u = mod.onTimer(u.state, ctx(t));
    }
    expect(u.done).toBe(true);
  });
});

describe("party mode", () => {
  it("plays family and party songs", () => {
    const init = mod.init(ctx(T0), options(party, { questionCount: 15 }));
    expect(init.state.pending.length).toBeGreaterThan(10);
  });
});
