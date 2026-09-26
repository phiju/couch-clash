/**
 * Saved figures: copies between a room (`rooms/<code>/<playerId>/`) and the
 * player's saved slot (`saved/<savedId>/`). Only generated images are copied.
 */
import { FIGURE_POSES, PHOTO_EXPRESSIONS, isFigurePose, isPhotoExpression, type FigurePose, type PhotoExpression } from "@couch-clash/shared";
import { avatarKey, figureKey, savedFigureKey, savedKey, savedMetaKey, savedPrefix, type AvatarStore } from "./store";

export interface SavedMeta {
  expressions: PhotoExpression[];
  /** Standing figures (missing in figures saved before they existed). */
  figures: FigurePose[];
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
    const figures = (meta.figures ?? []).filter(isFigurePose);
    return { expressions, figures, savedAt: meta.savedAt ?? 0, lastUsedAt: meta.lastUsedAt ?? 0 };
  } catch {
    return null;
  }
}

/**
 * Read-modify-write of a saved slot's meta.json, one at a time per slot:
 * expressions and standing figures finish in parallel and would otherwise
 * overwrite each other's additions.
 */
const metaLocks = new Map<string, Promise<unknown>>();
function withMetaLock<T>(savedId: string, fn: () => Promise<T>): Promise<T> {
  const prev = metaLocks.get(savedId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  metaLocks.set(savedId, tail);
  void tail.then(() => {
    if (metaLocks.get(savedId) === tail) metaLocks.delete(savedId);
  });
  return run;
}

async function writeMeta(store: AvatarStore, savedId: string, meta: SavedMeta) {
  await store.put(savedMetaKey(savedId), new TextEncoder().encode(JSON.stringify(meta)), "application/json");
}

/** Room → saved slot. Returns the expressions that were copied. */
export async function saveFigure(
  store: AvatarStore,
  job: {
    code: string;
    playerId: string;
    savedId: string;
    expressions: readonly PhotoExpression[];
    figures?: readonly FigurePose[];
    now: number;
  },
): Promise<PhotoExpression[]> {
  const copied: PhotoExpression[] = [];
  for (const e of job.expressions) {
    if (await copy(store, avatarKey(job.code, job.playerId, e), savedKey(job.savedId, e))) copied.push(e);
  }
  const figures: FigurePose[] = [];
  for (const pose of job.figures ?? []) {
    if (await copy(store, figureKey(job.code, job.playerId, pose), savedFigureKey(job.savedId, pose))) figures.push(pose);
  }
  if (copied.includes("neutral")) {
    await writeMeta(store, job.savedId, { expressions: copied, figures, savedAt: job.now, lastUsedAt: job.now });
  }
  return copied;
}

/** A standing figure made after saving is added to the saved slot too. */
export async function addSavedFigure(
  store: AvatarStore,
  job: { code: string; playerId: string; savedId: string; pose: FigurePose },
): Promise<void> {
  await withMetaLock(job.savedId, async () => {
    const meta = await readMeta(store, job.savedId);
    if (!meta || meta.figures.includes(job.pose)) return;
    if (await copy(store, figureKey(job.code, job.playerId, job.pose), savedFigureKey(job.savedId, job.pose))) {
      await writeMeta(store, job.savedId, { ...meta, figures: [...meta.figures, job.pose] });
    }
  });
}

/** An expression generated after saving is added to the saved slot too. */
export async function addSavedExpression(
  store: AvatarStore,
  job: { code: string; playerId: string; savedId: string; expression: PhotoExpression },
): Promise<void> {
  await withMetaLock(job.savedId, async () => {
    const meta = await readMeta(store, job.savedId);
    if (!meta || meta.expressions.includes(job.expression)) return;
    if (await copy(store, avatarKey(job.code, job.playerId, job.expression), savedKey(job.savedId, job.expression))) {
      await writeMeta(store, job.savedId, { ...meta, expressions: [...meta.expressions, job.expression] });
    }
  });
}

/**
 * Saved slot → room. Every file is written again, which resets the R2
 * lifecycle clock ("deleted after 365 days without use").
 * Null if the figure no longer exists.
 */
export async function loadFigure(
  store: AvatarStore,
  job: { code: string; playerId: string; savedId: string; now: number },
): Promise<{ expressions: PhotoExpression[]; figures: FigurePose[] } | null> {
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
  const figures: FigurePose[] = [];
  for (const pose of FIGURE_POSES.filter((x) => meta.figures.includes(x))) {
    const obj = await store.get(savedFigureKey(job.savedId, pose));
    if (!obj) continue;
    await store.put(figureKey(job.code, job.playerId, pose), obj.bytes, obj.contentType);
    await store.put(savedFigureKey(job.savedId, pose), obj.bytes, obj.contentType);
    figures.push(pose);
  }
  await writeMeta(store, job.savedId, { ...meta, expressions: copied, figures, lastUsedAt: job.now });
  return { expressions: copied, figures };
}

export async function deleteFigure(store: AvatarStore, savedId: string): Promise<void> {
  await store.deletePrefix(savedPrefix(savedId));
}
