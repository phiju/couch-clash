import type { Avatar } from "@couch-clash/shared";
import type { AvatarImage, AvatarProvider } from "../src/avatar/provider";
import type { AvatarStore } from "../src/avatar/store";
import { createRoomRecord, joinPlayer, type RoomRecord } from "../src/room-logic";

export const T0 = 1_700_000_000_000;
const avatar: Avatar = { character: "fox", color: "red" };

let counter = 0;
export function roomWithPlayers(names: string[], code = "ABCD"): RoomRecord {
  let room = createRoomRecord(code, "host-token-0123456789abcdef", T0);
  for (const name of names) {
    const n = ++counter;
    const r = joinPlayer(room, { name, avatar }, { now: T0, secret: () => `p${n}-secret-0123456789abcdef` });
    if (!r.ok) throw new Error(r.error);
    room = r.value.room;
  }
  return room;
}

export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
export const photo: AvatarImage = { bytes: JPEG, mimeType: "image/jpeg" };
export const styleReference = (): AvatarImage => ({ bytes: new Uint8Array([9]), mimeType: "image/webp" });

/** In-memory R2 replacement. */
export function memoryStore(): AvatarStore & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(key, bytes) {
      objects.set(key, bytes);
    },
    async get(key) {
      const bytes = objects.get(key);
      return bytes ? { bytes, contentType: "image/webp" } : null;
    },
    async has(key) {
      return objects.has(key);
    },
    async deletePrefix(prefix) {
      for (const key of [...objects.keys()]) if (key.startsWith(prefix)) objects.delete(key);
    },
  };
}

/** Mocked provider – never calls a real API. Records every call. */
export function mockProvider(
  impl: (input: AvatarImage, prompt: string) => Promise<AvatarImage> = async () => ({
    bytes: new Uint8Array([7, 7, 7]),
    mimeType: "image/webp",
  }),
): AvatarProvider & { calls: { input: AvatarImage; prompt: string }[] } {
  const calls: { input: AvatarImage; prompt: string }[] = [];
  return {
    calls,
    generateAvatar(input, style) {
      calls.push({ input, prompt: style.prompt });
      return impl(input, style.prompt);
    },
  };
}
