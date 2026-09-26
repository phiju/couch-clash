import { GAME_MODULES, SURVIVAL_CONFIG, survivalModule, type SurvivalState } from "@couch-clash/games";
import { describe, expect, it } from "vitest";
import { advance, beginGame, updateSettings, type FlowDeps } from "../src/game-flow";
import type { Result } from "../src/result";
import { createRoomRecord, joinPlayer, type RoomRecord } from "../src/room-logic";
import { applySurvivalCue, survivalOf, trophyCandidates } from "../src/survival-room";

const T0 = 1_700_000_000_000;
const avatar = { character: "fox", color: "red" } as const;

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.value;
}

const deps = (now: number, connected: string[]): FlowDeps => ({ now, random: () => 0.4, connectedPlayerIds: new Set(connected), registry: GAME_MODULES });
const state = (room: RoomRecord) => room.game!.moduleState as SurvivalState;

/** A finale in its rules (intro step). */
function finale(names: string[]) {
  let room = createRoomRecord("CUES", "host-token-0123456789abcdef", T0);
  const ids: string[] = [];
  for (const name of names) {
    const r = unwrap(joinPlayer(room, { name, avatar }, { now: T0 }));
    room = r.room;
    ids.push(r.player.id);
  }
  room = unwrap(updateSettings(room, [{ categoryId: "survival", questionCount: 1, scoring: survivalModule.meta.scoring }], GAME_MODULES));
  room = unwrap(beginGame(room, deps(T0, ids)));
  room = unwrap(advance(room, deps(room.phaseEndsAt!, ids)));
  return { room, ids };
}

describe("Survival-Finale: the room follows the moderator", () => {
  it("launch cue: the ride starts when his opening line ends (never twice, never in another step)", () => {
    const { room: intro, ids } = finale(["Anna", "Ben", "Cleo"]);
    expect(applySurvivalCue(intro, "launch", intro.phaseStartedAt!)).toBeNull();
    const launch = unwrap(advance(intro, deps(intro.phaseEndsAt!, ids)));
    expect(state(launch).step).toBe("launch");
    const now = launch.phaseEndsAt! - SURVIVAL_CONFIG.launchLineMaxMs + 2_500; // line over after 2.5 s
    const cued = applySurvivalCue(launch, "launch", now)!;
    expect(cued.phaseEndsAt).toBe(now);
    const rising = unwrap(advance(cued, deps(now, ids)));
    expect(state(rising).launchRiseAt).toBe(now);
    // Riding already: a second cue changes nothing.
    expect(applySurvivalCue(rising, "launch", now + 100)).toBeNull();
    expect(applySurvivalCue(rising, "ceremony", now + 100)).toBeNull();
  });

  it("ceremony cue: after the last line – but the winner still gets his moment", () => {
    const { room, ids } = finale(["Anna", "Ben"]);
    const s = state(room);
    const winnerAt = T0 + 60_000;
    const won: RoomRecord = {
      ...room,
      phaseEndsAt: winnerAt + SURVIVAL_CONFIG.winnerMs,
      game: { ...room.game!, moduleState: { ...s, step: "winner", stepStartedAt: winnerAt, stepEndsAt: winnerAt + SURVIVAL_CONFIG.winnerMs, winnerId: ids[0]! } },
    };
    expect(applySurvivalCue(won, "ceremony", winnerAt + 6_800)!.phaseEndsAt).toBe(winnerAt + 6_800);
    // No line at all (voice off): the platform rides up, a short cheer, then the ceremony.
    expect(applySurvivalCue(won, "ceremony", winnerAt + 100)!.phaseEndsAt).toBe(winnerAt + SURVIVAL_CONFIG.winnerMinMs);
    const done = unwrap(advance(applySurvivalCue(won, "ceremony", winnerAt + 6_800)!, deps(winnerAt + 6_800, ids)));
    expect(done.phase).toBe("finale");
    expect(survivalOf(done)).toBeNull();
  });

  it("trophy figures: for exactly the last two, once", () => {
    const { room: three, ids } = finale(["Anna", "Ben", "Cleo"]);
    expect(trophyCandidates(null, three)).toEqual([]);
    const { room: two, ids: pair } = finale(["Anna", "Ben"]);
    // A finale that starts with two: right away.
    expect(trophyCandidates(null, two).sort()).toEqual([...pair].sort());
    expect(trophyCandidates(two, two)).toEqual([]);
    // Later in a bigger finale: when FINAL_TWO happens.
    const s = state(three);
    const seq = s.eventSeq + 1;
    const later: RoomRecord = {
      ...three,
      game: { ...three.game!, moduleState: { ...s, eventSeq: seq, events: [...s.events, { seq, type: "FINAL_TWO", at: T0 + 90_000, playerIds: [ids[0]!, ids[2]!] }] } },
    };
    expect(trophyCandidates(three, later)).toEqual([ids[0], ids[2]]);
    expect(trophyCandidates(later, later)).toEqual([]);
  });
});
