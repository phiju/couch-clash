"use client";

import type { EstimatePublicState } from "@couch-clash/games/meta";
import { formatNumber } from "@/lib/numbers";
import {
  AnsweredStrip,
  Countdown,
  QuestionCounter,
  QuestionLeaderboard,
  RevealTable,
} from "../question-round/components";
import type { HostViewProps } from "../types";

export function EstimateHostView({ state, room }: HostViewProps<EstimatePublicState>) {
  if (state.step === "leaderboard") return <QuestionLeaderboard state={state} room={room} variant="tv" />;
  const reveal = state.reveal;
  const { unit, format } = state.question;

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

      {reveal ? (
        <div className="grid min-h-0 flex-1 gap-[1.5vw] lg:grid-cols-[2fr_3fr]">
          <div className="flex flex-col items-center justify-center gap-[1.5vh] rounded-[2rem] border-4 border-orange bg-bulb p-[3vh] text-center text-brown shadow-[0_8px_0_var(--color-brown)]">
            <p className="fs-lg font-bold">Richtig ist</p>
            <p className="fs-hero animate-pop font-bold">
              {formatNumber(reveal.solution.answer, format)}
              {unit && <span className="fs-title ml-3">{unit}</span>}
            </p>
            {reveal.solution.fact && <p className="fs-lg font-bold">{reveal.solution.fact}</p>}
          </div>
          <RevealTable
            room={room}
            results={reveal.results}
            renderAnswer={(p) => {
              const a = reveal.answers[p.id];
              if (a === undefined) return "keine Antwort";
              return `${formatNumber(a, format)}${unit ? ` ${unit}` : ""}`;
            }}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[4vh]">
          <p className="fs-xl rounded-full chip px-6 py-2 text-cream/90">
            Schätzt auf euren Handys{unit ? ` (in ${unit})` : ""} 🤔
          </p>
          <AnsweredStrip state={state} room={room} />
        </div>
      )}
    </div>
  );
}
