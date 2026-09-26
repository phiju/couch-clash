import { plainFetch, type FetchFor } from "../costs/meter";
import { createOpenAIProvider } from "./openai";
import type { AvatarProvider } from "./provider";

/** The one place that picks the image provider (swap for e.g. Gemini here). */
export function createAvatarProvider(env: { OPENAI_API_KEY?: string }, fetchFor: FetchFor = plainFetch): AvatarProvider | null {
  // The meter tells round avatars, faces and figures apart by the request.
  return env.OPENAI_API_KEY ? createOpenAIProvider(env.OPENAI_API_KEY, fetchFor("avatar-round")) : null;
}
