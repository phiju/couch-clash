/**
 * The Musik-Quiz through the room's real game flow: fresh previews via the
 * task runner at the round start, the buzzer order decided by arrival at the
 * server, points into the game's scores, Kids without a timer.
 */
import { MUSIK_TEST_SONGS } from "@couch-clash/content";
import {
  GAME_MODULES,
  createMusikModule,
  musikMeta,
  normalizeScoring,
  type ModuleRegistry,
  type MusikPublicState,
  type MusikState,
} from "@couch-clash/games";
import type { GameMode, SongPreviewRequest } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { advance, beginGame, handlePlayerAction, publicGame, updateMode, updateSettings, type FlowDeps } from "../src/game-flow";
import type { Result } from "../src/result";
import { createRoomRecord, joinPlayer, type RoomRecord } from "../src/room-logic";
import { ModuleTaskRunner } from "../src/tasks/runner";

const T0 = 1_750_000_000_000;
const avatar = { character: "fox", color: "red" } as const;
const registry: ModuleRegistry = { ...GAME_MODULES, musik: createMusikModule({ songs: MUSIK_TEST_SONGS }) as never };

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.value;
}

let seed = 3;
const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

async function setup(mode: GameMode, options: Record<string, boolean> = {}) {
  let room = createRoomRecord("MUSI", "host-token-0123456789abcdef", T0);
  const ids: string[] = [];
  for (const name of ["Anna", "Ben"]) {
    const r = unwrap(joinPlayer(room, { name, avatar }, { now: T0 }));
    room = r.room;
    ids.push(r.player.id);
  }
  room = unwrap(updateMode(room, { mode, allow16: false, difficulty: "mixed" }, true, registry));
  room = unwrap(
    updateSettings(room, [{ categoryId: "musik", questionCount: 3, scoring: normalizeScoring(musikMeta, undefined), options }], registry),
  );
  let now = T0;
  const deps = (): FlowDeps => ({ now, random, connectedPlayerIds: new Set(ids), registry });
  room = unwrap(beginGame(room, deps()));
  now = room.phaseEndsAt!;
  room = unwrap(advance(room, deps())); // intro → loading

  const asked: SongPreviewRequest[][] = [];
  const pending: Promise<unknown>[] = [];
  const runner = new ModuleTaskRunner({
    read: () => room,
    commit: async (next) => {
      room = next;
    },
    waitUntil: (p) => pending.push(p),
    flowDeps: deps,
    model: () => null,
    songs: () => async (tracks) => {
      asked.push([...tracks]);
      return Object.fromEntries(tracks.map((t) => [t.songId, t.previewUrl ?? null]));
    },
    registry,
  });
  runner.roomChanged(room);
  await Promise.all(pending);
  return {
    get room() {
      return room;
    },
    set room(r: RoomRecord) {
      room = r;
    },
    ids,
    asked,
    deps,
    tick: (ms: number) => (now += ms),
    at: (t: number) => (now = t),
  };
}

const state = (room: RoomRecord) => room.game!.moduleState as MusikState;
const view = (room: RoomRecord, viewer: "host" | string) =>
  publicGame(room, viewer === "host" ? { role: "host" } : { role: "player", playerId: viewer }, registry)!.module as MusikPublicState;

describe("Musik-Quiz in the room", () => {
  it("round start: the room looks up fresh previews, then announces the first song", async () => {
    const t = await setup("family", { typeTitle: true, typeArtist: false, typeYear: false });
    expect(t.asked).toHaveLength(1);
    expect(t.asked[0]!.length).toBeGreaterThanOrEqual(3);
    expect(state(t.room).step).toBe("announce");
    expect(view(t.room, "host").clip).toBeNull();
  });

  it("buzzer: arrival order at the server decides, points land in the scores", async () => {
    const t = await setup("family", { typeTitle: true, typeArtist: false, typeYear: false });
    const [anna, ben] = t.ids as [string, string];
    t.at(t.room.phaseEndsAt!);
    t.room = unwrap(advance(t.room, t.deps())); // announce → play
    expect(view(t.room, "host").clip!.url).toMatch(/^\/test-audio\//);
    expect(view(t.room, anna).clip!.url).toBeNull();
    t.tick(2_000);
    // Both tap at the "same" moment – Ben's message is handled first.
    t.room = unwrap(handlePlayerAction(t.room, ben, { type: "buzz" }, t.deps()));
    const late = handlePlayerAction(t.room, anna, { type: "buzz" }, t.deps());
    expect(late.ok ? null : late.error).toBe("BUZZER_TAKEN");
    expect(view(t.room, anna).buzz?.playerId).toBe(ben);
    const title = state(t.room).slots[0]!.song.title;
    t.tick(3_000);
    t.room = unwrap(handlePlayerAction(t.room, ben, { type: "answer", text: title }, t.deps()));
    expect(state(t.room).step).toBe("reveal");
    expect(t.room.game!.scores[ben]).toBe(200);
  });

  it("kids: no timer while the song loops; the host's „Auflösen“ solves", async () => {
    const t = await setup("kids");
    t.at(t.room.phaseEndsAt!);
    t.room = unwrap(advance(t.room, t.deps()));
    expect(t.room.phaseEndsAt).toBeNull();
    expect(view(t.room, "host").clip!.loop).toBe(true);
    t.room = unwrap(advance(t.room, t.deps())); // "Auflösen"
    expect(state(t.room).step).toBe("reveal");
  });
});
