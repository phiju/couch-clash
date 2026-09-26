/**
 * WHEN WHAT PLAYS – the one place that maps the room state (as the host
 * sees it) to music and sound effects. Pure, no Web Audio here.
 *
 * A category can take over via its GameViews `audio` function, e.g. a
 * music round returns { music: null } and plays its own tracks through
 * the same audio engine.
 */
import type { PublicRoomState } from "@couch-clash/shared";

export type MusicId = "lobby" | "think";
export type EffectId = "jingle" | "sting" | "sting-short" | "fanfare";

/**
 * Survival-Finale sounds – the ids are the file names in public/audio
 * (see docs/survival-sounds.md). One-shots are MP3, the seamless loops WAV.
 */
export const SURVIVAL_ONE_SHOT_IDS = [
  "survival-intro",
  "survival-bonus",
  "survival-wrong",
  "survival-elevator-jolt",
  "survival-decay-tick",
  "survival-splash",
  "survival-final-two",
  "survival-winner",
] as const;
export const SURVIVAL_LOOP_IDS = ["survival-slime-bubble-loop", "survival-slime-threat-loop", "survival-warning-lamp-loop"] as const;
export type SurvivalOneShotId = (typeof SURVIVAL_ONE_SHOT_IDS)[number];
export type SurvivalLoopId = (typeof SURVIVAL_LOOP_IDS)[number];
export type SoundId = SurvivalOneShotId | SurvivalLoopId;
export const SOUND_IDS: readonly SoundId[] = [...SURVIVAL_ONE_SHOT_IDS, ...SURVIVAL_LOOP_IDS];

export type AudioId = MusicId | EffectId | SoundId;

export const MUSIC_IDS: readonly MusicId[] = ["lobby", "think"];
export const EFFECT_IDS: readonly EffectId[] = ["jingle", "sting", "sting-short", "fanfare"];

export interface AudioScene {
  /** Changes whenever something should (re)trigger – same key = no change. */
  key: string;
  /** Background loop, or null for silence. */
  music: MusicId | null;
  /** Relative loop volume (1 = normal). */
  musicLevel?: number;
  /** Fade/crossfade time in seconds (default 0.8). */
  musicFade?: number;
  /** One-shot played when entering the scene (music is ducked meanwhile). */
  enter?: EffectId;
  /** Music after the `enter` one-shot has finished (e.g. quiet lobby after the fanfare). */
  afterEnter?: { music: MusicId | null; musicLevel?: number; musicFade?: number };
}

/** What a category module wants while it is playing (without the key). */
export type ModuleAudioScene = Omit<AudioScene, "key"> & { key?: string };

/** Standard mapping for question → reveal → leaderboard categories (quiz, estimate, …). */
export function questionRoundAudio(state: { step?: string; index?: number } | null): ModuleAudioScene | null {
  if (!state?.step) return null;
  const i = state.index ?? 0;
  switch (state.step) {
    case "question":
      return { key: `question:${i}`, music: "think" };
    case "reveal":
      // Stop the think loop quickly, hit the sting.
      return { key: `reveal:${i}`, music: null, musicFade: 0.3, enter: "sting" };
    case "leaderboard":
      // The lobby loop fades back in under the leaderboard.
      return { key: `leaderboard:${i}`, music: "lobby", musicFade: 1.5 };
    default:
      return null;
  }
}

/**
 * @param moduleAudio what the current category wants (only used in phase "play")
 */
export function audioSceneFor(
  room: Pick<PublicRoomState, "phase" | "game"> | null,
  moduleAudio: ModuleAudioScene | null = null,
): AudioScene | null {
  if (!room) return null;
  const round = room.game?.roundIndex ?? 0;
  switch (room.phase) {
    case "lobby":
      return { key: "lobby", music: "lobby" };
    case "intro":
      return { key: `intro:${round}`, music: "lobby", enter: "sting-short" };
    case "play": {
      if (!moduleAudio) return { key: `play:${round}`, music: "lobby" };
      const { key, ...rest } = moduleAudio;
      return { ...rest, key: `play:${round}:${key ?? "module"}` };
    }
    case "scoreboard":
      return { key: `scoreboard:${round}`, music: "lobby", enter: "sting" };
    case "finale":
      return {
        key: "finale",
        music: null,
        musicFade: 0.5,
        enter: "fanfare",
        afterEnter: { music: "lobby", musicLevel: 0.45, musicFade: 2 },
      };
  }
}
