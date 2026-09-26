/**
 * Photo avatars: a player's photo is turned into a cartoon character by the
 * party server. The emoji avatar always stays as the fallback.
 */

/** Expressions of a photo avatar. "neutral" is generated first, the others after "Passt!". */
export const PHOTO_EXPRESSIONS = ["neutral", "jubelnd", "enttaeuscht", "geschockt"] as const;
export type PhotoExpression = (typeof PHOTO_EXPRESSIONS)[number];
/** Generated in the background once the player accepts the neutral image. */
export const EXTRA_EXPRESSIONS = ["jubelnd", "enttaeuscht", "geschockt"] as const satisfies readonly PhotoExpression[];

export function isPhotoExpression(value: string): value is PhotoExpression {
  return (PHOTO_EXPRESSIONS as readonly string[]).includes(value);
}

/**
 * Standing full-body figures of a photo avatar (on top of the round one):
 * "standard" is made from the round avatar, the other four from "standard"
 * so they all match. Same size and position, feet on the same baseline.
 */
export const FIGURE_POSES = ["standard", "jubelnd", "besorgt", "panisch", "geschockt"] as const;
export type FigurePose = (typeof FIGURE_POSES)[number];
/** The four made from the standing standard figure. */
export const FIGURE_EXPRESSIONS = ["jubelnd", "besorgt", "panisch", "geschockt"] as const satisfies readonly FigurePose[];

export function isFigurePose(value: string): value is FigurePose {
  return (FIGURE_POSES as readonly string[]).includes(value);
}

/** Image name of a figure on the party worker ("figure-panisch"). */
export function figureImageName(pose: FigurePose): string {
  return `figure-${pose}`;
}

/** A requested avatar image: a round expression or a standing figure. */
export function parseAvatarImageName(name: string): { kind: "expression"; expression: PhotoExpression } | { kind: "figure"; pose: FigurePose } | null {
  if (isPhotoExpression(name)) return { kind: "expression", expression: name };
  const pose = name.startsWith("figure-") ? name.slice("figure-".length) : "";
  return isFigurePose(pose) ? { kind: "figure", pose } : null;
}

/** Upload limits (the phone crops to 512 px JPEG, which is far below this). */
export const PHOTO_MAX_BYTES = 1024 * 1024;
export const PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** Re-generations after the first image, per player. */
export const PHOTO_MAX_REGENERATIONS = 2;
/** Generation timeout (the game never waits for it). */
export const PHOTO_TIMEOUT_MS = 90_000;

export type PhotoFailure = "error" | "timeout" | "refused";

/** Photo avatar as every client sees it (part of the player's avatar). */
export interface PublicPhotoAvatar {
  /** State of the latest generation. */
  status: "pending" | "ready" | "failed";
  /** Bumped with every generation; used for cache busting. */
  version: number;
  /** Version of the last successful image, null → show the emoji. */
  readyVersion: number | null;
  /** The player confirmed the image ("Passt!"). */
  accepted: boolean;
  /** Expressions that exist (always contains "neutral" when readyVersion is set). */
  expressions: PhotoExpression[];
  regenerationsLeft: number;
  reason: PhotoFailure | null;
  /** Image base path on the party worker, see `photoAvatarUrl`. */
  path: string;
  /** Kept for next time ("Figur behalten"). The id itself is only sent to the owner. */
  saved: boolean;
  /** Standing figures that exist (the game never waits for them). */
  figures: FigurePose[];
  /** Standing figures are being made right now. */
  figuresPending: boolean;
}

/**
 * Saved figures ("⭐ Meine Figur"): stored under a random id that only the
 * player's phone knows. Knowing the id = owning the figure.
 */
export const SAVED_AVATAR_ID_PATTERN = /^[a-f0-9]{32}$/;
/** Kept this long after the last use (R2 lifecycle rule on "saved/"). */
export const SAVED_AVATAR_RETENTION_DAYS = 365;

export function savedAvatarPath(savedId: string, expression: PhotoExpression = "neutral"): string {
  return `/api/avatars/saved/${savedId}/${expression}`;
}

/** Base path of a player's avatar images on the party worker. */
export function photoAvatarPath(code: string, playerId: string): string {
  return `/api/rooms/${encodeURIComponent(code)}/avatar/${encodeURIComponent(playerId)}`;
}

/**
 * URL of the image to show, or null → emoji. Unknown expressions fall back
 * to neutral; `?v=` changes with every new image (cache busting).
 */
export function photoAvatarUrl(
  partyHttpUrl: string,
  photo: PublicPhotoAvatar | undefined,
  expression: PhotoExpression = "neutral",
): string | null {
  if (!photo || photo.readyVersion === null) return null;
  const face = photo.expressions.includes(expression) ? expression : "neutral";
  return `${partyHttpUrl}${photo.path}/${face}?v=${photo.readyVersion}`;
}

/**
 * URL of a standing figure with the fallback chain: the pose → the standing
 * standard figure → null (then the round avatar stands on the platform).
 */
export function figureUrl(partyHttpUrl: string, photo: PublicPhotoAvatar | undefined, pose: FigurePose): string | null {
  if (!photo || photo.readyVersion === null) return null;
  const figures = photo.figures ?? [];
  // Expressions are made from the standard figure – without it, the round avatar.
  if (!figures.includes("standard")) return null;
  const use = figures.includes(pose) ? pose : "standard";
  return `${partyHttpUrl}${photo.path}/${figureImageName(use)}?v=${photo.readyVersion}`;
}

/**
 * Which face to show in the animated leaderboard. Falls back to neutral.
 * - moved up → jubelnd
 * - big loss (lost points, or dropped 2+ places) → geschockt
 * - moved down → enttaeuscht
 */
export function expressionForChange(
  change: { rankBefore: number; rankAfter: number; pointsGained: number },
  available: readonly PhotoExpression[],
): PhotoExpression {
  let wanted: PhotoExpression = "neutral";
  const drop = change.rankAfter - change.rankBefore;
  if (change.pointsGained < 0 || drop >= 2) wanted = "geschockt";
  else if (drop < 0) wanted = "jubelnd";
  else if (drop > 0) wanted = "enttaeuscht";
  return available.includes(wanted) ? wanted : "neutral";
}
