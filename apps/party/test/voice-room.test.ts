import { DEFAULT_VOICE_SETTINGS } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { updateMode } from "../src/game-flow";
import { createRoomRecord, toPublicState, updateVoiceSettings } from "../src/room-logic";
import { handleVoiceGet } from "../src/voice/routes";
import { memoryStore } from "./avatar-helpers";

describe("voice settings", () => {
  it("defaults: moderator on, normal, frech – visible to the host only", () => {
    const room = createRoomRecord("ABCD", "host-token-0123456789abcdef", 0);
    const connected = { host: true, playerIds: new Set<string>() };
    expect(toPublicState(room, connected, { role: "host" }).voice).toMatchObject({
      enabled: true,
      frequency: "normal",
      cheekiness: "frech",
      effectiveCheekiness: "frech",
    });
    expect(toPublicState(room, connected, { role: "guest" }).voice).toBeNull();
  });

  it("Frechheit follows the game mode (Kids: nett or frech)", () => {
    let room = createRoomRecord("ABCD", "host-token-0123456789abcdef", 0);
    const kids = updateMode(room, { mode: "kids", allow16: false, difficulty: "mixed" }, false);
    if (!kids.ok) throw new Error(kids.error);
    room = kids.value;
    expect(toPublicState(room, { host: true, playerIds: new Set() }, { role: "host" }).voice).toMatchObject({
      effectiveCheekiness: "nett",
      allowedCheekiness: ["nett", "frech"],
    });
    const gnadenlos = updateVoiceSettings(room, { ...DEFAULT_VOICE_SETTINGS, cheekiness: "gnadenlos" });
    if (!gnadenlos.ok) throw new Error(gnadenlos.error);
    expect(toPublicState(gnadenlos.value, { host: true, playerIds: new Set() }, { role: "host" }).voice!.effectiveCheekiness).toBe("nett");
    const frech = updateVoiceSettings(room, { ...DEFAULT_VOICE_SETTINGS, cheekiness: "frech" });
    if (!frech.ok) throw new Error(frech.error);
    expect(toPublicState(frech.value, { host: true, playerIds: new Set() }, { role: "host" }).voice!.effectiveCheekiness).toBe("frech");
  });

  it("can only be changed in lobby or setup", () => {
    const room = { ...createRoomRecord("ABCD", "host-token-0123456789abcdef", 0), phase: "play" as const };
    expect(updateVoiceSettings(room, DEFAULT_VOICE_SETTINGS)).toEqual({ ok: false, error: "WRONG_PHASE" });
  });
});

describe("GET /api/rooms/:code/voice/:id", () => {
  const id = "0123456789abcdef";
  it("serves the mp3 only while the room exists", async () => {
    const store = memoryStore();
    await store.put(`rooms/ABCD/voice/${id}.mp3`, new Uint8Array([1, 2]), "audio/mpeg");
    const alive = { info: async () => ({ phase: "lobby", playerCount: 1 }) };
    const gone = { info: async () => null };
    const ok = await handleVoiceGet("abcd", id, async () => alive, store);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("audio/mpeg");
    expect((await handleVoiceGet("ABCD", id, async () => gone, store)).status).toBe(404);
    expect((await handleVoiceGet("ABCD", "../../x", async () => alive, store)).status).toBe(404);
    expect((await handleVoiceGet("ABCD", "fedcba9876543210", async () => alive, store)).status).toBe(404);
  });
});
