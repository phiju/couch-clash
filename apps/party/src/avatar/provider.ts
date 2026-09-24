import type { PhotoFailure } from "@couch-clash/shared";

export interface AvatarImage {
  bytes: Uint8Array;
  mimeType: string;
}

/** How the result should look: the style reference image and the instruction. */
export interface AvatarStyle {
  reference: AvatarImage;
  prompt: string;
}

/**
 * An image model that turns a photo into a character. Swap the provider
 * (e.g. Gemini) by implementing this interface and changing `createAvatarProvider`.
 */
export interface AvatarProvider {
  /** Throws `AvatarGenerationError` (refusal, no image, API error). */
  generateAvatar(photo: AvatarImage, style: AvatarStyle, options?: { signal?: AbortSignal }): Promise<AvatarImage>;
}

export class AvatarGenerationError extends Error {
  constructor(
    readonly reason: PhotoFailure,
    message: string,
  ) {
    super(message);
    this.name = "AvatarGenerationError";
  }
}
