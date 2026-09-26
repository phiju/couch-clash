/**
 * Pure state transitions for photo avatars (no I/O, unit-tested).
 * The Durable Object runs the generation and reports back through these.
 */
import {
  EXTRA_EXPRESSIONS,
  ALL_FIGURE_POSES,
  FIGURE_POSES,
  type FigurePose,
  MAX_PLAYERS,
  PHOTO_MAX_REGENERATIONS,
  PHOTO_TIMEOUT_MS,
  photoAvatarPath,
  type PhotoExpression,
  type PhotoFailure,
  type PublicPhotoAvatar,
} from "@couch-clash/shared";
import { RATE_LIMIT_CONFIG } from "./config";
import { fail, ok, type Result } from "../result";
import type { PlayerRecord, RoomRecord } from "../room-logic";

export interface PhotoRecord {
  status: "pending" | "ready" | "failed";
  version: number;
  readyVersion: number | null;
  accepted: boolean;
  expressions: PhotoExpression[];
  /** Extra expressions are being generated for `readyVersion`. */
  expressionsPending: boolean;
  /** When the current job (base image or expressions) started. */
  startedAt: number;
  reason: PhotoFailure | null;
  /** Saved slot of this figure ("Figur behalten"). Never sent to other clients. */
  savedId?: string;
  /** Standing full-body figures that exist for `readyVersion`. */
  figures?: FigurePose[];
  /** Standing figures are being made for `readyVersion`. */
  figuresPending?: boolean;
  figuresStartedAt?: number;
}

/** Base images per player: the first one plus the re-generations. */
export const PHOTO_MAX_BASE_PER_PLAYER = 1 + PHOTO_MAX_REGENERATIONS;
/** Room-wide budget: 16 players × (1 + 2) base images, 16 × 3 expressions. */
export const ROOM_MAX_BASE_IMAGES = MAX_PLAYERS * PHOTO_MAX_BASE_PER_PLAYER;
export const ROOM_MAX_EXPRESSION_IMAGES = MAX_PLAYERS * EXTRA_EXPRESSIONS.length;
/** A job still "pending" this long after its start is treated as timed out (crash, eviction). */
export const PHOTO_STALE_MS = PHOTO_TIMEOUT_MS + RATE_LIMIT_CONFIG.maxWaitMs + 30_000;
/** Expressions run one after another. */
export const EXPRESSIONS_STALE_MS = EXTRA_EXPRESSIONS.length * (PHOTO_TIMEOUT_MS + RATE_LIMIT_CONFIG.maxWaitMs) + 30_000;
/** Figures: the standard one, then four in parallel – each with one retry. */
export const FIGURES_STALE_MS = 2 * (2 * PHOTO_TIMEOUT_MS + RATE_LIMIT_CONFIG.maxWaitMs) + 30_000;
/** Room-wide budget of model calls for standing figures: 16 players × (5 figures + trophy) × (1 + 1 retry). */
export const ROOM_MAX_FIGURE_IMAGES = MAX_PLAYERS * ALL_FIGURE_POSES.length * 2;

export interface PhotoUsage {
  base: number;
  expressions: number;
  /** Model calls for standing figures (retries included). Missing in old rooms. */
  figures?: number;
}

function updatePlayer(room: RoomRecord, playerId: string, fn: (p: PlayerRecord) => PlayerRecord): RoomRecord {
  return { ...room, players: room.players.map((p) => (p.id === playerId ? fn(p) : p)) };
}

function isBusy(photo: PhotoRecord | undefined): boolean {
  return !!photo && (photo.status === "pending" || photo.expressionsPending || !!photo.figuresPending);
}

