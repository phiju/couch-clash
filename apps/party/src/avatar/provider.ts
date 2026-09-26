import type { PhotoFailure } from "@couch-clash/shared";

export interface AvatarImage {
  bytes: Uint8Array;
  mimeType: string;
}

/** How the result should look: the style reference image (optional) and the instruction. */
export interface AvatarStyle {
  /** Second input image (the Couch Clash style). Figures don't use it – they keep the input's style. */
  reference?: AvatarImage;
  prompt: string;
}

export interface AvatarGenerateOptions {
  signal?: AbortSignal;
  /** Requested size, e.g. "1024x1536" (default: AVATAR_CONFIG.size). */
  size?: string;
  /** Transparent background (standing figures). */
  transparent?: boolean;
}

/**
 * An image model that turns a photo into a character. Swap the provider
 * (e.g. Gemini) by implementing this interface and changing `createAvatarProvider`.
 */
export interface AvatarProvider {
  /** Throws `AvatarGenerationError` (refusal, no image, API error). */
  generateAvatar(photo: AvatarImage, style: AvatarStyle, options?: AvatarGenerateOptions): Promise<AvatarImage>;
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
