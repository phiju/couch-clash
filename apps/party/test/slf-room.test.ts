/**
 * Stadt, Land, Fluss through the room: the stop with its grace time for
 * everyone, both AI tasks (check: strong, gags: fast, never names), the
 * host reading EVERY answer with the "read" voice model, fallbacks, the
 * vote and the points in the game's scores – plus Zufall and the model
 * setting.
 */
import { GAME_MODULES, plannableCategories, slfMeta, type SlfPublicState, type SlfState } from "@couch-clash/games";
import { DEFAULT_MODE_SETTINGS, type GameModeSettings, type HostLine } from "@couch-clash/shared";
import { describe, expect, it, vi } from "vitest";
import { advance, beginGame, handlePlayerAction, publicGame, updateMode, updateSettings, type FlowDeps } from "../src/game-flow";
import type { JsonModel } from "../src/generate/model";
import { poolSizesFor } from "../src/pools";
import type { Result } from "../src/result";
import { createRoomRecord, joinPlayer, type RoomRecord } from "../src/room-logic";
import { ModuleTaskRunner } from "../src/tasks/runner";
import { ELEVENLABS_MODELS } from "../src/voice/config";
import { VoiceDirector } from "../src/voice/director";
import { createElevenLabsProvider } from "../src/voice/elevenlabs";
import { elevenLabsModels } from "../src/voice/index";
import type { VoiceServices } from "../src/voice/service";
import { memoryStore } from "./avatar-helpers";
import { mockSpeech } from "./voice-helpers";

const T0 = 1_700_000_000_000;
const avatar = { character: "fox", color: "red" } as const;

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

const sstate = (room: RoomRecord) => room.game!.moduleState as SlfState;
const view = (room: RoomRecord, playerId?: string) =>
  publicGame(room, playerId ? { role: "player", playerId } : { role: "host" })!.module as SlfPublicState;

/** Model mock: the check says every answer is valid; the gags tease the last player. */
function fakeModel(log: { system: string; user: string }[], opts: { check?: boolean; gags?: boolean } = {}): JsonModel {
  return async (system, user) => {
    log.push({ system, user });
    const data = JSON.parse(user.split("\n")[1]!) as {
      answers?: { id: string; text: string }[];
      categories: { id: string; answers?: { player: string }[] }[];
    };
    if (system.includes("Schiedsrichter")) {
      if (opts.check === false) throw new Error("OpenAI HTTP 500");
      return { results: data.answers!.map((a) => ({ id: a.id, valid: true, normalized: a.text, duplicateGroup: a.text.toLowerCase() })) };
    }
    if (opts.gags === false) return { nope: true };
    return { gags: data.categories.map((c) => ({ category: c.id, gag: `${c.answers!.at(-1)!.player}, wir müssen reden.` })) };
  };
}

function setup(names: string[], opts: { model?: JsonModel | null; mode?: GameModeSettings; voice?: boolean } = {}) {
  let room = createRoomRecord("SLFX", "host-token-0123456789abcdef", T0);
  const ids: string[] = [];
  for (const name of names) {
    const r = unwrap(joinPlayer(room, { name, avatar }, { now: T0 }));
    room = r.room;
    ids.push(r.player.id);
  }
  if (opts.mode) room = unwrap(updateMode(room, opts.mode, true));
  const rt = { room: room as RoomRecord | null, now: T0, tasks: [] as Promise<unknown>[], sent: [] as HostLine[], qualities: [] as string[] };
  const connected = new Set(ids);
  const deps = (): FlowDeps => ({ now: rt.now, random: () => 0.37, connectedPlayerIds: connected });
  const commit = async (next: RoomRecord) => {
    const prev = rt.room;
    rt.room = next;
    runner.roomChanged(next);
    director?.roomChanged(prev, next);
  };
  const runner = new ModuleTaskRunner({
    read: () => rt.room,
    commit,
    waitUntil: (p) => rt.tasks.push(p),
    flowDeps: deps,
    model: (quality) => {
      rt.qualities.push(quality);
      return opts.model === undefined ? null : opts.model;
    },
  });
  const speech = mockSpeech();
  const store = memoryStore();
  const services: VoiceServices = { text: null, speech, store };
  let n = 0;
  const director = opts.voice
    ? new VoiceDirector({
        read: () => rt.room,
        commit,
        sendToHosts: (line) => {
          rt.sent.push(line);
          return true;
        },
        hostConnected: () => true,
        waitUntil: (p) => rt.tasks.push(p),
        services: () => services,
        now: () => rt.now,
        random: () => 0.5,
        newId: () => (++n).toString(16).padStart(16, "0"),
      })
    : null;
  const settle = async () => {
    while (rt.tasks.length) await Promise.all(rt.tasks.splice(0));
  };
  const act = async (i: number, action: unknown) => {
    const r = handlePlayerAction(rt.room!, ids[i]!, action, deps());
    if (r.ok) await commit(r.value);
    return r;
  };
  const tick = async () => {
    rt.now = Math.max(rt.now, rt.room!.phaseEndsAt!);
    await commit(unwrap(advance(rt.room!, deps())));
    await settle();
  };
  const start = async (questionCount = 2) => {
    await commit(unwrap(updateSettings(rt.room!, [{ categoryId: "stadt-land-fluss", questionCount, scoring: slfMeta.scoring }])));
    await commit(unwrap(beginGame(rt.room!, deps())));
    await tick(); // category intro → letter intro
    expect(sstate(rt.room!).step).toBe("intro");
    await tick(); // → write
    expect(sstate(rt.room!).step).toBe("write");
  };
  return { rt, ids, connected, speech, store, settle, act, tick, start };
}