/** "Verwandeln!" / "Nochmal": reserve a base generation and mark it pending. */
export function startPhotoGeneration(
  room: RoomRecord,
  playerId: string,
  now: number,
): Result<{ room: RoomRecord; version: number }> {
  if (!room.photoAvatars) return fail("PHOTO_DISABLED");
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return fail("UNKNOWN_PLAYER");
  if (isBusy(player.photo)) return fail("PHOTO_BUSY");
  if ((player.photoGenerations ?? 0) >= PHOTO_MAX_BASE_PER_PLAYER) return fail("PHOTO_LIMIT");
  if (room.photoUsage.base >= ROOM_MAX_BASE_IMAGES) return fail("PHOTO_ROOM_LIMIT");

  const prev = player.photo;
  const version = (prev?.version ?? 0) + 1;
  const photo: PhotoRecord = {
    status: "pending",
    version,
    readyVersion: prev?.readyVersion ?? null,
    accepted: false,
    // A new neutral image replaces the old one; old expressions no longer match.
    expressions: prev?.readyVersion != null ? ["neutral"] : [],
    figures: [],
    figuresPending: false,
    expressionsPending: false,
    startedAt: now,
    reason: null,
    savedId: prev?.savedId,
  };
  const next = updatePlayer(room, playerId, (p) => ({
    ...p,
    photo,
    photoGenerations: (p.photoGenerations ?? 0) + 1,
  }));
  return ok({
    room: { ...next, photoUsage: { ...room.photoUsage, base: room.photoUsage.base + 1 } },
    version,
  });
}

/** Result of a base generation. Ignored if the player reset or started another one meanwhile. */
export function finishPhotoGeneration(
  room: RoomRecord,
  playerId: string,
  version: number,
  outcome: { ok: true } | { ok: false; reason: PhotoFailure },
): RoomRecord | null {
  const player = room.players.find((p) => p.id === playerId);
  const photo = player?.photo;
  if (!photo || photo.version !== version || photo.status !== "pending") return null;
  const next: PhotoRecord = outcome.ok
    ? // A new image is a new figure – the saved one stays as it was.
      { ...photo, status: "ready", readyVersion: version, expressions: ["neutral"], figures: [], reason: null, savedId: undefined }
    : { ...photo, status: "failed", reason: outcome.reason };
  return updatePlayer(room, playerId, (p) => ({ ...p, photo: next }));
}

/**
 * "Passt!": keep the image and start the extra expressions (if the room
 * budget allows – otherwise the neutral face is used everywhere).
 */
export function acceptPhoto(
  room: RoomRecord,
  playerId: string,
  now: number,
  /** False when no provider is configured: accept without extra expressions. */
  canGenerate = true,
): Result<{ room: RoomRecord; expressions: PhotoExpression[]; version: number }> {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return fail("UNKNOWN_PLAYER");
  const photo = player.photo;
  if (!photo || photo.readyVersion === null || photo.status === "pending") return fail("PHOTO_NOT_READY");
  if (photo.accepted) return ok({ room, expressions: [], version: photo.readyVersion });

  const missing = EXTRA_EXPRESSIONS.filter((e) => !photo.expressions.includes(e));
  const budget = canGenerate ? Math.max(0, ROOM_MAX_EXPRESSION_IMAGES - room.photoUsage.expressions) : 0;
  const expressions = missing.slice(0, budget);
  const next = updatePlayer(room, playerId, (p) => ({
    ...p,
    photo: {
      ...photo,
      accepted: true,
      expressionsPending: expressions.length > 0,
      startedAt: expressions.length > 0 ? now : photo.startedAt,
    },
  }));
  return ok({
    room: {
      ...next,
      photoUsage: { ...room.photoUsage, expressions: room.photoUsage.expressions + expressions.length },
    },
    expressions,
    version: photo.readyVersion,
  });
}

/** One extra expression is stored. */
export function addPhotoExpression(
  room: RoomRecord,
  playerId: string,
  version: number,
  expression: PhotoExpression,
): RoomRecord | null {
  const photo = room.players.find((p) => p.id === playerId)?.photo;
  if (!photo || photo.readyVersion !== version || photo.expressions.includes(expression)) return null;
  return updatePlayer(room, playerId, (p) => ({
    ...p,
    photo: { ...photo, expressions: [...photo.expressions, expression] },
  }));
}

