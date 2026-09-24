import {
  ERROR_MESSAGES,
  savedAvatarPath,
  type CreateRoomResponse,
  type PhotoUploadResponse,
  type RoomInfoResponse,
} from "@couch-clash/shared";
import { PARTY_HTTP_URL } from "./config";

export async function createRoom(): Promise<CreateRoomResponse> {
  const res = await fetch(`${PARTY_HTTP_URL}/api/rooms`, { method: "POST" });
  if (!res.ok) throw new Error(`Raum konnte nicht erstellt werden (${res.status})`);
  return (await res.json()) as CreateRoomResponse;
}

export async function getRoomInfo(code: string): Promise<RoomInfoResponse> {
  const res = await fetch(`${PARTY_HTTP_URL}/api/rooms/${encodeURIComponent(code)}`);
  if (!res.ok) throw new Error(`Server nicht erreichbar (${res.status})`);
  return (await res.json()) as RoomInfoResponse;
}

/**
 * Sends the prepared photo to the party server (only after "Verwandeln!").
 * Never throws: network errors come back as `{ ok: false }` with a German message.
 */
export async function uploadPhoto(
  code: string,
  creds: { playerId: string; playerSecret: string },
  photo: Blob,
): Promise<PhotoUploadResponse> {
  const form = new FormData();
  form.append("playerId", creds.playerId);
  form.append("playerSecret", creds.playerSecret);
  form.append("photo", photo, "photo.jpg");
  try {
    const res = await fetch(`${PARTY_HTTP_URL}/api/rooms/${encodeURIComponent(code)}/avatar`, {
      method: "POST",
      body: form,
    });
    return (await res.json()) as PhotoUploadResponse;
  } catch {
    return { ok: false, code: "PHOTO_UNAVAILABLE", error: ERROR_MESSAGES.PHOTO_UNAVAILABLE };
  }
}

/** Preview of the saved figure ("⭐ Meine Figur"). */
export function savedFigureUrl(savedId: string): string {
  return `${PARTY_HTTP_URL}${savedAvatarPath(savedId)}`;
}

/** "Figur löschen": removes the saved figure from the server. */
export async function deleteSavedFigure(savedId: string): Promise<boolean> {
  try {
    const res = await fetch(`${PARTY_HTTP_URL}/api/avatars/saved/${savedId}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}
