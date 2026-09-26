/** Pure helpers for the Stadt-Land-Fluss views (tested). */
import type { SlfPublicAnswer, SlfPublicState } from "@couch-clash/games/meta";
import type { ModuleAudioScene } from "@/lib/audio/scenes";

/**
 * Which category the host is reading: the voice line tells (cue
 * "category:2"); without a voice each category is shown for its own time.
 */
export function readingCategory(
  state: Pick<SlfPublicState, "step" | "stepStartedAt" | "reveal">,
  now: number,
  cue: string | null | undefined,
): number | null {
  const categories = state.reveal?.categories;
  if (state.step !== "reveal" || !categories?.length) return null;
  const fromCue = cue?.match(/^category:(\d+)$/);
  if (fromCue) {
    const i = Number(fromCue[1]);
    return i < categories.length ? i : null;
  }
  const elapsed = now - state.stepStartedAt;
  let index = 0;
  categories.forEach((c, i) => {
    if (elapsed >= c.startsAtMs) index = i;
  });
  return index;
}

/** "✗ falscher Buchstabe", "doppelt", … – the small print next to an answer. */
export function answerTags(a: Pick<SlfPublicAnswer, "verdict" | "duplicate" | "only" | "typo">): string[] {
  const tags: string[] = [];
  if (a.verdict === "letter") tags.push("✗ falscher Buchstabe");
  if (a.verdict === "invalid") tags.push("✗ gibt's nicht");
  if (a.verdict === "censored") tags.push("🙊 zensiert");
  if (a.only) tags.push("⭐ als Einzige(r)");
  else if (a.duplicate) tags.push("👯 doppelt");
  if (a.typo) tags.push("✍️ Tippfehler");
  return tags;
}

/** What a phone may send: all fields filled → "Stopp!" allowed. */
export function allFilled(answers: readonly string[], count: number): boolean {
  return answers.length >= count && answers.slice(0, count).every((a) => a.trim().length > 0);
}

/** Music: think loop while writing and voting, quiet while the host reads, a sting for the letter and the winner. */
export function slfAudio(state: Pick<SlfPublicState, "step" | "index"> | null): ModuleAudioScene | null {
  if (!state?.step) return null;
  const i = state.index;
  switch (state.step) {
    case "intro":
      return { key: `intro:${i}`, music: null, musicFade: 0.4, enter: "sting-short" };
    case "write":
      return { key: `write:${i}`, music: "think" };
    case "check":
    case "script":
      return { key: `check:${i}`, music: "think", musicLevel: 0.35, musicFade: 1 };
    case "reveal":
      return { key: `reveal:${i}`, music: "think", musicLevel: 0.25, musicFade: 1 };
    case "vote":
      return { key: `vote:${i}`, music: "think" };
    case "tally":
      return { key: `tally:${i}`, music: null, musicFade: 0.4, enter: "sting" };
    case "leaderboard":
      return { key: `leaderboard:${i}`, music: "lobby", musicFade: 1.5 };
  }
}

/** The host's "Weiter" button per step. */
export function slfSkipLabel(state: Pick<SlfPublicState, "step">): string {
  switch (state.step) {
    case "intro":
      return "Los ⏭";
    case "write":
      return "Zeit um ⏭";
    case "reveal":
      return "Abstimmung ⏭";
    case "vote":
      return "Auswerten ⏭";
    case "tally":
      return "Rangliste ⏭";
    default:
      return "Weiter ⏭";
  }
}
