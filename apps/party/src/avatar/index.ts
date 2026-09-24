import { createOpenAIProvider } from "./openai";
import type { AvatarProvider } from "./provider";

/** The one place that picks the image provider (swap for e.g. Gemini here). */
export function createAvatarProvider(env: { OPENAI_API_KEY?: string }): AvatarProvider | null {
  return env.OPENAI_API_KEY ? createOpenAIProvider(env.OPENAI_API_KEY) : null;
}
