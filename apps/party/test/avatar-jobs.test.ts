import { describe, expect, it, vi } from "vitest";
import { acceptPhotoAndGenerate, startPhotoUpload, type RoomAccess } from "../src/avatar/jobs";
import { AvatarGenerationError } from "../src/avatar/provider";
import type { AvatarServiceDeps } from "../src/avatar/service";
import { resetPhoto } from "../src/avatar/photo-logic";
import type { RoomRecord } from "../src/room-logic";
import { T0, memoryStore, mockProvider, photo, roomWithPlayers, styleReference } from "./avatar-helpers";

function access(initial: RoomRecord | null) {
  const a: RoomAccess & { room: RoomRecord | null; commits: RoomRecord[] } = {
    room: initial,
    commits: [],
    read: () => a.room,
    commit: async (room) => {
      a.room = room;
      a.commits.push(room);
    },
  };
  return a;
}

function deps(provider = mockProvider()): AvatarServiceDeps & { store: ReturnType<typeof memoryStore> } {
  return { provider, store: memoryStore(), styleReference };
}

const statusOf = (a: { room: RoomRecord | null }) => a.room!.players[0]!.photo;

describe("photo upload job", () => {
  it("pending right away, ready after the generation – broadcast both times", async () => {
    const room = roomWithPlayers(["Ana"]);
    const p = room.players[0]!;
    const a = access(room);
    const d = deps();
    const { response, job } = await startPhotoUpload(a, d, { playerId: p.id, playerSecret: p.secret, photo }, T0);
    expect(response).toEqual({ ok: true, version: 1 });
    expect(statusOf(a)?.status).toBe("pending");
    await job;
    expect(statusOf(a)).toMatchObject({ status: "ready", readyVersion: 1 });
    expect(a.commits).toHaveLength(2);
    expect(d.store.objects.has(`rooms/ABCD/${p.id}/neutral.webp`)).toBe(true);
  });

  it("pending → failed on a refusal, emoji stays", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const room = roomWithPlayers(["Ana"]);
    const p = room.players[0]!;
    const a = access(room);
    const refusing = mockProvider(async () => {
      throw new AvatarGenerationError("refused", "OpenAI refused (moderation_blocked)");
    });
    const { job } = await startPhotoUpload(a, deps(refusing), { playerId: p.id, playerSecret: p.secret, photo }, T0);
    await job;
    expect(statusOf(a)).toMatchObject({ status: "failed", reason: "refused", readyVersion: null });
    expect(a.room!.players[0]!.avatar).toEqual(room.players[0]!.avatar);
  });

  it("rejects wrong secrets, unknown rooms and missing configuration", async () => {
    const room = roomWithPlayers(["Ana"]);
    const p = room.players[0]!;
    const provider = mockProvider();
    const wrong = await startPhotoUpload(access(room), deps(provider), { playerId: p.id, playerSecret: "nope-0123456789abcdef", photo }, T0);
    expect(wrong.response).toMatchObject({ ok: false, code: "UNKNOWN_PLAYER" });
    const gone = await startPhotoUpload(access(null), deps(provider), { playerId: p.id, playerSecret: p.secret, photo }, T0);
    expect(gone.response).toMatchObject({ ok: false, code: "ROOM_NOT_FOUND" });
    const off = await startPhotoUpload(access(room), null, { playerId: p.id, playerSecret: p.secret, photo }, T0);
    expect(off.response).toMatchObject({ ok: false, code: "PHOTO_UNAVAILABLE" });
    expect(provider.calls).toHaveLength(0);
  });

  it("ignores a result that arrives after the host reset the avatar", async () => {
    const room = roomWithPlayers(["Ana"]);
    const p = room.players[0]!;
    const a = access(room);
    let finish!: () => void;
    const slow = mockProvider(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ bytes: new Uint8Array([1]), mimeType: "image/webp" });
        }),
    );
    const { job } = await startPhotoUpload(a, deps(slow), { playerId: p.id, playerSecret: p.secret, photo }, T0);
    const reset = resetPhoto(a.room!, p.id);
    if (!reset.ok) throw new Error(reset.error);
    a.room = reset.value;
    finish();
    await job;
    expect(statusOf(a)).toBeUndefined();
  });
});

describe("accept job", () => {
  it("generates the 3 expressions one after another after 'Passt!'", async () => {
    const room = roomWithPlayers(["Ana"]);
    const p = room.players[0]!;
    const a = access(room);
    const d = deps();
    const { job } = await startPhotoUpload(a, d, { playerId: p.id, playerSecret: p.secret, photo }, T0);
    await job;
    const accepted = await acceptPhotoAndGenerate(a, d, p.id, T0 + 1);
    if (!accepted.ok) throw new Error(accepted.error);
    expect(statusOf(a)).toMatchObject({ accepted: true, expressionsPending: true });
    await accepted.value;
    expect(statusOf(a)).toMatchObject({
      expressions: ["neutral", "jubelnd", "enttaeuscht", "geschockt"],
      expressionsPending: false,
    });
    expect(d.provider).toBeDefined();
    expect((d.provider as ReturnType<typeof mockProvider>).calls).toHaveLength(4);
  });

  it("failed expressions fall back to neutral", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const room = roomWithPlayers(["Ana"]);
    const p = room.players[0]!;
    const a = access(room);
    let calls = 0;
    const d = deps(
      mockProvider(async () => {
        if (++calls > 1) throw new AvatarGenerationError("error", "OpenAI HTTP 500");
        return { bytes: new Uint8Array([1]), mimeType: "image/webp" };
      }),
    );
    await (await startPhotoUpload(a, d, { playerId: p.id, playerSecret: p.secret, photo }, T0)).job;
    const accepted = await acceptPhotoAndGenerate(a, d, p.id, T0);
    if (!accepted.ok) throw new Error(accepted.error);
    await accepted.value;
    expect(statusOf(a)).toMatchObject({ expressions: ["neutral"], expressionsPending: false, accepted: true });
  });

  it("cannot accept before an image is ready", async () => {
    const room = roomWithPlayers(["Ana"]);
    expect(await acceptPhotoAndGenerate(access(room), deps(), room.players[0]!.id, T0)).toEqual({
      ok: false,
      error: "PHOTO_NOT_READY",
    });
  });
});
