import { AVATAR_CONFIG } from "./config";
import { AvatarGenerationError, type AvatarImage, type AvatarProvider, type AvatarStyle } from "./provider";

const EDIT_URL = "https://api.openai.com/v1/images/edits";

/** Error codes OpenAI uses when the safety system rejects a request. */
const REFUSAL_CODES = new Set(["moderation_blocked", "content_policy_violation", "safety_violation"]);

function extension(mimeType: string): string {
  return mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * OpenAI Images API, "edit" with several input images: [photo, style reference].
 * Never logs images or response bodies.
 */
export function createOpenAIProvider(apiKey: string, fetchFn: typeof fetch = fetch): AvatarProvider {
  return {
    async generateAvatar(photo: AvatarImage, style: AvatarStyle, options = {}) {
      const form = new FormData();
      form.append("model", AVATAR_CONFIG.model);
      form.append("prompt", style.prompt);
      form.append("image[]", new Blob([photo.bytes], { type: photo.mimeType }), `photo.${extension(photo.mimeType)}`);
      if (style.reference) {
        form.append(
          "image[]",
          new Blob([style.reference.bytes], { type: style.reference.mimeType }),
          `style.${extension(style.reference.mimeType)}`,
        );
      }
      form.append("quality", AVATAR_CONFIG.quality);
      form.append("size", options.size ?? AVATAR_CONFIG.size);
      if (options.transparent) form.append("background", "transparent");
      form.append("output_format", "webp");
      form.append("output_compression", String(AVATAR_CONFIG.webpQuality));
      form.append("n", "1");

      const res = await fetchFn(EDIT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: options.signal,
      });

      let body: { data?: { b64_json?: string }[]; error?: { code?: string | null; type?: string } } = {};
      try {
        body = await res.json();
      } catch {
        // handled below
      }
      if (!res.ok) {
        const code = body.error?.code ?? body.error?.type ?? "";
        if (REFUSAL_CODES.has(code)) throw new AvatarGenerationError("refused", `OpenAI refused (${code})`);
        throw new AvatarGenerationError("error", `OpenAI HTTP ${res.status} ${code}`.trim());
      }
      const b64 = body.data?.[0]?.b64_json;
      // No image without an error: treat like a refusal.
      if (!b64) throw new AvatarGenerationError("refused", "OpenAI returned no image");
      return { bytes: base64ToBytes(b64), mimeType: "image/webp" };
    },
  };
}
