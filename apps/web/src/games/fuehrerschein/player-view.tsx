"use client";

import type { FuehrerscheinPublicState } from "@couch-clash/games/meta";
import { QuizPlayerView } from "../quiz/player-view";
import type { PlayerViewProps } from "../types";
import { ExamResultPhone } from "./exam";

/** The quiz on the phone (with the small picture and the explanation) + the own exam result at the end. */
export function FuehrerscheinPlayerView(props: PlayerViewProps<FuehrerscheinPublicState>) {
  const { state, me } = props;
  if (state.step === "summary") return state.summary ? <ExamResultPhone summary={state.summary} meId={me.id} /> : null;
  return <QuizPlayerView {...props} />;
}
