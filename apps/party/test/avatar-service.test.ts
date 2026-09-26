import { afterEach, describe, expect, it, vi } from "vitest";
import { AVATAR_CONFIG, AVATAR_PROMPT, FIGURE_CONFIG, RATE_LIMIT_CONFIG } from "../src/avatar/config";
import { createOpenAIProvider, retryAfterMs } from "../src/avatar/openai";
import { AvatarGenerationError } from "../src/avatar/provider";
import { generateBaseAvatar, generateExpressionAvatar, generateFigure } from "../src/avatar/service";
import { avatarKey, r2AvatarStore } from "../src/avatar/store";
import { memoryStore, mockProvider, photo, styleReference } from "./avatar-helpers";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const job = { code: "ABCD", playerId: "player1", photo };

describe("generateBaseAvatar", () => {
  it("sends the photo with the style prompt and stores only the result", async () => {
    const provider = mockProvider();
    const store = memoryStore();
    const resize = vi.fn(async () => ({ bytes: new Uint8Array([1]), mimeType: "image/webp" }));
    const outcome = await generateBaseAvatar({ provider, store, styleReference, resize }, job);
    expect(outcome).toEqual({ ok: true });
    expect(provider.calls[0]!.input).toBe(photo);
    expect(provider.calls[0]!.prompt).toBe(AVATAR_PROMPT);
    expect([...store.objects.keys()]).toEqual(["rooms/ABCD/player1/neutral.webp"]);
    expect(store.objects.get("rooms/ABCD/player1/neutral.webp")).toEqual(new Uint8Array([1]));
    // The original photo is never stored.
    expect([...store.objects.values()]).not.toContainEqual(photo.bytes);
  });

  it("reports refusals and errors as failures", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = memoryStore();
    const refused = mockProvider(async () => {
      throw new AvatarGenerationError("refused", "OpenAI refused (moderation_blocked)");
    });
    expect(await generateBaseAvatar({ provider: refused, store, styleReference }, job)).toEqual({
      ok: false,
      reason: "refused",
    });
    const broken = mockProvider(async () => {
      throw new Error("network");
    });
    expect(await generateBaseAvatar({ provider: broken, store, styleReference }, job)).toEqual({
      ok: false,
      reason: "error",
    });
    expect(store.objects.size).toBe(0);
  });

  it("times out after the configured time", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hanging = mockProvider(() => new Promise(() => {}));
    const pending = generateBaseAvatar({ provider: hanging, store: memoryStore(), styleReference }, job);
    await vi.advanceTimersByTimeAsync(AVATAR_CONFIG.timeoutMs);
    expect(await pending).toEqual({ ok: false, reason: "timeout" });
    // Logs never contain image data.
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/base64|\/9j\//);
  });

  it("stores the original size if resizing fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = memoryStore();
    const resize = vi.fn(async () => {
      throw new Error("no images");
    });
    await generateBaseAvatar({ provider: mockProvider(), store, styleReference, resize }, job);
    expect(store.objects.get("rooms/ABCD/player1/neutral.webp")).toEqual(new Uint8Array([7, 7, 7]));
  });
});

describe("generateExpressionAvatar", () => {
  it("uses the stored neutral avatar, not the photo", async () => {
    const store = memoryStore();
    await store.put(avatarKey("ABCD", "player1", "neutral"), new Uint8Array([5]), "image/webp");
    const provider = mockProvider();
    const ok = await generateExpressionAvatar(
      { provider, store, styleReference },
      { code: "ABCD", playerId: "player1", expression: "geschockt" },
    );
    expect(ok).toBe(true);
    expect(provider.calls[0]!.input.bytes).toEqual(new Uint8Array([5]));
    expect(provider.calls[0]!.prompt).toContain("shocked");
    expect(store.objects.has("rooms/ABCD/player1/geschockt.webp")).toBe(true);
  });

  it("does nothing without a neutral image", async () => {
    const provider = mockProvider();
    const ok = await generateExpressionAvatar(
      { provider, store: memoryStore(), styleReference },
      { code: "ABCD", playerId: "player1", expression: "jubelnd" },
    );
    expect(ok).toBe(false);
    expect(provider.calls).toHaveLength(0);
  });
});

describe("quality per image kind (cost)", () => {
  it("round avatar in the configured quality, faces and standing figures in low", async () => {
    const provider = mockProvider();
    const store = memoryStore();
    const deps = { provider, store, styleReference };
    await generateBaseAvatar(deps, job);
    await generateExpressionAvatar(deps, { code: "ABCD", playerId: "player1", expression: "jubelnd" });
    await generateFigure(deps, { code: "ABCD", playerId: "player1", pose: "standard" });
    expect(provider.calls.map((c) => c.options.quality)).toEqual([AVATAR_CONFIG.quality, "low", "low"]);
    expect(AVATAR_CONFIG.expressionQuality).toBe("low");
    expect(FIGURE_CONFIG.quality).toBe("low");
  });
});

