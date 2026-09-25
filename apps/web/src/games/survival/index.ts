import type { SurvivalPublicState } from "@couch-clash/games/meta";
import type { GameViews } from "../types";
import { SurvivalHostView } from "./host-view";
import { survivalAudio, survivalSkipLabel } from "./logic";
import { SurvivalPlayerView } from "./player-view";

export const survivalViews: GameViews<SurvivalPublicState> = {
  HostView: SurvivalHostView,
  PlayerView: SurvivalPlayerView,
  audio: survivalAudio,
  skipLabel: survivalSkipLabel,
};
