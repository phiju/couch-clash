import type { HostLine, ScoringSettings } from "@couch-clash/shared";
import { bluffMeta } from "@couch-clash/games";
import { describe, expect, it, vi } from "vitest";
import { advance, beginGame, handlePlayerAction, updateSettings, type FlowDeps } from "../src/game-flow";
import type { JsonModel } from "../src/generate/model";
import type { Result } from "../src/result";
import { createRoomRecord, joinPlayer, type RoomRecord } from "../src/room-logic";
import { ModuleTaskRunner } from "../src/tasks/runner";
import { VoiceDirector } from "../src/voice/director";
import type { VoiceServices } from "../src/voice/service";
import { memoryStore } from "./avatar-helpers";
import { mockSpeech } from "./voice-helpers";

const T0 = 1_700_000_000_000;
const avatar = { character: "fox", color: "red" } as const;
const scoring: ScoringSettings = bluffMeta.scoring;

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

type BState = { step: string; index: number; options: { text: string; correct: boolean; authors: string[] }[] | null; knewIt: string[]; stepEndsAt: number };
const bstate = (room: RoomRecord) => room.game!.moduleState as BState;

function setup(names: string[], opts: { model?: JsonModel | null; voice?: boolean; categoryId?: "bluff" | "skurril" } = {}) {
  let room = createRoomRecord("ABCD", "host-token-0123456789abcdef", T0);
  const ids: string[] = [];
  for (const name of names) {
    const r = unwrap(joinPlayer(room, { name, avatar }, { now: T0 }));
    room = r.room;
    ids.push(r.player.id);
  }
  const rt = {
    room: room as RoomRecord | null,
    now: T0,
    tasks: [] as Promise<unknown>[],
    sent: [] as HostLine[],
    qualities: [] as string[],
  };
  const deps = (): FlowDeps => ({ now: rt.now, random: () => 0.5, connectedPlayerIds: new Set(ids) });
  const commit = async (next: RoomRecord) => {
    const prev = rt.room;
    rt.room = next;
    runner.roomChanged(next);
    director?.roomChanged(prev, next);
  };
  const runner: ModuleTaskRunner = new ModuleTaskRunner({
    read: () => rt.room,
    commit,
    waitUntil: (p) => rt.tasks.push(p),
    flowDeps: deps,
    model: (quality) => {
      rt.qualities.push(quality);
      return opts.model === undefined ? null : opts.model;
    },
  });
  let n = 0;
  const services: VoiceServices = { text: null, speech: mockSpeech(), store: memoryStore() };
  const director: VoiceDirector | null = opts.voice
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
  const start = async () => {
    await commit(unwrap(updateSettings(rt.room!, [{ categoryId: opts.categoryId ?? "bluff", questionCount: 3, scoring }])));
    await commit(unwrap(beginGame(rt.room!, deps())));
    await commit(unwrap(advance(rt.room!, deps()))); // intro → write
    await settle();
  };
  const define = async (i: number, text: string) => {
    rt.now += 1000;
    await commit(unwrap(handlePlayerAction(rt.room!, ids[i]!, { type: "define", text }, deps())));
  };
  return { rt, ids, deps, commit, settle, start, define, director };
}

