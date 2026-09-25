import { DEFAULT_VOICE_SETTINGS, type HostLine, type ScoringSettings } from "@couch-clash/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { advance, beginGame, handlePlayerAction, updateSettings } from "../src/game-flow";
import type { Result } from "../src/result";
import { createRoomRecord, joinPlayer, type RoomRecord } from "../src/room-logic";
import { VOICE_CONFIG } from "../src/voice/config";
import { VoiceDirector, detectVoiceEvents } from "../src/voice/director";
import { VoiceProviderError, type LinePrompt, type TextProvider } from "../src/voice/provider";
import type { VoiceServices } from "../src/voice/service";
import { SNARK_LINES_DE } from "@couch-clash/content";
import { voiceSnarkBatch } from "../src/voice/admin";
import { allSnarkLines } from "../src/voice/snark";
import { memoryStore } from "./avatar-helpers";
import { mockSpeech } from "./voice-helpers";

const T0 = 1_700_000_000_000;
const avatar = { character: "fox", color: "red" } as const;
const scoring: ScoringSettings = {
  mode: "absolute",
  maxPoints: 100,
  speedModifier: { enabled: false, fastestMultiplier: 1.5, slowestMultiplier: 0.5 },
};

afterEach(() => vi.restoreAllMocks());

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/** Names from the prompt's JSON data block. */
function promptData(prompt: LinePrompt) {
  return JSON.parse(prompt.user.split("\n")[1]!) as { players?: string[]; playerCount?: number };
}

/** Text model mock: echoes the names so tests can see batching. Never calls a real API. */
function echoText(): TextProvider & { prompts: LinePrompt[] } {
  const prompts: LinePrompt[] = [];
  return {
    prompts,
    async generateLine(prompt) {
      prompts.push(prompt);
      if (prompt.json) return JSON.stringify({ line: "Oh Ben … zurück in die erste Klasse!", target: "Ben" });
      const data = promptData(prompt);
      if (data.players) return `Willkommen ${data.players.join(", ")}!`;
      return `Meine Damen und Herren – ${data.playerCount ?? "?"} Kandidaten!`;
    },
  };
}

function setup(
  names: string[],
  opts: {
    text?: TextProvider;
    host?: boolean;
    speech?: VoiceServices["speech"];
    /** The director's random source: < 0.5 → live comments, ≥ 0.5 → cached library lines. */
    random?: () => number;
    store?: ReturnType<typeof memoryStore>;
    usage?: VoiceServices["usage"];
  } = {},
) {
  let room = createRoomRecord("ABCD", "host-token-0123456789abcdef", T0);
  let n = 0;
  const text = opts.text ?? echoText();
  const services: VoiceServices = {
    text,
    speech: opts.speech === undefined ? mockSpeech() : opts.speech,
    store: opts.store ?? memoryStore(),
    usage: opts.usage ?? null,
  };
  const rt = {
    room: null as RoomRecord | null,
    sent: [] as HostLine[],
    host: opts.host ?? true,
    tasks: [] as Promise<unknown>[],
    now: T0,
  };
  const director = new VoiceDirector({
    read: () => rt.room,
    commit: async (next) => {
      const prev = rt.room;
      rt.room = next;
      director.roomChanged(prev, next);
    },
    sendToHosts: (line) => {
      if (!rt.host) return false;
      rt.sent.push(line);
      return true;
    },
    hostConnected: () => rt.host,
    waitUntil: (p) => rt.tasks.push(p),
    services: () => services,
    now: () => rt.now,
    random: opts.random ?? (() => 0.5),
    newId: () => (++n).toString(16).padStart(16, "0"),
  });
  const ids: string[] = [];
  for (const name of names) {
    const r = unwrap(joinPlayer(room, { name, avatar }, { now: T0 }));
    room = r.room;
    ids.push(r.player.id);
  }
  rt.room = room;
  const settle = async () => {
    while (rt.tasks.length) await Promise.all(rt.tasks.splice(0));
  };
  const commit = async (next: RoomRecord) => {
    const prev = rt.room;
    rt.room = next;
    director.roomChanged(prev, next);
  };
  return { rt, director, ids, text, settle, commit, services };
}