/** All extra expressions are done (failed ones fall back to neutral). */
export function finishPhotoExpressions(room: RoomRecord, playerId: string, version: number): RoomRecord | null {
  const photo = room.players.find((p) => p.id === playerId)?.photo;
  if (!photo || photo.readyVersion !== version || !photo.expressionsPending) return null;
  return updatePlayer(room, playerId, (p) => ({ ...p, photo: { ...photo, expressionsPending: false } }));
}

/**
 * Standing figures for the accepted avatar (after "Passt!" or a saved figure
 * without them). Null when there is nothing to do or the room budget is used up.
 */
export function startFigures(
  room: RoomRecord,
  playerId: string,
  now: number,
  /** Which figures (default: the five; the trophy only on request). */
  wanted: readonly FigurePose[] = FIGURE_POSES,
): { room: RoomRecord; version: number; poses: FigurePose[] } | null {
  const photo = room.players.find((p) => p.id === playerId)?.photo;
  if (!photo || photo.readyVersion === null || photo.figuresPending) return null;
  const have = photo.figures ?? [];
  // Everything but the standard figure is made from it.
  if (!wanted.includes("standard") && !have.includes("standard")) return null;
  const poses = wanted.filter((p) => !have.includes(p));
  if (poses.length === 0) return null;
  // Room budget: the worst case (every image with its retry) must fit.
  if ((room.photoUsage.figures ?? 0) + poses.length * 2 > ROOM_MAX_FIGURE_IMAGES) return null;
  const next = updatePlayer(room, playerId, (p) => ({
    ...p,
    photo: { ...photo, figuresPending: true, figuresStartedAt: now },
  }));
  return { room: next, version: photo.readyVersion, poses };
}

/** One standing figure is stored. */
export function addFigure(room: RoomRecord, playerId: string, version: number, pose: FigurePose): RoomRecord | null {
  const photo = room.players.find((p) => p.id === playerId)?.photo;
  if (!photo || photo.readyVersion !== version || (photo.figures ?? []).includes(pose)) return null;
  return updatePlayer(room, playerId, (p) => ({ ...p, photo: { ...photo, figures: [...(photo.figures ?? []), pose] } }));
}

/** The figure job is over (missing ones fall back); the model calls count against the room budget. */
export function finishFigures(room: RoomRecord, playerId: string, version: number, modelCalls: number): RoomRecord {
  const usage = { ...room.photoUsage, figures: (room.photoUsage.figures ?? 0) + modelCalls };
  const photo = room.players.find((p) => p.id === playerId)?.photo;
  const next = { ...room, photoUsage: usage };
  if (!photo || photo.readyVersion !== version || !photo.figuresPending) return next;
  return updatePlayer(next, playerId, (p) => ({ ...p, photo: { ...photo, figuresPending: false } }));
}

/** Back to the emoji avatar. The used generations still count. */
export function resetPhoto(room: RoomRecord, playerId: string): Result<RoomRecord> {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return fail("UNKNOWN_PLAYER");
  if (!player.photo) return ok(room);
  return ok(updatePlayer(room, playerId, (p) => ({ ...p, photo: undefined })));
}

/** Whether the player's current figure can be saved; returns it. */
export function photoToSave(room: RoomRecord, playerId: string): Result<PhotoRecord> {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return fail("UNKNOWN_PLAYER");
  const photo = player.photo;
  if (!photo || photo.readyVersion === null || photo.status === "pending" || !photo.accepted) {
    return fail("PHOTO_NOT_READY");
  }
  return ok(photo);
}

export function markPhotoSaved(room: RoomRecord, playerId: string, version: number, savedId: string): RoomRecord | null {
  const photo = room.players.find((p) => p.id === playerId)?.photo;
  if (!photo || photo.readyVersion !== version) return null;
  return updatePlayer(room, playerId, (p) => ({ ...p, photo: { ...photo, savedId } }));
}

