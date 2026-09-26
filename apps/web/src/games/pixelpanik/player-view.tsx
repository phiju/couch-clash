"use client";

import { PIXELPANIK_CONFIG, type PixelpanikPublicState } from "@couch-clash/games/meta";
import { useState } from "react";
import { Button } from "@/components/ui";
import { Countdown, QuestionLeaderboard } from "../question-round/components";
import { QUIZ_OPTION_STYLES } from "../quiz/options";
import type { PlayerViewProps } from "../types";

/** The phone never shows the picture – only the input (free text or, for Kids, four options). */
export function PixelpanikPlayerView({ state, room, me, sendAction }: PlayerViewProps<PixelpanikPublicState>) {
  if (state.step === "leaderboard") {
    return (
      <QuestionLeaderboard state={{ index: state.index, total: state.total, answeredPlayerIds: [] }} room={room} variant="phone" meId={me.id} />
    );
  }

  const reveal = state.reveal;
  if (reveal) {
    const mine = reveal.results[me.id];
    const points = mine?.points ?? 0;
    return (
      <div className="panel flex w-full flex-col items-center gap-4 p-6 text-center">
        <div className="animate-pop text-8xl">{points > 0 ? "🎉" : mine?.guess ? "😬" : "🙈"}</div>
        <p className={`text-6xl font-bold ${points > 0 ? "text-bulb" : "text-cream/60"}`}>+{points}</p>
        <p className="text-xl">
          Es war: <span className="font-bold text-bulb">{reveal.answer}</span>
        </p>
        {mine?.guess && <p className="text-lg text-cream/60">Dein Tipp: {mine.guess}</p>}
        <p className="text-lg text-cream/60">Schau auf den Fernseher!</p>
      </div>
    );
  }

  const status = state.me?.status ?? "open";
  const points = state.stages[state.stage]?.points ?? 0;
  return (
    <div className="flex w-full flex-1 flex-col gap-5">
      <Countdown startedAt={state.stageStartedAt} endsAt={state.stepEndsAt} size="sm" />
      <p className="text-center text-xl font-bold text-cream/80">
        Bild {state.index + 1}/{state.total} · Stufe {state.stage + 1}/{state.stages.length} ·{" "}
        <span className="text-bulb">jetzt {points} Punkte</span>
      </p>

      {status === "correct" ? (
        <Locked points={state.players.find((p) => p.id === me.id)?.points ?? 0} />
      ) : status === "out" ? (
        <Spectator guess={state.me?.guess ?? null} />
      ) : state.input === "choice" ? (
        <ChoiceInput state={state} onPick={(index) => sendAction({ type: "choice", index })} />
      ) : (
        // key: fresh input for every picture
        <GuessInput key={state.index} onSubmit={(text) => sendAction({ type: "guess", text })} />
      )}
    </div>
  );
}

function GuessInput({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const value = text.trim();

  if (sent) {
    return (
      <div className="panel flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="animate-float text-6xl">📨</div>
        <p className="text-2xl font-bold text-bulb">Wird geprüft …</p>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value) return;
        setSent(true);
        onSubmit(value);
      }}
    >
      <p className="panel px-5 py-3 text-center text-xl leading-snug font-bold text-balance">
        Was ist auf dem Fernseher? Du hast <span className="text-bulb">einen</span> Versuch – falsch heißt raus!
      </p>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={PIXELPANIK_CONFIG.maxGuessLength}
        autoFocus
        autoComplete="off"
        autoCapitalize="sentences"
        enterKeyHint="send"
        placeholder="Dein Tipp"
        aria-label="Dein Tipp"
        className="w-full rounded-3xl border-4 border-bulb bg-cream px-5 py-4 text-3xl font-bold text-brown placeholder:text-brown/30 focus:ring-8 focus:ring-orange/60 focus:outline-none"
      />
      <Button type="submit" disabled={!value} className="py-5 text-3xl">
        Abschicken
      </Button>
    </form>
  );
}

function ChoiceInput({ state, onPick }: { state: PixelpanikPublicState; onPick: (index: number) => void }) {
  // Optimistic: no double taps while the server answers.
  const [pending, setPending] = useState<string | null>(null);
  const key = `${state.index}:${state.stage}:${state.me?.wrongChoices.length ?? 0}`;
  const locked = state.me?.status === "locked";
  const wrong = new Set(state.me?.wrongChoices ?? []);
  const busy = pending === key;
  return (
    <div className="flex flex-1 flex-col gap-4">
      <p className={`panel px-5 py-3 text-center text-xl font-bold ${locked ? "text-orange" : ""}`}>
        {locked ? "⏳ Knapp daneben! Warte auf die nächste Stufe." : "Was ist auf dem Fernseher? Tipp an!"}
      </p>
      <div className="grid flex-1 grid-cols-1 gap-4">
        {(state.choices ?? []).map((choice, i) => {
          const style = QUIZ_OPTION_STYLES[i]!;
          const out = wrong.has(i);
          const disabled = out || locked || busy;
          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => {
                setPending(key);
                onPick(i);
              }}
              className={`flex min-h-20 items-center gap-4 rounded-[2rem] border-4 border-bulb px-5 py-4 text-left text-2xl font-bold transition active:translate-y-1 active:shadow-none disabled:active:translate-y-0 ${
                out ? "bg-petrol-dark text-cream/30 line-through grayscale" : `${style.bg} ${style.shadow}`
              } ${locked && !out ? "opacity-50" : ""}`}
            >
              <span className="text-3xl opacity-80">{out ? "✗" : style.shape}</span>
              <span>{choice}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Locked({ points }: { points: number }) {
  return (
    <div className="panel flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="animate-pop text-7xl">🔒</div>
      <p className="text-3xl font-bold text-bulb">Richtig – gesperrt!</p>
      <p className="text-5xl font-bold text-bulb">+{points}</p>
      <p className="text-xl text-cream/70">Punkte gesichert. Warte auf die anderen …</p>
    </div>
  );
}

function Spectator({ guess }: { guess: string | null }) {
  return (
    <div className="panel flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="animate-float text-7xl">🍿</div>
      <p className="text-3xl font-bold text-orange">Raus für dieses Bild!</p>
      {guess && <p className="text-xl text-cream/70">Dein Tipp: „{guess}“</p>}
      <p className="text-xl text-cream/80">Ab jetzt bist du Zuschauer. Schau auf den Fernseher und leide mit den anderen.</p>
    </div>
  );
}
