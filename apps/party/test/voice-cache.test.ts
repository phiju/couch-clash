import { afterEach, describe, expect, it, vi } from "vitest";
import { SNARK_LINES_DE } from "@couch-clash/content";
import { handleAdmin } from "../src/admin/routes";
import type { AdminVoiceResponse, AdminVoiceRunResponse } from "@couch-clash/shared";
import { SNARK_BATCH, voiceSnarkBatch, voiceStatus } from "../src/voice/admin";
import { handleVoiceCacheGet, voiceCacheKey, voiceCachePath } from "../src/voice/cache";
import { clearUsageCache, fetchElevenLabsUsage } from "../src/voice/elevenlabs";
import { accountLow } from "../src/voice/rules";
import type { VoiceServices } from "../src/voice/service";
import { allSnarkLines } from "../src/voice/snark";
import { memoryStore } from "./avatar-helpers";
import { mockSpeech } from "./voice-helpers";

afterEach(() => {
  clearUsageCache();
  vi.restoreAllMocks();
});

describe("voice cache route", () => {
  it("serves cached clips by content hash, long-lived; nothing else", async () => {
    const store = memoryStore();
    const key = await voiceCacheKey("snark", "Mutig geraten.", "fast", 1.15);
    expect(key).toMatch(/^voice-cache\/[\w-]+\/snark\/[a-f0-9]{64}\.mp3$/);
    await store.put(key, new Uint8Array([9]), "audio/mpeg");
    const res = (await handleVoiceCacheGet(voiceCachePath(key), store))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toMatch(/immutable/);
    expect((await handleVoiceCacheGet(voiceCachePath(key.replace(/[a-f0-9]{64}/, "0".repeat(64))), store))!.status).toBe(404);
    expect(await handleVoiceCacheGet("/api/voice-cache/../rooms/ABCD/voice/x.mp3", store)).toBeNull();
    expect(await handleVoiceCacheGet("/api/rooms/ABCD/voice/0123456789abcdef", store)).toBeNull();
  });
});

describe("ElevenLabs account usage", () => {
  it("reads character_count / character_limit and caches it for 10 minutes", async () => {
    const fetchFn = vi.fn(async () => Response.json({ character_count: 18_400, character_limit: 30_000 }));
    expect(await fetchElevenLabsUsage("k", fetchFn as typeof fetch, 0)).toEqual({ used: 18_400, limit: 30_000 });
    await fetchElevenLabsUsage("k", fetchFn as typeof fetch, 9 * 60_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await fetchElevenLabsUsage("k", fetchFn as typeof fetch, 11 * 60_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect((fetchFn.mock.calls[0] as unknown[])[0]).toBe("https://api.elevenlabs.io/v1/user/subscription");
  });

  it("unknown usage (no permission, network) never blocks and never throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await fetchElevenLabsUsage("a", (async () => new Response("", { status: 401 })) as typeof fetch)).toBeNull();
    expect(await fetchElevenLabsUsage("b", (async () => { throw new Error("offline"); }) as typeof fetch)).toBeNull();
    expect(accountLow(null)).toBe(false);
  });

  it("less than 10 % left → low", () => {
    expect(accountLow({ used: 26_999, limit: 30_000 })).toBe(false);
    expect(accountLow({ used: 27_001, limit: 30_000 })).toBe(true);
  });
});

describe("admin: Moderator-Sprüche vertonen", () => {
  const total = allSnarkLines(SNARK_LINES_DE).length;
  const services = (over: Partial<VoiceServices> = {}): VoiceServices & { store: ReturnType<typeof memoryStore> } => ({
    text: null,
    speech: mockSpeech(),
    store: memoryStore(),
    usage: async () => ({ used: 1_000, limit: 30_000 }),
    ...over,
  }) as VoiceServices & { store: ReturnType<typeof memoryStore> };

  it("voices the library batch by batch; once done nothing is generated again", async () => {
    const s = services();
    expect(await voiceStatus(s)).toEqual({ account: { used: 1_000, limit: 30_000 }, snark: { total, cached: 0 } });
    const first = await voiceSnarkBatch(s);
    expect(first).toMatchObject({ ok: true, generated: SNARK_BATCH.size, snark: { total, cached: SNARK_BATCH.size } });
    let last = first;
    for (let i = 0; i < 20 && last.snark.cached < total; i++) last = await voiceSnarkBatch(s);
    expect(last.snark.cached).toBe(total);
    expect(s.speech!.speak).toHaveBeenCalledTimes(total);
    const again = await voiceSnarkBatch(s);
    expect(again).toMatchObject({ ok: true, generated: 0 });
    expect(s.speech!.speak).toHaveBeenCalledTimes(total);
    // Lines are voiced with flash at the cached speed.
    expect(s.speech!.speak).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ style: "fast", speed: 1.15 }));
  });

  it("refuses when less than 10 % of the month's credits are left", async () => {
    const s = services({ usage: async () => ({ used: 29_000, limit: 30_000 }) });
    expect(await voiceSnarkBatch(s)).toMatchObject({ ok: false, generated: 0 });
    expect(s.speech!.speak).not.toHaveBeenCalled();
  });

  it("admin routes: token required, no database needed", async () => {
    const s = services();
    const deps = { adminToken: "secret", store: null, background: () => {}, replaceDeps: () => { throw new Error("unused"); }, now: () => 0, voice: () => s };
    const call = (path: string, init: RequestInit = {}, token = "secret") =>
      handleAdmin(new Request(`https://x${path}`, { ...init, headers: { Authorization: `Bearer ${token}` } }), new URL(`https://x${path}`), deps);
    expect((await call("/api/admin/voice", {}, "wrong"))!.status).toBe(401);
    const status = (await (await call("/api/admin/voice"))!.json()) as AdminVoiceResponse;
    expect(status.snark).toEqual({ total, cached: 0 });
    const run = (await (await call("/api/admin/voice/snark", { method: "POST" }))!.json()) as AdminVoiceRunResponse;
    expect(run.generated).toBe(SNARK_BATCH.size);
  });
});
