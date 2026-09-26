/**
 * Pixelpanik through the room's real game flow: a whole round of 5 pictures
 * in Familie, Party and Kids – points per stage into the game's scores,
 * out / locked, and the TV never seeing a later stage early.
 */
import { PIXELPANIK_MOTIFS, PIXELPANIK_STAGE_SIZES } from "@couch-clash/content";
import {
  GAME_MODULES,
  createPixelpanikModule,
  normalizeScoring,
  pixelpanikMeta,
  type ModuleRegistry,
  type PixelpanikPublicState,
  type PixelpanikState,
} from "@couch-clash/games";
import type { GameMode, GameModeSettings } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { advance, beginGame, handlePlayerAction, publicGame, updateMode, updateSettings, type FlowDeps } from "../src/game-flow";
import type { Result } from "../src/result";
import { poolSizesFor } from "../src/pools";
import { createRoomRecord, joinPlayer, type RoomRecord } from "../src/room-logic";

const T0 = 1_700_000_000_000;
const avatar = { character: "fox", color: "red" } as const;

// The real motifs, each with stand-in pictures (the image script adds the real ones).
const pool = PIXELPANIK_MOTIFS.map((m) => ({
  ...m,
  image: { stages: PIXELPANIK_STAGE_SIZES.map((size, i) => `https://img.test/${m.id}/${i}-${(i * 31 + 7).toString(36)}-${size}.png`) },
}));
const registry: ModuleRegistry = { ...GAME_MODULES, pixelpanik: createPixelpanikModule({ pool }) as never };

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.value;
}

let seed = 5;
const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

function setup(mode: GameMode) {
  let room = createRoomRecord("PIXL", "host-token-0123456789abcdef", T0);
  const ids: string[] = [];
  for (const name of ["Anna", "Ben"]) {
    const r = unwrap(joinPlayer(room, { name, avatar }, { now: T0 }));
    room = r.room;
    ids.push(r.player.id);
  }
  const settings: GameModeSettings = { mode, allow16: false, difficulty: "mixed" };
  room = unwrap(updateMode(room, settings, true, registry));
  room = unwrap(
    updateSettings(room, [{ categoryId: "pixelpanik", questionCount: 5, scoring: normalizeScoring(pixelpanikMeta, undefined) }], registry),
  );
  const deps = (now: number): FlowDeps => ({ now, random, connectedPlayerIds: new Set(ids), registry });
  room = unwrap(beginGame(room, deps(T0)));
  room = unwrap(advance(room, deps(room.phaseEndsAt!))); // intro → first picture
  return { room, anna: ids[0]!, ben: ids[1]!, deps };
}

const state = (room: RoomRecord) => room.game!.moduleState as PixelpanikState;
const hostView = (room: RoomRecord) => publicGame(room, { role: "host" }, registry)!.module as PixelpanikPublicState;

