import { describe, expect, it } from "vitest";
import {
  EXPRESSIONS_STALE_MS,
  PHOTO_MAX_BASE_PER_PLAYER,
  PHOTO_STALE_MS,
  ROOM_MAX_BASE_IMAGES,
  ROOM_MAX_EXPRESSION_IMAGES,
  acceptPhoto,
  addPhotoExpression,
  expireStalePhotos,
  finishPhotoExpressions,
  finishPhotoGeneration,
  nextPhotoDeadline,
  publicPhoto,
  resetPhoto,
  setPhotoAvatars,
  startPhotoGeneration,
} from "../src/avatar/photo-logic";
import { normalizeRoomRecord, toPublicState, type RoomRecord } from "../src/room-logic";
import { T0, roomWithPlayers } from "./avatar-helpers";

function start(room: RoomRecord, playerId: string, now = T0) {
  const r = startPhotoGeneration(room, playerId, now);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

function photoOf(room: RoomRecord, playerId: string) {
  return room.players.find((p) => p.id === playerId)!.photo;
}

describe("photo avatar state", () => {
  it("pending → ready: the neutral image is shown, accepting starts 3 expressions", () => {
    const room = roomWithPlayers(["Ana"]);
    const id = room.players[0]!.id;
    const { room: pending, version } = start(room, id);
    expect(photoOf(pending, id)).toMatchObject({ status: "pending", version: 1, readyVersion: null });
    expect(pending.photoUsage.base).toBe(1);

    const ready = finishPhotoGeneration(pending, id, version, { ok: true })!;
    expect(photoOf(ready, id)).toMatchObject({ status: "ready", readyVersion: 1, expressions: ["neutral"] });

    const accepted = acceptPhoto(ready, id, T0 + 5);
    if (!accepted.ok) throw new Error(accepted.error);
    expect(accepted.value.expressions).toEqual(["jubelnd", "enttaeuscht", "geschockt"]);
    expect(photoOf(accepted.value.room, id)).toMatchObject({ accepted: true, expressionsPending: true });
    expect(accepted.value.room.photoUsage.expressions).toBe(3);

    let r = addPhotoExpression(accepted.value.room, id, 1, "jubelnd")!;
    r = finishPhotoExpressions(r, id, 1)!;
    expect(photoOf(r, id)).toMatchObject({ expressions: ["neutral", "jubelnd"], expressionsPending: false });
  });

  it("pending → failed keeps the emoji (no ready version)", () => {
    const room = roomWithPlayers(["Ana"]);
    const id = room.players[0]!.id;
    const { room: pending, version } = start(room, id);
    const failed = finishPhotoGeneration(pending, id, version, { ok: false, reason: "refused" })!;
    expect(photoOf(failed, id)).toMatchObject({ status: "failed", reason: "refused", readyVersion: null });
    expect(publicPhoto(failed.players[0]!, "ABCD")?.expressions).toEqual([]);
    expect(acceptPhoto(failed, id, T0)).toEqual({ ok: false, error: "PHOTO_NOT_READY" });
  });

  it("a failed re-generation keeps the previous image", () => {
    const room = roomWithPlayers(["Ana"]);
    const id = room.players[0]!.id;
    const first = start(room, id);
    const ready = finishPhotoGeneration(first.room, id, first.version, { ok: true })!;
    const second = start(ready, id);
    expect(second.version).toBe(2);
    const failed = finishPhotoGeneration(second.room, id, 2, { ok: false, reason: "timeout" })!;
    expect(photoOf(failed, id)).toMatchObject({ status: "failed", readyVersion: 1, expressions: ["neutral"] });
  });

  it("ignores results of outdated or reset generations", () => {
    const room = roomWithPlayers(["Ana"]);
    const id = room.players[0]!.id;
    const { room: pending } = start(room, id);
    expect(finishPhotoGeneration(pending, id, 99, { ok: true })).toBeNull();
    const reset = resetPhoto(pending, id);
    if (!reset.ok) throw new Error(reset.error);
    expect(finishPhotoGeneration(reset.value, id, 1, { ok: true })).toBeNull();
    expect(reset.value.players[0]!.avatar).toEqual(room.players[0]!.avatar);
  });

  it("allows one job per player at a time", () => {
    const room = roomWithPlayers(["Ana"]);
    const id = room.players[0]!.id;
    const { room: pending } = start(room, id);
    expect(startPhotoGeneration(pending, id, T0)).toEqual({ ok: false, error: "PHOTO_BUSY" });
    const ready = finishPhotoGeneration(pending, id, 1, { ok: true })!;
    const accepted = acceptPhoto(ready, id, T0);
    if (!accepted.ok) throw new Error(accepted.error);
    expect(startPhotoGeneration(accepted.value.room, id, T0)).toEqual({ ok: false, error: "PHOTO_BUSY" });
  });

  it("limits a player to 1 + 2 re-generations, also after a reset", () => {
    let room = roomWithPlayers(["Ana"]);
    const id = room.players[0]!.id;
    for (let i = 0; i < PHOTO_MAX_BASE_PER_PLAYER; i++) {
      const s = start(room, id);
      room = finishPhotoGeneration(s.room, id, s.version, { ok: true })!;
    }
    expect(publicPhoto(room.players[0]!, "ABCD")?.regenerationsLeft).toBe(0);
    expect(startPhotoGeneration(room, id, T0)).toEqual({ ok: false, error: "PHOTO_LIMIT" });
    const reset = resetPhoto(room, id);
    if (!reset.ok) throw new Error(reset.error);
    expect(startPhotoGeneration(reset.value, id, T0)).toEqual({ ok: false, error: "PHOTO_LIMIT" });
  });

  it("enforces the room-wide budget", () => {
    const room = roomWithPlayers(["Ana", "Ben"]);
    const full = { ...room, photoUsage: { base: ROOM_MAX_BASE_IMAGES, expressions: 0 } };
    expect(startPhotoGeneration(full, room.players[0]!.id, T0)).toEqual({ ok: false, error: "PHOTO_ROOM_LIMIT" });

    const id = room.players[1]!.id;
    const s = start(room, id);
    const ready = finishPhotoGeneration(s.room, id, s.version, { ok: true })!;
    const almost = { ...ready, photoUsage: { base: 1, expressions: ROOM_MAX_EXPRESSION_IMAGES - 1 } };
    const accepted = acceptPhoto(almost, id, T0);
    if (!accepted.ok) throw new Error(accepted.error);
    expect(accepted.value.expressions).toEqual(["jubelnd"]);
  });

  it("rejects uploads when the host turned photo avatars off", () => {
    const room = roomWithPlayers(["Ana"]);
    const off = setPhotoAvatars(room, false);
    if (!off.ok) throw new Error(off.error);
    expect(startPhotoGeneration(off.value, room.players[0]!.id, T0)).toEqual({ ok: false, error: "PHOTO_DISABLED" });
    expect(toPublicState(off.value, { host: true, playerIds: new Set() }, { role: "guest" }).photoAvatars).toBe(false);
  });

  it("times out jobs that never report back and schedules an alarm for them", () => {
    const room = roomWithPlayers(["Ana"]);
    const id = room.players[0]!.id;
    const { room: pending } = start(room, id);
    expect(nextPhotoDeadline(pending)).toBe(T0 + PHOTO_STALE_MS);
    expect(expireStalePhotos(pending, T0 + PHOTO_STALE_MS - 1)).toBeNull();
    const expired = expireStalePhotos(pending, T0 + PHOTO_STALE_MS)!;
    expect(photoOf(expired, id)).toMatchObject({ status: "failed", reason: "timeout" });
    expect(nextPhotoDeadline(expired)).toBeNull();

    const ready = finishPhotoGeneration(pending, id, 1, { ok: true })!;
    const accepted = acceptPhoto(ready, id, T0 + 10);
    if (!accepted.ok) throw new Error(accepted.error);
    const done = expireStalePhotos(accepted.value.room, T0 + 10 + EXPRESSIONS_STALE_MS)!;
    expect(photoOf(done, id)?.expressionsPending).toBe(false);
  });

  it("shows the photo in the public avatar and fills defaults for old rooms", () => {
    const room = roomWithPlayers(["Ana"]);
    const id = room.players[0]!.id;
    const { room: pending } = start(room, id);
    const state = toPublicState(pending, { host: true, playerIds: new Set() }, { role: "guest" });
    expect(state.players[0]!.avatar.photo).toMatchObject({
      status: "pending",
      version: 1,
      regenerationsLeft: 2,
      path: `/api/rooms/ABCD/avatar/${id}`,
    });
    expect(JSON.stringify(state)).not.toContain(room.players[0]!.secret);
    expect(JSON.stringify(state)).not.toContain("photoGenerations");

    const old: Partial<RoomRecord> = { ...room };
    delete old.photoAvatars;
    delete old.photoUsage;
    const normalized = normalizeRoomRecord(old as RoomRecord);
    expect(normalized.photoAvatars).toBe(true);
    expect(normalized.photoUsage).toEqual({ base: 0, expressions: 0 });
  });
});
