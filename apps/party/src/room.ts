import {
  ClientMessageSchema,
  errorMessage,
  type Avatar,
  type ErrorCode,
  type ServerMessage,
} from "@couch-clash/shared";
import { Server, type Connection, type WSMessage } from "partyserver";
import {
  authenticateHost,
  authenticatePlayer,
  createRoomRecord,
  isExpired,
  joinPlayer,
  kickPlayer,
  startGame,
  toPublicState,
  type RoomRecord,
} from "./room-logic";

const STORAGE_KEY = "room";

/** Per-connection identity; persisted in the WebSocket attachment (survives hibernation). */
type ConnState = { role: "guest" } | { role: "host" } | { role: "player"; playerId: string };

type Conn = Connection<ConnState>;

/**
 * One Durable Object instance = one room = one game.
 * The room is authoritative: clients send intents, the room validates them,
 * updates its state and broadcasts the public state to everyone.
 */
export class Room extends Server<Env> {
  static options = { hibernate: true };

  private room: RoomRecord | null = null;

  async onStart() {
    this.room = (await this.ctx.storage.get<RoomRecord>(STORAGE_KEY)) ?? null;
  }

  // -------------------------------------------------------------------------
  // RPC, called by the worker's HTTP API
  // -------------------------------------------------------------------------

  /** Initializes a fresh room. Returns false if the code is already taken. */
  async initialize(code: string, hostToken: string): Promise<boolean> {
    const now = Date.now();
    if (this.room && !isExpired(this.room, now)) return false;
    if (this.room) await this.destroy();
    const room = createRoomRecord(code, hostToken, now);
    await this.save(room);
    await this.ctx.storage.setAlarm(room.expiresAt);
    return true;
  }

  async info(): Promise<{ phase: RoomRecord["phase"]; playerCount: number } | null> {
    const room = this.activeRoom();
    if (!room) return null;
    return { phase: room.phase, playerCount: room.players.length };
  }

  // -------------------------------------------------------------------------
  // Alarms: room expiry (and later: phaseEndsAt timers)
  // -------------------------------------------------------------------------

  async onAlarm() {
    const room = this.room;
    if (!room) return;
    const now = Date.now();
    if (isExpired(room, now)) {
      for (const conn of this.getConnections<ConnState>()) {
        this.send(conn, errorMessage("ROOM_EXPIRED"));
        conn.close(4000, "Room expired");
      }
      await this.destroy();
      return;
    }
    // Future: if (room.phaseEndsAt && now >= room.phaseEndsAt) → module.onTimer
    await this.scheduleAlarm(room);
  }

  // -------------------------------------------------------------------------
  // WebSocket lifecycle
  // -------------------------------------------------------------------------

  onConnect(conn: Conn) {
    conn.setState({ role: "guest" });
    const room = this.activeRoom();
    if (!room) {
      this.send(conn, errorMessage(this.room ? "ROOM_EXPIRED" : "ROOM_NOT_FOUND"));
      conn.close(4004, "Room not found");
      return;
    }
    this.send(conn, { type: "state", state: this.publicState(room) });
  }

  onClose(conn: Conn) {
    const state = conn.state;
    // Only presence changes are interesting for the others.
    if (state && state.role !== "guest") this.broadcastState(conn.id);
  }

