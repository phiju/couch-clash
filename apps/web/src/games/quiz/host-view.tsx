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
    <div className="flex min-h-0 w-full flex-1 flex-col gap-[2.2vh]">
      <div className="flex shrink-0 items-center justify-between gap-[1.5vw]">
        <QuestionCounter state={state} />
        {!reveal && (
          <div className="flex-1">
            <Countdown startedAt={state.questionStartedAt} endsAt={state.stepEndsAt} />
          </div>
        )}
      </div>

      <h2 className="panel fs-title shrink-0 px-[2vw] py-[2.2vh] text-center font-bold text-balance">
        {state.question.text}
      </h2>

      <div className={`grid min-h-0 flex-1 gap-[1.5vw] ${reveal ? "lg:grid-cols-[3fr_2fr]" : ""}`}>
        <ul className="grid content-start gap-[2vh] sm:grid-cols-2">
          {state.question.options.map((option, i) => {
            const style = QUIZ_OPTION_STYLES[i]!;
            const isCorrect = correct === i;
            const pickedBy = reveal
              ? room.players.filter((p) => reveal.answers[p.id] === i)
              : [];
            return (
              <li
                key={i}
                className={`flex min-h-[12vh] flex-col justify-center gap-[1vh] rounded-[2rem] border-4 border-bulb px-[1.5vw] py-[1.6vh] transition duration-500 ${style.bg} ${style.shadow} ${
                  reveal && !isCorrect ? "scale-95 opacity-30 grayscale" : ""
                } ${reveal && isCorrect ? "scale-105 ring-8 ring-cream/90" : ""}`}
              >
                <div className="flex items-center gap-4">
                  <span className="fs-xl opacity-80">{style.shape}</span>
                  <span className="fs-xl font-bold">{option}</span>
                  {isCorrect && <span className="fs-title ml-auto">✅</span>}
                </div>
                {pickedBy.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {pickedBy.map((p) => (
                      <AvatarBadge key={p.id} avatar={p.avatar} size="fluidSm" className="animate-pop" />
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
