import { DEFAULT_VOICE_SETTINGS, type ScoringSettings } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { updateSettings } from "../src/game-flow";
import { createRoomRecord, toPublicState, updateVoiceSettings } from "../src/room-logic";
import { handleVoiceGet } from "../src/voice/routes";
import { memoryStore } from "./avatar-helpers";

const scoring: ScoringSettings = {
  mode: "absolute",
  maxPoints: 100,
  speedModifier: { enabled: false, fastestMultiplier: 1.5, slowestMultiplier: 0.5 },
};

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

  it("shows the automatic 'nett' for kids' categories", () => {
    let room = createRoomRecord("ABCD", "host-token-0123456789abcdef", 0);
    const r = updateSettings(room, [{ categoryId: "quiz", questionCount: 5, scoring }]); // quiz: age rating 6
    if (!r.ok) throw new Error(r.error);
    room = r.value;
    const host = toPublicState(room, { host: true, playerIds: new Set() }, { role: "host" }).voice!;
    expect(host).toMatchObject({ kidsCategories: true, effectiveCheekiness: "nett" });
    const overridden = updateVoiceSettings(room, { ...DEFAULT_VOICE_SETTINGS, cheekiness: "gnadenlos", cheekinessOverride: true });
    if (!overridden.ok) throw new Error(overridden.error);
    expect(toPublicState(overridden.value, { host: true, playerIds: new Set() }, { role: "host" }).voice).toMatchObject({
      effectiveCheekiness: "gnadenlos",
    });
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
