import { afterEach, describe, expect, it, vi } from "vitest";
import { VOICE_CONFIG } from "../src/voice/config";
import { createOpenAISpeechProvider, createOpenAITextProvider } from "../src/voice/openai";
import { welcomePrompt } from "../src/voice/prompt";
import { VoiceProviderError, type SpeechProvider, type TextProvider } from "../src/voice/provider";
import { produceLine, type LineRequest } from "../src/voice/service";
import { memoryStore } from "./avatar-helpers";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const text = (impl: TextProvider["generateLine"]): TextProvider => ({ generateLine: vi.fn(impl) });
const speech = (impl: SpeechProvider["speak"]): SpeechProvider => ({ speak: vi.fn(impl) });
const okText = text(async () => "Applaus für Clara – unsere Geheimwaffe vom Sofa!");
const okSpeech = speech(async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/mpeg" }));

function req(over: Partial<LineRequest> = {}): LineRequest {
  return {
    code: "ABCD",
    id: "0123456789abcdef",
    kind: "welcome",
    prompt: welcomePrompt(["Clara"], 1),
    fallback: "Applaus für Clara!",
    useAi: true,
    deadline: null,
    now: () => Date.now(),
    ...over,
  };
}

describe("produceLine", () => {
  it("text → speech → R2, with an audio path for the host screen", async () => {
    const store = memoryStore();
    const out = await produceLine({ text: okText, speech: okSpeech, store }, req());
    expect(out.source).toBe("ai");
    expect(out.line).toMatchObject({
      text: "Applaus für Clara – unsere Geheimwaffe vom Sofa!",
      audioPath: "/api/rooms/ABCD/voice/0123456789abcdef",
    });
    expect(store.objects.has("rooms/ABCD/voice/0123456789abcdef.mp3")).toBe(true);
  });

  it("falls back to the template (subtitle only) when the text model times out", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hanging = text(() => new Promise(() => {}));
    const pending = produceLine({ text: hanging, speech: okSpeech, store: memoryStore() }, req());
    await vi.advanceTimersByTimeAsync(VOICE_CONFIG.textTimeoutMs);
    const out = await pending;
    expect(out).toMatchObject({ source: "template", line: { text: "Applaus für Clara!", audioPath: null } });
    // Logs contain reasons only – never names or texts.
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/Clara/);
    expect(okSpeech.speak).not.toHaveBeenCalled();
  });

  it("falls back on errors, refusals and unusable replies", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = memoryStore();
    for (const provider of [
      text(async () => {
        throw new VoiceProviderError("error", "OpenAI text HTTP 500");
      }),
      text(async () => {
        throw new VoiceProviderError("refused", "OpenAI text refused");
      }),
      text(async () => ""),
    ]) {
      const out = await produceLine({ text: provider, speech: okSpeech, store }, req());
      expect(out).toMatchObject({ source: "template", line: { audioPath: null } });
    }
  });

  it("keeps the written line as subtitle when speech fails or times out", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const slow = speech(() => new Promise(() => {}));
    const pending = produceLine({ text: okText, speech: slow, store: memoryStore() }, req());
    await vi.advanceTimersByTimeAsync(VOICE_CONFIG.speechTimeoutMs);
    expect(await pending).toMatchObject({ source: "ai-text-only", line: { audioPath: null } });
  });

  it("uses the template without calling anything when the budget is used up", async () => {
    const t = text(async () => "x");
    const out = await produceLine({ text: t, speech: okSpeech, store: memoryStore() }, req({ useAi: false }));
    expect(out.source).toBe("template");
    expect(t.generateLine).not.toHaveBeenCalled();
  });

  it("respects a deadline (commentary must be ready in time)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = text(async () => "x");
    const now = 1000;
    const out = await produceLine(
      { text: t, speech: okSpeech, store: memoryStore() },
      req({ deadline: now, now: () => now }),
    );
    expect(out.source).toBe("template");
    expect(t.generateLine).not.toHaveBeenCalled();
  });
});

describe("OpenAI providers (mocked fetch)", () => {
  it("text: small model, JSON mode for comments", async () => {
    const fetchFn = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
      Response.json({ choices: [{ message: { content: '{"line":"Hi","target":""}' } }] }),
    );
    const provider = createOpenAITextProvider("sk-test", fetchFn as typeof fetch);
    expect(await provider.generateLine({ system: "s", user: "u", json: true })).toBe('{"line":"Hi","target":""}');
    const body = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string);
    expect(body.model).toBe(VOICE_CONFIG.textModel);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("speech: steerable TTS with voice + style, mp3", async () => {
    const fetchFn = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(new Uint8Array([9, 9])),
    );
    const clip = await createOpenAISpeechProvider("sk-test", fetchFn as typeof fetch).speak("Hallo");
    expect(clip).toEqual({ bytes: new Uint8Array([9, 9]), mimeType: "audio/mpeg" });
    const body = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string);
    expect(body).toMatchObject({
      model: VOICE_CONFIG.speechModel,
      voice: VOICE_CONFIG.voice,
      instructions: VOICE_CONFIG.style,
      response_format: "mp3",
    });
  });
});
