/**
 * ElevenLabs audio tags like "[laughs]". eleven_v3 understands a few of
 * them (whitelist, max 2 per line); everything else is removed so it is
 * never read out loud.
 */
import { AUDIO_TAG_WHITELIST, MAX_AUDIO_TAGS } from "./config";

const TAG = /\[([^\]\n]{0,40})\]/g;

function tidy(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

/** Keeps at most MAX_AUDIO_TAGS whitelisted tags, drops the rest. */
export function keepAllowedTags(text: string): string {
  let kept = 0;
  const out = text.replace(TAG, (_, raw: string) => {
    const name = raw.trim().toLowerCase();
    if ((AUDIO_TAG_WHITELIST as readonly string[]).includes(name) && kept < MAX_AUDIO_TAGS) {
      kept++;
      return `[${name}]`;
    }
    return " ";
  });
  return tidy(out);
}

/** Removes every [tag] (models without tag support, and the text itself). */
export function stripTags(text: string): string {
  return tidy(text.replace(TAG, " "));
}