describe.each(["family", "party", "kids"] as const)("Pixelpanik round in %s mode", (mode) => {
  it("5 pictures: points per stage go into the game's scores; wrong = out / locked", () => {
    const { room: first, anna: A, ben: B, deps } = setup(mode);
    let room = first;
    let now = room.phaseStartedAt;
    const played: string[] = [];

    for (let picture = 0; picture < 5; picture++) {
      expect(room.phase).toBe("play");
      const s = state(room);
      expect(s.index).toBe(picture);
      const motif = s.motifs[s.index]!;
      played.push(motif.id);
      const source = PIXELPANIK_MOTIFS.find((m) => m.id === motif.id)!;
      if (mode === "kids") expect(source.modes).toContain("kinder");
      if (mode === "family") expect(source.modes).toContain("erwachsene");

      // The TV sees stage 1 (4×4) and nothing later; the phones see no picture.
      expect(hostView(room).image).toEqual({ url: motif.stages[0], size: 4 });
      const phone = publicGame(room, { role: "player", playerId: A }, registry)!.module as PixelpanikPublicState;
      expect(phone.image).toBeNull();

      // Anna gets it at 4×4.
      now += 1_000;
      if (mode === "kids") {
        room = unwrap(handlePlayerAction(room, A, { type: "choice", index: motif.correctChoice }, deps(now)));
        const wrong = [0, 1, 2, 3].find((i) => i !== motif.correctChoice)!;
        room = unwrap(handlePlayerAction(room, B, { type: "choice", index: wrong }, deps(now)));
        expect(handlePlayerAction(room, B, { type: "choice", index: motif.correctChoice }, deps(now)).ok).toBe(false); // locked
        // Next stage (8×8): Ben may try again – and gets it.
        now = room.phaseEndsAt!;
        room = unwrap(advance(room, deps(now)));
        expect(hostView(room).image).toEqual({ url: motif.stages[1], size: 8 });
        room = unwrap(handlePlayerAction(room, B, { type: "choice", index: motif.correctChoice }, deps(now + 500)));
      } else {
        room = unwrap(handlePlayerAction(room, A, { type: "guess", text: source.synonyms[0] ?? source.answer }, deps(now)));
        room = unwrap(handlePlayerAction(room, B, { type: "guess", text: "Quatschantwort" }, deps(now)));
        // Out: no second try.
        expect(handlePlayerAction(room, B, { type: "guess", text: source.answer }, deps(now)).ok).toBe(false);
      }
      // Everyone done → the solution.
      expect(state(room).step).toBe("reveal");
      expect(hostView(room).reveal?.answer).toBe(source.answer);
      expect(hostView(room).image).toEqual({ url: motif.stages[5], size: 0 });
      now = room.phaseEndsAt!;
      room = unwrap(advance(room, deps(now))); // → leaderboard
      expect(state(room).step).toBe("leaderboard");
      now = room.phaseEndsAt!;
      room = unwrap(advance(room, deps(now))); // → next picture / scoreboard
    }

    expect(room.phase).toBe("scoreboard");
    expect(new Set(played).size).toBe(5);
    expect(room.game!.scores[A]).toBe(5 * 200);
    expect(room.game!.scores[B]).toBe(mode === "kids" ? 5 * 180 : 0);
    // Mode-neutral: every motif may come up in Party, Kids and Familie never get party motifs.
    if (mode !== "party") expect(played.some((id) => PIXELPANIK_MOTIFS.find((m) => m.id === id)!.modes.join() === "party")).toBe(false);
  });
});

describe("Pixelpanik is mode-neutral", () => {
  it("with pictures it can be picked in every mode – Party gets every motif", () => {
    const sizes = (mode: GameMode) => poolSizesFor({ mode, allow16: false, difficulty: "mixed" }, registry).pixelpanik!;
    expect(sizes("party")).toBe(PIXELPANIK_MOTIFS.length);
    expect(sizes("family")).toBe(PIXELPANIK_MOTIFS.filter((m) => m.modes.includes("erwachsene")).length);
    expect(sizes("kids")).toBe(PIXELPANIK_MOTIFS.filter((m) => m.kids_choices).length);
    for (const mode of ["kids", "family", "party"] as const) {
      expect(sizes(mode)).toBeGreaterThanOrEqual(pixelpanikMeta.questionsPerRound.max);
      let room = createRoomRecord("NEUT", "host-token-0123456789abcdef", T0);
      room = unwrap(updateMode(room, { mode, allow16: false, difficulty: "mixed" }, true, registry));
      room = unwrap(
        updateSettings(room, [{ categoryId: "pixelpanik", questionCount: 10, scoring: normalizeScoring(pixelpanikMeta, undefined) }], registry),
      );
      expect(room.settings).toMatchObject([{ categoryId: "pixelpanik", questionCount: 10 }]);
    }
  });
});

describe("Pixelpanik without pictures", () => {
  it("is not offered as long as no motif has pictures (settings drop it)", () => {
    const hasPictures = (GAME_MODULES.pixelpanik.listContent?.() ?? []).length > 0;
    let room = createRoomRecord("NOPX", "host-token-0123456789abcdef", T0);
    room = unwrap(
      updateSettings(room, [{ categoryId: "pixelpanik", questionCount: 5, scoring: normalizeScoring(pixelpanikMeta, undefined) }]),
    );
    expect(room.settings.some((r) => r.categoryId === "pixelpanik")).toBe(hasPictures);
  });
});

describe("timeline", () => {
  it("six stages of 4 s each, then the solution – nobody guessed → 0 points, the host says 'Keiner'", () => {
    const { room: start, deps } = setup("family");
    let room = start;
    const motif = state(room).motifs[0]!;
    for (let stage = 0; stage < 6; stage++) {
      expect(state(room).stage).toBe(stage);
      expect(hostView(room).image?.url).toBe(motif.stages[stage]);
      expect(room.phaseEndsAt! - state(room).stageStartedAt).toBe(4_000);
      room = unwrap(advance(room, deps(room.phaseEndsAt!)));
    }
    expect(state(room).step).toBe("reveal");
    expect(Object.values(room.game!.scores)).toEqual([0, 0]);
    expect(state(room).events.map((e) => e.type)).toEqual(["NOBODY_YET", "NOBODY"]);
  });
});
