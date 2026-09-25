/** Pure helpers for the Bluff-Lexikon views (tested). */
import type { BluffPublicState, BluffResult } from "@couch-clash/games/meta";
import type { ModuleAudioScene } from "@/lib/audio/scenes";

/**
 * Which option is being read out: the host's voice line tells (cue
 * "option:2"); without a voice every option is shown for ~3 s.
 */
export function presentHighlight(
  state: Pick<BluffPublicState, "step" | "options" | "stepStartedAt" | "presentLeadMs" | "presentMsPerOption">,
  now: number,
  cue: string | null | undefined,
): number | null {
  if (state.step !== "present" || !state.options) return null;
  const fromCue = cue?.match(/^option:(\d+)$/);
  if (fromCue) {
    const i = Number(fromCue[1]);
    return i < state.options.length ? i : null;
  }
  const elapsed = now - state.stepStartedAt - state.presentLeadMs;
  if (elapsed < 0) return null;
  return Math.min(state.options.length - 1, Math.floor(elapsed / state.presentMsPerOption));
}

/** "Richtig getippt +100 · 2 reingelegt +100 · Gewusst! +100" */
export function resultParts(r: BluffResult, maxPoints: number, perFooledShare: number): string[] {
  const parts: string[] = [];
  if (r.knewIt) parts.push(`Gewusst! +${maxPoints}`);
  if (r.votedCorrect) parts.push(`Richtig getippt +${maxPoints}`);
  if (r.fooled > 0) parts.push(`${r.fooled} reingelegt +${r.fooled * Math.round(maxPoints * perFooledShare)}`);
  return parts;
}

/** Music: think loop while writing/voting, quiet while reading, sting for the real definition. */
export function bluffAudio(state: Pick<BluffPublicState, "step" | "index"> | null): ModuleAudioScene | null {
  if (!state?.step) return null;
  const i = state.index;
  switch (state.step) {
    case "write":
    case "check":
      return { key: `write:${i}`, music: "think" };
    case "present":
      return { key: `present:${i}`, music: "think", musicLevel: 0.35, musicFade: 1 };
    case "vote":
      return { key: `vote:${i}`, music: "think" };
    case "reveal":
      return { key: `reveal:${i}`, music: null, musicFade: 0.4 };
    case "solution":
      return { key: `solution:${i}`, music: null, enter: "sting" };
    case "leaderboard":
      return { key: `leaderboard:${i}`, music: "lobby", musicFade: 1.5 };
  }
}
