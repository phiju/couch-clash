import type { FuehrerscheinPublicState } from "@couch-clash/games/meta";
import type { GameViews } from "../types";
import { FuehrerscheinHostView } from "./host-view";
import { Clipboard, FahrschuleIntro } from "./intro";
import { fuehrerscheinAudio } from "./logic";
import { FuehrerscheinPlayerView } from "./player-view";

export const fuehrerscheinViews: GameViews<FuehrerscheinPublicState> = {
  HostView: FuehrerscheinHostView,
  PlayerView: FuehrerscheinPlayerView,
  audio: fuehrerscheinAudio,
  IntroDecor: FahrschuleIntro,
  MascotProp: Clipboard,
};