/** Before loading a saved figure: allowed, and nothing running for this player. */
export function canUseSavedPhoto(room: RoomRecord, playerId: string): Result<PlayerRecord> {
  if (!room.photoAvatars) return fail("PHOTO_DISABLED");
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return fail("UNKNOWN_PLAYER");
  if (isBusy(player.photo)) return fail("PHOTO_BUSY");
  return ok(player);
}

/** The saved figure was copied into the room: ready and accepted right away, no generation. */
export function applySavedPhoto(
  room: RoomRecord,
  playerId: string,
  savedId: string,
  expressions: PhotoExpression[],
  now: number,
  figures: FigurePose[] = [],
): Result<RoomRecord> {
  const allowed = canUseSavedPhoto(room, playerId);
  if (!allowed.ok) return allowed;
  const version = (allowed.value.photo?.version ?? 0) + 1;
  const photo: PhotoRecord = {
    status: "ready",
    version,
    readyVersion: version,
    accepted: true,
    expressions,
    expressionsPending: false,
    startedAt: now,
    reason: null,
    savedId,
    figures,
    figuresPending: false,
  };
  return ok(updatePlayer(room, playerId, (p) => ({ ...p, photo })));
}

export function setPhotoAvatars(room: RoomRecord, enabled: boolean): Result<RoomRecord> {
  if (room.phase !== "lobby") return fail("WRONG_PHASE");
  return ok({ ...room, photoAvatars: enabled });
}

/** Jobs that never reported back (object evicted, crash) → failed / done. Null if nothing changed. */
export function expireStalePhotos(room: RoomRecord, now: number): RoomRecord | null {
  let changed = false;
  const players = room.players.map((p) => {
    const photo = p.photo;
    if (!photo) return p;
    if (photo.status === "pending" && now - photo.startedAt >= PHOTO_STALE_MS) {
      changed = true;
      return { ...p, photo: { ...photo, status: "failed" as const, reason: "timeout" as const } };
    }
    if (photo.expressionsPending && now - photo.startedAt >= EXPRESSIONS_STALE_MS) {
      changed = true;
      return { ...p, photo: { ...photo, expressionsPending: false } };
    }
    if (photo.figuresPending && now - (photo.figuresStartedAt ?? photo.startedAt) >= FIGURES_STALE_MS) {
      changed = true;
      return { ...p, photo: { ...photo, figuresPending: false } };
    }
    return p;
  });
  return changed ? { ...room, players } : null;
}

/** Next time a running job must be checked (for the Durable Object alarm), or null. */
export function nextPhotoDeadline(room: RoomRecord): number | null {
  let next: number | null = null;
  for (const p of room.players) {
    const photo = p.photo;
    if (!photo) continue;
    const at =
      photo.status === "pending"
        ? photo.startedAt + PHOTO_STALE_MS
        : photo.expressionsPending
          ? photo.startedAt + EXPRESSIONS_STALE_MS
          : null;
    if (at !== null && (next === null || at < next)) next = at;
    const figuresAt = photo.figuresPending ? (photo.figuresStartedAt ?? photo.startedAt) + FIGURES_STALE_MS : null;
    if (figuresAt !== null && (next === null || figuresAt < next)) next = figuresAt;
  }
  return next;
}

export function publicPhoto(player: PlayerRecord, code: string): PublicPhotoAvatar | undefined {
  const photo = player.photo;
  if (!photo) return undefined;
  return {
    status: photo.status,
    version: photo.version,
    readyVersion: photo.readyVersion,
    accepted: photo.accepted,
    expressions: photo.readyVersion === null ? [] : photo.expressions,
    regenerationsLeft: Math.max(0, PHOTO_MAX_BASE_PER_PLAYER - (player.photoGenerations ?? 0)),
    reason: photo.reason,
    path: photoAvatarPath(code, player.id),
    saved: !!photo.savedId,
    figures: photo.readyVersion === null ? [] : (photo.figures ?? []),
    figuresPending: !!photo.figuresPending,
  };
}
