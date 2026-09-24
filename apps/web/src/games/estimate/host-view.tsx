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
    <div className="flex w-full flex-1 flex-col gap-8">
      <div className="flex items-center justify-between gap-6">
        <QuestionCounter state={state} />
        {!reveal && (
          <div className="flex-1">
            <Countdown startedAt={state.questionStartedAt} endsAt={state.stepEndsAt} />
          </div>
        )}
      </div>

      <h2 className="panel px-8 py-6 text-center text-5xl leading-tight font-bold text-balance lg:text-6xl">
        {state.question.text}
      </h2>

      {reveal ? (
        <div className="grid flex-1 gap-8 lg:grid-cols-[2fr_3fr]">
          <div className="flex flex-col items-center justify-center gap-4 rounded-[2rem] border-4 border-orange bg-bulb p-8 text-center text-brown shadow-[0_8px_0_var(--color-brown)]">
            <p className="text-2xl font-bold">Richtig ist</p>
            <p className="animate-pop text-7xl font-bold lg:text-9xl">
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
          <p className="rounded-full chip px-6 py-2 text-3xl text-cream/90">
            Schätzt auf euren Handys{unit ? ` (in ${unit})` : ""} 🤔
          </p>
          <AnsweredStrip state={state} room={room} />
        </div>
      )}
    </div>
  );
}