  async onMessage(conn: Conn, raw: WSMessage) {
    const room = this.activeRoom();
    if (!room) {
      this.send(conn, errorMessage(this.room ? "ROOM_EXPIRED" : "ROOM_NOT_FOUND"));
      conn.close(4004, "Room not found");
      return;
    }

    let data: unknown;
    try {
      data = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.send(conn, errorMessage("INVALID_MESSAGE"));
    }
    const parsed = ClientMessageSchema.safeParse(data);
    if (!parsed.success) {
      const isJoin = (data as { type?: unknown } | null)?.type === "join";
      return this.send(conn, errorMessage(isJoin ? "INVALID_NAME" : "INVALID_MESSAGE"));
    }
    const msg = parsed.data;

    switch (msg.type) {
      case "hello_host": {
        if (!authenticateHost(room, msg.hostToken)) {
          return this.send(conn, errorMessage("NOT_AUTHORIZED"));
        }
        conn.setState({ role: "host" });
        this.send(conn, { type: "welcome_host" });
        return this.broadcastState();
      }

      case "hello_player": {
        const result = authenticatePlayer(room, msg.playerId, msg.playerSecret);
        if (!result.ok) return this.send(conn, errorMessage(result.error));
        conn.setState({ role: "player", playerId: result.value.id });
        this.send(conn, { type: "welcome_player", playerId: result.value.id });
        return this.broadcastState();
      }

      case "join": {
        if (conn.state?.role === "player") {
          return this.send(conn, errorMessage("ALREADY_JOINED"));
        }
        return this.join(conn, room, msg.name, msg.avatar);
      }

      case "kick": {
        if (conn.state?.role !== "host") return this.send(conn, errorMessage("NOT_AUTHORIZED"));
        const result = kickPlayer(room, msg.playerId);
        if (!result.ok) return this.send(conn, errorMessage(result.error));
        await this.save(result.value);
        for (const c of this.getConnections<ConnState>()) {
          const s = c.state;
          if (s?.role === "player" && s.playerId === msg.playerId) {
            this.send(c, { type: "kicked" });
            c.setState({ role: "guest" });
            c.close(4001, "Kicked");
          }
        }
        return this.broadcastState();
      }

      case "start": {
        if (conn.state?.role !== "host") return this.send(conn, errorMessage("NOT_AUTHORIZED"));
        return this.apply(conn, startGame(room, Date.now()));
      }
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async join(conn: Conn, room: RoomRecord, name: string, avatar: Avatar) {
    const result = joinPlayer(room, { name, avatar }, { now: Date.now() });
    if (!result.ok) return this.send(conn, errorMessage(result.error));
    const { room: next, player } = result.value;
    await this.save(next);
    conn.setState({ role: "player", playerId: player.id });
    this.send(conn, { type: "joined", playerId: player.id, playerSecret: player.secret });
    this.broadcastState();
  }

  private async apply(
    conn: Conn,
    result: { ok: true; value: RoomRecord } | { ok: false; error: ErrorCode },
  ) {
    if (!result.ok) return this.send(conn, errorMessage(result.error));
    await this.save(result.value);
    this.broadcastState();
  }

  private activeRoom(): RoomRecord | null {
    if (!this.room || isExpired(this.room, Date.now())) return null;
    return this.room;
  }

  private async save(room: RoomRecord) {
    this.room = room;
    await this.ctx.storage.put(STORAGE_KEY, room);
  }

  private async scheduleAlarm(room: RoomRecord) {
    const next = room.phaseEndsAt ? Math.min(room.phaseEndsAt, room.expiresAt) : room.expiresAt;
    await this.ctx.storage.setAlarm(next);
  }

  private async destroy() {
    this.room = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  /** `excludeConnId`: a connection that is closing but may still be listed. */
  private publicState(room: RoomRecord, excludeConnId?: string) {
    let host = false;
    const playerIds = new Set<string>();
    for (const c of this.getConnections<ConnState>()) {
      if (c.id === excludeConnId) continue;
      const s = c.state;
      if (s?.role === "host") host = true;
      else if (s?.role === "player") playerIds.add(s.playerId);
    }
    return toPublicState(room, { host, playerIds });
  }

  private broadcastState(excludeConnId?: string) {
    const room = this.activeRoom();
    if (!room) return;
    const msg: ServerMessage = { type: "state", state: this.publicState(room, excludeConnId) };
    this.broadcast(JSON.stringify(msg), excludeConnId ? [excludeConnId] : undefined);
  }

  private send(conn: Conn, msg: ServerMessage) {
    conn.send(JSON.stringify(msg));
  }
}
