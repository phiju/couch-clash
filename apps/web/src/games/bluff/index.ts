import type { BluffPublicState } from "@couch-clash/games/meta";
import type { GameViews } from "../types";
import { BluffHostView } from "./host-view";
import { bluffAudio } from "./logic";
import { BluffPlayerView } from "./player-view";

export const bluffViews: GameViews<BluffPublicState> = {
  HostView: BluffHostView,
  PlayerView: BluffPlayerView,
  audio: bluffAudio,
};
