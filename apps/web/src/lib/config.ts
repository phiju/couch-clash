/**
 * Where the party worker lives, from NEXT_PUBLIC_PARTY_HOST:
 *   "localhost:1999", "192.168.1.20:1999"            → http / ws
 *   "couch-clash.xyz.workers.dev"                    → https / wss
 *   "http://…" or "https://…" prefix                 → forces the protocol
 */
const raw = process.env.NEXT_PUBLIC_PARTY_HOST?.trim() || "localhost:1999";

const explicit = raw.match(/^(https?|wss?):\/\//)?.[1];

export const PARTY_HOST = raw.replace(/^(https?|wss?):\/\//, "").replace(/\/+$/, "");

const LOCAL_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;

const secure = explicit ? explicit === "https" || explicit === "wss" : !LOCAL_HOST.test(PARTY_HOST);

export const PARTY_HTTP_URL = `${secure ? "https" : "http"}://${PARTY_HOST}`;
export const PARTY_WS_PROTOCOL = secure ? "wss" : "ws";
