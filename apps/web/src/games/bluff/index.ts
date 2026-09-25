import type { BluffPublicState } from "@couch-clash/games/meta";
import type { GameViews } from "../types";
import { createBluffHostView } from "./host-view";
import { bluffAudio } from "./logic";
import { createBluffPlayerView } from "./player-view";
import { LEXIKON_TEXTS, SKURRIL_TEXTS, type BluffUiTexts } from "./texts";

/** Views for a game on the bluff engine (shared components, own texts). */
export function createBluffViews(texts: BluffUiTexts): GameViews<BluffPublicState> {
  return {
    HostView: createBluffHostView(texts),
    PlayerView: createBluffPlayerView(texts),
    audio: bluffAudio,
  };
}

export const bluffViews = createBluffViews(LEXIKON_TEXTS);
export const skurrilViews = createBluffViews(SKURRIL_TEXTS);
