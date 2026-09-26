import { PHOTO_TIMEOUT_MS, type FigurePose, type PhotoExpression } from "@couch-clash/shared";
import FIGURE_PROMPTS_JSON from "./figure-prompts.json";

/**
 * Everything about the AI avatar generation in one place.
 * Swap the model or quality here; swap the whole provider in `provider.ts`.
 */
export const AVATAR_CONFIG = {
  /** OpenAI GPT Image model (image edit with several input images). */
  model: "gpt-image-2",
  /** The round avatar – the one everybody sees first. */
  quality: "medium",
  /** The leaderboard faces: shown small, so "low" looks the same at a fraction of the price. */
  expressionQuality: "low",
  /** Size requested from the model; stored images are scaled down to `storedSize`. */
  size: "1024x1024",
  storedSize: 256,
  /** WebP quality (0–100) for the model output and the stored image. */
  webpQuality: 80,
  timeoutMs: PHOTO_TIMEOUT_MS,
} as const;

/**
 * "Too many requests" from OpenAI (the account's images-per-minute limit):
 * wait as long as OpenAI says and try again. Not billed, so it doesn't count
 * as the image's retry. At most this much waiting per image, then give up.
 */
export const RATE_LIMIT_CONFIG = {
  maxWaitMs: 30_000,
  /** When OpenAI doesn't say how long. */
  defaultWaitMs: 10_000,
} as const;

/** First image: the player's photo; second image: the Couch Clash style reference. */
export const AVATAR_PROMPT =
  "Turn the person in the first image into a head-and-shoulders cartoon character in exactly the illustration style of the second image (1970s TV game show, warm oranges and teals). Keep recognizable features (hair, glasses, beard, face shape), friendly, funny, slightly exaggerated expression, no text, plain solid cream-colored background, centered, square.";

const EXPRESSION_DESCRIPTIONS: Record<Exclude<PhotoExpression, "neutral">, string> = {
  jubelnd: "cheering and overjoyed, huge open-mouthed grin, eyes sparkling, like they just won the jackpot",
  enttaeuscht: "disappointed, pouting, drooping eyebrows and a sad little frown",
  geschockt: "completely shocked, jaw dropped, eyes wide open, hands on the cheeks",
};

/** First image: the accepted (neutral) avatar; second image: the style reference. */
export function expressionPrompt(expression: Exclude<PhotoExpression, "neutral">): string {
  return `Draw exactly the same cartoon character as in the first image, in exactly the illustration style of the second image (1970s TV game show, warm oranges and teals), but now ${EXPRESSION_DESCRIPTIONS[expression]}. Keep the face, hair, glasses, beard, clothes and framing identical, head-and-shoulders, no text, plain solid cream-colored background, centered, square.`;
}

/** Standing full-body figures (on top of the round avatar). */
export const FIGURE_CONFIG = {
  /** Portrait, the same for all five images. */
  size: "1024x1536",
  /** Stored size (2:3, transparent WebP) – identical for all five, so the feet stay in place. */
  storedWidth: 400,
  storedHeight: 600,
  /** One automatic retry per image, then give up (fallback: standard figure / round avatar). */
  retries: 1,
  /** Shown at most 600 px tall: "low" looks the same as "medium" at about a fifth of the price. */
  quality: "low",
  /** Estimated OpenAI price per image (low, 1024×1536, measured) – for the cost log only. */
  estimatedUsdPerImage: 0.011,
  timeoutMs: PHOTO_TIMEOUT_MS,
} as const;

interface FigurePrompts {
  standard: string;
  expressionBase: string;
  expressions: Record<Exclude<FigurePose, "standard">, string>;
}

/** The prompts live in figure-prompts.json (editable without touching code). */
export const FIGURE_PROMPTS: FigurePrompts = FIGURE_PROMPTS_JSON;

/** Prompt for one figure: the standard one, or the shared edit part + the expression. */
export function figurePrompt(pose: FigurePose, prompts: FigurePrompts = FIGURE_PROMPTS): string {
  return pose === "standard" ? prompts.standard : `${prompts.expressionBase}\n\n${prompts.expressions[pose]}`;
}