describe("too many requests (images per minute)", () => {
  const rateLimited = (ms: number) => new AvatarGenerationError("error", "OpenAI HTTP 429 rate_limit_exceeded", ms);

  it("waits as long as the API says and tries again – not counted as the image's retry", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let n = 0;
    const provider = mockProvider(async () => {
      if (n++ < 2) throw rateLimited(12_000);
      return { bytes: new Uint8Array([1]), mimeType: "image/webp" };
    });
    const store = memoryStore();
    await store.put(avatarKey("ABCD", "player1", "neutral"), new Uint8Array([5]), "image/webp");
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    const outcome = await generateFigure({ provider, store, styleReference, sleep }, { code: "ABCD", playerId: "player1", pose: "standard" });
    expect(outcome).toEqual({ ok: true, attempts: 1 });
    expect(waits).toEqual([12_000, 12_000]);
  });

  it("gives up once the wait budget is used up (then the normal fallback applies)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = mockProvider(async () => {
      throw rateLimited(20_000);
    });
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    const outcome = await generateBaseAvatar({ provider, store: memoryStore(), styleReference, sleep }, job);
    expect(outcome).toEqual({ ok: false, reason: "error" });
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(RATE_LIMIT_CONFIG.maxWaitMs);
    expect(provider.calls).toHaveLength(waits.length + 1);
  });

  it("other errors are not waited on", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = mockProvider(async () => {
      throw new AvatarGenerationError("error", "OpenAI HTTP 500");
    });
    const sleep = vi.fn(async () => {});
    await generateBaseAvatar({ provider, store: memoryStore(), styleReference, sleep }, job);
    expect(sleep).not.toHaveBeenCalled();
    expect(provider.calls).toHaveLength(1);
  });

  it("reads the wait from the headers or the message", () => {
    expect(retryAfterMs(new Headers({ "retry-after-ms": "1500" }))).toBe(1500);
    expect(retryAfterMs(new Headers({ "retry-after": "3" }))).toBe(3000);
    expect(retryAfterMs(new Headers(), "Rate limit reached … Please try again in 12.5s.")).toBe(12_500);
    expect(retryAfterMs(new Headers(), "Please try again in 800ms.")).toBe(800);
    expect(retryAfterMs(new Headers())).toBe(RATE_LIMIT_CONFIG.defaultWaitMs);
  });
});

describe("OpenAI provider (mocked fetch)", () => {
  const style = { reference: styleReference(), prompt: AVATAR_PROMPT };

  it("posts both images with the configured model and quality", async () => {
    const fetchFn = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
      Response.json({ data: [{ b64_json: btoa("abc") }] }),
    );
    const provider = createOpenAIProvider("sk-test", fetchFn as typeof fetch);
    const image = await provider.generateAvatar(photo, style);
    expect(image).toEqual({ bytes: new TextEncoder().encode("abc"), mimeType: "image/webp" });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/images/edits");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const form = init!.body as FormData;
    expect(form.get("model")).toBe(AVATAR_CONFIG.model);
    expect(form.get("quality")).toBe("medium");
    expect(form.get("output_format")).toBe("webp");
    expect(form.getAll("image[]")).toHaveLength(2);
  });

  it("turns safety rejections and empty answers into refusals", async () => {
    const blocked = createOpenAIProvider("sk-test", (async () =>
      Response.json({ error: { code: "moderation_blocked" } }, { status: 400 })) as typeof fetch);
    await expect(blocked.generateAvatar(photo, style)).rejects.toMatchObject({ reason: "refused" });
    const empty = createOpenAIProvider("sk-test", (async () => Response.json({ data: [] })) as typeof fetch);
    await expect(empty.generateAvatar(photo, style)).rejects.toMatchObject({ reason: "refused" });
    const down = createOpenAIProvider("sk-test", (async () =>
      Response.json({ error: { type: "server_error" } }, { status: 500 })) as typeof fetch);
    await expect(down.generateAvatar(photo, style)).rejects.toMatchObject({ reason: "error" });
  });

  it("marks 'too many requests' as worth waiting for, but not an empty quota", async () => {
    const limited = createOpenAIProvider("sk-test", (async () =>
      Response.json(
        { error: { code: "rate_limit_exceeded", message: "Please try again in 12s." } },
        { status: 429 },
      )) as typeof fetch);
    await expect(limited.generateAvatar(photo, style)).rejects.toMatchObject({ reason: "error", retryAfterMs: 12_000 });
    const broke = createOpenAIProvider("sk-test", (async () =>
      Response.json({ error: { code: "insufficient_quota" } }, { status: 429 })) as typeof fetch);
    await expect(broke.generateAvatar(photo, style)).rejects.toMatchObject({ reason: "error", retryAfterMs: undefined });
  });

  it("sends the requested quality", async () => {
    const fetchFn = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
      Response.json({ data: [{ b64_json: btoa("abc") }] }),
    );
    await createOpenAIProvider("sk-test", fetchFn as typeof fetch).generateAvatar(photo, { prompt: "p" }, { quality: "low" });
    expect((fetchFn.mock.calls[0]![1]!.body as FormData).get("quality")).toBe("low");
  });
});

describe("R2 store cleanup", () => {
  it("deletes every object of a room, page by page", async () => {
    const keys = new Set([
      "rooms/ABCD/p1/neutral.webp",
      "rooms/ABCD/p1/jubelnd.webp",
      "rooms/ABCD/p2/neutral.webp",
      "rooms/WXYZ/p3/neutral.webp",
    ]);
    const bucket = {
      async list({ prefix, cursor }: { prefix: string; cursor?: string }) {
        const matching = [...keys].filter((k) => k.startsWith(prefix)).sort();
        const start = cursor ? Number(cursor) : 0;
        const page = matching.slice(start, start + 2);
        const truncated = start + 2 < matching.length;
        return { objects: page.map((key) => ({ key })), truncated, cursor: truncated ? String(start + 2) : undefined };
      },
      async delete(list: string[]) {
        for (const k of list) keys.delete(k);
      },
    };
    await r2AvatarStore(bucket as unknown as R2Bucket).deletePrefix("rooms/ABCD/");
    expect([...keys]).toEqual(["rooms/WXYZ/p3/neutral.webp"]);
  });
});
