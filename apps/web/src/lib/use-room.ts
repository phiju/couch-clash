"use client";

import {
  ROOM_PARTY,
  type ClientMessage,
  type ErrorCode,
  type PublicRoomState,
  type ServerMessage,
} from "@couch-clash/shared";
import PartySocket from "partysocket";
import { useCallback, useEffect, useRef, useState } from "react";
import { PARTY_HOST, PARTY_WS_PROTOCOL } from "./config";

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
 * Connects to a room. PartySocket reconnects automatically (reload, phone
 * lock, flaky Wi-Fi); on every (re)connect we re-send the hello message so
 * the server re-attaches us to the same host/player.
 */
export function useRoom(code: string, options: Options) {
  const [state, setState] = useState<PublicRoomState | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [fatalError, setFatalError] = useState<ServerMessage & { type: "error" } | null>(null);
  /** serverTime ≈ Date.now() + clockOffset – used for countdowns. */
  const [clockOffset, setClockOffset] = useState(0);
  const socketRef = useRef<PartySocket | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    const socket = new PartySocket({
      host: PARTY_HOST,
      protocol: PARTY_WS_PROTOCOL,
      party: ROOM_PARTY,
      room: code,
    });
    socketRef.current = socket;

    const onOpen = () => {
      setStatus("open");
      const hello = optionsRef.current.hello();
      if (hello) socket.send(JSON.stringify(hello));
    };
    const onClose = () => setStatus(socket.shouldReconnect ? "connecting" : "closed");
    const onMessage = (event: MessageEvent) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "state") {
        setState(msg.state);
        if (typeof msg.serverNow === "number") setClockOffset(msg.serverNow - Date.now());
        return;
      }
      if (msg.type === "error" && FATAL_ERRORS.includes(msg.code)) {
        setFatalError(msg);
        socket.close();
      }
      optionsRef.current.onMessage?.(msg);
    };
    // Phones suspend sockets when locked – reconnect right away when visible again.
    const onVisible = () => {
      if (document.visibilityState === "visible" && socket.readyState !== WebSocket.OPEN) {
        socket.reconnect();
      }
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("close", onClose);
    socket.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("message", onMessage);
      socket.close();
      socketRef.current = null;
    };
  }, [code]);

  const send = useCallback((msg: ClientMessage) => {
    socketRef.current?.send(JSON.stringify(msg));
  }, []);

  return { state, status, fatalError, send, clockOffset };
}
