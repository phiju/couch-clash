import {
  ClientMessageSchema,
  errorMessage,
  generateSecret,
  type HostLine,
  type Avatar,
  type PhotoExpression,
  type PhotoUploadResponse,
  type ServerMessage,
  type Viewer,
} from "@couch-clash/shared";
import { createAvatarProvider } from "./avatar";
import {
  acceptPhotoAndGenerate,
  savePlayerPhoto,
  startPhotoUpload,
  useSavedPhoto,
  type RoomAccess,
} from "./avatar/jobs";
import { expireStalePhotos, nextPhotoDeadline, resetPhoto, setPhotoAvatars } from "./avatar/photo-logic";
import type { AvatarImage } from "./avatar/provider";
import type { AvatarRoomApi } from "./avatar/routes";
import { imagesResizer, type AvatarServiceDeps } from "./avatar/service";
import { playerPrefix, r2AvatarStore, roomPrefix } from "./avatar/store";
import { styleReference } from "./avatar/style";
import { createVoiceProviders } from "./voice";
import { VoiceDirector } from "./voice/director";
import { Server, type Connection, type WSMessage } from "partyserver";
import {
  advance,
  backToLobby,
  beginGame,
  handlePlayerAction,
  handlePresenceChange,
  isTimerDue,
  playAgain,
  updateSettings,
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
  toPublicState,
  updateVoiceSettings,
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
export class Room extends Server<Env> implements AvatarRoomApi {
  static options = { hibernate: true };

  private room: RoomRecord | null = null;

  async onStart() {
    const stored = await this.ctx.storage.get<RoomRecord>(STORAGE_KEY);
    this.room = stored ? normalizeRoomRecord(stored) : null;
  }

  /** The host mascot's voice (lines are sent to host screens only). */
  private readonly voice = new VoiceDirector({
    read: () => this.activeRoom(),
    commit: (room) => this.commit(room),
    sendToHosts: (line) => this.sendToHosts(line),
    hostConnected: () => this.presence().host,
    waitUntil: (promise) => this.ctx.waitUntil(promise),
    services: () => {
      const providers = createVoiceProviders(this.env);
      return { text: providers?.text ?? null, speech: providers?.speech ?? null, store: this.avatarStore() };
    },
    now: () => Date.now(),
    random: Math.random,
    newId: () => generateSecret(8),
  });

  /** Read/commit access for background avatar jobs. */
  private readonly roomAccess: RoomAccess = {
    read: () => this.activeRoom(),
    commit: (room) => this.commit(room),
  };

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

  /**
   * Photo upload (validated by the worker). Marks the avatar as pending and
   * generates it in the background; clients learn the result via the state.
   * The photo is only kept in memory until the generation finished.
   */
  async uploadPhoto(playerId: string, playerSecret: string, photo: AvatarImage): Promise<PhotoUploadResponse> {
    const { response, job } = await startPhotoUpload(
      this.roomAccess,
      this.avatarDeps(),
      { playerId, playerSecret, photo },
      Date.now(),
    );
    if (job) this.ctx.waitUntil(job);
    return response;
  }

  async hasPhoto(playerId: string, expression: PhotoExpression): Promise<boolean> {
    const photo = this.activeRoom()?.players.find((p) => p.id === playerId)?.photo;
    return !!photo && photo.readyVersion !== null && photo.expressions.includes(expression);
  }

  // -------------------------------------------------------------------------
  // Alarms: game timers (phaseEndsAt) and room expiry
  // -------------------------------------------------------------------------

  async onAlarm() {
    let room = this.room;
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
    // Avatar jobs that never reported back (e.g. the object was evicted) → failed.
    const expired = expireStalePhotos(room, now);
    if (expired) {
      room = expired;
      await this.save(room);
      this.broadcastState();
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
        return this.join(conn, room, msg.name, msg.avatar, msg.savedFigureId);
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
        this.deleteAvatars(playerPrefix(room.code, msg.playerId));
        return this.commit(handlePresenceChange(kicked, this.flowDeps(now)) ?? kicked);
      }

      case "set_photo_avatars":
        if (!isHost) return this.send(conn, errorMessage("NOT_AUTHORIZED"));
        return this.apply(conn, setPhotoAvatars(room, msg.enabled));

      case "photo_accept": {
        const state = conn.state;
        if (state?.role !== "player") return this.send(conn, errorMessage("NOT_AUTHORIZED"));
        const result = await acceptPhotoAndGenerate(this.roomAccess, this.avatarDeps(), state.playerId, now);
        if (!result.ok) return this.send(conn, errorMessage(result.error));
        if (result.value) this.ctx.waitUntil(result.value);
        return;
      }

      case "update_voice_settings":
        if (!isHost) return this.send(conn, errorMessage("NOT_AUTHORIZED"));
        return this.apply(conn, updateVoiceSettings(room, msg.settings));

      case "voice_event":
        if (!isHost) return this.send(conn, errorMessage("NOT_AUTHORIZED"));
        this.voice.hostEvent(msg.lineId, msg.event, msg.endsAt);
        return;

      case "photo_save": {
        const state = conn.state;
        if (state?.role !== "player") return this.send(conn, errorMessage("NOT_AUTHORIZED"));
        const result = await savePlayerPhoto(this.roomAccess, this.avatarStore(), state.playerId, now);
        if (!result.ok) return this.send(conn, errorMessage(result.error));
        // The id goes to this connection only – it is the key to the saved figure.
        return this.send(conn, { type: "photo_saved", savedId: result.value });
      }

      case "photo_use_saved": {
        const state = conn.state;
        if (state?.role !== "player") return this.send(conn, errorMessage("NOT_AUTHORIZED"));
        const result = await useSavedPhoto(this.roomAccess, this.avatarStore(), state.playerId, msg.savedId, now);
        if (!result.ok) return this.send(conn, errorMessage(result.error));
        return;
      }

      case "photo_reset": {
        const state = conn.state;
        // The host resets anyone; a player only themselves.
        const target = isHost ? msg.playerId : state?.role === "player" ? state.playerId : undefined;
        if (!target || (!isHost && msg.playerId && msg.playerId !== target)) {
          return this.send(conn, errorMessage("NOT_AUTHORIZED"));
        }
        const result = resetPhoto(room, target);
        if (!result.ok) return this.send(conn, errorMessage(result.error));
        if (result.value !== room) this.deleteAvatars(playerPrefix(room.code, target));
        return this.commit(result.value);
      }

      case "back_to_lobby":
        if (!isHost) return this.send(conn, errorMessage("NOT_AUTHORIZED"));
        return this.apply(conn, backToLobby(room, now));

      case "update_settings":
        if (!isHost) return this.send(conn, errorMessage("NOT_AUTHORIZED"));
        return this.apply(conn, updateSettings(room, msg.rounds));

      case "start_game":
        if (!isHost) return this.send(conn, errorMessage("NOT_AUTHORIZED"));
        return this.apply(conn, beginGame(room, this.flowDeps(now)));

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

  private async join(conn: Conn, room: RoomRecord, name: string, avatar: Avatar, savedFigureId?: string) {
    const result = joinPlayer(room, { name, avatar }, { now: Date.now() });
    if (!result.ok) return this.send(conn, errorMessage(result.error));
    const { room: next, player } = result.value;
    conn.setState({ role: "player", playerId: player.id });
    this.send(conn, { type: "joined", playerId: player.id, playerSecret: player.secret });
    await this.commit(next);
    this.voice.playerJoined(player.id);
    // Joined with the emoji first; the saved figure replaces it a moment later.
    if (savedFigureId) {
      const used = await useSavedPhoto(this.roomAccess, this.avatarStore(), player.id, savedFigureId, Date.now());
      if (!used.ok) this.send(conn, errorMessage(used.error));
    }
  }

  private async apply(conn: Conn, result: Result<RoomRecord>) {
    if (!result.ok) return this.send(conn, errorMessage(result.error));
    await this.commit(result.value);
  }

  /** Save, re-arm the alarm and send everyone their view. */
  private async commit(room: RoomRecord) {
    const prev = this.room;
    await this.save(room);
    await this.scheduleAlarm(room);
    this.broadcastState();
    // The host may have something to say about it (welcome, commentary, …).
    this.voice.roomChanged(prev, room);
  }

  /** Host lines never go to phones. */
  private sendToHosts(line: HostLine): boolean {
    let sent = false;
    for (const conn of this.getConnections<ConnState>()) {
      if (conn.state?.role !== "host") continue;
      this.send(conn, { type: "host_line", line });
      sent = true;
    }
    return sent;
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
    const candidates = [room.expiresAt, room.phaseEndsAt, nextPhotoDeadline(room)];
    const next = Math.min(...candidates.filter((t): t is number => t !== null));
    await this.ctx.storage.setAlarm(next);
  }

  private async destroy() {
    const code = this.room?.code;
    this.room = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    // Generated avatars live 24 h at most (plus the bucket's 1-day lifecycle rule).
    if (code) await this.deleteAvatarsNow(roomPrefix(code));
  }

  private avatarStore() {
    return this.env.AVATARS ? r2AvatarStore(this.env.AVATARS) : null;
  }

  /** Null when photo avatars are not set up (no API key or no R2 bucket). */
  private avatarDeps(): AvatarServiceDeps | null {
    const provider = createAvatarProvider(this.env);
    if (!provider || !this.env.AVATARS) return null;
    return {
      provider,
      store: r2AvatarStore(this.env.AVATARS),
      styleReference,
      resize: this.env.IMAGES ? imagesResizer(this.env.IMAGES) : undefined,
    };
  }

  private async deleteAvatarsNow(prefix: string) {
    if (!this.env.AVATARS) return;
    try {
      await r2AvatarStore(this.env.AVATARS).deletePrefix(prefix);
    } catch {
      console.warn("avatar cleanup failed (the bucket lifecycle rule will remove them)");
    }
  }

  private deleteAvatars(prefix: string) {
    this.ctx.waitUntil(this.deleteAvatarsNow(prefix));
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
