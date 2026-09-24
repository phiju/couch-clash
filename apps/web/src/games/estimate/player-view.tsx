"use client";

import type { EstimatePublicState } from "@couch-clash/games/meta";
import { useState } from "react";
import { Button } from "@/components/ui";
import { formatNumber, parseGermanNumber } from "@/lib/numbers";
import { AnswerSent, Countdown, PlayerRevealResult, QuestionLeaderboard } from "../question-round/components";
import type { PlayerViewProps } from "../types";

export function EstimatePlayerView({ state, room, me, sendAction }: PlayerViewProps<EstimatePublicState>) {
  const reveal = state.reveal;
  const { unit, format } = state.question;

  if (state.step === "leaderboard") {
    return <QuestionLeaderboard state={state} room={room} variant="phone" meId={me.id} />;
  }

  if (reveal) {
    const mine = reveal.answers[me.id];
    return (
      <PlayerRevealResult result={reveal.results[me.id]}>
        <p className="text-xl">
          Richtig:{" "}
          <span className="font-bold text-bulb">
            {formatNumber(reveal.solution.answer, format)} {unit}
          </span>
        </p>
        {mine !== undefined && (
          <p className="text-lg text-cream/60">
            Dein Tipp: {formatNumber(mine, format)} {unit}
          </p>
        )}
      </PlayerRevealResult>
    );
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <Countdown startedAt={state.questionStartedAt} endsAt={state.stepEndsAt} size="sm" />
      <p className="panel px-5 py-4 text-center text-2xl leading-snug font-bold text-balance">{state.question.text}</p>
      {state.myAnswer !== null ? (
        <div className="flex flex-1 items-center justify-center">
          <AnswerSent>
            <p className="text-2xl font-bold">
              {formatNumber(state.myAnswer, format)} {unit}
            </p>
          </AnswerSent>
        </div>
      ) : (
        // key: fresh input for every question
        <EstimateInput key={state.index} unit={unit} onSubmit={(value) => sendAction({ type: "answer", value })} />
      )}
    </div>
  );
}

function EstimateInput({ unit, onSubmit }: { unit: string; onSubmit: (value: number) => void }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const value = parseGermanNumber(text);

  if (sent) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <AnswerSent />
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (value === null) return;
        setSent(true);
        onSubmit(value);
      }}
    >
      <div className="flex items-center gap-3 rounded-3xl border-4 border-bulb bg-cream px-5 py-3 focus-within:ring-8 focus-within:ring-orange/60">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          inputMode="decimal"
          autoFocus
          autoComplete="off"
          enterKeyHint="send"
          placeholder="?"
          aria-label="Deine Schätzung"
          className="w-full min-w-0 bg-transparent text-right text-5xl font-bold text-brown placeholder:text-brown/20 focus:outline-none"
        />
        {unit && <span className="shrink-0 text-3xl font-bold text-brown/60">{unit}</span>}
      </div>
      {text && value === null && <p className="rounded-2xl bg-rust px-3 py-1 text-center font-bold">Bitte eine Zahl eingeben.</p>}
      <Button type="submit" disabled={value === null} className="py-5 text-3xl">
        Abschicken
      </Button>
    </form>
  );
}
