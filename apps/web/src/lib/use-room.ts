"use client";

import {
  CONNECTION_CONFIG,
  HEARTBEAT_PING,
  HEARTBEAT_PONG,
  ROOM_PARTY,
  type ClientMessage,
  type ErrorCode,
  type PublicRoomState,
  type ServerMessage,
} from "@couch-clash/shared";
import PartySocket from "partysocket";
import { useCallback, useEffect, useRef, useState } from "react";
import { PARTY_HOST, PARTY_WS_PROTOCOL } from "./config";
import { needsFreshSocket } from "./rejoin";

export type ConnectionStatus = "connecting" | "open" | "closed";

/** Errors after which reconnecting makes no sense. */
const FATAL_ERRORS: ErrorCode[] = ["ROOM_NOT_FOUND", "ROOM_EXPIRED"];

interface Options {
  /** Message sent on every (re)connect to identify this client, or null for guests. */
  hello: () => ClientMessage | null;
  /** Called for every non-state message (errors, joined, kicked, …). */
  onMessage?: (msg: ServerMessage) => void;
}

/**
 * Connects to a room and never gives up (except for a room that is gone):
 * - partysocket reconnects with backoff (at most 5 s between attempts),
 * - on wake-up (visible, online, pageshow, focus) a FRESH socket replaces a
 *   closed one right away – partysocket itself would wait out its backoff,
 * - a heartbeat ("ping" every 15 s, answered by the server) finds sockets
 *   that died silently while the phone slept,
 * - on every (re)connect the hello message re-attaches us to the same
 *   host/player.
 * `stuck`: still not connected after 8 s – the screen offers "Neu verbinden".
 */
export function useRoom(code: string, options: Options) {
  const [state, setState] = useState<PublicRoomState | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [stuck, setStuck] = useState(false);
  const [fatalError, setFatalError] = useState<ServerMessage & { type: "error" } | null>(null);
  /** serverTime ≈ Date.now() + clockOffset – used for countdowns. */
  const [clockOffset, setClockOffset] = useState(0);
  const socketRef = useRef<PartySocket | null>(null);
  const optionsRef = useRef(options);
  const reconnectRef = useRef<() => void>(() => {});

  useEffect(() => {
    optionsRef.current = options;
  });

  // "Verbinde …" for too long → show the "Neu verbinden" button (retrying goes on).
  useEffect(() => {
    if (status !== "connecting") return;
    const t = setTimeout(() => setStuck(true), CONNECTION_CONFIG.stuckHintAfterMs);
    return () => {
      clearTimeout(t);
      setStuck(false);
    };
  }, [status]);

  useEffect(() => {
    let socket: PartySocket;
    let lastMessageAt = Date.now();
    let fatal = false;
    let wakeCheck: ReturnType<typeof setTimeout> | null = null;

    const onOpen = () => {
      lastMessageAt = Date.now();
      setStatus("open");
      const hello = optionsRef.current.hello();
      if (hello) socket.send(JSON.stringify(hello));
      socket.send(HEARTBEAT_PING);
    };
    const onClose = () => setStatus(fatal ? "closed" : "connecting");
    const onMessage = (event: MessageEvent) => {
      lastMessageAt = Date.now();
      const raw = String(event.data);
      if (raw === HEARTBEAT_PONG) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(raw) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "state") {
        setState(msg.state);
        if (typeof msg.serverNow === "number") setClockOffset(msg.serverNow - Date.now());
        return;
      }
      if (msg.type === "error" && FATAL_ERRORS.includes(msg.code)) {
        fatal = true;
        setFatalError(msg);
        socket.close();
      }
      optionsRef.current.onMessage?.(msg);
    };

    const create = () => {
      socket = new PartySocket({
        host: PARTY_HOST,
        protocol: PARTY_WS_PROTOCOL,
        party: ROOM_PARTY,
        room: code,
        maxReconnectionDelay: CONNECTION_CONFIG.maxReconnectDelayMs,
        minReconnectionDelay: CONNECTION_CONFIG.minReconnectDelayMs,
        reconnectionDelayGrowFactor: 1.5,
        connectionTimeout: 4_000,
      });
      socket.addEventListener("open", onOpen);
      socket.addEventListener("close", onClose);
      socket.addEventListener("message", onMessage);
      socketRef.current = socket;
    };
    const dispose = (s: PartySocket) => {
      s.removeEventListener("open", onOpen);
      s.removeEventListener("close", onClose);
      s.removeEventListener("message", onMessage);
      s.close();
    };
    /** Replaces the socket right now (no backoff wait). */
    const fresh = () => {
      if (fatal) return;
      dispose(socket);
      lastMessageAt = Date.now();
      setStatus("connecting");
      create();
    };
    reconnectRef.current = fresh;
    create();

    const open = () => socket.readyState === WebSocket.OPEN;
    /** Ping; no answer within `pongTimeoutMs` → the socket died silently (e.g. WLAN ↔ mobile switch). */
    const probe = () => {
      const sentAt = Date.now();
      const probed = socket;
      socket.send(HEARTBEAT_PING);
      if (wakeCheck) clearTimeout(wakeCheck);
      wakeCheck = setTimeout(() => {
        if (socket === probed && open() && lastMessageAt < sentAt) fresh();
      }, CONNECTION_CONFIG.pongTimeoutMs);
    };
    // The phone is back: a closed socket is replaced at once; an "open" one must prove it is alive.
    const onWake = () => {
      if (document.visibilityState === "hidden" || fatal) return;
      if (needsFreshSocket({ open: open(), lastMessageAt, now: Date.now() })) return fresh();
      probe();
    };
    const heartbeat = setInterval(() => {
      if (fatal || !open()) return;
      if (Date.now() - lastMessageAt > CONNECTION_CONFIG.clientDeadAfterMs) return fresh();
      probe();
    }, CONNECTION_CONFIG.heartbeatMs);

    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    window.addEventListener("pageshow", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      clearInterval(heartbeat);
      if (wakeCheck) clearTimeout(wakeCheck);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      window.removeEventListener("pageshow", onWake);
      window.removeEventListener("focus", onWake);
      dispose(socket);
      socketRef.current = null;
      reconnectRef.current = () => {};
    };
  }, [code]);

  const send = useCallback((msg: ClientMessage) => {
    socketRef.current?.send(JSON.stringify(msg));
  }, []);
  /** "Neu verbinden": a fresh socket right now. */
  const reconnect = useCallback(() => reconnectRef.current(), []);

  return { state, status, stuck, fatalError, send, reconnect, clockOffset };
}