describe("welcome lines", () => {
  it("welcomes each player by name – on the host screen only", async () => {
    const { rt, director, ids, settle } = setup(["Clara"]);
    director.playerJoined(ids[0]!);
    await settle();
    expect(rt.sent).toHaveLength(1);
    expect(rt.sent[0]).toMatchObject({ kind: "welcome", text: "Willkommen Clara!", audioPath: "/api/rooms/ABCD/voice/0000000000000001" });
  });

  it("keeps max 3 welcome lines queued and merges the rest", async () => {
    const { rt, director, ids, settle } = setup(["Anna", "Ben", "Tina", "Max", "Oma Gerda"]);
    for (const id of ids) director.playerJoined(id);
    await settle();
    expect(rt.sent.map((l) => l.text)).toEqual(["Willkommen Anna!", "Willkommen Ben!", "Willkommen Tina!"]);
    // The host screen finished one line → the waiting names share one line.
    director.hostEvent(rt.sent[0]!.id, "ended");
    await settle();
    expect(rt.sent.map((l) => l.text).at(-1)).toBe("Willkommen Max, Oma Gerda!");
    expect(rt.sent).toHaveLength(4);
  });

  it("merges when one slot is left and several wait", async () => {
    const { rt, director, ids, settle } = setup(["A", "B", "C", "D", "E"]);
    director.playerJoined(ids[0]!);
    director.playerJoined(ids[1]!);
    await settle();
    // 2 queued on the host screen, 1 slot left – three names wait.
    director.playerJoined(ids[2]!);
    director.playerJoined(ids[3]!);
    director.playerJoined(ids[4]!);
    await settle();
    director.hostEvent(rt.sent[0]!.id, "ended");
    await settle();
    expect(rt.sent.map((l) => l.text)).toEqual(["Willkommen A!", "Willkommen B!", "Willkommen C!", "Willkommen D, E!"]);
  });

  it("waits until the host screen finished a line when 3 are already queued", async () => {
    const { rt, director, ids, settle } = setup(["A", "B", "C", "D", "E"]);
    for (const id of ids.slice(0, 3)) director.playerJoined(id);
    await settle();
    director.playerJoined(ids[3]!);
    director.playerJoined(ids[4]!);
    await settle();
    expect(rt.sent).toHaveLength(3);
    director.hostEvent(rt.sent[0]!.id, "ended");
    await settle();
    expect(rt.sent.at(-1)!.text).toBe("Willkommen D, E!");
  });

  it("says nothing when the moderator is off or no host screen is connected", async () => {
    const off = setup(["Clara"]);
    off.rt.room = { ...off.rt.room!, voice: { ...off.rt.room!.voice, settings: { ...DEFAULT_VOICE_SETTINGS, enabled: false } } };
    off.director.playerJoined(off.ids[0]!);
    await off.settle();
    expect(off.rt.sent).toHaveLength(0);

    const noHost = setup(["Clara"], { host: false });
    noHost.director.playerJoined(noHost.ids[0]!);
    await noHost.settle();
    expect(noHost.rt.sent).toHaveLength(0);
    expect((noHost.text as ReturnType<typeof echoText>).prompts).toHaveLength(0);
  });

  it("speaks template lines once the room budget of 60 texts is used up", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { rt, director, ids, text, settle } = setup(["Clara"]);
    rt.room = { ...rt.room!, voice: { ...rt.room!.voice, linesUsed: VOICE_CONFIG.maxLinesPerRoom } };
    director.playerJoined(ids[0]!);
    await settle();
    expect((text as ReturnType<typeof echoText>).prompts).toHaveLength(0);
    expect(rt.sent[0]!.text).toMatch(/Clara/);
    expect(rt.sent[0]!.audioPath).toBeTruthy();
  });

  it("a quota error stops NEW audio for the room – the game continues", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const speech = mockSpeech(async () => {
      throw new VoiceProviderError("unavailable", "ElevenLabs 401 quota_exceeded", "401 quota_exceeded");
    });
    const ctx = setup(["Anna", "Ben"], { speech });
    ctx.director.playerJoined(ctx.ids[0]!);
    await ctx.settle();
    expect(ctx.rt.room!.voice.status).toBe("unavailable");
    expect(ctx.rt.room!.voice.errorCode).toBe("401 quota_exceeded");
    expect(ctx.rt.sent).toHaveLength(0);
    // Nothing is generated any more (no text, no voice) – but the game runs.
    const promptsBefore = (ctx.text as ReturnType<typeof echoText>).prompts.length;
    const callsBefore = speech.speak.mock.calls.length;
    const { answerAll, next } = await startGame(ctx, "oft", 3);
    await answerAll();
    await ctx.settle();
    await next();
    expect(ctx.rt.room!.phase).toBe("play");
    expect((ctx.text as ReturnType<typeof echoText>).prompts.length).toBe(promptsBefore);
    expect(speech.speak).toHaveBeenCalledTimes(callsBefore);
  });

  it("'Stimme erneut versuchen' lifts the stop (e.g. after fixing the key)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let refuse = true;
    const speech = mockSpeech(async () => {
      if (refuse) throw new VoiceProviderError("unavailable", "ElevenLabs 401 missing_permissions", "401 missing_permissions");
      return { bytes: new Uint8Array([1]), mimeType: "audio/mpeg" };
    });
    const ctx = setup([], { speech });
    ctx.director.testLine();
    await ctx.settle();
    expect(ctx.rt.room!.voice).toMatchObject({ status: "unavailable", errorCode: "401 missing_permissions" });
    ctx.director.testLine(); // still stopped
    await ctx.settle();
    expect(speech.speak).toHaveBeenCalledTimes(1);
    refuse = false;
    await ctx.director.retryVoice();
    expect(ctx.rt.room!.voice).toMatchObject({ status: "ok", errorCode: null });
    ctx.director.testLine();
    await ctx.settle();
    expect(ctx.rt.sent.map((l) => l.kind)).toEqual(["test"]);
  });

  it("stops NEW audio at the room's credit budget", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = setup(["Anna", "Ben"]);
    ctx.rt.room = { ...ctx.rt.room!, voice: { ...ctx.rt.room!.voice, creditsUsed: VOICE_CONFIG.creditBudgetPerRoom - 5 } };
    ctx.director.playerJoined(ctx.ids[0]!);
    await ctx.settle();
    expect(ctx.rt.sent).toHaveLength(0);
    expect(ctx.rt.room!.voice.status).toBe("budget");
  });

  it("says nothing without a voice provider (no text is generated either)", async () => {
    const ctx = setup(["Clara"], { speech: null });
    ctx.director.playerJoined(ctx.ids[0]!);
    await ctx.settle();
    expect(ctx.rt.sent).toHaveLength(0);
    expect((ctx.text as ReturnType<typeof echoText>).prompts).toHaveLength(0);
  });

  it("counts credits per model (v3 welcome ×1, flash name clip ×½) and applies the tempo", async () => {
    const speech = mockSpeech();
    const ctx = setup(["Clara"], { speech });
    ctx.rt.room = { ...ctx.rt.room!, voice: { ...ctx.rt.room!.voice, settings: { ...ctx.rt.room!.voice.settings, tempo: "turbo" } } };
    ctx.director.playerJoined(ctx.ids[0]!);
    await ctx.settle();
    expect(speech.speak).toHaveBeenCalledWith("Willkommen Clara!", expect.objectContaining({ style: "expressive", speed: 1.2 }));
    // The name clip for library lines: flash, the cached speed (same for every room).
    expect(speech.speak).toHaveBeenCalledWith("Clara …", expect.objectContaining({ style: "fast", speed: VOICE_CONFIG.cachedSpeed }));
    expect(ctx.rt.room!.voice.creditsUsed).toBe("Willkommen Clara!".length + Math.ceil("Clara …".length * 0.5));
    expect(ctx.rt.room!.voice.nameClips[ctx.ids[0]!]).toMatch(/^\/api\/voice-cache\/.+\/names\//);
    expect(ctx.rt.sent[0]!.playbackRate).toBe(1.1);
  });

  it("test line (Probe-Spruch) is spoken and counts towards the budget", async () => {
    const ctx = setup([]);
    ctx.director.testLine();
    await ctx.settle();
    expect(ctx.rt.sent[0]).toMatchObject({ kind: "test" });
    expect(ctx.rt.room!.voice.creditsUsed).toBeGreaterThan(0);
    expect(ctx.rt.room!.voice.linesUsed).toBe(1);
  });

  it("counts generated lines", async () => {
    const { rt, director, ids, settle } = setup(["Clara", "Ben"]);
    director.playerJoined(ids[0]!);
    director.playerJoined(ids[1]!);
    await settle();
    expect(rt.room!.voice.linesUsed).toBe(2);
  });
});

