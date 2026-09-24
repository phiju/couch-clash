"use client";

import type { QuizPublicState } from "@couch-clash/games/meta";
import { useState } from "react";
import { AnswerSent, Countdown, PlayerRevealResult, QuestionLeaderboard } from "../question-round/components";
import type { PlayerViewProps } from "../types";
import { QUIZ_OPTION_STYLES } from "./options";

export function QuizPlayerView({ state, room, me, sendAction }: PlayerViewProps<QuizPublicState>) {
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
          <span className="font-black text-spot">
            {QUIZ_OPTION_STYLES[correct]?.shape} {state.question.options[correct]}
          </span>
        </p>
        {mine !== undefined && mine !== correct && (
          <p className="text-lg text-white/60">Deine Antwort: {state.question.options[mine]}</p>
        )}
      </PlayerRevealResult>
    );
  }

  const answered = state.myAnswer !== null || sentFor === state.index;

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <Countdown startedAt={state.questionStartedAt} endsAt={state.stepEndsAt} size="sm" />
      <p className="text-center text-2xl leading-snug font-black text-balance">{state.question.text}</p>
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
                className={`flex min-h-20 items-center gap-4 rounded-3xl px-5 py-4 text-left text-2xl font-black text-white transition active:translate-y-1 active:shadow-none ${style.bg} ${style.shadow}`}
              >
                <span className="text-3xl text-white/80">{style.shape}</span>
                <span className="drop-shadow">{option}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