describe("Stadt, Land, Fluss in the room", () => {
  it("a whole letter: Stopp! (+10 s for all), AI check + gags, every answer read out, vote, points", async () => {
    const log: { system: string; user: string }[] = [];
    const t = setup(["Philip", "Tina", "Max"], { model: fakeModel(log), voice: true, mode: { mode: "party", allow16: false, difficulty: "mixed" } });
    await t.start();
    const round = sstate(t.rt.room!).rounds[0]!;
    const L = round.letter;
    const creative = round.categories.findIndex((c) => c.type === "kreativ");
    const fill = (tag: string) => round.categories.map((_, i) => (i === creative ? `${L}${tag}` : `${L}${tag}${i}`));

    t.rt.now += 20_000;
    expect((await t.act(0, { type: "stop", answers: fill("ildo") })).ok).toBe(true);
    // The same end for the whole room (timer) and every screen.
    expect(t.rt.room!.phaseEndsAt).toBe(t.rt.now + 10_000);
    expect(view(t.rt.room!, t.ids[1]).stepEndsAt).toBe(t.rt.now + 10_000);
    expect(view(t.rt.room!).stop?.playerId).toBe(t.ids[0]);
    await t.settle();
    expect(t.rt.sent.some((l) => l.kind === "read" && l.cue === "stop" && l.text === "Stopp! Noch 10 Sekunden für alle anderen!")).toBe(true);

    t.rt.now += 3_000;
    await t.act(1, { type: "answers", answers: fill("ildo") });
    await t.act(2, { type: "answers", answers: round.categories.map((_, i) => (i === creative ? `${L}uschkopf` : "")) });
    await t.tick(); // stop time over → check → gags → reveal (tasks settle right away)

    const s = sstate(t.rt.room!);
    expect(s.step).toBe("reveal");
    expect(s.aiChecked).toBe(true);
    // Check: strong model, gags: fast model; names never reach a text model.
    expect(t.rt.qualities).toEqual(["strong", "fast"]);
    for (const p of log) expect(`${p.system}${p.user}`).not.toMatch(/Philip|Tina|Max|player-/);

    const reads = t.rt.sent.filter((l) => l.kind === "read" && l.cue?.startsWith("category:"));
    expect(reads.map((l) => l.cue)).toEqual(round.categories.map((_, i) => `category:${i}`));
    for (const line of reads) {
      for (const name of ["Philip", "Tina", "Max"]) expect(line.text).toContain(name);
      expect(line.text).toMatch(/Max, wir müssen reden\.$/);
    }
    // Long read-outs go to the "read" voice model.
    const styles = t.speech.speak.mock.calls.map((c) => (c[1] as { style: string }).style);
    expect(styles).toContain("read");
    expect(reads[creative]!.text).toContain(`${L}uschkopf`);

    await t.tick(); // → vote
    expect(sstate(t.rt.room!).step).toBe("vote");
    const cands = view(t.rt.room!, t.ids[0]).candidates!;
    const duschkopf = cands.findIndex((c) => c.text === `${L}uschkopf`);
    await t.act(0, { type: "vote", candidate: duschkopf });
    await t.act(1, { type: "vote", candidate: duschkopf });
    const dildo = cands.findIndex((c) => c.text === `${L}ildo`);
    await t.act(2, { type: "vote", candidate: dildo });
    expect(sstate(t.rt.room!).step).toBe("tally");
    const scores = t.rt.room!.game!.scores;
    // Philip and Tina share "…ildo" (5 each), Max's answer is unique (10) and the funniest (+10).
    expect(sstate(t.rt.room!).tally!.points[t.ids[2]!]).toEqual({ categories: 10, vote: 10, total: 20 });
    expect(scores[t.ids[2]!]).toBe(20);
    // Philip & Tina: every category shared (5 each).
    expect(scores[t.ids[0]!]).toBe(5 * round.categories.length);
    expect(scores[t.ids[1]!]).toBe(5 * round.categories.length);
  });

  it("the AI check fails → only the first letter counts and the host reads without gags; a dropped phone keeps its answers", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = setup(["Anna", "Ben"], { model: fakeModel([], { check: false }) });
    await t.start();
    const round = sstate(t.rt.room!).rounds[0]!;
    const L = round.letter;
    await t.act(0, { type: "answers", answers: [`${L}ennis`, "Quatsch"] });
    // Ben's phone dies after saving one answer.
    await t.act(1, { type: "answers", answers: [`${L}ottel`] });
    t.connected.delete(t.ids[1]!);
    await t.tick();
    await t.settle();
    const s = sstate(t.rt.room!);
    expect(s.step).toBe("reveal");
    expect(s.aiChecked).toBe(false);
    const pub = view(t.rt.room!);
    expect(pub.reveal!.categories[0]!.answers.map((a) => [a.text, a.verdict, a.points])).toEqual([
      [`${L}ennis`, "valid", 10],
      [`${L}ottel`, "valid", 10],
    ]);
    if (L !== "Q") expect(pub.reveal!.categories[1]!.answers[0]!.verdict).toBe("letter");
    expect(pub.reveal!.categories[0]!.script).not.toMatch(/reden/);
    expect(pub.reveal!.categories[0]!.script).toContain("Ben");
    warn.mockRestore();
  });

  it("with only one player a filled-in Stopp! ends the writing at once", async () => {
    const t = setup(["Solo"], { model: fakeModel([]) });
    await t.start(1);
    const round = sstate(t.rt.room!).rounds[0]!;
    await t.act(0, { type: "stop", answers: round.categories.map(() => `${round.letter}olo`) });
    await t.settle();
    expect(sstate(t.rt.room!).step).toBe("reveal");
  });

  it("the fixed lines (letters, Stopp, time's up, nobody, vote) are cached up front", async () => {
    const t = setup(["Anna"], { model: null, voice: true });
    await t.start(1);
    await t.settle();
    const texts = t.speech.speak.mock.calls.map((c) => c[0] as string);
    for (const l of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") expect(texts).toContain(`Der Buchstabe ist: ${l}!`);
    expect(texts).toContain("Zeit ist um – Stifte weg!");
    expect(texts).toContain("Stopp! Noch 10 Sekunden für alle anderen!");
    expect([...t.store.objects.keys()].filter((k) => k.includes("/read/")).length).toBeGreaterThan(26);
  });

  it("is offered in every mode and planned by Zufall", () => {
    for (const mode of ["kids", "family", "party"] as const) {
      const settings: GameModeSettings = { ...DEFAULT_MODE_SETTINGS, mode };
      const pools = poolSizesFor(settings);
      const available = plannableCategories({ mode, categories: Object.values(GAME_MODULES).map((m) => m.meta), pools });
      expect(available.map((c) => c.id)).toContain("stadt-land-fluss");
    }
  });
});

