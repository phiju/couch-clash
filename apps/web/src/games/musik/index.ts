import type { MusikPublicState } from "@couch-clash/games/meta";
import type { GameViews } from "../types";
import { MusikHostView } from "./host-view";
import { musikAudio, musikSkipLabel } from "./logic";
import { MusikPlayerView } from "./player-view";

export const musikViews: GameViews<MusikPublicState> = {
  HostView: MusikHostView,
  PlayerView: MusikPlayerView,
  audio: musikAudio,
  skipLabel: musikSkipLabel,
};