type QState = { step: string; index: number; questions: { correctIndex: number }[]; stepEndsAt: number };
const qstate = (room: RoomRecord) => room.game!.moduleState as QState;

async function startGame(ctx: ReturnType<typeof setup>, frequency: "selten" | "normal" | "oft", count = 4, categoryId = "quiz") {
  expect(count).toBeGreaterThanOrEqual(3); // quiz minimum
  const { rt, commit, ids, settle } = ctx;
  const deps = () => ({ now: rt.now, random: () => 0.3, connectedPlayerIds: new Set(ids) });
  let room = unwrap(updateSettings(rt.room!, [{ categoryId, questionCount: count, scoring }]));
  room = { ...room, voice: { ...room.voice, settings: { ...room.voice.settings, frequency } } };
  await commit(room);
  await commit(unwrap(beginGame(rt.room!, deps())));
  await commit(unwrap(advance(rt.room!, deps()))); // intro → first question
  await settle();
  /** Everyone answers (Anna right, the others wrong) → reveal. */
  const answerAll = async () => {
    const s = qstate(rt.room!);
    const right = s.questions[s.index]!.correctIndex;
    for (const [i, id] of ids.entries()) {
      await commit(unwrap(handlePlayerAction(rt.room!, id, { type: "answer", value: i === 0 ? right : (right + i) % 4 }, deps())));
    }
  };
  const next = async () => commit(unwrap(advance(rt.room!, deps())));
  return { answerAll, next };
}