describe("Bluff-Lexikon in the room", () => {
  it("the room runs the AI check (anonymous keys) and applies it", async () => {
    const prompts: string[] = [];
    const model: JsonModel = async (_system, user) => {
      prompts.push(user);
      return {
        results: [
          { id: "s1", verdict: "correct", text: "x", group: 1 },
          { id: "s2", verdict: "bluff", text: "ein Hut", group: 2 },
          { id: "s3", verdict: "bluff", text: "ein Tanz", group: 3 },
        ],
      };
    };
    const t = setup(["Anna", "Ben", "Clara"], { model });
    await t.start();
    expect(bstate(t.rt.room!).step).toBe("write");
    await t.define(0, "irgendwas Richtiges");
    await t.define(1, "ein Hut");
    await t.define(2, "ein Tanz");
    await t.settle();
    const s = bstate(t.rt.room!);
    expect(s.step).toBe("present");
    expect(s.knewIt).toEqual([t.ids[0]]);
    expect(s.options).toHaveLength(3);
    // Only the texts go to the model – no names, no player ids.
    expect(prompts[0]).toContain("ein Hut");
    expect(prompts[0]).not.toContain("Anna");
    expect(prompts[0]).not.toContain(t.ids[0]!);
    // Judging answers uses the strong model.
    expect(t.rt.qualities).toEqual(["strong"]);
  });

  it("category options reach the module (unknown ones are dropped)", async () => {
    const t = setup(["Anna", "Ben"]);
    await t.commit(
      unwrap(
        updateSettings(t.rt.room!, [{ categoryId: "bluff", questionCount: 3, scoring, options: { showOriginals: true, hack: true } }]),
      ),
    );
    expect(t.rt.room!.settings[0]!.options).toEqual({ showOriginals: true });
    await t.commit(unwrap(beginGame(t.rt.room!, t.deps())));
    await t.commit(unwrap(advance(t.rt.room!, t.deps())));
    expect((t.rt.room!.game!.moduleState as { showOriginals: boolean }).showOriginals).toBe(true);
  });

  it("model error or no API key → shown as written", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const model of [null, async () => Promise.reject(new Error("OpenAI HTTP 500"))] as (JsonModel | null)[]) {
      const t = setup(["Anna", "Ben"], { model });
      await t.start();
      await t.define(0, "ein Hut");
      await t.define(1, "ein Boot");
      await t.settle();
      expect(bstate(t.rt.room!).step).toBe("present");
      expect(bstate(t.rt.room!).options).toHaveLength(3);
    }
    warn.mockRestore();
  });

  it("if the task never answers, the alarm falls back after the check time", async () => {
    const t = setup(["Anna", "Ben"], { model: () => new Promise(() => {}) });
    await t.start();
    await t.define(0, "ein Hut");
    await t.define(1, "ein Boot");
    const s = bstate(t.rt.room!);
    expect(s.step).toBe("check");
    t.rt.now = s.stepEndsAt;
    await t.commit(unwrap(advance(t.rt.room!, t.deps())));
    expect(bstate(t.rt.room!).step).toBe("present");
    t.rt.tasks.length = 0; // the hanging task is abandoned
  });

  it("the host reads the options out, one clip per option with a cue; the step waits for the voice", async () => {
    const t = setup(["Anna", "Ben"], { model: null, voice: true });
    await t.start();
    await t.define(0, "ein Hut");
    await t.define(1, "ein Boot");
    await t.settle();
    const reads = t.rt.sent.filter((l) => l.kind === "read");
    const s = bstate(t.rt.room!);
    expect(reads.map((l) => l.cue)).toEqual(["option:0", "option:1", "option:2"]);
    expect(reads[0]!.text).toBe(`A: ${s.options![0]!.text}`);
    // No AI text lines used for reading.
    expect(t.rt.room!.voice.linesUsed).toBe(1); // only the game-start line
    // The last option starts late → the present step is extended.
    const end = s.stepEndsAt;
    t.director!.hostEvent(reads[2]!.id, "started", end + 3000);
    await t.settle();
    expect(t.rt.room!.phaseEndsAt).toBe(end + 3000 + 700);
  });

  it("categories that need 2 players are skipped with 1 player", () => {
    const t = setup(["Solo"]);
    let room = unwrap(
      updateSettings(t.rt.room!, [
        { categoryId: "bluff", questionCount: 3, scoring },
        { categoryId: "quiz", questionCount: 3, scoring: { ...scoring, mode: "absolute" } },
      ]),
    );
    const game = unwrap(beginGame(room, t.deps())).game!;
    expect(game.rounds.map((r) => r.categoryId)).toEqual(["quiz"]);
    room = unwrap(updateSettings(t.rt.room!, [{ categoryId: "bluff", questionCount: 3, scoring }]));
    expect(beginGame(room, t.deps())).toEqual({ ok: false, error: "NOT_ENOUGH_PLAYERS" });
  });
});

describe("Skurrile Ereignisse in the room", () => {
  type Story = { context: string; question: string };
  const story = (room: RoomRecord) => {
    const s = room.game!.moduleState as { words: Story[]; index: number };
    return s.words[s.index]!;
  };

  it("the host reads the story and the question when the writing starts (fixed text, no AI line)", async () => {
    const t = setup(["Anna", "Ben"], { model: null, voice: true, categoryId: "skurril" });
    await t.start();
    const s = story(t.rt.room!);
    // (The intro card's description is read too – "Skurrile Ereignisse! Wahre Geschichten, …")
    const reads = t.rt.sent.filter((l) => l.kind === "read" && l.cue);
    expect(reads.map((l) => [l.cue, l.text])).toEqual([["prompt", `${s.context} ${s.question}`]]);
    expect(t.rt.room!.voice.linesUsed).toBe(1); // only the game-start line
  });

  it("the Bluff-Lexikon still reads nothing while writing", async () => {
    const t = setup(["Anna", "Ben"], { model: null, voice: true });
    await t.start();
    expect(t.rt.sent.filter((l) => l.kind === "read" && l.cue)).toEqual([]);
  });

  it("the room runs the event check with the strong model and the story as data", async () => {
    const systems: string[] = [];
    const users: string[] = [];
    const model: JsonModel = async (system, user) => {
      systems.push(system);
      users.push(user);
      return {
        results: [
          { id: "s1", verdict: "bluff", polished: "Er ist eingeschlafen", sameIdea: true, group: 1 },
          { id: "s2", verdict: "bluff", polished: "Er ist mit dem Zug gefahren", sameIdea: true, group: 2 },
        ],
      };
    };
    const t = setup(["Anna", "Ben"], { model, categoryId: "skurril" });
    await t.start();
    const s = story(t.rt.room!);
    await t.define(0, "er is eingeschlafen");
    await t.define(1, "mit dem zug");
    await t.settle();
    expect(bstate(t.rt.room!).step).toBe("present");
    expect(bstate(t.rt.room!).options!.map((o) => o.text)).toContain("Er ist mit dem Zug gefahren");
    expect(systems[0]).toContain("Skurrile Ereignisse");
    expect(JSON.parse(users[0]!.split("\n")[1]!)).toMatchObject({ context: s.context, question: s.question });
    expect(users[0]).not.toContain("Anna");
    expect(t.rt.qualities).toContain("strong");
  });
});
