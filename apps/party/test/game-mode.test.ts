import { GAME_MODULES } from "@couch-clash/games";
import { DEFAULT_MODE_SETTINGS, type GameModeSettings, type ScoringSettings } from "@couch-clash/shared";
import { describe, expect, it, vi } from "vitest";
import { advance, beginGame, updateMode, updateSettings, type FlowDeps } from "../src/game-flow";
import { poolSizesFor } from "../src/pools";
import type { Result } from "../src/result";
import { createRoomRecord, joinPlayer, normalizeRoomRecord, toPublicState, type RoomRecord } from "../src/room-logic";

const T0 = 1_700_000_000_000;
const avatar = { character: "fox", color: "red" } as const;
const kids: GameModeSettings = { mode: "kids", allow16: false, difficulty: "mixed" };
const party: GameModeSettings = { mode: "party", allow16: false, difficulty: "mixed" };
const family: GameModeSettings = DEFAULT_MODE_SETTINGS;
const sc = (id: string): ScoringSettings => GAME_MODULES[id as keyof typeof GAME_MODULES].meta.scoring;

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

function room(players = 3): RoomRecord {
  let r = createRoomRecord("ABCD", "host-token-0123456789abcdef", T0);
  for (let i = 0; i < players; i++) r = unwrap(joinPlayer(r, { name: `P${i}`, avatar }, { now: T0 })).room;
  return r;
}
const deps = (r: RoomRecord): FlowDeps => ({ now: T0, random: () => 0.3, connectedPlayerIds: new Set(r.players.map((p) => p.id)) });
const ALL = [
  { categoryId: "quiz", questionCount: 8, scoring: sc("quiz") },
  { categoryId: "estimate", questionCount: 6, scoring: sc("estimate") },
  { categoryId: "bluff", questionCount: 5, scoring: sc("bluff") },
];

describe("game mode in the room", () => {
  it("new rooms and old saved rooms are Familie", () => {
    expect(room().mode).toEqual(DEFAULT_MODE_SETTINGS);
    const old = { ...room() } as Partial<RoomRecord>;
    delete old.mode;
    delete old.partyConfirmed;
    expect(normalizeRoomRecord(old as RoomRecord)).toMatchObject({ mode: DEFAULT_MODE_SETTINGS, partyConfirmed: false });
  });

  it("Party needs a one-time confirmation, remembered per room", () => {
    let r = room();
    expect(updateMode(r, party, false)).toEqual({ ok: false, error: "PARTY_CONFIRM_REQUIRED" });
    r = unwrap(updateMode(r, party, true));
    expect(r).toMatchObject({ mode: party, partyConfirmed: true });
    r = unwrap(updateMode(r, family, false));
    // Back to Party without asking again.
    expect(unwrap(updateMode(r, party, false)).mode.mode).toBe("party");
  });

  it("switching mode sets the Frechheit default and drops categories the mode doesn't offer", () => {
    let r = unwrap(updateSettings(room(), ALL));
    expect(r.settings.map((s) => s.categoryId)).toEqual(["quiz", "estimate", "bluff"]);
    r = unwrap(updateMode(r, kids, false));
    expect(r.settings.map((s) => s.categoryId)).toEqual(["quiz", "estimate"]);
    expect(r.voice.settings.cheekiness).toBe("nett");
    r = unwrap(updateMode(r, party, true));
    expect(r.voice.settings.cheekiness).toBe("frech");
    // In Kids mode bluff can't be selected at all.
    r = unwrap(updateMode(r, kids, false));
    expect(unwrap(updateSettings(r, ALL)).settings.map((s) => s.categoryId)).toEqual(["quiz", "estimate"]);
  });

  it("question counts are capped by the mode's pool", () => {
    const pools = poolSizesFor(kids);
    let r = unwrap(updateMode(room(), kids, false));
    r = unwrap(updateSettings(r, [{ categoryId: "estimate", questionCount: 15, scoring: sc("estimate") }]));
    expect(r.settings[0]!.questionCount).toBeLessThanOrEqual(Math.min(15, pools.estimate!));
    expect(pools.bluff).toBe(0);
  });

  it("a Zufall plan may repeat a category, but never directly after itself", () => {
    const r = room();
    const q = { categoryId: "quiz", questionCount: 8, scoring: sc("quiz") };
    const e = { categoryId: "estimate", questionCount: 6, scoring: sc("estimate") };
    expect(unwrap(updateSettings(r, [q, e, q])).settings.map((s) => s.categoryId)).toEqual(["quiz", "estimate", "quiz"]);
    expect(updateSettings(r, [q, q])).toEqual({ ok: false, error: "INVALID_PLAN" });
  });

  it("only in lobby/setup", () => {
    expect(updateMode({ ...room(), phase: "play" }, kids, false)).toEqual({ ok: false, error: "WRONG_PHASE" });
  });

  it("the round only plays questions eligible in the mode", () => {
    let r = unwrap(updateMode(room(), kids, false));
    r = unwrap(updateSettings(r, [{ categoryId: "quiz", questionCount: 20, scoring: sc("quiz") }]));
    r = unwrap(beginGame(r, deps(r)));
    r = unwrap(advance(r, deps(r)));
    const ids = (r.game!.moduleState as { questions: { id: string }[] }).questions.map((q) => q.id);
    const entries = new Map(GAME_MODULES.quiz.listContent!().map((e) => [e.id, e]));
    for (const id of ids) expect(entries.get(id)).toMatchObject({ ageRating: 6, difficulty: 1 });
  });

  it("public state: mode for everyone (summary), pools and confirmation for the host only", () => {
    const r = unwrap(updateSettings(room(), ALL));
    const connected = { host: true, playerIds: new Set<string>() };
    const host = toPublicState(r, connected, { role: "host" });
    const player = toPublicState(r, connected, { role: "player", playerId: r.players[0]!.id });
    expect(host.settingsSummary!.mode).toBe("family");
    expect(player.settingsSummary!.mode).toBe("family");
    expect(host.poolSizes!.quiz).toBeGreaterThan(100);
    expect(player.poolSizes).toBeNull();
    expect(player.partyConfirmed).toBe(false);
  });
});

