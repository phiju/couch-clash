import { GENERATION_CONFIG } from "./config";

/** One JSON answer from a chat model. */
export type JsonModel = (system: string, user: string) => Promise<unknown>;

const CHAT_URL = "https://api.openai.com/v1/chat/completions";

export interface JsonModelOptions {
  model?: string;
  temperature?: number;
  timeoutMs?: number;
}

/** OpenAI JSON mode. Never logs prompts or answers. */
export function createOpenAIJsonModel(apiKey: string, fetchFn: typeof fetch = fetch, options: JsonModelOptions = {}): JsonModel {
  return async (system, user) => {
    const res = await fetchFn(CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options.model ?? GENERATION_CONFIG.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: options.temperature ?? 0.9,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? GENERATION_CONFIG.timeoutMs),
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI: leere Antwort");
    try {
      return JSON.parse(content);
    } catch {
      throw new Error("OpenAI: kein gültiges JSON");
    }
  };
}
