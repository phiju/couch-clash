/**
 * Runs one generation: provider call with timeout → scale down → store in R2.
 * The original photo only lives in memory for the duration of the call.
 */
import type { PhotoExpression, PhotoFailure } from "@couch-clash/shared";
import { AVATAR_CONFIG, AVATAR_PROMPT, expressionPrompt } from "./config";
import { AvatarGenerationError, type AvatarImage, type AvatarProvider } from "./provider";
import { avatarKey, type AvatarStore } from "./store";

export interface AvatarServiceDeps {
  provider: AvatarProvider;
  store: AvatarStore;
  /** The Couch Clash style reference (host artwork). */
  styleReference: () => AvatarImage;
  /** Scales the model output down (e.g. Cloudflare Images). Optional. */
  resize?: (image: AvatarImage) => Promise<AvatarImage>;
  timeoutMs?: number;
}

export type GenerationOutcome = { ok: true } | { ok: false; reason: PhotoFailure };

class TimeoutError extends Error {}

/** Calls the provider, aborting after the timeout even if it ignores the signal. */
async function generateWithTimeout(
  deps: AvatarServiceDeps,
  input: AvatarImage,
  prompt: string,
): Promise<AvatarImage> {
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
      deps.provider.generateAvatar(input, { reference: deps.styleReference(), prompt }, { signal: controller.signal }),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
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

async function storeImage(deps: AvatarServiceDeps, key: string, image: AvatarImage) {
  let stored = image;
  if (deps.resize) {
    try {
      stored = await deps.resize(image);
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
    const image = await generateWithTimeout(deps, job.photo, AVATAR_PROMPT);
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
    const image = await generateWithTimeout(
      deps,
      { bytes: neutral.bytes, mimeType: neutral.contentType },
      expressionPrompt(job.expression),
    );
    await storeImage(deps, avatarKey(job.code, job.playerId, job.expression), image);
    return true;
  } catch (err) {
    logFailure(`expression ${job.expression}`, err);
    return false;
  }
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
