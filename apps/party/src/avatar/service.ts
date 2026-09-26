/**
 * Runs one generation: provider call with timeout → scale down → store in R2.
 * The original photo only lives in memory for the duration of the call.
 */
import type { FigurePose, PhotoExpression, PhotoFailure } from "@couch-clash/shared";
import { AVATAR_CONFIG, AVATAR_PROMPT, FIGURE_CONFIG, RATE_LIMIT_CONFIG, expressionPrompt, figurePrompt } from "./config";
import { AvatarGenerationError, type AvatarGenerateOptions, type AvatarImage, type AvatarProvider } from "./provider";
import { avatarKey, figureKey, type AvatarStore } from "./store";

export interface AvatarServiceDeps {
  provider: AvatarProvider;
  store: AvatarStore;
  /** The Couch Clash style reference (host artwork). */
  styleReference: () => AvatarImage;
  /** Scales the model output down (e.g. Cloudflare Images). Optional. */
  resize?: (image: AvatarImage) => Promise<AvatarImage>;
  /** Scales a standing figure to the fixed portrait size, keeping transparency. Optional. */
  resizeFigure?: (image: AvatarImage) => Promise<AvatarImage>;
  timeoutMs?: number;
  /** Waits on "too many requests" (tests pass a fake). */
  sleep?: (ms: number) => Promise<void>;
}

export type GenerationOutcome = { ok: true } | { ok: false; reason: PhotoFailure };

class TimeoutError extends Error {}

interface CallOptions extends Omit<AvatarGenerateOptions, "signal"> {
  /** Send the Couch Clash style reference (round avatars and faces; figures keep the input's style). */
  withStyle: boolean;
}

