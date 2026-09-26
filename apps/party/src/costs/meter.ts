/**
 * Measures every paid API call: a fetch wrapper that reads the token counts
 * from the answer (OpenAI) or counts the characters (text-to-speech) and
 * hands one entry to `record`. Never looks at more than the numbers; a
 * failed measurement never breaks the call itself.
 */
import type { CostKind, CostService } from "@couch-clash/shared";
import {
  CHAT_PRICES,
  ELEVENLABS_CREDITS_PER_CHAR,
  FALLBACK_CHAT,
  FALLBACK_IMAGE,
  IMAGE_PRICES,
  SPEECH_USD_PER_CHAR,
} from "./prices";

export interface UsageEntry {
  service: CostService;
  kind: CostKind;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  units: number;
  usd: number;
}

export type RecordUsage = (entry: UsageEntry) => void;

/** Gives each provider its measured fetch (one kind per provider). */
export type FetchFor = (kind: CostKind) => typeof fetch;

export const plainFetch: FetchFor = () => (input, init) => fetch(input, init);

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
}

const M = 1_000_000;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function formField(body: unknown, name: string): string | null {
  if (!(body instanceof FormData)) return null;
  const v = body.get(name);
  return typeof v === "string" ? v : null;
}

function jsonBody(body: unknown): Record<string, unknown> | null {
  if (typeof body !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Image calls: which avatar image it was, from the request (figures: transparent; faces: low quality). */
export function avatarKind(body: unknown): CostKind {
  if (formField(body, "background") === "transparent") return "avatar-figure";
  if (formField(body, "quality") === "low") return "avatar-face";
  return "avatar-round";
}

export function imageUsage(model: string, usage: OpenAIUsage): Omit<UsageEntry, "kind"> {
  const price = IMAGE_PRICES[model] ?? FALLBACK_IMAGE;
  const input = num(usage.input_tokens);
  const imageIn = num(usage.input_tokens_details?.image_tokens);
  const textIn = usage.input_tokens_details ? num(usage.input_tokens_details.text_tokens) : input;
  const output = num(usage.output_tokens);
  return {
    service: "openai",
    calls: 1,
    inputTokens: input,
    outputTokens: output,
    units: 0,
    usd: (textIn * price.textInput + imageIn * price.imageInput + output * price.output) / M,
  };
}

export function chatUsage(model: string, usage: OpenAIUsage): Omit<UsageEntry, "kind"> {
  const price = CHAT_PRICES[model] ?? FALLBACK_CHAT;
  const input = num(usage.prompt_tokens);
  const output = num(usage.completion_tokens);
  return { service: "openai", calls: 1, inputTokens: input, outputTokens: output, units: 0, usd: (input * price.input + output * price.output) / M };
}

/** The entry for one successful call, or null when it isn't a paid API we know. */
export async function usageFor(kind: CostKind, url: string, init: RequestInit | undefined, res: Response): Promise<UsageEntry | null> {
  const body = init?.body;
  if (url.startsWith("https://api.openai.com/v1/images/")) {
    const answer = (await res.json()) as { usage?: OpenAIUsage };
    const model = formField(body, "model") ?? "";
    return { kind: avatarKind(body), ...imageUsage(model, answer.usage ?? {}) };
  }
  if (url.startsWith("https://api.openai.com/v1/chat/completions")) {
    const answer = (await res.json()) as { model?: string; usage?: OpenAIUsage };
    const model = String(jsonBody(body)?.model ?? answer.model ?? "");
    return { kind, ...chatUsage(model, answer.usage ?? {}) };
  }
  if (url.startsWith("https://api.openai.com/v1/audio/speech")) {
    const request = jsonBody(body);
    const chars = String(request?.input ?? "").length;
    const perChar = SPEECH_USD_PER_CHAR[String(request?.model ?? "")] ?? 0.000017;
    return { service: "openai", kind, calls: 1, inputTokens: 0, outputTokens: 0, units: 0, usd: chars * perChar };
  }
  if (url.startsWith("https://api.elevenlabs.io/v1/text-to-speech")) {
    const request = jsonBody(body);
    const chars = String(request?.text ?? "").length;
    const credits = Math.ceil(chars * (ELEVENLABS_CREDITS_PER_CHAR[String(request?.model_id ?? "")] ?? 1));
    // Paid by the monthly plan (a fixed cost) – only the credits are counted.
    return { service: "elevenlabs", kind, calls: 1, inputTokens: 0, outputTokens: 0, units: credits, usd: 0 };
  }
  return null;
}

/** A fetch that measures successful calls. Unsuccessful ones aren't billed and aren't counted. */
export function meteredFetch(record: RecordUsage, kind: CostKind, base: typeof fetch = (i, n) => fetch(i, n)): typeof fetch {
  return async (input, init) => {
    const res = await base(input, init);
    if (res.ok) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      try {
        const entry = await usageFor(kind, url, init, res.clone());
        if (entry) record(entry);
      } catch {
        console.warn("cost metering failed for one call");
      }
    }
    return res;
  };
}

/** Measured fetches for all providers, recording into `record`. */
export function meteredFetchFor(record: RecordUsage): FetchFor {
  return (kind) => meteredFetch(record, kind);
}
