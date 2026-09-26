import type { SlfPublicState } from "@couch-clash/games/meta";
import type { GameViews } from "../types";
import { SlfHostView } from "./host-view";
import { slfAudio, slfSkipLabel } from "./logic";
import { SlfPlayerView } from "./player-view";

export const slfViews: GameViews<SlfPublicState> = {
  HostView: SlfHostView,
  PlayerView: SlfPlayerView,
  audio: slfAudio,
  skipLabel: slfSkipLabel,
};
