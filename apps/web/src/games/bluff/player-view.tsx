"use client";

import { BLUFF_CONFIG, OPTION_LETTERS, type BluffPublicState } from "@couch-clash/games/meta";
import { useState } from "react";
import { Button } from "@/components/ui";
import { AnswerSent, Countdown, QuestionLeaderboard } from "../question-round/components";
import type { PlayerViewProps } from "../types";
import { resultParts } from "./logic";

function Question({ text }: { text: string }) {
  return (
    <p className="panel px-5 py-4 text-center text-3xl leading-tight font-bold text-bulb [overflow-wrap:anywhere]">{text}</p>
  );
}

function Note({ emoji, title, children }: { emoji: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="panel flex flex-col items-center gap-3 p-6 text-center">
      <div className="animate-float text-7xl">{emoji}</div>
      <p className="text-3xl font-bold text-bulb">{title}</p>
      {children}
    </div>
  );
}

export function BluffPlayerView({ state, room, me, sendAction }: PlayerViewProps<BluffPublicState>) {
  if (state.step === "leaderboard") {
    return <QuestionLeaderboard state={state as never} room={room} variant="phone" meId={me.id} />;
  }
  return (
    <div className="flex w-full flex-1 flex-col gap-5">
      {(state.step === "write" || state.step === "vote") && (
        <Countdown startedAt={state.stepStartedAt} endsAt={state.stepEndsAt} size="sm" />
      )}
      <Question text={state.question} />
      <StepContent state={state} room={room} me={me} sendAction={sendAction} />
    </div>
  );
}

function StepContent({ state, room, me, sendAction }: PlayerViewProps<BluffPublicState>) {
  switch (state.step) {
    case "write":
      return <WriteForm key={state.index} state={state} sendAction={sendAction} />;
    case "check":
      return <Note emoji="🔎" title="Gleich geht's weiter …" />;
    case "present":
      return state.iKnewIt ? (
        <Note emoji="🧠" title="Gewusst!">
          <p className="text-xl">Deine Erklärung war richtig. Lehn dich zurück.</p>
        </Note>
      ) : (
        <Note emoji="👂" title="Hör gut zu!">
          <p className="text-xl">Schau auf den Fernseher – gleich stimmt ihr ab.</p>
        </Note>
      );
    case "vote":
      return <VoteForm key={state.index} state={state} sendAction={sendAction} />;
    default:
      return <Result state={state} room={room} me={me} sendAction={sendAction} />;
  }
}

function WriteForm({ state, sendAction }: Pick<PlayerViewProps<BluffPublicState>, "state" | "sendAction">) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const mine = state.mySubmission ?? sent;
  const max = BLUFF_CONFIG.maxDefinitionLength;
  if (mine) {
    return (
      <AnswerSent>
        <p className="text-xl italic">„{mine}“</p>
      </AnswerSent>
    );
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const value = text.trim();
        if (!value) return;
        setSent(value);
        sendAction({ type: "define", text: value });
      }}
    >
      <label className="flex flex-col gap-2">
        <span className="text-2xl font-bold">Deine erfundene Erklärung:</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.replace(/\n/g, " ").slice(0, max))}
          maxLength={max}
          rows={3}
          autoFocus
          placeholder="… z. B. ein Werkzeug, das …"
          className="rounded-2xl border-4 border-bulb bg-cream px-4 py-3 text-2xl text-brown outline-none placeholder:text-brown/40"
        />
        <span className={`self-end text-lg font-bold ${text.length >= max ? "text-orange" : "text-cream/70"}`}>
          {text.length} / {max}
        </span>
      </label>
      <Button type="submit" disabled={!text.trim()} className="!text-3xl">
        Abschicken
      </Button>
    </form>
  );
}

function VoteForm({ state, sendAction }: Pick<PlayerViewProps<BluffPublicState>, "state" | "sendAction">) {
  const [picked, setPicked] = useState<number | null>(null);
  const [showTexts, setShowTexts] = useState(false);
  const options = state.options ?? [];
  const vote = state.myVote ?? picked;

  if (state.iKnewIt) {
    return (
      <Note emoji="😎" title="Du wusstest es!">
        <p className="text-xl">Lehn dich zurück.</p>
      </Note>
    );
  }
  if (!state.canVote) {
    return <Note emoji="🙈" title="Diesmal stimmst du nicht ab." />;
  }
  if (vote !== null) {
    return (
      <Note emoji="🗳️" title={`Stimme für ${OPTION_LETTERS[vote]}`}>
        <p className="text-xl text-cream/70">Warte auf die anderen …</p>
      </Note>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-center text-2xl font-bold">Welche Erklärung ist echt?</p>
      <div className={`grid gap-3 ${showTexts ? "grid-cols-1" : "grid-cols-2"}`}>
        {options.map((o, i) => {
          const own = state.myOptions.includes(i);
          return (
            <button
              key={i}
              type="button"
              disabled={own}
              onClick={() => {
                setPicked(i);
                sendAction({ type: "vote", option: i });
              }}
              className={`flex min-h-20 items-center gap-3 rounded-[1.6rem] border-4 px-4 py-3 text-left font-bold transition active:translate-y-1 ${
                own ? "border-cream/20 bg-petrol-dark/60 text-cream/50" : "border-bulb bg-orange shadow-[0_6px_0_var(--color-brown)]"
              }`}
            >
              <span className="text-5xl">{OPTION_LETTERS[i]}</span>
              {own && <span className="text-lg">Deine Antwort</span>}
              {showTexts && !own && <span className="text-lg leading-snug">{o.text}</span>}
            </button>
          );
        })}
      </div>
      <button type="button" onClick={() => setShowTexts((v) => !v)} className="self-center text-lg text-cream/70 underline">
        {showTexts ? "Texte ausblenden" : "Texte anzeigen"}
      </button>
    </div>
  );
}

function Result({ state, me }: PlayerViewProps<BluffPublicState>) {
  const reveal = state.reveal;
  const r = reveal?.results[me.id];
  const points = r?.finalScore ?? 0;
  const parts = r ? resultParts(r) : [];
  return (
    <div className="panel flex w-full flex-col items-center gap-3 p-6 text-center">
      <div className="animate-pop text-8xl">{points > 0 ? "🎉" : r ? "😬" : "⏰"}</div>
      <p className={`text-6xl font-bold ${points > 0 ? "text-bulb" : "text-cream/60"}`}>+{points}</p>
      {parts.map((p) => (
        <p key={p} className="text-xl font-bold">
          {p}
        </p>
      ))}
      {!r && <p className="text-xl text-cream/70">Diesmal nicht mitgemacht</p>}
      {reveal && state.step === "solution" && (
        <p className="text-xl">
          {reveal.lead} <span className="font-bold text-bulb">{reveal.definition}</span>
        </p>
      )}
      <p className="text-lg text-cream/60">Schau auf den Fernseher!</p>
    </div>
  );
}
