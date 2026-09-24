import type { PhotoExpression } from "@couch-clash/shared";

/** Storage for generated avatars (never for the original photos). */
export interface AvatarStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  /** Deletes every object under `prefix`. */
  deletePrefix(prefix: string): Promise<void>;
}

export function roomPrefix(code: string): string {
  return `rooms/${code}/`;
}

export function playerPrefix(code: string, playerId: string): string {
  return `${roomPrefix(code)}${playerId}/`;
}

export function avatarKey(code: string, playerId: string, expression: PhotoExpression): string {
  return `${playerPrefix(code, playerId)}${expression}.webp`;
}

/** R2 bucket binding AVATARS. A lifecycle rule (1 day) cleans up anything missed. */
export function r2AvatarStore(bucket: R2Bucket): AvatarStore {
  return {
    async put(key, bytes, contentType) {
      await bucket.put(key, bytes, { httpMetadata: { contentType } });
    },
    async get(key) {
      const obj = await bucket.get(key);
      if (!obj) return null;
      return {
        bytes: new Uint8Array(await obj.arrayBuffer()),
        contentType: obj.httpMetadata?.contentType ?? "image/webp",
      };
    },
    async deletePrefix(prefix) {
      // Re-list from the start after each delete (a cursor could skip keys
      // while objects disappear). A room has at most 64 avatars.
      for (let round = 0; round < 20; round++) {
        const list = await bucket.list({ prefix, limit: 1000 });
        const keys = list.objects.map((o) => o.key);
        if (keys.length === 0) return;
        await bucket.delete(keys);
        if (!list.truncated) return;
      }
    },
  };
}

/** Saved figures ("Figur behalten"), refreshed on every use; lifecycle rule on "saved/". */
export function savedPrefix(savedId: string): string {
  return `saved/${savedId}/`;
}

export function savedKey(savedId: string, expression: PhotoExpression): string {
  return `${savedPrefix(savedId)}${expression}.webp`;
}

export function savedMetaKey(savedId: string): string {
  return `${savedPrefix(savedId)}meta.json`;
}
