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
