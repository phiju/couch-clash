/**
 * GET /api/rooms/:code/voice/:id – a generated line (mp3), only while the
 * room exists. Deleted with the room (and by the 1-day lifecycle rule).
 */
import { isValidRoomCode, normalizeRoomCode } from "@couch-clash/shared";
import type { AvatarStore } from "../avatar/store";
import { CORS_HEADERS } from "../http";
import { voiceKey } from "./service";

export interface VoiceRoomApi {
  info(): Promise<unknown>;
}

export async function handleVoiceGet(
  rawCode: string,
  id: string,
  getRoom: (code: string) => Promise<VoiceRoomApi>,
  store: AvatarStore | null,
): Promise<Response> {
  const notFound = () => new Response("Not found", { status: 404, headers: CORS_HEADERS });
  const code = normalizeRoomCode(rawCode);
  if (!store || !isValidRoomCode(code) || !/^[a-f0-9]{16}$/.test(id)) return notFound();
  if (!(await (await getRoom(code)).info())) return notFound();
  const clip = await store.get(voiceKey(code, id));
  if (!clip) return notFound();
  return new Response(clip.bytes, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=3600",
      ...CORS_HEADERS,
    },
  });
}
