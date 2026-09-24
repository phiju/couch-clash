"use client";

import type { QuizPublicState } from "@couch-clash/games/meta";
import { AvatarBadge } from "@/components/avatar";
import {
  AnsweredStrip,
  Countdown,
  QuestionCounter,
  QuestionLeaderboard,
  RevealTable,
} from "../question-round/components";
import type { HostViewProps } from "../types";
import { QUIZ_OPTION_STYLES } from "./options";

export function QuizHostView({ state, room }: HostViewProps<QuizPublicState>) {
  if (state.step === "leaderboard") return <QuestionLeaderboard state={state} room={room} variant="tv" />;
  const reveal = state.reveal;
  const correct = reveal?.solution.correctIndex;

  return (
    <div className="flex w-full flex-1 flex-col gap-8">
      <div className="flex items-center justify-between gap-6">
        <QuestionCounter state={state} />
        {!reveal && (
          <div className="flex-1">
            <Countdown startedAt={state.questionStartedAt} endsAt={state.stepEndsAt} />
          </div>
        )}
      </div>

      <h2 className="text-center text-5xl leading-tight font-black text-balance lg:text-7xl">
        {state.question.text}
      </h2>

      <div className={`grid flex-1 gap-8 ${reveal ? "lg:grid-cols-[3fr_2fr]" : ""}`}>
        <ul className="grid content-start gap-5 sm:grid-cols-2">
          {state.question.options.map((option, i) => {
            const style = QUIZ_OPTION_STYLES[i]!;
            const isCorrect = correct === i;
            const pickedBy = reveal
              ? room.players.filter((p) => reveal.answers[p.id] === i)
              : [];
            return (
              <li
                key={i}
                className={`flex min-h-28 flex-col justify-center gap-3 rounded-3xl px-6 py-5 transition duration-500 ${style.bg} ${
                  reveal && !isCorrect ? "scale-95 opacity-30 grayscale" : ""
                } ${reveal && isCorrect ? "scale-105 ring-8 ring-white" : ""}`}
              >
                <div className="flex items-center gap-4">
                  <span className="text-4xl text-white/80">{style.shape}</span>
                  <span className="text-3xl font-black text-white drop-shadow lg:text-4xl">{option}</span>
                  {isCorrect && <span className="ml-auto text-5xl">✅</span>}
                </div>
                {pickedBy.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {pickedBy.map((p) => (
                      <AvatarBadge key={p.id} avatar={p.avatar} size="sm" className="animate-pop" />
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {reveal && (
          <RevealTable
            room={room}
            results={reveal.results}
            accuracyLabel="richtig"
            showAccuracy={false}
            renderAnswer={(p) => {
              const a = reveal.answers[p.id];
              if (a === undefined) return "keine Antwort";
              return `${QUIZ_OPTION_STYLES[a]?.shape ?? ""} ${state.question.options[a]}`;
            }}
          />
        )}
      </div>

      {!reveal && <AnsweredStrip state={state} room={room} />}
    </div>
  );
}
