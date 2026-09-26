/**
 * API prices for the cost overview (USD). Estimates from the providers'
 * price lists – update them here when the prices change.
 */

/** OpenAI chat models: USD per 1M tokens. */
export const CHAT_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1": { input: 2, output: 8 },
};

/** OpenAI image models: USD per 1M tokens (text input, image input, image output). */
export const IMAGE_PRICES: Record<string, { textInput: number; imageInput: number; output: number }> = {
  "gpt-image-2": { textInput: 5, imageInput: 8, output: 30 },
};

/** OpenAI text-to-speech (no token counts in the answer): USD per character, about $0.015 per minute. */
export const SPEECH_USD_PER_CHAR: Record<string, number> = {
  "gpt-4o-mini-tts": 0.000017,
};

/** ElevenLabs credits per character by model (eleven_v3: 1, flash: 0.5). */
export const ELEVENLABS_CREDITS_PER_CHAR: Record<string, number> = {
  eleven_v3: 1,
  eleven_multilingual_v2: 1,
  eleven_flash_v2_5: 0.5,
  eleven_turbo_v2_5: 0.5,
};

/** Unknown model: price it like the most expensive known one (better too high than invisible). */
export const FALLBACK_CHAT = { input: 2, output: 8 };
export const FALLBACK_IMAGE = { textInput: 5, imageInput: 10, output: 40 };