describe("game start", () => {
  it("opens the show and mentions the number of players", async () => {
    const ctx = setup(["Anna", "Ben"]);
    await startGame(ctx, "oft");
    expect(ctx.rt.sent.find((l) => l.kind === "start")?.text).toBe("Meine Damen und Herren – 2 Kandidaten!");
  });
});

const LIVE = () => 0.3;
const CACHED = () => 0.9;
const comments = (ctx: ReturnType<typeof setup>) => ctx.rt.sent.filter((l) => l.kind === "comment");
const prompts = (ctx: ReturnType<typeof setup>) => (ctx.text as ReturnType<typeof echoText>).prompts.filter((p) => p.json);
/** Library text of a cached comment ("Anna … Mutig geraten." → "Mutig geraten."). */
const libraryText = (line: HostLine) => line.text.replace(/^.+? … /, "");
const ALL_LINES = allSnarkLines(SNARK_LINES_DE);

/** Answer, reveal, leaderboard – for `count` questions. */
async function playQuestions(ctx: ReturnType<typeof setup>, game: Awaited<ReturnType<typeof startGame>>, count: number) {
  for (let q = 0; q < count; q++) {
    await game.answerAll();
    await ctx.settle();
    await game.next(); // leaderboard
    await ctx.settle();
    if (q < count - 1) {
      await game.next();
      await ctx.settle();
    }
  }
}

