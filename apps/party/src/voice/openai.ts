import { VOICE_CONFIG } from "./config";
import {
  VoiceProviderError,
  type LinePrompt,
  type SpeechProvider,
  type TextProvider,
} from "./provider";

const CHAT_URL = "https://api.openai.com/v1/chat/completions";
const SPEECH_URL = "https://api.openai.com/v1/audio/speech";

/** Chat Completions with a small model. Never logs prompts or answers. */
export function createOpenAITextProvider(apiKey: string, fetchFn: typeof fetch = fetch): TextProvider {
  return {
    async generateLine(prompt: LinePrompt, options = {}) {
      const res = await fetchFn(CHAT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: VOICE_CONFIG.textModel,
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          max_tokens: 160,
          temperature: 1,
          ...(prompt.json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: options.signal,
      });
      let body: {
        choices?: { message?: { content?: string | null; refusal?: string | null } }[];
        error?: { code?: string | null };
      } = {};
      try {
        body = await res.json();
      } catch {
        // handled below
      }
      if (!res.ok) throw new VoiceProviderError("error", `OpenAI text HTTP ${res.status} ${body.error?.code ?? ""}`.trim());
      const message = body.choices?.[0]?.message;
      if (message?.refusal) throw new VoiceProviderError("refused", "OpenAI text refused");
      const content = message?.content?.trim();
      if (!content) throw new VoiceProviderError("error", "OpenAI text empty");
      return content;
    },
  };
}

/** Text-to-speech (mp3) with style instructions. */
export function createOpenAISpeechProvider(apiKey: string, fetchFn: typeof fetch = fetch): SpeechProvider {
  return {
    async speak(text, options = {}) {
      const res = await fetchFn(SPEECH_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: VOICE_CONFIG.speechModel,
          voice: VOICE_CONFIG.voice,
          input: text,
          instructions: VOICE_CONFIG.style,
          response_format: "mp3",
        }),
        signal: options.signal,
      });
      if (!res.ok) throw new VoiceProviderError("error", `OpenAI speech HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0) throw new VoiceProviderError("error", "OpenAI speech empty");
      return { bytes, mimeType: "audio/mpeg" };
    },
  };
}
