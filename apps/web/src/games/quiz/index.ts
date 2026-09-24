import type { QuizPublicState } from "@couch-clash/games/meta";
import { questionRoundAudio } from "@/lib/audio/scenes";
import type { GameViews } from "../types";
import { QuizHostView } from "./host-view";
import { QuizPlayerView } from "./player-view";

export const quizViews: GameViews<QuizPublicState> = {
  HostView: QuizHostView,
  PlayerView: QuizPlayerView,
  audio: questionRoundAudio,
};
