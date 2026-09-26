/**
 * Standing full-body figures: which pose to show, short reactions, and how
 * to keep the feet in place (pure, tested). Built for the Survival-Finale and
 * meant to be reused by the game-wide reaction moments later.
 */
import type { DangerLevel } from "@couch-clash/games/meta";
import type { FigurePose, PhotoExpression } from "@couch-clash/shared";

export const FIGURE_CONFIG = {
  /** Idle animations on/off (prefers-reduced-motion switches them off anyway). */
  idleAnimations: true,
  /** Cross-fade between two poses. */
  crossfadeMs: 150,
  /** How long a reaction shows before the figure goes back to its state pose. */
  cheerMs: 1_800,
  shockMs: 1_500,
} as const;

/** The pose for a danger level (the figure's resting state). */
export function poseForDanger(danger: DangerLevel): FigurePose {
  switch (danger) {
    case "CRITICAL":
      return "besorgt";
    case "ELIMINATION_IMMINENT":
      return "panisch";
    case "ELIMINATED":
      return "geschockt";
    default:
      return "standard";
  }
}

/**
 * The resting pose on the elevator, from everything the stage knows:
 * winner → jubelnd; after the reveal a loss → geschockt, a correct answer →
 * jubelnd; then the danger: just above the slime → panisch, sinking (live
 * decay) or few points → besorgt; otherwise standard.
 */
export function stagePose(input: {
  danger: DangerLevel;
  winner?: boolean;
  /** Losing points to the clock right now. */
  descending?: boolean;
  /** Reveal: this player's answer was right (null: no reveal / no answer). */
  correct?: boolean | null;
  /** Reveal: what the question did to the score in total (null: nothing yet). */
  pointsChange?: number | null;
}): FigurePose {
  if (input.winner) return "jubelnd";
  if (input.danger === "ELIMINATED") return "geschockt";
  if (input.pointsChange != null && input.pointsChange < 0) return "geschockt";
  if (input.correct) return "jubelnd";
  if (input.danger === "ELIMINATION_IMMINENT") return "panisch";
  if (input.descending || input.danger === "CRITICAL") return "besorgt";
  return "standard";
}

/** The round avatar's closest face per pose (it has only four). */
export const POSE_EXPRESSION: Record<FigurePose, PhotoExpression> = {
  standard: "neutral",
  besorgt: "enttaeuscht",
  panisch: "geschockt",
  jubelnd: "jubelnd",
  geschockt: "geschockt",
  pokal: "jubelnd",
};

export interface FigureReaction {
  /** Changes with every new reaction (e.g. the event's seq). */
  key: string | number;
  pose: FigurePose;
  durationMs: number;
}

/** A short reaction for a game event (+50, comeback, winner → cheering; wrong answer → shocked). */
export function reactionForEvent(type: string, key: string | number): FigureReaction | null {
  switch (type) {
    case "FAST_CORRECT":
    case "COMEBACK":
    case "WINNER":
      return { key, pose: "jubelnd", durationMs: FIGURE_CONFIG.cheerMs };
    case "WRONG_ANSWER":
      return { key, pose: "geschockt", durationMs: FIGURE_CONFIG.shockMs };
    default:
      return null;
  }
}

/** Pose right now: a running reaction wins over the resting (state) pose. */
export function currentPose(statePose: FigurePose, runningReaction: Pick<FigureReaction, "pose"> | null): FigurePose {
  return runningReaction ? runningReaction.pose : statePose;
}

/** A stable offset (seconds) per player, so the figures don't all breathe in sync. */
export function idlePhase(seed: string, period = 3): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return -((h % 1000) / 1000) * period;
}

/** Where the feet are, in % of the image (x: middle of the feet, y: lowest opaque row). */
export interface FeetAnchor {
  x: number;
  y: number;
}

/**
 * Finds the feet in an RGBA image: the lowest row with opaque pixels, and
 * the horizontal middle of the opaque pixels in the band just above it.
 * Null for an empty image.
 */
export function feetAnchor(rgba: ArrayLike<number>, width: number, height: number, alphaMin = 40): FeetAnchor | null {
  let bottom = -1;
  for (let y = height - 1; y >= 0 && bottom < 0; y--) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3]! >= alphaMin) {
        bottom = y;
        break;
      }
    }
  }
  if (bottom < 0) return null;
  const band = Math.max(1, Math.round(height * 0.04));
  let sum = 0;
  let count = 0;
  for (let y = Math.max(0, bottom - band); y <= bottom; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3]! >= alphaMin) {
        sum += x;
        count++;
      }
    }
  }
  return { x: ((sum / count + 0.5) / width) * 100, y: ((bottom + 1) / height) * 100 };
}

/**
 * Shift (in % of the image) that puts this pose's feet exactly where the
 * reference pose's feet are – no pose change makes the figure jump.
 */
export function alignShift(anchor: FeetAnchor | null, reference: FeetAnchor | null): { x: number; y: number } {
  if (!anchor || !reference) return { x: 0, y: 0 };
  return { x: reference.x - anchor.x, y: reference.y - anchor.y };
}