/** Voices the whole library into `store` (the admin task). */
async function voiceLibrary(store: ReturnType<typeof memoryStore>) {
  const services: VoiceServices = { text: null, speech: mockSpeech(), store, usage: null };
  for (let i = 0; i < 20; i++) if ((await voiceSnarkBatch(services)).snark.cached === ALL_LINES.length) return;
}

describe("leaderboard commentary", () => {
  it("oft: a comment after EVERY question – prepared at the reveal, played when the leaderboard starts", async () => {
    const ctx = setup(["Anna", "Ben"], { random: LIVE });
    const { answerAll, next } = await startGame(ctx, "oft");
    await answerAll();
    await ctx.settle();
    expect(comments(ctx)).toHaveLength(0); // waits for the leaderboard
    await next(); // → leaderboard
    const comment = comments(ctx)[0];
    expect(comment).toMatchObject({ text: "Oh Ben … zurück in die erste Klasse!", staleAfterMs: 2500 });
    // The facts are specific: actual answers, right/wrong, ranks.
    expect(prompts(ctx)[0]!.user).toMatch(/"correct":false/);
    expect(prompts(ctx)[0]!.user).toMatch(/"rankAfter"/);
    await next(); // → question 2
    await answerAll();
    await ctx.settle();
    await next();
    expect(comments(ctx)).toHaveLength(2);
    expect(ctx.rt.room!.voice.streaks[ctx.ids[0]!]).toBe(2);
    expect(ctx.rt.room!.voice.wrongStreaks[ctx.ids[1]!]).toBe(2);
  });

  it("party question in Party mode → partyItem in the facts, the host may wink", async () => {
    const ctx = setup(["Anna", "Ben"], { random: LIVE });
    ctx.rt.room = { ...ctx.rt.room!, mode: { mode: "party", allow16: false, difficulty: "mixed", partyShare: 1 }, partyConfirmed: true };
    await playQuestions(ctx, await startGame(ctx, "oft"), 1);
    expect(prompts(ctx)[0]!.user).toContain('"partyItem":true');
    expect(prompts(ctx)[0]!.system).toMatch(/partyItem is true/);
  });

  it("family question → no partyItem", async () => {
    const ctx = setup(["Anna", "Ben"], { random: LIVE });
    await playQuestions(ctx, await startGame(ctx, "oft"), 1);
    expect(prompts(ctx)[0]!.user).not.toContain("partyItem");
  });

  it("live: rotates targets – the last target is passed as avoidTargets", async () => {
    const ctx = setup(["Anna", "Ben"], { random: LIVE });
    await playQuestions(ctx, await startGame(ctx, "oft", 4), 2);
    expect(prompts(ctx)).toHaveLength(2);
    expect(prompts(ctx)[1]!.user).toMatch(/"avoidTargets":\["Ben"\]/);
  });

  it("cached: the target's name clip, 150 ms, then the library line", async () => {
    const ctx = setup(["Anna", "Ben"], { random: CACHED });
    ctx.director.playerJoined(ctx.ids[0]!);
    ctx.director.playerJoined(ctx.ids[1]!);
    await ctx.settle();
    await playQuestions(ctx, await startGame(ctx, "oft"), 1);
    const [line] = comments(ctx);
    expect(prompts(ctx)).toHaveLength(0); // no text model for library lines
    // Ben answered wrong (Anna right) → about Ben.
    expect(line!.text).toMatch(/^Ben … /);
    expect(line!.prefixAudioPath).toBe(ctx.rt.room!.voice.nameClips[ctx.ids[1]!]);
    expect(line!.prefixGapMs).toBe(150);
    expect(line!.audioPath).toMatch(/^\/api\/voice-cache\/.+\/snark\/[a-f0-9]{64}\.mp3$/);
    expect(ALL_LINES).toContain(libraryText(line!));
    expect(ctx.rt.room!.voice.usedSnark).toEqual([libraryText(line!)]);
  });

  it("a live line that is not ready when the leaderboard starts → a cached line instead of silence", async () => {
    let release!: () => void;
    const base = echoText();
    const slow: TextProvider = {
      generateLine: (p) =>
        p.json
          ? new Promise((resolve) => {
              release = () => resolve('{"line":"Zu spät!","target":""}');
            })
          : base.generateLine(p),
    };
    const ctx = setup(["Anna", "Ben"], { text: slow, random: LIVE });
    const { answerAll, next } = await startGame(ctx, "oft", 3);
    await answerAll();
    await next(); // leaderboard starts before the live text is ready
    await vi.waitFor(() => expect(comments(ctx)).toHaveLength(1));
    expect(ALL_LINES).toContain(libraryText(comments(ctx)[0]!));
    release();
    await ctx.settle();
    // The late live line is dropped – one comment per question.
    expect(comments(ctx)).toHaveLength(1);
    expect(comments(ctx)[0]!.text).not.toBe("Zu spät!");
  });

  it("budget used up → only cached lines, never silent, nothing new is paid for", async () => {
    const store = memoryStore();
    await voiceLibrary(store);
    const speech = mockSpeech();
    const ctx = setup(["Anna", "Ben"], { random: LIVE, store, speech });
    ctx.rt.room = { ...ctx.rt.room!, voice: { ...ctx.rt.room!.voice, status: "budget" } };
    await playQuestions(ctx, await startGame(ctx, "oft", 4), 4);
    expect(comments(ctx)).toHaveLength(4);
    for (const line of comments(ctx)) expect(ALL_LINES).toContain(libraryText(line));
    expect(prompts(ctx)).toHaveLength(0);
    expect(speech.speak).not.toHaveBeenCalled();
    expect(ctx.rt.room!.voice.creditsUsed).toBe(0);
  });

  it("account nearly used up this month (< 10 %) → only cached audio", async () => {
    const store = memoryStore();
    await voiceLibrary(store);
    const speech = mockSpeech();
    const usage = async () => ({ used: 27_500, limit: 30_000 });
    const ctx = setup(["Anna", "Ben"], { random: LIVE, store, speech, usage });
    await playQuestions(ctx, await startGame(ctx, "oft", 3), 3);
    expect(ctx.rt.room!.voice.account).toEqual({ used: 27_500, limit: 30_000 });
    expect(comments(ctx)).toHaveLength(3);
    expect(prompts(ctx)).toHaveLength(0);
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it("cached audio is not counted in the room budget", async () => {
    const store = memoryStore();
    await voiceLibrary(store);
    const ctx = setup(["Anna", "Ben"], { random: CACHED, store });
    // Name clips are made when the players join (new audio – counted).
    for (const id of ctx.ids) ctx.director.playerJoined(id);
    await ctx.settle();
    const game = await startGame(ctx, "oft", 3);
    await ctx.settle();
    const before = ctx.rt.room!.voice.creditsUsed;
    expect(before).toBeGreaterThan(0);
    await playQuestions(ctx, game, 3);
    expect(comments(ctx)).toHaveLength(3);
    expect(comments(ctx).some((l) => l.prefixAudioPath)).toBe(true);
    // Library lines and name clips from the cache: free.
    expect(ctx.rt.room!.voice.creditsUsed).toBe(before);
  });

  it("never the same line twice in a game, never the same target twice in a row", async () => {
    const store = memoryStore();
    await voiceLibrary(store);
    let n = 0;
    // Deterministic but varied choices; ≥ 0.5 on the live/cached draw → cached.
    const ctx = setup(["Anna", "Ben", "Cleo"], { random: () => ((n++ * 0.6180339) % 0.5) + 0.5, store });
    const total = 12;
    await playQuestions(ctx, await startGame(ctx, "oft", total), total);
    const lines = comments(ctx);
    expect(lines).toHaveLength(total);
    const texts = lines.map(libraryText);
    expect(new Set(texts).size).toBe(texts.length);
    const targets = lines.map((l) => l.text.match(/^(\w+) … /)?.[1] ?? null);
    for (let i = 1; i < targets.length; i++) if (targets[i] && targets[i - 1]) expect(targets[i]).not.toBe(targets[i - 1]);
  });

  it("Kids: only kids lines; Party: family + party lines", async () => {
    const store = memoryStore();
    await voiceLibrary(store);
    const kidsLines = new Set(Object.values(SNARK_LINES_DE).flatMap((m) => m.kids));
    const partyLines = new Set(Object.values(SNARK_LINES_DE).flatMap((m) => [...m.family, ...m.party]));
    for (const [mode, allowed] of [
      ["kids", kidsLines],
      ["party", partyLines],
    ] as const) {
      const ctx = setup(["Anna", "Ben"], { random: CACHED, store });
      ctx.rt.room = { ...ctx.rt.room!, mode: { mode, allow16: false, difficulty: "mixed" }, partyConfirmed: true };
      await playQuestions(ctx, await startGame(ctx, "oft", 4), 4);
      expect(comments(ctx).length).toBe(4);
      for (const line of comments(ctx)) expect(allowed.has(libraryText(line)), line.text).toBe(true);
    }
  });

  it("extends the leaderboard hold by at most 3 s while a line plays", async () => {
    const ctx = setup(["Anna", "Ben"]);
    await playQuestions(ctx, await startGame(ctx, "oft", 3), 1);
    const comment = comments(ctx)[0]!;
    const baseEnd = ctx.rt.room!.phaseEndsAt!;
    ctx.director.hostEvent(comment.id, "started", baseEnd + 10_000);
    await ctx.settle();
    expect(ctx.rt.room!.phaseEndsAt).toBe(baseEnd + 3_000);
  });

  it("announces the winner at the final ranking", async () => {
    const ctx = setup(["Anna", "Ben"]);
    const game = await startGame(ctx, "selten", 3);
    await playQuestions(ctx, game, 3);
    await game.next(); // → scoreboard
    await game.next(); // → finale
    await ctx.settle();
    expect(ctx.rt.room!.phase).toBe("finale");
    expect(ctx.rt.sent.some((l) => l.kind === "finale")).toBe(true);
    // "selten": every 3rd question – here only the last one.
    expect(comments(ctx)).toHaveLength(1);
  });
});

describe("Führerscheinprüfung", () => {
  it("the host plays the driving instructor and announces the exam result", async () => {
    const ctx = setup(["Anna", "Ben"], { random: LIVE });
    const { answerAll, next } = await startGame(ctx, "selten", 5, "fuehrerschein");
    for (let q = 0; q < 5; q++) {
      await answerAll();
      await ctx.settle();
      await next(); // leaderboard
      await ctx.settle();
      await next(); // next question / exam result
      await ctx.settle();
    }
    expect(qstate(ctx.rt.room!).step).toBe("summary");
    const prompts = (ctx.text as ReturnType<typeof echoText>).prompts;
    const comment = prompts.find((p) => p.json)!;
    expect(comment.system).toMatch(/DRIVING INSTRUCTOR/);
    // The persona is a rule, never part of the data block.
    expect(comment.user).not.toMatch(/DRIVING INSTRUCTOR/);
    const exam = prompts.find((p) => p.system.includes("each player's result"))!;
    expect(exam.user).toMatch(/"verdict":"bestanden"/);
    expect(exam.user).toMatch(/"verdict":"durchgefallen"/);
    expect(exam.system).toMatch(/does not change the game points/);
    // Sent right away, and the step waits (bounded) while it plays.
    const line = ctx.rt.sent.at(-1)!;
    expect(line.kind).toBe("comment");
    const baseEnd = ctx.rt.room!.phaseEndsAt!;
    ctx.director.hostEvent(line.id, "started", baseEnd + 10_000);
    await ctx.settle();
    expect(ctx.rt.room!.phaseEndsAt).toBe(baseEnd + 3_000);
  });
});

describe("detectVoiceEvents", () => {
  it("ignores changes that are not steps (e.g. voice memory updates)", () => {
    const ctx = setup(["Anna"]);
    const room = ctx.rt.room!;
    expect(detectVoiceEvents(room, { ...room, voice: { ...room.voice, linesUsed: 3 } })).toEqual([]);
  });
});
