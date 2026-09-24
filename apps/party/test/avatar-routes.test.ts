import { describe, expect, it, vi } from "vitest";
import { PHOTO_MAX_BYTES, type PhotoUploadResponse } from "@couch-clash/shared";
import { handleAvatarGet, handleAvatarUpload, sniffImageType, type AvatarRoomApi } from "../src/avatar/routes";
import { avatarKey } from "../src/avatar/store";
import { JPEG, memoryStore } from "./avatar-helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const WEBP = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");

function fakeRoom(result: PhotoUploadResponse = { ok: true, version: 1 }) {
  const room: AvatarRoomApi & { uploads: unknown[] } = {
    uploads: [],
    uploadPhoto: vi.fn(async (...args) => {
      room.uploads.push(args);
      return result;
    }),
    hasPhoto: vi.fn(async () => true),
  };
  return room;
}

function upload(fields: { playerId?: string; playerSecret?: string; photo?: Blob }, headers: HeadersInit = {}) {
  const form = new FormData();
  if (fields.playerId !== undefined) form.append("playerId", fields.playerId);
  if (fields.playerSecret !== undefined) form.append("playerSecret", fields.playerSecret);
  if (fields.photo) form.append("photo", fields.photo, "photo.jpg");
  return new Request("https://party.test/api/rooms/ABCD/avatar", { method: "POST", body: form, headers });
}

const auth = { playerId: "player1", playerSecret: "secret-0123456789abcdef" };
const jpeg = (bytes: Uint8Array = JPEG) => new Blob([bytes], { type: "image/jpeg" });

async function body(res: Response) {
  return (await res.json()) as PhotoUploadResponse;
}

describe("POST /api/rooms/:code/avatar", () => {
  it("accepts a valid JPEG and forwards it to the room (202)", async () => {
    const room = fakeRoom();
    const res = await handleAvatarUpload(upload({ ...auth, photo: jpeg() }), "abcd", async () => room);
    expect(res.status).toBe(202);
    expect(await body(res)).toEqual({ ok: true, version: 1 });
    expect(room.uploadPhoto).toHaveBeenCalledWith("player1", auth.playerSecret, {
      bytes: JPEG,
      mimeType: "image/jpeg",
    });
  });

  it("rejects missing credentials (401) without touching the room", async () => {
    const room = fakeRoom();
    const res = await handleAvatarUpload(upload({ playerId: "player1", photo: jpeg() }), "ABCD", async () => room);
    expect(res.status).toBe(401);
    expect(await body(res)).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
    expect(room.uploadPhoto).not.toHaveBeenCalled();
  });

  it("passes on wrong credentials from the room (401)", async () => {
    const room = fakeRoom({ ok: false, code: "UNKNOWN_PLAYER", error: "" });
    const res = await handleAvatarUpload(upload({ ...auth, photo: jpeg() }), "ABCD", async () => room);
    expect(res.status).toBe(401);
  });

  it("rejects photos over 1 MB (413)", async () => {
    const big = new Uint8Array(PHOTO_MAX_BYTES + 1);
    big.set(JPEG);
    const room = fakeRoom();
    const res = await handleAvatarUpload(upload({ ...auth, photo: jpeg(big) }), "ABCD", async () => room);
    expect(res.status).toBe(413);
    expect(room.uploadPhoto).not.toHaveBeenCalled();
  });

  it("rejects a too large Content-Length before reading the body", async () => {
    const room = fakeRoom();
    const req = upload({ ...auth, photo: jpeg() }, { "Content-Length": String(5 * PHOTO_MAX_BYTES) });
    const res = await handleAvatarUpload(req, "ABCD", async () => room);
    expect(res.status).toBe(413);
  });

  it("rejects other types, also when the declared type lies (415)", async () => {
    const room = fakeRoom();
    const gif = new Blob([new TextEncoder().encode("GIF89a")], { type: "image/gif" });
    expect((await handleAvatarUpload(upload({ ...auth, photo: gif }), "ABCD", async () => room)).status).toBe(415);
    const fake = new Blob([new TextEncoder().encode("<svg>")], { type: "image/jpeg" });
    expect((await handleAvatarUpload(upload({ ...auth, photo: fake }), "ABCD", async () => room)).status).toBe(415);
    expect(room.uploadPhoto).not.toHaveBeenCalled();
  });

  it("detects JPEG, PNG and WebP by their bytes", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(WEBP)).toBe("image/webp");
    expect(sniffImageType(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("returns 404 for invalid codes and unknown rooms", async () => {
    const room = fakeRoom({ ok: false, code: "ROOM_NOT_FOUND", error: "" });
    const invalid = await handleAvatarUpload(upload({ ...auth, photo: jpeg() }), "!!", async () => room);
    expect(invalid.status).toBe(404);
    expect(room.uploadPhoto).not.toHaveBeenCalled();
    const unknown = await handleAvatarUpload(upload({ ...auth, photo: jpeg() }), "WXYZ", async () => room);
    expect(unknown.status).toBe(404);
  });

  it("maps limit errors to clear responses", async () => {
    const cases = [
      ["PHOTO_BUSY", 409],
      ["PHOTO_LIMIT", 429],
      ["PHOTO_ROOM_LIMIT", 429],
      ["PHOTO_DISABLED", 403],
      ["PHOTO_UNAVAILABLE", 503],
    ] as const;
    for (const [code, status] of cases) {
      const room = fakeRoom({ ok: false, code, error: "" });
      const res = await handleAvatarUpload(upload({ ...auth, photo: jpeg() }), "ABCD", async () => room);
      expect(res.status).toBe(status);
      const json = await body(res);
      expect(json).toMatchObject({ ok: false, code });
      expect(json.ok === false && json.error.length).toBeGreaterThan(0);
    }
  });
});

describe("GET /api/rooms/:code/avatar/:playerId/:expression", () => {
  it("serves stored avatars with cache headers", async () => {
    const store = memoryStore();
    await store.put(avatarKey("ABCD", "player1", "jubelnd"), new Uint8Array([1, 2]), "image/webp");
    const res = await handleAvatarGet("ABCD", "player1", "jubelnd", async () => fakeRoom(), store);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("Cache-Control")).toContain("max-age");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
  });

  it("only serves for existing rooms and players", async () => {
    const store = memoryStore();
    await store.put(avatarKey("ABCD", "player1", "neutral"), new Uint8Array([1]), "image/webp");
    const gone = fakeRoom();
    gone.hasPhoto = vi.fn(async () => false);
    expect((await handleAvatarGet("ABCD", "player1", "neutral", async () => gone, store)).status).toBe(404);
    expect((await handleAvatarGet("ABCD", "player1", "evil", async () => fakeRoom(), store)).status).toBe(404);
    expect((await handleAvatarGet("ABCD", "../x", "neutral", async () => fakeRoom(), store)).status).toBe(404);
    expect((await handleAvatarGet("ABCD", "player2", "neutral", async () => fakeRoom(), store)).status).toBe(404);
  });
});