describe("TTS model for long read-outs", () => {
  it("defaults to a cheap model; ELEVENLABS_READ_MODEL picks another known one", async () => {
    expect(elevenLabsModels({}).read).toBe(ELEVENLABS_MODELS.read);
    expect(elevenLabsModels({ ELEVENLABS_READ_MODEL: "eleven_turbo_v2_5" }).read).toBe("eleven_turbo_v2_5");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(elevenLabsModels({ ELEVENLABS_READ_MODEL: "gpt-evil" }).read).toBe(ELEVENLABS_MODELS.read);
    warn.mockRestore();

    const fetchFn = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }));
    const provider = createElevenLabsProvider("xi-test", fetchFn as unknown as typeof fetch, elevenLabsModels({ ELEVENLABS_READ_MODEL: "eleven_turbo_v2_5" }));
    await provider.speak("Stadt mit B: Anna sagt Berlin.", { style: "read", speed: 1 });
    await provider.speak("Oh Max!", { style: "fast", speed: 1 });
    const bodies = fetchFn.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string) as { model_id: string });
    expect(bodies.map((b) => b.model_id)).toEqual(["eleven_turbo_v2_5", ELEVENLABS_MODELS.fast]);
    expect(provider.modelFor("read")).toBe("eleven_turbo_v2_5");
  });
});
