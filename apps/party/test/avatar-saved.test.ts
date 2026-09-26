import { describe, expect, it } from "vitest";
import { acceptPhotoAndGenerate, savePlayerPhoto, startPhotoUpload, useSavedPhoto, type RoomAccess } from "../src/avatar/jobs";
import { finishPhotoGeneration, startPhotoGeneration } from "../src/avatar/photo-logic";
import { handleSavedAvatarDelete, handleSavedAvatarGet } from "../src/avatar/routes";
import type { AvatarServiceDeps } from "../src/avatar/service";
import { toPublicState, type RoomRecord } from "../src/room-logic";
import { T0, memoryStore, mockProvider, photo, roomWithPlayers, styleReference } from "./avatar-helpers";

const SAVED_ID = "0123456789abcdef0123456789abcdef";

function access(initial: RoomRecord) {
  const a: RoomAccess & { room: RoomRecord } = {
    room: initial,
    read: () => a.room,
    commit: async (room) => {
      a.room = room;
    },
  };
  return a;
}

/** A player in room ABCD with an accepted figure (all expressions if `waitForExpressions`). */
async function playerWithFigure(deps: AvatarServiceDeps, waitForExpressions = true) {
  const room = roomWithPlayers(["Ana"]);
  const p = room.players[0]!;
  const a = access(room);
  await (await startPhotoUpload(a, deps, { playerId: p.id, playerSecret: p.secret, photo }, T0)).job;
  const accepted = await acceptPhotoAndGenerate(a, deps, p.id, T0);
  if (!accepted.ok) throw new Error(accepted.error);
  if (waitForExpressions) await accepted.value;
  return { a, id: p.id, expressionsDone: accepted.value };
}

