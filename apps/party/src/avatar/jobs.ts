/**
 * Glue between the room state and the generation service. The Durable
 * Object passes in how to read and commit its room; the returned promises
 * are the background work (handed to ctx.waitUntil).
 */
import type { PhotoExpression, PhotoUploadResponse } from "@couch-clash/shared";
import { authenticatePlayer, type RoomRecord } from "../room-logic";
import { fail, ok, type Result } from "../result";
import {
  acceptPhoto,
  addPhotoExpression,
  finishPhotoExpressions,
  finishPhotoGeneration,
  startPhotoGeneration,
} from "./photo-logic";
import type { AvatarImage } from "./provider";
import { generateBaseAvatar, generateExpressionAvatar, type AvatarServiceDeps } from "./service";

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
  return ok(
    (async () => {
      for (const expression of expressions as Exclude<PhotoExpression, "neutral">[]) {
        // Stop early if the player reset or re-generated meanwhile.
        const current = access.read()?.players.find((p) => p.id === playerId)?.photo;
        if (!current || current.readyVersion !== version || !current.expressionsPending) break;
        if (await generateExpressionAvatar(deps, { code, playerId, expression })) {
          await update(access, code, (r) => addPhotoExpression(r, playerId, version, expression));
        }
      }
      await update(access, code, (r) => finishPhotoExpressions(r, playerId, version));
    })(),
  );
}
