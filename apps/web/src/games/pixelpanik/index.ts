import type { PixelpanikPublicState } from "@couch-clash/games/meta";
import type { GameViews } from "../types";
import { PixelpanikHostView } from "./host-view";
import { pixelpanikAudio, pixelpanikSkipLabel } from "./logic";
import { PixelpanikPlayerView } from "./player-view";

export const pixelpanikViews: GameViews<PixelpanikPublicState> = {
  HostView: PixelpanikHostView,
  PlayerView: PixelpanikPlayerView,
  audio: pixelpanikAudio,
  skipLabel: pixelpanikSkipLabel,
};
