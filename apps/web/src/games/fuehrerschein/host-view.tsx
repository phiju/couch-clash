"use client";

import type { FuehrerscheinPublicState } from "@couch-clash/games/meta";
import { AnsweredStrip, Countdown, QuestionCounter, QuestionLeaderboard, RevealTable } from "../question-round/components";
import { OptionGrid } from "../quiz/option-grid";
import { QUIZ_OPTION_STYLES } from "../quiz/options";
import type { HostViewProps } from "../types";
import { ExamHeader, ExamResultsTv, Explanation } from "./exam";
import { mediaKind } from "./logic";
import { MediaView } from "./media";

export function FuehrerscheinHostView({ state, room }: HostViewProps<FuehrerscheinPublicState>) {
  if (state.step === "leaderboard") return <QuestionLeaderboard state={state} room={room} variant="tv" />;
  if (state.step === "summary") return state.summary ? <ExamResultsTv summary={state.summary} room={room} /> : null;
  const reveal = state.reveal;
  const correct = reveal?.solution.correctIndex ?? null;
  const media = state.question.media;
  const kind = mediaKind(state);
  const explanation = reveal?.solution.explanation ? <Explanation text={reveal.solution.explanation} /> : undefined;

  const table = reveal && (
    <RevealTable
      room={room}
      results={reveal.results}
      renderAnswer={(p) => {
        const a = reveal.answers[p.id];
        if (a === undefined) return "keine Antwort";
        return `${QUIZ_OPTION_STYLES[a]?.shape ?? ""} ${state.question.options[a]}`;
      }}
    />
  );

  const header = (
    <div className="flex shrink-0 items-center justify-between gap-[1.5vw]">
      <QuestionCounter state={state} />
      {!reveal && (
        <div className="flex-1">
          <Countdown startedAt={state.questionStartedAt} endsAt={state.stepEndsAt} />
        </div>
      )}
    </div>
  );
  const sheet = (
    <div className="exam-sheet shrink-0 px-[2vw] py-[1.6vh]">
      <ExamHeader index={state.index} total={state.total} kind={kind} />
      <h2 className={`${media ? "fs-xl" : "fs-title"} pt-[1vh] text-center font-bold text-balance`}>{state.question.text}</h2>
    </div>
  );

  if (!media) {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col gap-[2vh]">
        {header}
        {sheet}
        <div className={`grid min-h-0 flex-1 gap-[1.5vw] ${reveal ? "lg:grid-cols-[3fr_2fr]" : ""}`}>
          <OptionGrid options={state.question.options} correct={correct} answers={reveal?.answers ?? null} room={room} belowCorrect={explanation} />
          {table}
        </div>
        {!reveal && <AnsweredStrip state={state} room={room} />}
      </div>
    );
  }

  // With a picture: the sign / junction big on the left, the exam sheet on the right.
  return (
    <div className="flex min-h-0 w-full flex-1 gap-[1.8vw]">
      <div className="flex aspect-square h-full max-h-[calc(100dvh-8.5rem)] max-w-[50vw] shrink-0 items-center justify-center">
        <MediaView key={`${state.index}`} media={media} driveOrder={reveal?.solution.driveOrder ?? null} />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-[1.8vh]">
        {header}
        {sheet}
        {reveal ? (
          <>
            <OptionGrid
              options={state.question.options}
              correct={correct}
              answers={null}
              onlyCorrect
              room={room}
              columns={1}
              compact
              belowCorrect={explanation}
            />
            <div className="min-h-0 flex-1">{table}</div>
          </>
        ) : (
          <>
            <OptionGrid options={state.question.options} correct={null} answers={null} room={room} columns={1} compact />
            <div className="mt-auto">
              <AnsweredStrip state={state} room={room} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
