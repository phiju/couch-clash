import { DEFAULT_VOICE_SETTINGS, type HostLine, type ScoringSettings } from "@couch-clash/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { advance, beginGame, handlePlayerAction, updateSettings } from "../src/game-flow";
import type { Result } from "../src/result";
import { createRoomRecord, joinPlayer, type RoomRecord } from "../src/room-logic";
import { VOICE_CONFIG } from "../src/voice/config";
import { VoiceDirector, detectVoiceEvents } from "../src/voice/director";
import type { LinePrompt, TextProvider } from "../src/voice/provider";
import type { VoiceServices } from "../src/voice/service";
import { memoryStore } from "./avatar-helpers";

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

function setup(names: string[], opts: { text?: TextProvider; host?: boolean } = {}) {
  let room = createRoomRecord("ABCD", "host-token-0123456789abcdef", T0);
  let n = 0;
  const text = opts.text ?? echoText();
  const services: VoiceServices = {
    text,
    speech: { speak: async () => ({ bytes: new Uint8Array([1]), mimeType: "audio/mpeg" }) },
    store: memoryStore(),
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
    random: () => 0.5,
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
  return { rt, director, ids, text, settle, commit };
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

  it("uses template lines once the room budget of 60 lines is used up", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { rt, director, ids, text, settle } = setup(["Clara"]);
    rt.room = { ...rt.room!, voice: { ...rt.room!.voice, linesUsed: VOICE_CONFIG.maxLinesPerRoom } };
    director.playerJoined(ids[0]!);
    await settle();
    expect((text as ReturnType<typeof echoText>).prompts).toHaveLength(0);
    expect(rt.sent[0]).toMatchObject({ audioPath: null });
    expect(rt.sent[0]!.text).toMatch(/Clara/);
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

async function startGame(ctx: ReturnType<typeof setup>, frequency: "selten" | "normal" | "oft", count = 4) {
  expect(count).toBeGreaterThanOrEqual(3); // quiz minimum
  const { rt, commit, ids, settle } = ctx;
  const deps = () => ({ now: rt.now, random: () => 0.3, connectedPlayerIds: new Set(ids) });
  let room = unwrap(updateSettings(rt.room!, [{ categoryId: "quiz", questionCount: count, scoring }]));
  room = { ...room, voice: { ...room.voice, settings: { ...room.voice.settings, frequency } } };
  await commit(room);
  await commit(unwrap(beginGame(rt.room!, deps())));
  await commit(unwrap(advance(rt.room!, deps()))); // intro → first question
  await settle();
  /** Both answer (Anna right, Ben wrong) → reveal. */
  const answerAll = async () => {
    const s = qstate(rt.room!);
    const right = s.questions[s.index]!.correctIndex;
    await commit(unwrap(handlePlayerAction(rt.room!, ids[0]!, { type: "answer", value: right }, deps())));
    await commit(unwrap(handlePlayerAction(rt.room!, ids[1]!, { type: "answer", value: (right + 1) % 4 }, deps())));
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

describe("leaderboard commentary", () => {
  it("is prepared at the reveal and played when the leaderboard starts", async () => {
    const ctx = setup(["Anna", "Ben"]);
    const { answerAll, next } = await startGame(ctx, "oft");
    // Question 1: no comment ("oft" = every 2nd question).
    await answerAll();
    await ctx.settle();
    await next(); // → leaderboard
    expect(ctx.rt.sent.filter((l) => l.kind === "comment")).toHaveLength(0);
    await next(); // → question 2
    await answerAll();
    await ctx.settle();
    expect(ctx.rt.sent.filter((l) => l.kind === "comment")).toHaveLength(0); // waits for the leaderboard
    await next();
    const comment = ctx.rt.sent.find((l) => l.kind === "comment");
    expect(comment).toMatchObject({ text: "Oh Ben … zurück in die erste Klasse!", staleAfterMs: 2500 });
    // The facts are specific: actual answers, right/wrong, ranks.
    const prompt = (ctx.text as ReturnType<typeof echoText>).prompts.find((p) => p.json)!;
    expect(prompt.user).toMatch(/"correct":false/);
    expect(prompt.user).toMatch(/"rankAfter"/);
    expect(ctx.rt.room!.voice.streaks[ctx.ids[0]!]).toBe(2);
    expect(ctx.rt.room!.voice.streaks[ctx.ids[1]!]).toBe(0);
  });

  it("rotates targets: the last target is passed as avoidTargets", async () => {
    const ctx = setup(["Anna", "Ben"]);
    const { answerAll, next } = await startGame(ctx, "oft", 4);
    for (let q = 0; q < 4; q++) {
      await answerAll();
      await ctx.settle();
      await next();
      await ctx.settle();
      if (q < 3) await next();
    }
    const comments = (ctx.text as ReturnType<typeof echoText>).prompts.filter((p) => p.json);
    expect(comments).toHaveLength(2);
    expect(comments[1]!.user).toMatch(/"avoidTargets":\["Ben"\]/);
  });

  it("is skipped when it is not ready before the leaderboard starts", async () => {
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
    const ctx = setup(["Anna", "Ben"], { text: slow });
    const { answerAll, next } = await startGame(ctx, "selten", 3);
    for (let q = 0; q < 2; q++) {
      await answerAll();
      await ctx.settle();
      await next();
      await next();
    }
    await answerAll(); // last question → always a comment
    await next(); // leaderboard starts before the text is ready
    release();
    await ctx.settle();
    expect(ctx.rt.sent.filter((l) => l.kind === "comment")).toHaveLength(0);
  });

  it("extends the leaderboard hold by at most 3 s while a line plays", async () => {
    const ctx = setup(["Anna", "Ben"]);
    const { answerAll, next } = await startGame(ctx, "oft", 3);
    await answerAll();
    await ctx.settle();
    await next();
    await next();
    await answerAll(); // 2nd question → comment
    await ctx.settle();
    await next();
    const comment = ctx.rt.sent.find((l) => l.kind === "comment")!;
    const baseEnd = ctx.rt.room!.phaseEndsAt!;
    ctx.director.hostEvent(comment.id, "started", baseEnd + 10_000);
    await ctx.settle();
    expect(ctx.rt.room!.phaseEndsAt).toBe(baseEnd + 3_000);
  });

  it("announces the winner at the final ranking", async () => {
    const ctx = setup(["Anna", "Ben"]);
    const { answerAll, next } = await startGame(ctx, "selten", 3);
    for (let q = 0; q < 3; q++) {
      await answerAll();
      await ctx.settle();
      await next(); // leaderboard
      await ctx.settle();
      if (q < 2) await next();
    }
    await next(); // → scoreboard
    await next(); // → finale
    await ctx.settle();
    expect(ctx.rt.room!.phase).toBe("finale");
    expect(ctx.rt.sent.some((l) => l.kind === "finale")).toBe(true);
    // "selten": only the last question of the category was commented.
    expect(ctx.rt.sent.filter((l) => l.kind === "comment")).toHaveLength(1);
  });
});

describe("detectVoiceEvents", () => {
  it("ignores changes that are not steps (e.g. voice memory updates)", () => {
    const ctx = setup(["Anna"]);
    const room = ctx.rt.room!;
    expect(detectVoiceEvents(room, { ...room, voice: { ...room.voice, linesUsed: 3 } })).toEqual([]);
  });
});
