/**
 * Connection robustness: heartbeat, grace period, rejoining. Shared by the
 * party worker and the web app so both sides agree on the timings.
 */
export const CONNECTION_CONFIG = {
  /** Client sends the raw text "ping" this often; the server answers "pong" (auto-response, no wake-up). */
  heartbeatMs: 15_000,
  /** No "pong" (or any message) this long after a ping → the socket is dead, the client reconnects. */
  pongTimeoutMs: 5_000,
  /** No message from the server for this long while "open" → the client drops the socket and reconnects. */
  clientDeadAfterMs: 35_000,
  /** A player socket without a ping for this long counts as dead (half-open phone socket). */
  serverStaleAfterMs: 45_000,
  /**
   * A player counts as disconnected only after this long without a connection –
   * short network blips never end a question early or change anything.
   */
  graceMs: 20_000,
  /** Reconnect backoff (partysocket): never wait longer than this. */
  maxReconnectDelayMs: 5_000,
  minReconnectDelayMs: 500,
  /** Phone: after this long on "Verbinde …" show a "Neu verbinden" button. */
  stuckHintAfterMs: 8_000,
  /** Fallback cookie for the player credentials (in-app browsers that drop localStorage). */
  credsCookieMaxAgeSec: 24 * 60 * 60,
} as const;

export const HEARTBEAT_PING = "ping";
export const HEARTBEAT_PONG = "pong";

/** Something the host screen shows as a short toast. */
export interface RoomNotice {
  kind: "rejoined" | "late_join";
  playerId: string;
  name: string;
}