describe("saved figures", () => {
  it("saves a figure and uses it in another room without any generation", async () => {
    const store = memoryStore();
    const provider = mockProvider();
    const deps = { provider, store, styleReference };
    const { a, id } = await playerWithFigure(deps);

    const saved = await savePlayerPhoto(a, store, id, T0 + 1, () => SAVED_ID);
    expect(saved).toEqual({ ok: true, value: SAVED_ID });
    expect([...store.objects.keys()].filter((k) => k.startsWith("saved/")).sort()).toEqual([
      `saved/${SAVED_ID}/enttaeuscht.webp`,
      `saved/${SAVED_ID}/figure-besorgt.webp`,
      `saved/${SAVED_ID}/figure-geschockt.webp`,
      `saved/${SAVED_ID}/figure-jubelnd.webp`,
      `saved/${SAVED_ID}/figure-panisch.webp`,
      `saved/${SAVED_ID}/figure-standard.webp`,
      `saved/${SAVED_ID}/geschockt.webp`,
      `saved/${SAVED_ID}/jubelnd.webp`,
      `saved/${SAVED_ID}/meta.json`,
      `saved/${SAVED_ID}/neutral.webp`,
    ]);
    // Saving again returns the same id.
    expect(await savePlayerPhoto(a, store, id, T0 + 2, () => "x".repeat(32))).toEqual({ ok: true, value: SAVED_ID });

    // Next game night: another room, another player id.
    const other = access(roomWithPlayers(["Ana"], "WXYZ"));
    const otherId = other.room.players[0]!.id;
    const callsBefore = provider.calls.length;
    expect(await useSavedPhoto(other, store, otherId, SAVED_ID, T0 + 3)).toEqual({ ok: true, value: null });
    expect(provider.calls.length).toBe(callsBefore);
    expect(other.room.players[0]!.photo).toMatchObject({
      status: "ready",
      accepted: true,
      expressions: ["neutral", "jubelnd", "enttaeuscht", "geschockt"],
      savedId: SAVED_ID,
    });
    expect(store.objects.has(`rooms/WXYZ/${otherId}/geschockt.webp`)).toBe(true);
    // Uses no room budget.
    expect(other.room.photoUsage).toEqual({ base: 0, expressions: 0 });
  });

  it("never shows the saved id to other clients", async () => {
    const store = memoryStore();
    const { a, id } = await playerWithFigure({ provider: mockProvider(), store, styleReference });
    await savePlayerPhoto(a, store, id, T0, () => SAVED_ID);
    const state = toPublicState(a.room, { host: true, playerIds: new Set() }, { role: "host" });
    expect(state.players[0]!.avatar.photo?.saved).toBe(true);
    expect(JSON.stringify(state)).not.toContain(SAVED_ID);
  });

  it("adds expressions that finish after saving", async () => {
    const store = memoryStore();
    const deps = { provider: mockProvider(), store, styleReference };
    const { a, id, expressionsDone } = await playerWithFigure(deps, false);
    await savePlayerPhoto(a, store, id, T0, () => SAVED_ID);
    await expressionsDone;
    const meta = JSON.parse(new TextDecoder().decode(store.objects.get(`saved/${SAVED_ID}/meta.json`)!));
    expect([...meta.expressions].sort()).toEqual(["enttaeuscht", "geschockt", "jubelnd", "neutral"]);
  });

  it("only saves accepted figures", async () => {
    const store = memoryStore();
    const room = roomWithPlayers(["Ana"]);
    const id = room.players[0]!.id;
    const started = startPhotoGeneration(room, id, T0);
    if (!started.ok) throw new Error(started.error);
    const ready = finishPhotoGeneration(started.value.room, id, 1, { ok: true })!;
    expect(await savePlayerPhoto(access(ready), store, id, T0)).toEqual({ ok: false, error: "PHOTO_NOT_READY" });
    expect(await savePlayerPhoto(access(room), store, id, T0)).toEqual({ ok: false, error: "PHOTO_NOT_READY" });
  });

  it("reports a deleted or unknown figure, and respects the host switch", async () => {
    const store = memoryStore();
    const room = access(roomWithPlayers(["Ana"]));
    const id = room.room.players[0]!.id;
    expect(await useSavedPhoto(room, store, id, SAVED_ID, T0)).toEqual({ ok: false, error: "PHOTO_SAVED_GONE" });
    const off = access({ ...room.room, photoAvatars: false });
    expect(await useSavedPhoto(off, store, id, SAVED_ID, T0)).toEqual({ ok: false, error: "PHOTO_DISABLED" });
    expect(await useSavedPhoto(room, null, id, SAVED_ID, T0)).toEqual({ ok: false, error: "PHOTO_UNAVAILABLE" });
  });

  it("a new image is a new figure; a failed one keeps the saved state", async () => {
    const store = memoryStore();
    const { a, id } = await playerWithFigure({ provider: mockProvider(), store, styleReference });
    await savePlayerPhoto(a, store, id, T0, () => SAVED_ID);
    const again = startPhotoGeneration(a.room, id, T0);
    if (!again.ok) throw new Error(again.error);
    const failed = finishPhotoGeneration(again.value.room, id, again.value.version, { ok: false, reason: "error" })!;
    expect(failed.players[0]!.photo?.savedId).toBe(SAVED_ID);
    const ready = finishPhotoGeneration(again.value.room, id, again.value.version, { ok: true })!;
    expect(ready.players[0]!.photo?.savedId).toBeUndefined();
  });

  it("serves the preview and deletes on request", async () => {
    const store = memoryStore();
    const { a, id } = await playerWithFigure({ provider: mockProvider(), store, styleReference });
    await savePlayerPhoto(a, store, id, T0, () => SAVED_ID);

    const preview = await handleSavedAvatarGet(SAVED_ID, "neutral", store);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("Cache-Control")).toContain("private");
    expect((await handleSavedAvatarGet("../rooms", "neutral", store)).status).toBe(404);
    expect((await handleSavedAvatarGet(SAVED_ID, "meta", store)).status).toBe(404);

    expect((await handleSavedAvatarDelete("nope", store)).status).toBe(404);
    const del = await handleSavedAvatarDelete(SAVED_ID, store);
    expect(await del.json()).toEqual({ ok: true, deleted: true });
    expect([...store.objects.keys()].some((k) => k.startsWith("saved/"))).toBe(false);
    expect((await handleSavedAvatarGet(SAVED_ID, "neutral", store)).status).toBe(404);
  });
});
