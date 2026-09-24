"use client";

import type { EstimatePublicState } from "@couch-clash/games/meta";
import { formatNumber } from "@/lib/numbers";
import { AnsweredStrip, Countdown, QuestionCounter, RevealTable } from "../question-round/components";
import type { HostViewProps } from "../types";

export function EstimateHostView({ state, room }: HostViewProps<EstimatePublicState>) {
  const reveal = state.reveal;
  const { unit, format } = state.question;

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

      {reveal ? (
        <div className="grid flex-1 gap-8 lg:grid-cols-[2fr_3fr]">
          <div className="flex flex-col items-center justify-center gap-4 rounded-[2rem] bg-spot p-8 text-center text-stage">
            <p className="text-2xl font-bold">Richtig ist</p>
            <p className="animate-pop text-7xl font-black lg:text-9xl">
              {formatNumber(reveal.solution.answer, format)}
              {unit && <span className="ml-3 text-4xl lg:text-6xl">{unit}</span>}
            </p>
            {reveal.solution.fact && <p className="text-xl font-bold lg:text-2xl">{reveal.solution.fact}</p>}
          </div>
          <RevealTable
            room={room}
            results={reveal.results}
            accuracyLabel="Genauigkeit"
            showAccuracy
            renderAnswer={(p) => {
              const a = reveal.answers[p.id];
              if (a === undefined) return "keine Antwort";
              return `${formatNumber(a, format)}${unit ? ` ${unit}` : ""}`;
            }}
          />
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-10">
          <p className="text-3xl text-white/70">
            Schätzt auf euren Handys{unit ? ` (in ${unit})` : ""} 🤔
          </p>
          <AnsweredStrip state={state} room={room} />
        </div>
      )}
    </div>
  );
}
