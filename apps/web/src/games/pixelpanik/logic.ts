import { PIXELPANIK_CONFIG, type PixelpanikPublicPlayer, type PixelpanikPublicState } from "@couch-clash/games/meta";
import type { PhotoExpression } from "@couch-clash/shared";
import type { ModuleAudioScene } from "@/lib/audio/scenes";

/** Think music while the picture sharpens, a short sting on the snap to full resolution, the usual sting at the solution. */
export function pixelpanikAudio(state: Pick<PixelpanikPublicState, "step" | "index" | "stage" | "stages"> | null): ModuleAudioScene | null {
  if (!state?.step) return null;
  const i = state.index;
  if (state.step === "stage") {
    const snap = state.stage === state.stages.length - 1;
    return snap ? { key: `snap:${i}`, music: "think", enter: "sting-short" } : { key: `stage:${i}`, music: "think" };
  }
  if (state.step === "reveal") return { key: `reveal:${i}`, music: null, musicFade: 0.3, enter: "sting" };
  return { key: `leaderboard:${i}`, music: "lobby", musicFade: 1.5 };
}

/** The host's "Weiter" button: sharpen now, solve, leaderboard, next. */
export function pixelpanikSkipLabel(state: Pick<PixelpanikPublicState, "step" | "stage" | "stages">): string {
  if (state.step === "stage") return state.stage < state.stages.length - 1 ? "Schärfer ⏭" : "Auflösen ⏭";
  if (state.step === "reveal") return "Rangliste ⏭";
  return "Weiter ⏭";
}

export interface AvatarReaction {
  expression: PhotoExpression;
  /** Early hit (4×4 / 8×8): the avatar zooms in. */
  zoom: boolean;
  dimmed: boolean;
}

/** How a player's avatar reacts on the TV: zoom-in + cheering for an early hit, sad when out. */
export function avatarReaction(player: Pick<PixelpanikPublicPlayer, "status" | "stage"> | undefined): AvatarReaction {
  if (player?.status === "correct") {
    const early = player.stage !== null && player.stage < PIXELPANIK_CONFIG.earlyStages;
    return { expression: "jubelnd", zoom: early, dimmed: false };
  }
  if (player?.status === "out") return { expression: "enttaeuscht", zoom: false, dimmed: true };
  if (player?.status === "locked") return { expression: "enttaeuscht", zoom: false, dimmed: false };
  return { expression: "neutral", zoom: false, dimmed: false };
}
