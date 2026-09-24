import type { CreateRoomResponse, RoomInfoResponse } from "@couch-clash/shared";
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
