import {
  ClientMessageSchema,
  errorMessage,
  type Avatar,
  type ServerMessage,
  type Viewer,
} from "@couch-clash/shared";
import { Server, type Connection, type WSMessage } from "partyserver";
import {
  advance,
  backToLobby,
  beginGame,
  handlePlayerAction,
  handlePresenceChange,
  isTimerDue,
  playAgain,
  type FlowDeps,
} from "./game-flow";
import type { Result } from "./result";
import {
  authenticateHost,
  authenticatePlayer,
  createRoomRecord,
  isExpired,
  joinPlayer,
  kickPlayer,
  normalizeRoomRecord,
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
 * updates its state and sends every client the state *it* may see.
 * All timers are Durable Object alarms at `phaseEndsAt`.
 */
export class Room extends Server<Env> {
  static options = { hibernate: true };

  private room: RoomRecord | null = null;

  async onStart() {
    const stored = await this.ctx.storage.get<RoomRecord>(STORAGE_KEY);
    this.room = stored ? normalizeRoomRecord(stored) : null;
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
    await this.scheduleAlarm(room);
    return true;
  }

  async info(): Promise<{ phase: RoomRecord["phase"]; playerCount: number } | null> {
    const room = this.activeRoom();
    if (!room) return null;
    return { phase: room.phase, playerCount: room.players.length };
  }

  // -------------------------------------------------------------------------
  // Alarms: game timers (phaseEndsAt) and room expiry
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
    if (isTimerDue(room, now)) {
      const result = advance(room, this.flowDeps(now));
      if (result.ok) {
        await this.commit(result.value);
        return;
      }
      // Should not happen – never re-arm a past timer (would loop); keep only the expiry.
      await this.ctx.storage.setAlarm(room.expiresAt);
      return;
    }
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
    this.sendState(conn, room);
  }

  async onClose(conn: Conn) {
    const state = conn.state;
    // Only presence changes are interesting for the others.
    if (!state || state.role === "guest") return;
    await this.presenceChanged(conn.id);
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
    const now = Date.now();
    const isHost = conn.state?.role === "host";

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
        if (!isHost) return this.send(conn, errorMessage("NOT_AUTHORIZED"));
        const result = kickPlayer(room, msg.playerId);
        if (!result.ok) return this.send(conn, errorMessage(result.error));
        for (const c of this.getConnections<ConnState>()) {
          const s = c.state;
          if (s?.role === "player" && s.playerId === msg.playerId) {
            this.send(c, { type: "kicked" });
            c.setState({ role: "guest" });
            c.close(4001, "Kicked");
          }
        }
        // A removed player may have been the last one we were waiting for.
        const kicked = result.value;
        return this.commit(handlePresenceChange(kicked, this.flowDeps(now)) ?? kicked);
      }

      case "start":
        if (!isHost) return this.send(conn, errorMessage("NOT_AUTHORIZED"));
        return this.apply(conn, startGame(room, now));

      case "back_to_lobby":
        if (!isHost) return this.send(conn, errorMessage("NOT_AUTHORIZED"));
        return this.apply(conn, backToLobby(room, now));

      case "start_game":
        if (!isHost) return this.send(conn, errorMessage("NOT_AUTHORIZED"));
        return this.apply(conn, beginGame(room, msg.rounds, this.flowDeps(now)));

      case "skip":
        if (!isHost) return this.send(conn, errorMessage("NOT_AUTHORIZED"));
        return this.apply(conn, advance(room, this.flowDeps(now)));

      case "play_again":
        if (!isHost) return this.send(conn, errorMessage("NOT_AUTHORIZED"));
        return this.apply(conn, playAgain(room, now));

      case "action": {
        const state = conn.state;
        if (state?.role !== "player") return this.send(conn, errorMessage("NOT_AUTHORIZED"));
        return this.apply(conn, handlePlayerAction(room, state.playerId, msg.action, this.flowDeps(now)));
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
    conn.setState({ role: "player", playerId: player.id });
    this.send(conn, { type: "joined", playerId: player.id, playerSecret: player.secret });
    await this.commit(next);
  }

  private async apply(conn: Conn, result: Result<RoomRecord>) {
    if (!result.ok) return this.send(conn, errorMessage(result.error));
    await this.commit(result.value);
  }

  /** Save, re-arm the alarm and send everyone their view. */
  private async commit(room: RoomRecord) {
    await this.save(room);
    await this.scheduleAlarm(room);
    this.broadcastState();
  }

  private async presenceChanged(closingConnId?: string) {
    const room = this.activeRoom();
    if (!room) return;
    const deps = this.flowDeps(Date.now(), closingConnId);
    const next = handlePresenceChange(room, deps);
    if (next) {
      await this.save(next);
      await this.scheduleAlarm(next);
    }
    this.broadcastState(closingConnId);
  }

  private flowDeps(now: number, excludeConnId?: string): FlowDeps {
    return {
      now,
      random: Math.random,
      connectedPlayerIds: this.presence(excludeConnId).playerIds,
    };
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
  private presence(excludeConnId?: string) {
    let host = false;
    const playerIds = new Set<string>();
    for (const c of this.getConnections<ConnState>()) {
      if (c.id === excludeConnId) continue;
      const s = c.state;
      if (s?.role === "host") host = true;
      else if (s?.role === "player") playerIds.add(s.playerId);
    }
    return { host, playerIds };
  }

  private viewerOf(conn: Conn): Viewer {
    const s = conn.state;
    if (s?.role === "host") return { role: "host" };
    if (s?.role === "player") return { role: "player", playerId: s.playerId };
    return { role: "guest" };
  }

  private sendState(conn: Conn, room: RoomRecord) {
    const state = toPublicState(room, this.presence(), this.viewerOf(conn));
    this.send(conn, { type: "state", state, serverNow: Date.now() });
  }

  /** Sends every connection the state for its own viewer role (cached per viewer). */
  private broadcastState(excludeConnId?: string) {
    const room = this.activeRoom();
    if (!room) return;
    const presence = this.presence(excludeConnId);
    const serverNow = Date.now();
    const cache = new Map<string, string>();
    for (const conn of this.getConnections<ConnState>()) {
      if (conn.id === excludeConnId) continue;
      const viewer = this.viewerOf(conn);
      const key = viewer.role === "player" ? `p:${viewer.playerId}` : viewer.role;
      let payload = cache.get(key);
      if (!payload) {
        const msg: ServerMessage = {
          type: "state",
          state: toPublicState(room, presence, viewer),
          serverNow,
        };
        payload = JSON.stringify(msg);
        cache.set(key, payload);
      }
      conn.send(payload);
    }
  }

  private send(conn: Conn, msg: ServerMessage) {
    conn.send(JSON.stringify(msg));
  }
}
