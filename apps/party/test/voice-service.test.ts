import { afterEach, describe, expect, it, vi } from "vitest";
import { VOICE_CONFIG } from "../src/voice/config";
import { createOpenAITextProvider } from "../src/voice/openai";
import { welcomePrompt } from "../src/voice/prompt";
import { VoiceProviderError, type TextProvider } from "../src/voice/provider";
import { produceLine, type LineRequest } from "../src/voice/service";
import { memoryStore } from "./avatar-helpers";
import { mockSpeech } from "./voice-helpers";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const text = (impl: TextProvider["generateLine"]): TextProvider & { generateLine: ReturnType<typeof vi.fn> } => ({
  generateLine: vi.fn(impl),
});
const okText = () => text(async () => "[excited] Applaus für Clara – unsere Geheimwaffe vom Sofa!");

function req(over: Partial<LineRequest> = {}): LineRequest {
  return {
    code: "ABCD",
    id: "0123456789abcdef",
    kind: "welcome",
    prompt: welcomePrompt(["Clara"], 1, true),
    fallback: "Applaus für Clara!",
    useAi: true,
    style: "expressive",
    speed: 1.15,
    playbackRate: 1,
    deadline: null,
    now: () => Date.now(),
    reserveChars: async () => true,
    ...over,
  };
}

describe("produceLine", () => {
  it("OpenAI text → voice → R2, with an audio path for the host screen", async () => {
    const store = memoryStore();
    const speech = mockSpeech();
    const out = await produceLine({ text: okText(), speech, store }, req());
    expect(out.source).toBe("ai");
    expect(out.line).toMatchObject({
      text: "Applaus für Clara – unsere Geheimwaffe vom Sofa!",
      audioPath: "/api/rooms/ABCD/voice/0123456789abcdef",
      playbackRate: 1,
    });
    // eleven_v3 keeps the whitelisted tag; the speed comes from the tempo.
    expect(speech.speak).toHaveBeenCalledWith("[excited] Applaus für Clara – unsere Geheimwaffe vom Sofa!", expect.objectContaining({ style: "expressive", speed: 1.15 }));
    expect(store.objects.has("rooms/ABCD/voice/0123456789abcdef.mp3")).toBe(true);
  });

  it("speaks the template line when the text model times out", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const speech = mockSpeech();
    const pending = produceLine({ text: text(() => new Promise(() => {})), speech, store: memoryStore() }, req());
    await vi.advanceTimersByTimeAsync(VOICE_CONFIG.textTimeoutMs);
    const out = await pending;
    expect(out.source).toBe("template");
    expect(speech.speak).toHaveBeenCalledWith("Applaus für Clara!", expect.anything());
    expect(out.line?.audioPath).toBeTruthy();
    // Logs contain reasons only – never names or texts.
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/Clara/);
  });

  it("falls back to the template on errors, refusals and unusable replies", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const provider of [
      text(async () => {
        throw new VoiceProviderError("error", "OpenAI text HTTP 500");
      }),
      text(async () => {
        throw new VoiceProviderError("refused", "OpenAI text refused");
      }),
      text(async () => ""),
    ]) {
      const out = await produceLine({ text: provider, speech: mockSpeech(), store: memoryStore() }, req());
      expect(out).toMatchObject({ source: "template", line: { text: "Applaus für Clara!" } });
    }
  });

  it("no line at all when the voice fails (there are no subtitles)", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const pending = produceLine({ text: okText(), speech: mockSpeech(() => new Promise(() => {})), store: memoryStore() }, req());
    await vi.advanceTimersByTimeAsync(VOICE_CONFIG.speechTimeoutMs);
    expect(await pending).toMatchObject({ line: null, voiceStatus: undefined });
  });

  it("reports quota / key problems so the room stops the voice", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const speech = mockSpeech(async () => {
      throw new VoiceProviderError("unavailable", "ElevenLabs 401 quota_exceeded", "401 quota_exceeded");
    });
    const out = await produceLine({ text: okText(), speech, store: memoryStore() }, req());
    expect(out).toMatchObject({ line: null, voiceStatus: "unavailable", errorCode: "401 quota_exceeded" });
  });

  it("counts the characters actually sent and stops at the budget", async () => {
    const reserved: number[] = [];
    const speech = mockSpeech();
    const out = await produceLine(
      { text: text(async () => "[laughs] [dances] Hallo [shouting] Max [gasps]!"), speech, store: memoryStore() },
      req({ reserveChars: async (n) => (reserved.push(n), true) }),
    );
    const sent = speech.speak.mock.calls[0]![0] as string;
    expect(sent).toBe("[laughs] Hallo [shouting] Max!");
    expect(reserved).toEqual([sent.length]);
    expect(out.line?.text).toBe("Hallo Max!");

    const noBudget = mockSpeech();
    const over = await produceLine({ text: okText(), speech: noBudget, store: memoryStore() }, req({ reserveChars: async () => false }));
    expect(over).toMatchObject({ line: null, voiceStatus: "budget" });
    expect(noBudget.speak).not.toHaveBeenCalled();
  });

  it("uses the template without the text model once the line budget is used up", async () => {
    const t = okText();
    const out = await produceLine({ text: t, speech: mockSpeech(), store: memoryStore() }, req({ useAi: false }));
    expect(out.source).toBe("template");
    expect(t.generateLine).not.toHaveBeenCalled();
  });

  it("respects a deadline (commentary must be ready in time)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = okText();
    const speech = mockSpeech();
    const out = await produceLine(
      { text: t, speech, store: memoryStore() },
      req({ deadline: 1000, now: () => 1000, style: "fast" }),
    );
    expect(t.generateLine).not.toHaveBeenCalled();
    expect(speech.speak).not.toHaveBeenCalled();
    expect(out.line).toBeNull();
  });
});

describe("OpenAI text provider (mocked fetch)", () => {
  it("small model, JSON mode for comments", async () => {
    const fetchFn = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
      Response.json({ choices: [{ message: { content: '{"line":"Hi","target":""}' } }] }),
    );
    const provider = createOpenAITextProvider("sk-test", fetchFn as typeof fetch);
    expect(await provider.generateLine({ system: "s", user: "u", json: true })).toBe('{"line":"Hi","target":""}');
    const body = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string);
    expect(body.model).toBe(VOICE_CONFIG.textModel);
    expect(body.response_format).toEqual({ type: "json_object" });
  });
});
