import { afterEach, describe, expect, it, vi } from "vitest";
import { AVATAR_CONFIG, AVATAR_PROMPT } from "../src/avatar/config";
import { createOpenAIProvider } from "../src/avatar/openai";
import { AvatarGenerationError } from "../src/avatar/provider";
import { generateBaseAvatar, generateExpressionAvatar } from "../src/avatar/service";
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
