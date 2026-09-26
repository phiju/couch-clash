/**
 * Glue between the room state and the generation service. The Durable
 * Object passes in how to read and commit its room; the returned promises
 * are the background work (handed to ctx.waitUntil).
 */
import { FIGURE_EXPRESSIONS, generateSecret, type PhotoExpression, type PhotoUploadResponse } from "@couch-clash/shared";
import { FIGURE_CONFIG } from "./config";
import { authenticatePlayer, type RoomRecord } from "../room-logic";
import { fail, ok, type Result } from "../result";
import {
  acceptPhoto,
  addFigure,
  addPhotoExpression,
  applySavedPhoto,
  canUseSavedPhoto,
  finishPhotoExpressions,
  finishFigures,
  finishPhotoGeneration,
  markPhotoSaved,
  photoToSave,
  startFigures,
  startPhotoGeneration,
} from "./photo-logic";
import type { AvatarImage } from "./provider";
import { addSavedExpression, addSavedFigure, loadFigure, saveFigure } from "./saved";
import { generateBaseAvatar, generateExpressionAvatar, generateFigure, type AvatarServiceDeps } from "./service";
import type { AvatarStore } from "./store";

export interface RoomAccess {
  /** The current, active room (null when expired/destroyed). */
  read(): RoomRecord | null;
  /** Save + broadcast. */
  commit(room: RoomRecord): Promise<void>;
}

/** Applies a change to the *current* room (it may have changed while the job ran). */
async function update(access: RoomAccess, code: string, fn: (room: RoomRecord) => RoomRecord | null) {
  const room = access.read();
  if (!room || room.code !== code) return;
  const next = fn(room);
  if (next) await access.commit(next);
}

/** Upload: auth + limits → pending → background generation. */
export async function startPhotoUpload(
  access: RoomAccess,
  deps: AvatarServiceDeps | null,
  input: { playerId: string; playerSecret: string; photo: AvatarImage },
  now: number,
): Promise<{ response: PhotoUploadResponse; job: Promise<void> | null }> {
  const failed = (code: Extract<PhotoUploadResponse, { ok: false }>["code"]) => ({
    response: { ok: false as const, code, error: "" },
    job: null,
  });
  const room = access.read();
  if (!room) return failed("ROOM_NOT_FOUND");
  const auth = authenticatePlayer(room, input.playerId, input.playerSecret);
  if (!auth.ok) return failed(auth.error);
  if (!room.photoAvatars) return failed("PHOTO_DISABLED");
  if (!deps) return failed("PHOTO_UNAVAILABLE");

  const started = startPhotoGeneration(room, input.playerId, now);
  if (!started.ok) return failed(started.error);
  await access.commit(started.value.room);

  const { version } = started.value;
  const code = room.code;
  const job = (async () => {
    const outcome = await generateBaseAvatar(deps, { code, playerId: input.playerId, photo: input.photo });
    await update(access, code, (r) => finishPhotoGeneration(r, input.playerId, version, outcome));
  })();
  return { response: { ok: true, version }, job };
}

/** "Passt!" → accepted; extra expressions one after another in the background. */
export async function acceptPhotoAndGenerate(
  access: RoomAccess,
  deps: AvatarServiceDeps | null,
  playerId: string,
  now: number,
): Promise<Result<Promise<void> | null>> {
  const room = access.read();
  if (!room) return fail("ROOM_NOT_FOUND");
  const accepted = acceptPhoto(room, playerId, now, deps !== null);
  if (!accepted.ok) return accepted;
  const { expressions, version } = accepted.value;
  if (accepted.value.room !== room) await access.commit(accepted.value.room);
  if (!deps || expressions.length === 0) return ok(null);

  const code = room.code;
  // Standing figures run next to the expressions – the lobby and the game never wait for either.
  const figures = runFigures(access, deps, code, playerId, now);
  return ok(
    (async () => {
      for (const expression of expressions as Exclude<PhotoExpression, "neutral">[]) {
        // Stop early if the player reset or re-generated meanwhile.
        const current = access.read()?.players.find((p) => p.id === playerId)?.photo;
        if (!current || current.readyVersion !== version || !current.expressionsPending) break;
        if (await generateExpressionAvatar(deps, { code, playerId, expression })) {
          await update(access, code, (r) => addPhotoExpression(r, playerId, version, expression));
          // Saved meanwhile ("Figur behalten") → the saved figure gets this face too.
          const savedId = access.read()?.players.find((p) => p.id === playerId)?.photo?.savedId;
          if (savedId) await addSavedExpression(deps.store, { code, playerId, savedId, expression });
        }
      }
      await update(access, code, (r) => finishPhotoExpressions(r, playerId, version));
      await figures;
    })(),
  );
}

