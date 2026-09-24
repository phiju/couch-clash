import { z } from "zod";
import { AvatarSchema } from "./avatar";
import { NAME_MAX_LENGTH, type PublicRoomState } from "./state";

// ---------------------------------------------------------------------------
// Client → server intents. The room validates every one with these schemas.
// ---------------------------------------------------------------------------

const token = z.string().min(16).max(128);
const id = z.string().min(1).max(64);

export const PlayerNameSchema = z
  .string()
  .trim()
  .min(1, "Bitte gib einen Namen ein.")
  .max(NAME_MAX_LENGTH, `Höchstens ${NAME_MAX_LENGTH} Zeichen.`);

export const ClientMessageSchema = z.discriminatedUnion("type", [
  /** Authenticate this connection as the host screen. */
  z.object({ type: z.literal("hello_host"), hostToken: token }),
  /** Re-attach this connection to an existing player (reconnect). */
  z.object({
    type: z.literal("hello_player"),
    playerId: id,
    playerSecret: token,
  }),
  /** Join as a new player (only in lobby). */
  z.object({
    type: z.literal("join"),
    name: PlayerNameSchema,
    avatar: AvatarSchema,
  }),
  /** Host: remove a player. */
  z.object({ type: z.literal("kick"), playerId: id }),
  /** Host: start the game (leaves the lobby). */
  z.object({ type: z.literal("start") }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ---------------------------------------------------------------------------
// Server → client messages.
// ---------------------------------------------------------------------------

export const ERROR_CODES = [
  "ROOM_NOT_FOUND",
  "ROOM_EXPIRED",
  "INVALID_MESSAGE",
  "NOT_AUTHORIZED",
  "UNKNOWN_PLAYER",
  "NAME_TAKEN",
  "INVALID_NAME",
  "GAME_ALREADY_STARTED",
  "ROOM_FULL",
  "ALREADY_JOINED",
  "NOT_ENOUGH_PLAYERS",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  ROOM_NOT_FOUND: "Diesen Raum gibt es nicht (mehr). Prüf den Code nochmal.",
  ROOM_EXPIRED: "Dieser Raum ist abgelaufen. Startet ein neues Spiel.",
  INVALID_MESSAGE: "Das hat nicht geklappt. Versuch es nochmal.",
  NOT_AUTHORIZED: "Dafür fehlt dir die Berechtigung.",
  UNKNOWN_PLAYER: "Du bist nicht mehr in diesem Raum.",
  NAME_TAKEN: "Den Namen gibt es schon. Wähle einen anderen.",
  INVALID_NAME: "Der Name muss 1–20 Zeichen lang sein.",
  GAME_ALREADY_STARTED: "Das Spiel läuft schon. Beitreten geht nur in der Lobby.",
  ROOM_FULL: "Der Raum ist voll.",
  ALREADY_JOINED: "Du bist schon im Spiel.",
  NOT_ENOUGH_PLAYERS: "Es braucht mindestens eine:n Spieler:in.",
};

export type ServerMessage =
  | { type: "state"; state: PublicRoomState }
  | { type: "welcome_host" }
  | { type: "welcome_player"; playerId: string }
  /** Sent once to the joining connection only – contains the reconnect secret. */
  | { type: "joined"; playerId: string; playerSecret: string }
  | { type: "kicked" }
  | { type: "error"; code: ErrorCode; message: string };

export function errorMessage(code: ErrorCode): ServerMessage {
  return { type: "error", code, message: ERROR_MESSAGES[code] };
}

// ---------------------------------------------------------------------------
// HTTP API (room creation / lookup), served by the party worker.
// ---------------------------------------------------------------------------

export interface CreateRoomResponse {
  code: string;
  hostToken: string;
}

export type RoomInfoResponse =
  | { exists: true; code: string; phase: PublicRoomState["phase"]; playerCount: number }
  | { exists: false; code: string };

/** PartyServer party name for the room Durable Object (binding "Room"). */
export const ROOM_PARTY = "room";
