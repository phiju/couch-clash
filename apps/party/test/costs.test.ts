import { describe, expect, it, vi } from "vitest";
import { handleAdmin, type AdminDeps } from "../src/admin/routes";
import { meteredFetch, usageFor, type UsageEntry } from "../src/costs/meter";
import { d1CostStore, usageRecorder, type CostStore } from "../src/costs/store";
import { createVoiceProviders } from "../src/voice";
import { sqliteD1 } from "./stats-helpers";

const T0 = Date.UTC(2026, 8, 26, 12);
const TOKEN = "admin-secret-token-123";

/** OpenAI's answer for one image, with the usage numbers measured on a real standing figure (low quality). */
const figureAnswer = {
  data: [{ b64_json: "AAAA" }],
  usage: { input_tokens: 848, input_tokens_details: { image_tokens: 704, text_tokens: 144 }, output_tokens: 158 },
};

function imageForm(fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return form;
}

describe("cost metering", () => {
  it("prices an image call from the token counts in OpenAI's answer (≈ $0.011 per figure)", async () => {
    const entry = await usageFor(
      "avatar-round",
      "https://api.openai.com/v1/images/edits",
      { method: "POST", body: imageForm({ model: "gpt-image-2", quality: "low", background: "transparent" }) },
      Response.json(figureAnswer),
    );
    expect(entry).toMatchObject({ service: "openai", kind: "avatar-figure", calls: 1, inputTokens: 848, outputTokens: 158 });
    expect(entry!.usd).toBeCloseTo((144 * 5 + 704 * 8 + 158 * 30) / 1e6, 8);
    expect(entry!.usd).toBeGreaterThan(0.01);
    expect(entry!.usd).toBeLessThan(0.012);
  });

  it("tells round avatars, faces and figures apart by the request", async () => {
    const kindOf = async (fields: Record<string, string>) =>
      (await usageFor("avatar-round", "https://api.openai.com/v1/images/edits", { body: imageForm(fields) }, Response.json(figureAnswer)))!.kind;
    expect(await kindOf({ model: "gpt-image-2", quality: "medium" })).toBe("avatar-round");
    expect(await kindOf({ model: "gpt-image-2", quality: "low" })).toBe("avatar-face");
    expect(await kindOf({ model: "gpt-image-2", quality: "low", background: "transparent" })).toBe("avatar-figure");
  });

  it("chat calls: prompt/completion tokens × the model's price", async () => {
    const entry = await usageFor(
      "voice-text",
      "https://api.openai.com/v1/chat/completions",
      { body: JSON.stringify({ model: "gpt-4.1-mini", messages: [] }) },
      Response.json({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 100 } }),
    );
    expect(entry).toMatchObject({ kind: "voice-text", inputTokens: 1000, outputTokens: 100 });
    expect(entry!.usd).toBeCloseTo((1000 * 0.4 + 100 * 1.6) / 1e6, 10);
  });

  it("speech: OpenAI by characters, ElevenLabs as credits (paid by the plan)", async () => {
    const openai = await usageFor(
      "voice-speech",
      "https://api.openai.com/v1/audio/speech",
      { body: JSON.stringify({ model: "gpt-4o-mini-tts", input: "x".repeat(1000) }) },
      new Response(new Uint8Array([1])),
    );
    expect(openai!.usd).toBeCloseTo(0.017, 5);
    const flash = await usageFor(
      "voice-speech",
      "https://api.elevenlabs.io/v1/text-to-speech/voice?output_format=mp3",
      { body: JSON.stringify({ text: "x".repeat(100), model_id: "eleven_flash_v2_5" }) },
      new Response(new Uint8Array([1])),
    );
    expect(flash).toMatchObject({ service: "elevenlabs", units: 50, usd: 0 });
  });

  it("the call itself is untouched; failed calls and broken answers are not counted", async () => {
    const recorded: UsageEntry[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ok = meteredFetch((e) => recorded.push(e), "voice-text", async () =>
      Response.json({ choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    );
    const res = await ok("https://api.openai.com/v1/chat/completions", { body: JSON.stringify({ model: "gpt-4.1-mini" }) });
    expect(((await res.json()) as { choices: unknown[] }).choices).toHaveLength(1);
    expect(recorded).toHaveLength(1);

    const failed = meteredFetch((e) => recorded.push(e), "voice-text", async () => Response.json({ error: {} }, { status: 429 }));
    expect((await failed("https://api.openai.com/v1/chat/completions")).status).toBe(429);
    const garbage = meteredFetch((e) => recorded.push(e), "voice-text", async () => new Response("not json"));
    expect(await (await garbage("https://api.openai.com/v1/chat/completions")).text()).toBe("not json");
    expect(recorded).toHaveLength(1);
    warn.mockRestore();
  });

  it("the voice providers use the measured fetch per kind", () => {
    const kinds: string[] = [];
    createVoiceProviders({ OPENAI_API_KEY: "sk", ELEVENLABS_API_KEY: "el" }, "elevenlabs", (kind) => {
      kinds.push(kind);
      return fetch;
    });
    expect(kinds.sort()).toEqual(["voice-speech", "voice-text"]);
  });
});

describe("cost store (D1)", () => {
  it("sums calls per day and kind; the recorder writes in the background", async () => {
    const store = d1CostStore(sqliteD1().d1);
    const tasks: Promise<unknown>[] = [];
    const record = usageRecorder(store, (p) => tasks.push(p), () => T0);
    const e: UsageEntry = { service: "openai", kind: "avatar-figure", calls: 1, inputTokens: 800, outputTokens: 150, units: 0, usd: 0.011 };
    record(e);
    record(e);
    record({ ...e, kind: "avatar-round", usd: 0.067 });
    await Promise.all(tasks);
    const rows = await store.usageSince("2026-01-01");
    expect(rows).toHaveLength(2);
    const figures = rows.find((r) => r.kind === "avatar-figure")!;
    expect(figures).toMatchObject({ day: "2026-09-26", calls: 2, inputTokens: 1600, outputTokens: 300 });
    expect(figures.usd).toBeCloseTo(0.022);
  });

  it("without a database nothing is recorded, and a failing write never throws", async () => {
    const waitUntil = vi.fn();
    usageRecorder(null, waitUntil)({ service: "openai", kind: "voice-text", calls: 1, inputTokens: 1, outputTokens: 1, units: 0, usd: 0 });
    expect(waitUntil).not.toHaveBeenCalled();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = { addUsage: async () => Promise.reject(new Error("D1 down")) } as unknown as CostStore;
    const tasks: Promise<unknown>[] = [];
    usageRecorder(broken, (p) => tasks.push(p))({ service: "openai", kind: "voice-text", calls: 1, inputTokens: 1, outputTokens: 1, units: 0, usd: 0 });
    await expect(Promise.all(tasks)).resolves.toBeDefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("admin API /api/admin/costs", () => {
  function setup(costs: CostStore | null = d1CostStore(sqliteD1().d1)) {
    const deps: AdminDeps = {
      adminToken: TOKEN,
      store: null,
      background: () => {},
      replaceDeps: () => {
        throw new Error("unused");
      },
      now: () => T0,
      costs,
      voice: () => ({ text: null, speech: null, store: null, usage: async () => ({ used: 1200, limit: 30000 }) }),
    };
    return async (path: string, init: RequestInit & { auth?: string } = {}) => {
      const request = new Request(`https://party.test${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${init.auth ?? TOKEN}`, "Content-Type": "application/json" },
      });
      return (await handleAdmin(request, new URL(request.url), deps))!;
    };
  }
  const claude = { name: "Claude Max", amount: 100, currency: "EUR", since: "2026-05", until: null, note: "Entwicklung" };

  it("needs the admin token", async () => {
    expect((await setup()("/api/admin/costs", { auth: "wrong" })).status).toBe(401);
  });

  it("adds, lists, changes and deletes fixed costs; returns usage and ElevenLabs credits", async () => {
    const call = setup();
    expect((await call("/api/admin/costs/fixed", { method: "POST", body: JSON.stringify(claude) })).status).toBe(200);
    let body = (await (await call("/api/admin/costs")).json()) as { fixed: { id: number; until: string | null }[]; elevenlabs: unknown; usdToEur: number; usage: unknown[] };
    expect(body.fixed).toEqual([{ id: 1, ...claude }]);
    expect(body.elevenlabs).toEqual({ used: 1200, limit: 30000 });
    expect(body.usdToEur).toBeGreaterThan(0);
    expect(body.usage).toEqual([]);

    const ended = { ...claude, until: "2026-09" };
    expect((await call("/api/admin/costs/fixed/1", { method: "PUT", body: JSON.stringify(ended) })).status).toBe(200);
    body = (await (await call("/api/admin/costs")).json()) as typeof body;
    expect(body.fixed[0]!.until).toBe("2026-09");

    expect((await call("/api/admin/costs/fixed/1", { method: "DELETE" })).status).toBe(200);
    expect((await call("/api/admin/costs/fixed/1", { method: "DELETE" })).status).toBe(404);
  });

  it("rejects invalid entries", async () => {
    const call = setup();
    const bad = [
      { ...claude, name: "" },
      { ...claude, amount: -5 },
      { ...claude, since: "2026-13" },
      { ...claude, currency: "GBP" },
      { ...claude, until: "2026-01" },
    ];
    for (const b of bad) expect((await call("/api/admin/costs/fixed", { method: "POST", body: JSON.stringify(b) })).status).toBe(400);
  });

  it("503 without a database", async () => {
    expect((await setup(null)("/api/admin/costs")).status).toBe(503);
  });
});
