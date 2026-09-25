import { CONNECTION_CONFIG, type PublicPlayer } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { claimOptions, needsFreshSocket, noticeText, showJoinChip } from "../src/lib/rejoin";
import { credentialsCookie, credentialsFromCookie, parseCredentials } from "../src/lib/storage";

const creds = { playerId: "a1b2c3d4e5f6", playerSecret: "0123456789abcdef0123456789abcdef" };

describe("credentials fallback cookie", () => {
  it("per room, SameSite=Lax, 24 h, Secure on https – and readable again", () => {
    const cookie = credentialsCookie("AB12", creds, true);
    expect(cookie).toBe(`cc_player_AB12=${creds.playerId}.${creds.playerSecret}; Path=/; Max-Age=${24 * 60 * 60}; SameSite=Lax; Secure`);
    const jar = `other=1; ${cookie.split(";")[0]}; x=y`;
    expect(credentialsFromCookie("AB12", jar)).toEqual(creds);
    expect(credentialsFromCookie("ZZ99", jar)).toBeNull();
  });

  it("clearing expires it; broken or hand-edited values are ignored", () => {
    expect(credentialsCookie("AB12", null, false)).toBe("cc_player_AB12=; Path=/; Max-Age=0; SameSite=Lax");
    expect(credentialsFromCookie("AB12", "cc_player_AB12=")).toBeNull();
    expect(credentialsFromCookie("AB12", "cc_player_AB12=%E0%A4%A")).toBeNull();
    expect(credentialsFromCookie("AB12", "cc_player_AB12=id.short")).toBeNull();
    expect(parseCredentials({ playerId: "x y", playerSecret: creds.playerSecret })).toBeNull();
    expect(parseCredentials("nope")).toBeNull();
    expect(parseCredentials(creds)).toEqual(creds);
  });
});

describe("reconnecting", () => {
  it("a wake-up needs a fresh socket when closed or silent for too long", () => {
    const now = 1_000_000;
    expect(needsFreshSocket({ open: false, lastMessageAt: now, now })).toBe(true);
    expect(needsFreshSocket({ open: true, lastMessageAt: now - 1000, now })).toBe(false);
    expect(needsFreshSocket({ open: true, lastMessageAt: now - CONNECTION_CONFIG.clientDeadAfterMs - 1, now })).toBe(true);
  });

  it("timings: backoff ≤ 5 s, ping every 15 s, grace 20 s, hint after 8 s", () => {
    expect(CONNECTION_CONFIG.maxReconnectDelayMs).toBeLessThanOrEqual(5_000);
    expect(CONNECTION_CONFIG.heartbeatMs).toBe(15_000);
    expect(CONNECTION_CONFIG.graceMs).toBe(20_000);
    expect(CONNECTION_CONFIG.stuckHintAfterMs).toBe(8_000);
    // A phone is found dead (client) before the server gives up on it.
    expect(CONNECTION_CONFIG.heartbeatMs + CONNECTION_CONFIG.pongTimeoutMs).toBeLessThan(CONNECTION_CONFIG.serverStaleAfterMs);
  });
});

describe("\"Wer bist du?\"", () => {
  const p = (name: string, online: boolean): PublicPlayer => ({
    id: name,
    name,
    joinedAt: 0,
    connected: true,
    online,
    avatar: { character: "fox", color: "red" },
  });
  const players = [p("Anna", true), p("Philip", false)];

  it("only seats without a connection; late join only if the host allows it and the game isn't over", () => {
    expect(claimOptions({ players, lateJoin: true, phase: "play" })).toEqual({ free: [players[1]], canJoinLate: true });
    expect(claimOptions({ players, lateJoin: false, phase: "play" }).canJoinLate).toBe(false);
    expect(claimOptions({ players, lateJoin: true, phase: "finale" }).canJoinLate).toBe(false);
  });

  it("TV toasts and the corner chip", () => {
    expect(noticeText({ kind: "rejoined", playerId: "p", name: "Philip" })).toBe("Philip ist wieder da 👋");
    expect(noticeText({ kind: "late_join", playerId: "t", name: "Tina" })).toBe("Neu dabei: Tina 🎉");
    expect(noticeText({ kind: "game_ended" })).toBe("🏁 Spiel beendet");
    expect(["lobby", "intro", "play", "scoreboard", "finale"].filter((ph) => showJoinChip(ph as never))).toEqual([
      "play",
      "scoreboard",
    ]);
  });
});
