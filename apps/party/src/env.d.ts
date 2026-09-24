interface Env {
  Room: DurableObjectNamespace<import("./room").Room>;
  /** R2 bucket for generated avatars (never original photos). */
  AVATARS?: R2Bucket;
  /** Cloudflare Images – scales avatars down to 256 px. Optional. */
  IMAGES?: ImagesBinding;
  /** Worker secret (dashboard / `wrangler secret put`). Never sent to clients. */
  OPENAI_API_KEY?: string;
  /** Worker secret for the host's voice (ElevenLabs). Never sent to clients. */
  ELEVENLABS_API_KEY?: string;
}

declare namespace Cloudflare {
  // PartyServer's generics default to Cloudflare.Env.
  interface Env {
    Room: DurableObjectNamespace<import("./room").Room>;
    AVATARS?: R2Bucket;
    IMAGES?: ImagesBinding;
    OPENAI_API_KEY?: string;
    ELEVENLABS_API_KEY?: string;
  }
}

declare module "*.webp" {
  const data: ArrayBuffer;
  export default data;
}
