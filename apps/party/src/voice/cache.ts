/**
 * Global voice cache in R2: audio whose text is the same in every room
 * (library lines, name clips, read-outs) is generated once and reused –
 * free after the first time. Keys are content hashes:
 *   voice-cache/<voiceId>/<kind>/<sha256>.mp3
 * The R2 lifecycle rule only covers rooms/, so the cache stays.
 */
import { CORS_HEADERS } from "../http";
import type { AvatarStore } from "../avatar/store";
import { ELEVENLABS_MODELS, ELEVENLABS_VOICE_ID, VOICE_CONFIG, VOICE_PROVIDER } from "./config";
import type { SpeechStyle } from "./provider";

export const VOICE_CACHE_KINDS = ["snark", "names", "read"] as const;
export type VoiceCacheKind = (typeof VOICE_CACHE_KINDS)[number];

/** Whose voice the cached audio is (a new voice gets a fresh cache). */
export function cacheVoiceId(provider: typeof VOICE_PROVIDER = VOICE_PROVIDER): string {
  return provider === "elevenlabs" ? ELEVENLABS_VOICE_ID : `openai-${VOICE_CONFIG.openaiVoice}`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Same text, voice, model and speed → same key. */
export async function voiceCacheKey(
  kind: VoiceCacheKind,
  text: string,
  style: SpeechStyle,
  speed: number,
  model: string = ELEVENLABS_MODELS[style],
): Promise<string> {
  const hash = await sha256Hex([model, style, speed.toFixed(2), text].join("|"));
  return `voice-cache/${cacheVoiceId()}/${kind}/${hash}.mp3`;
}

/** Where the host screen fetches a cached clip (prefix with the party worker's HTTP URL). */
export function voiceCachePath(key: string): string {
  return `/api/${key}`;
}

const CACHE_PATH = /^\/api\/(voice-cache\/[A-Za-z0-9_-]{1,40}\/(?:snark|names|read)\/[a-f0-9]{64}\.mp3)$/;

/** GET /api/voice-cache/… – cached clips never change (content-addressed). */
export async function handleVoiceCacheGet(pathname: string, store: AvatarStore | null): Promise<Response | null> {
  const match = pathname.match(CACHE_PATH);
  if (!match) return null;
  const clip = store ? await store.get(match[1]!) : null;
  if (!clip) return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  return new Response(clip.bytes, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=31536000, immutable", ...CORS_HEADERS },
  });
}
