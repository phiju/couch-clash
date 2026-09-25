"use client";

import type { QuizLikePublicState } from "@couch-clash/games/meta";
import { useState } from "react";
import { Explanation } from "../fuehrerschein/exam";
import { MediaView } from "../fuehrerschein/media";
import { AnswerSent, Countdown, PlayerRevealResult, QuestionLeaderboard } from "../question-round/components";
import type { PlayerViewProps } from "../types";
import { QUIZ_OPTION_STYLES } from "./options";

export function QuizPlayerView({ state, room, me, sendAction }: PlayerViewProps<QuizLikePublicState>) {
  // Optimistic: show "sent" right away; the server state confirms it.
  const [sentFor, setSentFor] = useState<number | null>(null);
  const reveal = state.reveal;

  if (state.step === "leaderboard") {
    return <QuestionLeaderboard state={state} room={room} variant="phone" meId={me.id} />;
  }

  if (reveal) {
    const mine = reveal.answers[me.id];
    const correct = reveal.solution.correctIndex;
    return (
      <PlayerRevealResult result={reveal.results[me.id]}>
        <p className="text-xl">
          Richtig war:{" "}
          <span className="font-bold text-bulb">
            {QUIZ_OPTION_STYLES[correct]?.shape} {state.question.options[correct]}
          </span>
        </p>
        {mine !== undefined && mine !== correct && (
          <p className="text-lg text-cream/60">Deine Antwort: {state.question.options[mine]}</p>
        )}
        {reveal.solution.explanation && <Explanation text={reveal.solution.explanation} variant="phone" />}
      </PlayerRevealResult>
    );
  }

  const answered = state.myAnswer !== null || sentFor === state.index;

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <Countdown startedAt={state.questionStartedAt} endsAt={state.stepEndsAt} size="sm" />
      <p className="panel px-5 py-4 text-center text-2xl leading-snug font-bold text-balance">{state.question.text}</p>
      {/* Führerschein: small, still version of the sign / scene above the buttons. */}
      {state.question.media && !answered && (
        <div className="flex justify-center">
          <MediaView media={state.question.media} variant="phone" />
        </div>
      )}
      {answered ? (
        <div className="flex flex-1 items-center justify-center">
          <AnswerSent>
            {state.myAnswer !== null && (
              <p className="text-xl">
                {QUIZ_OPTION_STYLES[state.myAnswer]?.shape} {state.question.options[state.myAnswer]}
              </p>
            )}
          </AnswerSent>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-4">
          {state.question.options.map((option, i) => {
            const style = QUIZ_OPTION_STYLES[i]!;
            return (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setSentFor(state.index);
                  sendAction({ type: "answer", value: i });
                }}
                className={`flex min-h-20 items-center gap-4 rounded-[2rem] border-4 border-bulb px-5 py-4 text-left text-2xl font-bold transition active:translate-y-1 active:shadow-none ${style.bg} ${style.shadow}`}
              >
                <span className="text-3xl opacity-80">{style.shape}</span>
                <span>{option}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
