"use client";

import type { QuizPublicState } from "@couch-clash/games/meta";
import {
  AnsweredStrip,
  Countdown,
  QuestionCounter,
  QuestionLeaderboard,
  RevealTable,
} from "../question-round/components";
import type { HostViewProps } from "../types";
import { OptionGrid } from "./option-grid";
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
        <OptionGrid
          options={state.question.options}
          correct={correct ?? null}
          answers={reveal?.answers ?? null}
          room={room}
        />

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
