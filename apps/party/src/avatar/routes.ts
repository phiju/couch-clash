/**
 * HTTP side of photo avatars (worker, before the Durable Object):
 *   POST /api/rooms/:code/avatar                     multipart: playerId, playerSecret, photo
 *   GET  /api/rooms/:code/avatar/:playerId/:expression
 * Size and type are checked here; auth and limits in the room.
 */
import {
  ERROR_MESSAGES,
  PHOTO_MAX_BYTES,
  SAVED_AVATAR_ID_PATTERN,
  PHOTO_MIME_TYPES,
  isPhotoExpression,
  isValidRoomCode,
  normalizeRoomCode,
  type ErrorCode,
  type PhotoExpression,
  type PhotoUploadResponse,
} from "@couch-clash/shared";
import { CORS_HEADERS, json } from "../http";
import type { AvatarImage } from "./provider";
import { deleteFigure } from "./saved";
import { avatarKey, savedKey, savedMetaKey, type AvatarStore } from "./store";

export type PhotoMimeType = (typeof PHOTO_MIME_TYPES)[number];

/** What the worker needs from the room Durable Object. */
export interface AvatarRoomApi {
  uploadPhoto(playerId: string, playerSecret: string, photo: AvatarImage): Promise<PhotoUploadResponse>;
  /** Whether the room is active and the player has this expression. */
  hasPhoto(playerId: string, expression: PhotoExpression): Promise<boolean>;
}

const STATUS: Partial<Record<ErrorCode, number>> = {
  ROOM_NOT_FOUND: 404,
  ROOM_EXPIRED: 404,
  NOT_AUTHORIZED: 401,
  UNKNOWN_PLAYER: 401,
  INVALID_MESSAGE: 400,
  PHOTO_DISABLED: 403,
  PHOTO_BUSY: 409,
  PHOTO_LIMIT: 429,
  PHOTO_ROOM_LIMIT: 429,
  PHOTO_TOO_LARGE: 413,
  PHOTO_BAD_TYPE: 415,
  PHOTO_UNAVAILABLE: 503,
};

export function uploadError(code: ErrorCode): Response {
  const body: PhotoUploadResponse = { ok: false, code, error: ERROR_MESSAGES[code] };
  return json(body, STATUS[code] ?? 400);
}

/** Detects the real image type from the first bytes (the declared type is not trusted). */
export function sniffImageType(bytes: Uint8Array): PhotoMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)
  ) {
    return "image/png";
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Room codes are validated before a Durable Object is touched. */
function roomCode(raw: string): string | null {
  const code = normalizeRoomCode(raw);
  return isValidRoomCode(code) ? code : null;
}

const MULTIPART_OVERHEAD = 16 * 1024;

export async function handleAvatarUpload(
  request: Request,
  rawCode: string,
  getRoom: (code: string) => Promise<AvatarRoomApi>,
): Promise<Response> {
  const code = roomCode(rawCode);
  if (!code) return uploadError("ROOM_NOT_FOUND");

  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (length > PHOTO_MAX_BYTES + MULTIPART_OVERHEAD) return uploadError("PHOTO_TOO_LARGE");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return uploadError("INVALID_MESSAGE");
  }
  const playerId = form.get("playerId");
  const playerSecret = form.get("playerSecret");
  const photo = form.get("photo");
  if (typeof playerId !== "string" || typeof playerSecret !== "string" || !playerId || !playerSecret) {
    return uploadError("NOT_AUTHORIZED");
  }
  if (playerId.length > 64 || playerSecret.length > 128) return uploadError("NOT_AUTHORIZED");
  if (!photo || typeof photo === "string") return uploadError("INVALID_MESSAGE");
  if (photo.size > PHOTO_MAX_BYTES) return uploadError("PHOTO_TOO_LARGE");
  if (!(PHOTO_MIME_TYPES as readonly string[]).includes(photo.type)) return uploadError("PHOTO_BAD_TYPE");

  const bytes = new Uint8Array(await photo.arrayBuffer());
  const mimeType = sniffImageType(bytes);
  if (!mimeType) return uploadError("PHOTO_BAD_TYPE");

  const result = await (await getRoom(code)).uploadPhoto(playerId, playerSecret, { bytes, mimeType });
  return result.ok ? json(result, 202) : uploadError(result.code);
}

export async function handleAvatarGet(
  rawCode: string,
  playerId: string,
  expression: string,
  getRoom: (code: string) => Promise<AvatarRoomApi>,
  store: AvatarStore | null,
): Promise<Response> {
  const notFound = () => new Response("Not found", { status: 404, headers: CORS_HEADERS });
  const code = roomCode(rawCode);
  if (!code || !store || !isPhotoExpression(expression) || !/^[A-Za-z0-9_-]{1,64}$/.test(playerId)) {
    return notFound();
  }
  if (!(await (await getRoom(code)).hasPhoto(playerId, expression))) return notFound();
  const image = await store.get(avatarKey(code, playerId, expression));
  if (!image) return notFound();
  return new Response(image.bytes, {
    headers: {
      "Content-Type": image.contentType,
      // Clients add ?v=<version>, so a new image gets a new URL.
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      ...CORS_HEADERS,
    },
  });
}

/**
 * Saved figures ("⭐ Meine Figur"). The random id is the key: only the phone
 * that saved the figure knows it.
 *   GET    /api/avatars/saved/:id/:expression   preview on the join screen
 *   DELETE /api/avatars/saved/:id               "Figur löschen"
 */
export async function handleSavedAvatarGet(
  savedId: string,
  expression: string,
  store: AvatarStore | null,
): Promise<Response> {
  const notFound = () => new Response("Not found", { status: 404, headers: CORS_HEADERS });
  if (!store || !SAVED_AVATAR_ID_PATTERN.test(savedId) || !isPhotoExpression(expression)) return notFound();
  const image = await store.get(savedKey(savedId, expression));
  if (!image) return notFound();
  return new Response(image.bytes, {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      ...CORS_HEADERS,
    },
  });
}

export async function handleSavedAvatarDelete(savedId: string, store: AvatarStore | null): Promise<Response> {
  if (!store) return json({ ok: false }, 503);
  if (!SAVED_AVATAR_ID_PATTERN.test(savedId)) return json({ ok: false }, 404);
  const existed = (await store.get(savedMetaKey(savedId))) !== null;
  await deleteFigure(store, savedId);
  return json({ ok: true, deleted: existed });
}
