"use client";

import { MUSIK_CONFIG, type MusikPublicState } from "@couch-clash/games/meta";
import { useState } from "react";
import { Button } from "@/components/ui";
import { Countdown, QuestionLeaderboard } from "../question-round/components";
import { QUIZ_OPTION_STYLES } from "../quiz/options";
import type { PlayerViewProps } from "../types";
import { pointsLabel } from "./logic";

/** The phone never plays the song and never sees the title before the solution – only the buzzer and the input. */
export function MusikPlayerView({ state, room, me, sendAction }: PlayerViewProps<MusikPublicState>) {
  if (state.step === "leaderboard") {
    return (
      <QuestionLeaderboard state={{ index: state.index, total: state.total, answeredPlayerIds: [] }} room={room} variant="phone" meId={me.id} />
    );
  }
  if (state.reveal) return <Result state={state} meId={me.id} />;
  if (state.step === "loading" || state.step === "announce") {
    return (
      <div className="panel flex w-full flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <div key={state.step} className="animate-mq-announce text-8xl">{state.typeInfo.emoji}</div>
        <p className="text-4xl font-bold text-bulb text-balance">{state.step === "loading" ? "Gleich geht's los …" : state.typeInfo.label}</p>
        {state.step === "announce" && <p className="text-xl text-cream/80">{state.typeInfo.hint}</p>}
      </div>
    );
  }

  const header = (
    <p className="text-center text-xl font-bold text-cream/80">
      Song {state.index + 1}/{state.total} · {state.typeInfo.label}
    </p>
  );

  if (state.input === "year") {
    return (
      <div className="flex w-full flex-1 flex-col gap-5">
        {state.stepEndsAt !== null && <Countdown startedAt={state.stepStartedAt} endsAt={state.stepEndsAt} size="sm" />}
        {header}
        {state.shown && (
          <div className="panel px-5 py-3 text-center">
            <p className="text-2xl font-bold text-bulb">{state.shown.title}</p>
            <p className="text-lg text-cream/80">{state.shown.artist}</p>
          </div>
        )}
        {state.me?.year != null ? (
          <Waiting emoji="📅" title={`Dein Tipp: ${state.me.year}`} text="Warte auf die anderen …" />
        ) : (
          <YearInput key={state.index} state={state} onSubmit={(year) => sendAction({ type: "year", year })} />
        )}
      </div>
    );
  }

  if (state.input === "choice") {
    return (
      <div className="flex w-full flex-1 flex-col gap-5">
        {header}
        <p className="panel px-5 py-3 text-center text-xl font-bold">
          {state.me?.choice != null ? "Du kannst noch umentscheiden!" : "Welches Lied ist das? Tipp an!"}
        </p>
        <div className="grid flex-1 grid-cols-1 gap-4">
          {(state.choices ?? []).map((choice, i) => {
            const style = QUIZ_OPTION_STYLES[i]!;
            const picked = state.me?.choice === i;
            return (
              <button
                key={i}
                type="button"
                onClick={() => sendAction({ type: "choice", index: i })}
                className={`flex min-h-24 items-center gap-4 rounded-[2rem] border-4 px-5 py-4 text-left text-3xl font-bold transition active:translate-y-1 active:shadow-none ${style.bg} ${style.shadow} ${
                  picked ? "scale-[1.03] border-cream ring-8 ring-cream/60" : "border-bulb"
                } ${state.me?.choice != null && !picked ? "opacity-60" : ""}`}
              >
                <span className="text-4xl opacity-80">{picked ? "✓" : style.shape}</span>
                <span>{choice}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Buzzer.
  const answering = state.buzz?.playerId === me.id;
  const other = state.buzz && !answering ? room.players.find((p) => p.id === state.buzz!.playerId) : undefined;
  return (
    <div className="flex w-full flex-1 flex-col gap-5">
      {header}
      {answering && state.step === "answer" ? (
        <AnswerInput key={`${state.index}:${state.buzz!.endsAt}`} state={state} onSubmit={(text) => sendAction({ type: "answer", text })} />
      ) : answering && state.step === "checking" ? (
        <Waiting emoji="🧐" title="Wird geprüft …" text="Knapp! Der Moderator schaut genau hin." />
      ) : state.me?.lockedOut ? (
        <Waiting emoji="🔇" title="Gesperrt für diesen Song" text="Das war nix. Hör weiter zu – beim nächsten Song darfst du wieder." />
      ) : other ? (
        <Waiting emoji="🔔" title={`${other.name} antwortet …`} text="Daumen drücken, dass es falsch ist 😈" />
      ) : (
        <Buzzer key={`${state.index}:${state.players.filter((p) => p.lockedOut).length}`} onBuzz={() => sendAction({ type: "buzz" })} />
      )}
    </div>
  );
}

function Buzzer({ onBuzz }: { onBuzz: () => void }) {
  // Optimistic: one tap, no double buzzes while the server answers.
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      disabled={pressed}
      onPointerDown={() => {
        if (pressed) return;
        setPressed(true);
        navigator.vibrate?.(60);
        onBuzz();
      }}
      className="mx-auto flex aspect-square w-[min(80vw,24rem)] items-center justify-center rounded-full border-8 border-bulb bg-rust text-6xl font-bold text-cream shadow-[0_14px_0_var(--color-brown)] transition select-none active:translate-y-3 active:shadow-[0_2px_0_var(--color-brown)] disabled:translate-y-3 disabled:shadow-[0_2px_0_var(--color-brown)]"
    >
      {pressed ? "🔔" : "BUZZ!"}
    </button>
  );
}

function AnswerInput({ state, onSubmit }: { state: MusikPublicState; onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const value = text.trim();
  if (sent) return <Waiting emoji="📨" title="Wird geprüft …" text="Schau auf den Fernseher!" />;
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
      <Countdown startedAt={state.stepStartedAt} endsAt={state.buzz!.endsAt} size="sm" />
      <p className="panel px-5 py-3 text-center text-2xl font-bold text-bulb">
        Du bist dran! {state.type === "artist" ? "Wer singt das?" : "Wie heißt der Song?"}
      </p>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={MUSIK_CONFIG.maxAnswerLength}
        autoFocus
        autoComplete="off"
        autoCapitalize="sentences"
        enterKeyHint="send"
        placeholder={state.type === "artist" ? "Interpret" : "Songtitel"}
        aria-label="Deine Antwort"
        className="w-full rounded-3xl border-4 border-bulb bg-cream px-5 py-4 text-3xl font-bold text-brown placeholder:text-brown/30 focus:ring-8 focus:ring-orange/60 focus:outline-none"
      />
      <Button type="submit" disabled={!value} className="py-5 text-3xl">
        Abschicken
      </Button>
    </form>
  );
}

function YearInput({ state, onSubmit }: { state: MusikPublicState; onSubmit: (year: number) => void }) {
  const { min, max, start } = state.years;
  const [year, setYear] = useState(Math.min(max, Math.max(min, start)));
  const [sent, setSent] = useState(false);
  const set = (y: number) => setYear(Math.min(max, Math.max(min, y)));
  const step = (d: number) => (
    <button
      type="button"
      onClick={() => set(year + d)}
      className="flex size-20 items-center justify-center rounded-full border-4 border-bulb bg-petrol-dark text-4xl font-bold active:translate-y-1"
      aria-label={d < 0 ? "ein Jahr früher" : "ein Jahr später"}
    >
      {d < 0 ? "−" : "+"}
    </button>
  );
  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        {step(-1)}
        <span className="text-7xl font-bold text-bulb tabular-nums">{year}</span>
        {step(1)}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={year}
        onChange={(e) => set(Number(e.target.value))}
        className="h-12 w-full accent-[var(--color-orange)]"
        aria-label="Jahr"
      />
      <div className="flex justify-between text-lg text-cream/60 tabular-nums">
        <span>{min}</span>
        <span>{max}</span>
      </div>
      <Button
        disabled={sent}
        onClick={() => {
          setSent(true);
          onSubmit(year);
        }}
        className="py-5 text-3xl"
      >
        Tipp abgeben
      </Button>
    </div>
  );
}

function Waiting({ emoji, title, text }: { emoji: string; title: string; text: string }) {
  return (
    <div className="panel flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="animate-float text-7xl">{emoji}</div>
      <p className="text-3xl font-bold text-bulb">{title}</p>
      <p className="text-xl text-cream/80">{text}</p>
    </div>
  );
}

function Result({ state, meId }: { state: MusikPublicState; meId: string }) {
  const reveal = state.reveal!;
  const mine = reveal.results[meId];
  const points = mine?.points ?? 0;
  return (
    <div className="panel flex w-full flex-col items-center gap-4 p-6 text-center">
      <div className="animate-pop text-8xl">{points > 0 ? "🎉" : mine?.answer ? "😬" : "🎧"}</div>
      <p className={`text-6xl font-bold ${points > 0 ? "text-bulb" : points < 0 ? "text-orange" : "text-cream/60"}`}>{pointsLabel(points)}</p>
      <p className="text-2xl font-bold text-bulb">{reveal.title}</p>
      <p className="text-xl">
        {reveal.artist}
        {reveal.year ? ` · ${reveal.year}` : ""}
      </p>
      {mine?.answer && (
        <p className="text-lg text-cream/60">
          Dein Tipp: {mine.answer}
          {mine.partial ? " (Bandmitglied – Teilpunkte)" : ""}
          {reveal.closest.includes(meId) ? " · am nächsten dran!" : ""}
        </p>
      )}
      <p className="text-lg text-cream/60">Schau auf den Fernseher!</p>
    </div>
  );
}
