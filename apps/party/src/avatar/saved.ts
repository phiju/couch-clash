/**
 * Saved figures: copies between a room (`rooms/<code>/<playerId>/`) and the
 * player's saved slot (`saved/<savedId>/`). Only generated images are copied.
 */
import { PHOTO_EXPRESSIONS, isPhotoExpression, type PhotoExpression } from "@couch-clash/shared";
import { avatarKey, savedKey, savedMetaKey, savedPrefix, type AvatarStore } from "./store";

export interface SavedMeta {
  expressions: PhotoExpression[];
  savedAt: number;
  lastUsedAt: number;
}

async function copy(store: AvatarStore, from: string, to: string): Promise<boolean> {
  const obj = await store.get(from);
  if (!obj) return false;
  await store.put(to, obj.bytes, obj.contentType);
  return true;
}

async function readMeta(store: AvatarStore, savedId: string): Promise<SavedMeta | null> {
  const obj = await store.get(savedMetaKey(savedId));
  if (!obj) return null;
  try {
    const meta = JSON.parse(new TextDecoder().decode(obj.bytes)) as Partial<SavedMeta>;
    const expressions = (meta.expressions ?? []).filter(isPhotoExpression);
    if (!expressions.includes("neutral")) return null;
    return { expressions, savedAt: meta.savedAt ?? 0, lastUsedAt: meta.lastUsedAt ?? 0 };
  } catch {
    return null;
  }
}

async function writeMeta(store: AvatarStore, savedId: string, meta: SavedMeta) {
  await store.put(savedMetaKey(savedId), new TextEncoder().encode(JSON.stringify(meta)), "application/json");
}

/** Room → saved slot. Returns the expressions that were copied. */
export async function saveFigure(
  store: AvatarStore,
  job: { code: string; playerId: string; savedId: string; expressions: readonly PhotoExpression[]; now: number },
): Promise<PhotoExpression[]> {
  const copied: PhotoExpression[] = [];
  for (const e of job.expressions) {
    if (await copy(store, avatarKey(job.code, job.playerId, e), savedKey(job.savedId, e))) copied.push(e);
  }
  if (copied.includes("neutral")) {
    await writeMeta(store, job.savedId, { expressions: copied, savedAt: job.now, lastUsedAt: job.now });
  }
  return copied;
}

/** An expression generated after saving is added to the saved slot too. */
export async function addSavedExpression(
  store: AvatarStore,
  job: { code: string; playerId: string; savedId: string; expression: PhotoExpression },
): Promise<void> {
  const meta = await readMeta(store, job.savedId);
  if (!meta || meta.expressions.includes(job.expression)) return;
  if (await copy(store, avatarKey(job.code, job.playerId, job.expression), savedKey(job.savedId, job.expression))) {
    await writeMeta(store, job.savedId, { ...meta, expressions: [...meta.expressions, job.expression] });
  }
}

/**
 * Saved slot → room. Every file is written again, which resets the R2
 * lifecycle clock ("deleted after 365 days without use").
 * Null if the figure no longer exists.
 */
export async function loadFigure(
  store: AvatarStore,
  job: { code: string; playerId: string; savedId: string; now: number },
): Promise<PhotoExpression[] | null> {
  const meta = await readMeta(store, job.savedId);
  if (!meta) return null;
  const copied: PhotoExpression[] = [];
  for (const e of PHOTO_EXPRESSIONS.filter((x) => meta.expressions.includes(x))) {
    const obj = await store.get(savedKey(job.savedId, e));
    if (!obj) continue;
    await store.put(avatarKey(job.code, job.playerId, e), obj.bytes, obj.contentType);
    await store.put(savedKey(job.savedId, e), obj.bytes, obj.contentType);
    copied.push(e);
  }
  if (!copied.includes("neutral")) return null;
  await writeMeta(store, job.savedId, { ...meta, expressions: copied, lastUsedAt: job.now });
  return copied;
}

export async function deleteFigure(store: AvatarStore, savedId: string): Promise<void> {
  await store.deletePrefix(savedPrefix(savedId));
}
