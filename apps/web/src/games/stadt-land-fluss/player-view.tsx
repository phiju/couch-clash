"use client";

import { SLF_CONFIG, type SlfPublicState } from "@couch-clash/games/meta";
import { useContext, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { ClockContext } from "@/lib/clock";
import { Countdown, QuestionLeaderboard } from "../question-round/components";
import type { PlayerViewProps } from "../types";
import { allFilled, answerTags } from "./logic";

type Props = PlayerViewProps<SlfPublicState>;

/** Answers are saved this long after the last keystroke (and on leaving a field). */
const SAVE_DELAY_MS = 600;
/** …and once more right before the time runs out, so the last letters count too. */
const FINAL_SAVE_BEFORE_END_MS = 700;

function LetterBadge({ letter, small = false }: { letter: string; small?: boolean }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-3xl border-4 border-brown bg-bulb font-bold text-brown shadow-[0_6px_0_var(--color-brown)] ${
        small ? "size-16 text-5xl" : "size-40 text-9xl"
      }`}
    >
      {letter}
    </span>
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

export function SlfPlayerView(props: Props) {
  const { state, room, me } = props;
  if (state.step === "leaderboard") {
    return <QuestionLeaderboard state={{ index: state.index, total: state.total, answeredPlayerIds: [] }} room={room} variant="phone" meId={me.id} />;
  }
  switch (state.step) {
    case "intro":
      return (
        <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 text-center">
          <p className="text-2xl font-bold text-cream/80">
            Buchstabe {state.index + 1} von {state.total}
          </p>
          <div className="animate-pop">
            <LetterBadge letter={state.letter} />
          </div>
          <p className="text-2xl font-bold">Gleich geht&apos;s los – Finger bereit!</p>
        </div>
      );
    case "write":
      return <WriteForm key={state.index} {...props} />;
    case "check":
    case "script":
      return (
        <Note emoji="🔎" title="Stifte weg!">
          <p className="text-xl">Die Jury prüft eure Antworten …</p>
        </Note>
      );
    case "reveal":
      return <MyAnswers {...props} />;
    case "vote":
      return <VoteForm key={state.index} {...props} />;
    default:
      return <Tally {...props} />;
  }
}

function WriteForm({ state, room, me, sendAction }: Props) {
  const count = state.categories.length;
  const [answers, setAnswers] = useState<string[]>(() => state.categories.map((_, i) => state.myAnswers?.[i] ?? ""));
  const [stopped, setStopped] = useState(false);
  const saved = useRef(JSON.stringify(state.myAnswers ?? []));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(answers);
  const offset = useContext(ClockContext);

  const save = (next: string[]) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const json = JSON.stringify(next);
    if (json === saved.current) return;
    saved.current = json;
    sendAction({ type: "answers", answers: next });
  };
  // Leaving the screen (step over) → nothing pending stays behind.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  // Right before the end (also the shorter end after a "Stopp!"): save what is typed.
  useEffect(() => {
    const ms = state.stepEndsAt - FINAL_SAVE_BEFORE_END_MS - (Date.now() + offset);
    const id = setTimeout(() => save(latest.current), Math.max(0, ms));
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stepEndsAt, offset]);

  const change = (i: number, value: string) => {
    const next = answers.map((a, j) => (j === i ? value.replace(/\n/g, " ").slice(0, SLF_CONFIG.maxAnswerLength) : a));
    setAnswers(next);
    latest.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(next), SAVE_DELAY_MS);
  };

  const canStop = !state.stop && !stopped && allFilled(answers, count);
  const stopper = state.stop ? room.players.find((p) => p.id === state.stop!.playerId) : null;

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <Countdown startedAt={state.stop?.at ?? state.stepStartedAt} endsAt={state.stepEndsAt} size="sm" />
      <div className="flex items-center gap-4">
        <LetterBadge letter={state.letter} small />
        <p className="text-xl leading-snug font-bold">
          Alles mit <span className="text-bulb">{state.letter}</span>! Rechtschreibung ist egal.
        </p>
      </div>
      {state.stop && (
        <p className="animate-pop rounded-2xl bg-rust px-4 py-3 text-center text-2xl font-bold text-cream">
          🛑 {stopper?.id === me.id ? "Du hast" : `${stopper?.name ?? "Jemand"} hat`} Stopp gerufen!
        </p>
      )}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save(answers);
        }}
      >
        {state.categories.map((c, i) => (
          <label key={c.id} className="flex flex-col gap-1">
            <span className="text-xl font-bold">
              {c.label}
              {c.hint && <span className="text-base font-normal text-cream/70"> ({c.hint})</span>}
            </span>
            <input
              value={answers[i] ?? ""}
              onChange={(e) => change(i, e.target.value)}
              onBlur={() => save(answers)}
              maxLength={SLF_CONFIG.maxAnswerLength}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="sentences"
              enterKeyHint={i < count - 1 ? "next" : "done"}
              placeholder={`${state.letter} …`}
              aria-label={c.label}
              className="w-full rounded-2xl border-4 border-bulb bg-cream px-4 py-3 text-2xl font-bold text-brown placeholder:text-brown/30 focus:ring-8 focus:ring-orange/60 focus:outline-none"
            />
          </label>
        ))}
      </form>
      <Button
        type="button"
        disabled={!canStop}
        onClick={() => {
          if (timer.current) clearTimeout(timer.current);
          saved.current = JSON.stringify(answers);
          setStopped(true);
          sendAction({ type: "stop", answers });
        }}
        className="py-5 text-3xl"
      >
        🛑 Stopp!
      </Button>
      {!state.stop && !canStop && <p className="text-center text-lg text-cream/70">Alle Felder ausgefüllt? Dann darfst du Stopp rufen.</p>}
    </div>
  );
}

function MyAnswers({ state, me }: Props) {
  const reveal = state.reveal;
  const total = reveal?.categories.reduce((sum, c) => sum + (c.answers.find((a) => a.playerId === me.id)?.points ?? 0), 0) ?? 0;
  return (
    <div className="panel flex w-full flex-col gap-3 p-5">
      <p className="text-center text-2xl font-bold">
        Deine Antworten mit <span className="text-bulb">{state.letter}</span>
      </p>
      <ul className="flex flex-col gap-2">
        {state.categories.map((c, i) => {
          const a = reveal?.categories[i]?.answers.find((x) => x.playerId === me.id);
          return (
            <li key={c.id} className="flex items-center justify-between gap-3 rounded-2xl chip px-4 py-2">
              <div className="flex min-w-0 flex-col">
                <span className="text-base text-cream/70">{c.label}</span>
                <span className="text-xl font-bold [overflow-wrap:anywhere]">{a?.text || "—"}</span>
                {a && answerTags(a).length > 0 && <span className="text-sm text-cream/70">{answerTags(a).join(" · ")}</span>}
              </div>
              <span className={`text-3xl font-bold ${a && a.points > 0 ? "text-bulb" : "text-cream/40"}`}>+{a?.points ?? 0}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-center text-2xl font-bold text-bulb">= {total} Punkte</p>
      <p className="text-center text-lg text-cream/60">Hör gut zu – der Moderator liest alles vor!</p>
    </div>
  );
}

function VoteForm({ state, sendAction }: Props) {
  const [picked, setPicked] = useState<number | null>(null);
  const vote = state.myVote ?? picked;
  const label = (id: string) => state.categories.find((c) => c.id === id)?.label ?? "";
  if (!state.canVote) return <Note emoji="🙈" title="Diesmal stimmst du nicht ab." />;
  if (vote !== null) {
    return (
      <Note emoji="🗳️" title="Stimme abgegeben!">
        <p className="text-xl">„{state.candidates?.[vote]?.text}“</p>
        <p className="text-lg text-cream/70">Warte auf die anderen …</p>
      </Note>
    );
  }
  return (
    <div className="flex w-full flex-col gap-4">
      <Countdown startedAt={state.stepStartedAt} endsAt={state.stepEndsAt} size="sm" />
      <p className="text-center text-2xl font-bold">Welche Antwort war die witzigste?</p>
      <div className="flex flex-col gap-3">
        {(state.candidates ?? []).map((c, i) => {
          const own = state.myCandidates.includes(i);
          return (
            <button
              key={i}
              type="button"
              disabled={own}
              onClick={() => {
                setPicked(i);
                sendAction({ type: "vote", candidate: i });
              }}
              className={`flex flex-col items-start rounded-[1.6rem] border-4 px-4 py-3 text-left transition active:translate-y-1 ${
                own ? "border-cream/20 bg-petrol-dark/60 text-cream/50" : "border-bulb bg-orange shadow-[0_6px_0_var(--color-brown)]"
              }`}
            >
              <span className="text-base font-bold opacity-80">{label(c.categoryId)}</span>
              <span className="text-2xl font-bold [overflow-wrap:anywhere]">{c.text}</span>
              {own && <span className="text-base">Deine Antwort</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Tally({ state, me }: Props) {
  const mine = state.tally?.points[me.id];
  const won = state.tally?.winners.some((w) => w.playerId === me.id);
  const points = mine?.total ?? 0;
  return (
    <div className="panel flex w-full flex-col items-center gap-3 p-6 text-center">
      <div className="animate-pop text-8xl">{won ? "🏆" : points > 0 ? "🎉" : "😬"}</div>
      <p className={`text-6xl font-bold ${points > 0 ? "text-bulb" : "text-cream/60"}`}>+{points}</p>
      {mine && mine.vote > 0 && <p className="text-xl font-bold">Witzigste Antwort! +{mine.vote}</p>}
      <p className="text-lg text-cream/60">Schau auf den Fernseher!</p>
    </div>
  );
}