describe("Party-Anteil in the room", () => {
  const start = (r: RoomRecord, d: FlowDeps) => unwrap(advance(unwrap(beginGame(r, d)), d));
  const questionsOf = (r: RoomRecord) => (r.game!.moduleState as { questions: { adult?: boolean }[] }).questions;

  it("the host's share reaches the round (100 % → only party questions)", () => {
    let r = unwrap(updateMode(room(), { ...party, partyShare: 1 }, true));
    r = unwrap(updateSettings(r, [{ categoryId: "estimate", questionCount: 6, scoring: sc("estimate") }]));
    expect(r.mode.partyShare).toBe(1);
    const qs = questionsOf(start(r, deps(r)));
    expect(qs).toHaveLength(6);
    expect(qs.every((q) => q.adult)).toBe(true);
  });

  it("default 30 %: max(1, ceil(6 × 0.3)) = 2 party questions", () => {
    let r = unwrap(updateMode(room(), party, true));
    r = unwrap(updateSettings(r, [{ categoryId: "estimate", questionCount: 6, scoring: sc("estimate") }]));
    expect(questionsOf(start(r, deps(r))).filter((q) => q.adult)).toHaveLength(2);
  });

  it("all party questions played already → logged, family fills up, the game still starts", () => {
    let r = unwrap(updateMode(room(), party, true));
    r = unwrap(updateSettings(r, [{ categoryId: "estimate", questionCount: 6, scoring: sc("estimate") }]));
    r = { ...r, usedContentIds: GAME_MODULES.estimate.listContent!().filter((q) => q.adult).map((q) => q.id) };
    const log = vi.fn();
    const qs = questionsOf(start(r, { ...deps(r), log }));
    expect(qs).toHaveLength(6);
    expect(qs.some((q) => q.adult)).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("party pool"), expect.objectContaining({ label: "estimate", unplayedParty: 0 }));
  });
});
