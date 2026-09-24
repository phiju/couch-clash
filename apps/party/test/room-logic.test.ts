import { describe, expect, it } from "vitest";
import { MAX_PLAYERS, type Avatar } from "@couch-clash/shared";
import {
  authenticateHost,
  authenticatePlayer,
  createRoomRecord,
  isExpired,
  joinPlayer,
  kickPlayer,
  startGame,
  toPublicState,
  type RoomRecord,
} from "../src/room-logic";

const HOST_TOKEN = "host-token-0123456789abcdef";
const avatar: Avatar = { character: "fox", color: "red" };
const T0 = 1_700_000_000_000;

let counter = 0;
const deps = () => ({ now: T0 + 1000, secret: () => `secret-${++counter}-0123456789abcdef` });

function newRoom(): RoomRecord {
  return createRoomRecord("ABCD", HOST_TOKEN, T0);
}

function join(room: RoomRecord, name: string) {
  const r = joinPlayer(room, { name, avatar }, deps());
  if (!r.ok) throw new Error(`join failed: ${r.error}`);
  return r.value;
}

describe("createRoomRecord", () => {
  it("starts in lobby and expires after 24h", () => {
    const room = newRoom();
    expect(room.phase).toBe("lobby");
    expect(room.players).toEqual([]);
    expect(room.expiresAt - room.createdAt).toBe(24 * 60 * 60 * 1000);
    expect(isExpired(room, T0 + 24 * 60 * 60 * 1000 - 1)).toBe(false);
    expect(isExpired(room, T0 + 24 * 60 * 60 * 1000)).toBe(true);
  });
});

describe("host auth", () => {
  it("accepts the right token and rejects others", () => {
    const room = newRoom();
    expect(authenticateHost(room, HOST_TOKEN)).toBe(true);
    expect(authenticateHost(room, HOST_TOKEN.slice(0, -1) + "x")).toBe(false);
    expect(authenticateHost(room, "")).toBe(false);
  });
});

describe("joinPlayer", () => {
  it("adds a player with id, secret and cleaned name", () => {
    const { room, player } = join(newRoom(), "  Anna   Lena ");
    expect(room.players).toHaveLength(1);
    expect(player.name).toBe("Anna Lena");
    expect(player.id).toBeTruthy();
    expect(player.secret).toBeTruthy();
    expect(player.id).not.toBe(player.secret);
    expect(player.avatar).toEqual(avatar);
  });

  it("does not mutate the input room", () => {
    const room = newRoom();
    join(room, "Anna");
    expect(room.players).toHaveLength(0);
  });

  it("rejects duplicate names case-insensitively", () => {
    const { room } = join(newRoom(), "Anna");
    for (const name of ["anna", "ANNA", " Anna "]) {
      const r = joinPlayer(room, { name, avatar }, deps());
      expect(r).toEqual({ ok: false, error: "NAME_TAKEN" });
    }
  });

  it("rejects empty and too long names", () => {
    const room = newRoom();
    expect(joinPlayer(room, { name: "   ", avatar }, deps())).toEqual({
      ok: false,
      error: "INVALID_NAME",
    });
    expect(joinPlayer(room, { name: "x".repeat(21), avatar }, deps())).toEqual({
      ok: false,
      error: "INVALID_NAME",
    });
    expect(joinPlayer(room, { name: "x".repeat(20), avatar }, deps()).ok).toBe(true);
  });

  it("only allows joining in the lobby", () => {
    const { room } = join(newRoom(), "Anna");
    const started = startGame(room, T0 + 2000);
    if (!started.ok) throw new Error("start failed");
    expect(joinPlayer(started.value, { name: "Ben", avatar }, deps())).toEqual({
      ok: false,
      error: "GAME_ALREADY_STARTED",
    });
  });

  it("enforces the player limit", () => {
    let room = newRoom();
    for (let i = 0; i < MAX_PLAYERS; i++) room = join(room, `P${i}`).room;
    expect(joinPlayer(room, { name: "Late", avatar }, deps())).toEqual({
      ok: false,
      error: "ROOM_FULL",
    });
  });
});

describe("reconnect (authenticatePlayer)", () => {
  it("restores the same player with id + secret, without duplicates", () => {
    const { room, player } = join(newRoom(), "Anna");
    const r = authenticatePlayer(room, player.id, player.secret);
    expect(r).toEqual({ ok: true, value: player });
    expect(room.players).toHaveLength(1);
  });

  it("rejects a wrong secret or unknown id", () => {
    const { room, player } = join(newRoom(), "Anna");
    expect(authenticatePlayer(room, player.id, "wrong-secret-0123456789").ok).toBe(false);
    expect(authenticatePlayer(room, "nope", player.secret).ok).toBe(false);
  });

  it("still works after the game has started", () => {
    const { room, player } = join(newRoom(), "Anna");
    const started = startGame(room, T0 + 2000);
    if (!started.ok) throw new Error("start failed");
    expect(authenticatePlayer(started.value, player.id, player.secret).ok).toBe(true);
  });

  it("fails after the player was kicked", () => {
    const { room, player } = join(newRoom(), "Anna");
    const kicked = kickPlayer(room, player.id);
    if (!kicked.ok) throw new Error("kick failed");
    expect(authenticatePlayer(kicked.value, player.id, player.secret)).toEqual({
      ok: false,
      error: "UNKNOWN_PLAYER",
    });
  });
});

describe("kickPlayer", () => {
  it("removes the player and frees the name", () => {
    const a = join(newRoom(), "Anna");
    const b = join(a.room, "Ben");
    const r = kickPlayer(b.room, a.player.id);
    expect(r.ok && r.value.players.map((p) => p.name)).toEqual(["Ben"]);
    if (r.ok) expect(joinPlayer(r.value, { name: "anna", avatar }, deps()).ok).toBe(true);
  });

  it("errors for unknown players", () => {
    expect(kickPlayer(newRoom(), "nope")).toEqual({ ok: false, error: "UNKNOWN_PLAYER" });
  });
});

describe("startGame", () => {
  it("needs at least one player", () => {
    expect(startGame(newRoom(), T0)).toEqual({ ok: false, error: "NOT_ENOUGH_PLAYERS" });
  });

  it("moves lobby → setup with timestamps and cannot start twice", () => {
    const { room } = join(newRoom(), "Anna");
    const r = startGame(room, T0 + 5000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.phase).toBe("setup");
    expect(r.value.phaseStartedAt).toBe(T0 + 5000);
    expect(r.value.phaseEndsAt).toBeNull();
    expect(startGame(r.value, T0 + 6000)).toEqual({ ok: false, error: "GAME_ALREADY_STARTED" });
  });
});

describe("toPublicState", () => {
  it("never leaks secrets and marks connected players", () => {
    const a = join(newRoom(), "Anna");
    const b = join(a.room, "Ben");
    const state = toPublicState(b.room, { host: true, playerIds: new Set([a.player.id]) }, { role: "host" });
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain(HOST_TOKEN);
    expect(serialized).not.toContain(a.player.secret);
    expect(serialized).not.toContain(b.player.secret);
    expect(state.hostConnected).toBe(true);
    expect(state.players.map((p) => [p.name, p.connected])).toEqual([
      ["Anna", true],
      ["Ben", false],
    ]);
  });
});
