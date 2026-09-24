import type { EstimatePublicState } from "@couch-clash/games/meta";
import type { GameViews } from "../types";
import { EstimateHostView } from "./host-view";
import { EstimatePlayerView } from "./player-view";

export const estimateViews: GameViews<EstimatePublicState> = {
  HostView: EstimateHostView,
  PlayerView: EstimatePlayerView,
};
