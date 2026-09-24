import {
  generateRoomCode,
  generateSecret,
  isValidRoomCode,
  normalizeRoomCode,
  type CreateRoomResponse,
  type RoomInfoResponse,
} from "@couch-clash/shared";
import { getServerByName, routePartykitRequest } from "partyserver";
import {
  handleAvatarGet,
  handleAvatarUpload,
  handleSavedAvatarDelete,
  handleSavedAvatarGet,
} from "./avatar/routes";
import { r2AvatarStore } from "./avatar/store";
import { CORS_HEADERS, json } from "./http";
import type { Room } from "./room";

export { Room } from "./room";

const MAX_CODE_ATTEMPTS = 20;

async function roomStub(env: Env, code: string) {
  return getServerByName<Env, Room>(env.Room, code);
}

async function createRoom(env: Env): Promise<Response> {
  const hostToken = generateSecret();
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateRoomCode();
    const stub = await roomStub(env, code);
    if (await stub.initialize(code, hostToken)) {
      return json({ code, hostToken } satisfies CreateRoomResponse, 201);
    }
    // Collision with an active room → try another code.
  }
  return json({ error: "Kein freier Raumcode gefunden. Bitte nochmal versuchen." }, 503);
}

async function roomInfo(env: Env, rawCode: string): Promise<Response> {
  const code = normalizeRoomCode(rawCode);
  if (!isValidRoomCode(code)) {
    return json({ exists: false, code } satisfies RoomInfoResponse);
  }
  const info = await (await roomStub(env, code)).info();
  const body: RoomInfoResponse = info ? { exists: true, code, ...info } : { exists: false, code };
  return json(body);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
      if (url.pathname === "/api/rooms" && request.method === "POST") return createRoom(env);
      const match = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
      if (match && request.method === "GET") return roomInfo(env, decodeURIComponent(match[1]!));
      const getRoom = (code: string) => roomStub(env, code);
      const upload = url.pathname.match(/^\/api\/rooms\/([^/]+)\/avatar$/);
      if (upload && request.method === "POST") return handleAvatarUpload(request, decodeURIComponent(upload[1]!), getRoom);
      const image = url.pathname.match(/^\/api\/rooms\/([^/]+)\/avatar\/([^/]+)\/([^/]+)$/);
      if (image && request.method === "GET") {
        const [, code, playerId, expression] = image.map((part) => decodeURIComponent(part));
        const store = env.AVATARS ? r2AvatarStore(env.AVATARS) : null;
        return handleAvatarGet(code!, playerId!, expression!, getRoom, store);
      }
      const saved = url.pathname.match(/^\/api\/avatars\/saved\/([^/]+)(?:\/([^/]+))?$/);
      if (saved) {
        const store = env.AVATARS ? r2AvatarStore(env.AVATARS) : null;
        const [, savedId, expression] = saved;
        if (request.method === "GET" && expression) return handleSavedAvatarGet(savedId!, expression, store);
        if (request.method === "DELETE" && !expression) return handleSavedAvatarDelete(savedId!, store);
      }
      return json({ error: "Not found" }, 404);
    }

    if (url.pathname === "/") return new Response("Couch Clash party server 🎉");

    // WebSocket connections: /parties/room/<CODE>
    const response = await routePartykitRequest(request, env, {
      onBeforeConnect: (_req, lobby) => {
        if (!isValidRoomCode(lobby.name)) {
          return new Response("Invalid room code", { status: 404 });
        }
      },
      onBeforeRequest: () => new Response("Not found", { status: 404 }),
    });
    return response ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