/**
 * Standing full-body figures in the background: the standard figure from the
 * round avatar first, then the four expressions in parallel from the
 * standard figure. Each with one automatic retry; what fails falls back
 * (expression → standard figure → round avatar). Counts and cost are logged.
 */
export async function runFigures(
  access: RoomAccess,
  deps: AvatarServiceDeps,
  code: string,
  playerId: string,
  now: number,
): Promise<void> {
  const room = access.read();
  if (!room || room.code !== code) return;
  const started = startFigures(room, playerId, now);
  if (!started) return;
  await access.commit(started.room);
  const { version, poses } = started;
  let calls = 0;
  let made = 0;

  const still = () => access.read()?.players.find((p) => p.id === playerId)?.photo?.readyVersion === version;
  const make = async (pose: (typeof poses)[number]) => {
    if (!still()) return false;
    const outcome = await generateFigure(deps, { code, playerId, pose });
    calls += outcome.attempts;
    if (!outcome.ok) return false;
    made++;
    await update(access, code, (r) => addFigure(r, playerId, version, pose));
    const savedId = access.read()?.players.find((p) => p.id === playerId)?.photo?.savedId;
    if (savedId) await addSavedFigure(deps.store, { code, playerId, savedId, pose });
    return true;
  };

  const hasStandard = !poses.includes("standard") || (await make("standard"));
  if (hasStandard) await Promise.all(FIGURE_EXPRESSIONS.filter((p) => poses.includes(p)).map(make));
  await update(access, code, (r) => finishFigures(r, playerId, version, calls));
  const roomCalls = access.read()?.photoUsage.figures ?? calls;
  console.log(
    `avatar figures: ${made}/${poses.length} made in ${calls} model calls (≈$${(calls * FIGURE_CONFIG.estimatedUsdPerImage).toFixed(2)}); room total ${roomCalls} calls (≈$${(roomCalls * FIGURE_CONFIG.estimatedUsdPerImage).toFixed(2)})`,
  );
}

/**
 * "Figur behalten": copies the current figure to a new saved slot.
 * Returns the saved id (only the owner learns it). Saving twice returns the same id.
 */
export async function savePlayerPhoto(
  access: RoomAccess,
  store: AvatarStore | null,
  playerId: string,
  now: number,
  newId: () => string = () => generateSecret(16),
): Promise<Result<string>> {
  const room = access.read();
  if (!room) return fail("ROOM_NOT_FOUND");
  if (!store) return fail("PHOTO_UNAVAILABLE");
  const photo = photoToSave(room, playerId);
  if (!photo.ok) return photo;
  if (photo.value.savedId) return ok(photo.value.savedId);

  const version = photo.value.readyVersion!;
  const savedId = newId();
  const copied = await saveFigure(store, {
    code: room.code,
    playerId,
    savedId,
    expressions: photo.value.expressions,
    figures: photo.value.figures ?? [],
    now,
  });
  if (!copied.includes("neutral")) return fail("PHOTO_NOT_READY");
  await update(access, room.code, (r) => markPhotoSaved(r, playerId, version, savedId));
  return ok(savedId);
}

/**
 * "⭐ Meine Figur": copies a saved figure into the room – no generation, no
 * cost. A figure saved before standing figures existed gets them made now.
 */
export async function useSavedPhoto(
  access: RoomAccess,
  store: AvatarStore | null,
  playerId: string,
  savedId: string,
  now: number,
  deps: AvatarServiceDeps | null = null,
): Promise<Result<Promise<void> | null>> {
  const room = access.read();
  if (!room) return fail("ROOM_NOT_FOUND");
  if (!store) return fail("PHOTO_UNAVAILABLE");
  const allowed = canUseSavedPhoto(room, playerId);
  if (!allowed.ok) return allowed;
  const loaded = await loadFigure(store, { code: room.code, playerId, savedId, now });
  if (!loaded) return fail("PHOTO_SAVED_GONE");
  const current = access.read();
  if (!current || current.code !== room.code) return fail("ROOM_NOT_FOUND");
  const applied = applySavedPhoto(current, playerId, savedId, loaded.expressions, now, loaded.figures);
  if (!applied.ok) return applied;
  await access.commit(applied.value);
  return ok(deps ? runFigures(access, deps, room.code, playerId, now) : null);
}