/** Calls the provider, aborting after the timeout even if it ignores the signal. */
async function generateWithTimeout(deps: AvatarServiceDeps, input: AvatarImage, prompt: string, options: CallOptions): Promise<AvatarImage> {
  const { withStyle, ...generate } = options;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError("timeout"));
    }, deps.timeoutMs ?? AVATAR_CONFIG.timeoutMs);
  });
  try {
    return await Promise.race([
      deps.provider.generateAvatar(
        input,
        withStyle ? { reference: deps.styleReference(), prompt } : { prompt },
        { ...generate, signal: controller.signal },
      ),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One image. On "too many requests" it waits as long as the API says and
 * tries again (not billed, so not the image's retry) – up to
 * RATE_LIMIT_CONFIG.maxWaitMs of waiting in total.
 */
async function callModel(deps: AvatarServiceDeps, input: AvatarImage, prompt: string, options: CallOptions): Promise<AvatarImage> {
  let waited = 0;
  for (;;) {
    try {
      return await generateWithTimeout(deps, input, prompt, options);
    } catch (err) {
      const wait = err instanceof AvatarGenerationError ? err.retryAfterMs : undefined;
      if (wait === undefined || waited + wait > RATE_LIMIT_CONFIG.maxWaitMs) throw err;
      waited += wait;
      console.warn(`avatar rate-limited, waiting ${Math.round(wait / 1000)} s`);
      await (deps.sleep ?? sleep)(wait);
    }
  }
}

function failureReason(err: unknown): PhotoFailure {
  if (err instanceof TimeoutError) return "timeout";
  if (err instanceof AvatarGenerationError) return err.reason;
  return "error";
}

/** Only the reason is logged – never images, prompts or response bodies. */
function logFailure(kind: string, err: unknown) {
  const detail = err instanceof AvatarGenerationError ? err.message : failureReason(err);
  console.warn(`avatar ${kind} failed: ${detail}`);
}

async function storeImage(deps: AvatarServiceDeps, key: string, image: AvatarImage, figure = false) {
  let stored = image;
  const resize = figure ? deps.resizeFigure : deps.resize;
  if (resize) {
    try {
      stored = await resize(image);
    } catch {
      console.warn("avatar resize failed, storing the original size");
    }
  }
  await deps.store.put(key, stored.bytes, stored.mimeType);
}

/** Photo → neutral character, stored as `rooms/<code>/<playerId>/neutral.webp`. */
export async function generateBaseAvatar(
  deps: AvatarServiceDeps,
  job: { code: string; playerId: string; photo: AvatarImage },
): Promise<GenerationOutcome> {
  try {
    const image = await callModel(deps, job.photo, AVATAR_PROMPT, { withStyle: true, quality: AVATAR_CONFIG.quality });
    await storeImage(deps, avatarKey(job.code, job.playerId, "neutral"), image);
    return { ok: true };
  } catch (err) {
    logFailure("base", err);
    return { ok: false, reason: failureReason(err) };
  }
}

/** Neutral character → one expression. Uses the stored neutral image, never the photo. */
export async function generateExpressionAvatar(
  deps: AvatarServiceDeps,
  job: { code: string; playerId: string; expression: Exclude<PhotoExpression, "neutral"> },
): Promise<boolean> {
  try {
    const neutral = await deps.store.get(avatarKey(job.code, job.playerId, "neutral"));
    if (!neutral) return false;
    const image = await callModel(deps, { bytes: neutral.bytes, mimeType: neutral.contentType }, expressionPrompt(job.expression), {
      withStyle: true,
      quality: AVATAR_CONFIG.expressionQuality,
    });
    await storeImage(deps, avatarKey(job.code, job.playerId, job.expression), image);
    return true;
  } catch (err) {
    logFailure(`expression ${job.expression}`, err);
    return false;
  }
}

export interface FigureOutcome {
  ok: boolean;
  /** Billed model calls (1, or 2 with the retry; rate-limited calls aren't billed) – for the cost log. */
  attempts: number;
}

/**
 * One standing figure. "standard" is made from the round avatar; every other
 * pose from the stored standard figure (never the round avatar – otherwise the
 * body is re-invented and the figures don't match). One automatic retry.
 */
export async function generateFigure(
  deps: AvatarServiceDeps,
  job: { code: string; playerId: string; pose: FigurePose },
): Promise<FigureOutcome> {
  const source = await deps.store.get(
    job.pose === "standard" ? avatarKey(job.code, job.playerId, "neutral") : figureKey(job.code, job.playerId, "standard"),
  );
  if (!source) return { ok: false, attempts: 0 };
  const input = { bytes: source.bytes, mimeType: source.contentType };
  let attempts = 0;
  for (let i = 0; i <= FIGURE_CONFIG.retries; i++) {
    attempts++;
    try {
      const image = await callModel(deps, input, figurePrompt(job.pose), {
        withStyle: false,
        size: FIGURE_CONFIG.size,
        transparent: true,
        quality: FIGURE_CONFIG.quality,
      });
      await storeImage(deps, figureKey(job.code, job.playerId, job.pose), image, true);
      return { ok: true, attempts };
    } catch (err) {
      logFailure(`figure ${job.pose} (attempt ${attempts})`, err);
      // A refusal won't change on a retry.
      if (err instanceof AvatarGenerationError && err.reason === "refused") break;
    }
  }
  return { ok: false, attempts };
}

/** Cloudflare Images binding → portrait WebP of the figure size, transparency kept, never cropped. */
export function imagesFigureResizer(images: ImagesBinding) {
  return async (image: AvatarImage): Promise<AvatarImage> => {
    const result = await images
      .input(new Blob([image.bytes]).stream())
      .transform({ width: FIGURE_CONFIG.storedWidth, height: FIGURE_CONFIG.storedHeight, fit: "contain", background: "rgba(0,0,0,0)" })
      .output({ format: "image/webp", quality: AVATAR_CONFIG.webpQuality });
    const bytes = new Uint8Array(await new Response(result.image()).arrayBuffer());
    return { bytes, mimeType: result.contentType() };
  };
}

/** Cloudflare Images binding → square WebP of `AVATAR_CONFIG.storedSize` px. */
export function imagesResizer(images: ImagesBinding) {
  return async (image: AvatarImage): Promise<AvatarImage> => {
    const size = AVATAR_CONFIG.storedSize;
    const result = await images
      .input(new Blob([image.bytes]).stream())
      .transform({ width: size, height: size, fit: "cover" })
      .output({ format: "image/webp", quality: AVATAR_CONFIG.webpQuality });
    const bytes = new Uint8Array(await new Response(result.image()).arrayBuffer());
    return { bytes, mimeType: result.contentType() };
  };
}
