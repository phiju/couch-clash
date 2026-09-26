"use client";

import type { PixelpanikPublicPlayer, PixelpanikPublicState } from "@couch-clash/games/meta";
import type { PublicRoomState } from "@couch-clash/shared";
import { AvatarBadge } from "@/components/avatar";
import { Countdown, QuestionLeaderboard } from "../question-round/components";
import { QUIZ_OPTION_STYLES } from "../quiz/options";
import type { HostViewProps } from "../types";
import { avatarReaction } from "./logic";
import { PixelCanvas } from "./pixel-canvas";

export function PixelpanikHostView({ state, room }: HostViewProps<PixelpanikPublicState>) {
  if (state.step === "leaderboard") {
    return <QuestionLeaderboard state={{ index: state.index, total: state.total, answeredPlayerIds: [] }} room={room} variant="tv" />;
  }
  const reveal = state.reveal;
  const last = state.stages.length - 1;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-[2vh]">
      <div className="flex shrink-0 items-center justify-between gap-[1.5vw]">
        <span className="fs-md shrink-0 rounded-full border-2 border-bulb bg-petrol-dark/85 px-4 py-[0.6vh] font-bold whitespace-nowrap">
          Bild {state.index + 1} / {state.total}
        </span>
        <StageDots state={state} />
        {/* Keeps its place at the solution, so the dots don't jump. */}
        <div className="flex-1">{!reveal && <Countdown startedAt={state.stageStartedAt} endsAt={state.stepEndsAt} />}</div>
      </div>

      <div className="grid min-h-0 flex-1 items-center gap-[2vw] lg:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex justify-center">
          {state.image ? (
            <PixelCanvas
              url={state.image.url}
              size={state.image.size}
              className="aspect-square h-[min(64vh,48vw)] max-h-full max-w-full"
            />
          ) : (
            <div className="panel fs-lg flex aspect-square h-[min(64vh,48vw)] items-center justify-center p-8 text-center text-cream/70">
              Bild lädt …
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-col gap-[2vh]">
          {reveal ? (
            <div className="flex animate-pop flex-col items-center gap-[1vh] rounded-[2rem] border-4 border-orange bg-bulb p-[2.5vh] text-center text-brown shadow-[0_8px_0_var(--color-brown)]">
              <p className="fs-lg font-bold">Das war</p>
              <p className="fs-hero font-bold text-balance">{reveal.answer}</p>
              {reveal.source && (
                <p className="fs-sm text-brown/70">
                  {reveal.source.title}
                  {reveal.source.author ? ` · ${reveal.source.author}` : ""} · Quelle: Wikimedia Commons
                </p>
              )}
            </div>
          ) : (
            <div className="panel flex flex-col items-center gap-[0.6vh] px-[2vw] py-[2vh] text-center">
              <p className="fs-md font-bold text-cream/70">
                {state.stage === last ? "Volle Auflösung!" : `Stufe ${state.stage + 1} von ${state.stages.length} · ${state.stages[state.stage]?.label}`}
              </p>
              <p className="fs-title font-bold text-bulb">Jetzt: {state.stages[state.stage]?.points ?? 0} Punkte</p>
              <p className="fs-md text-cream/80">
                {state.input === "choice" ? "Tippt die richtige Antwort auf eurem Handy an!" : "Was ist das? Tippt es auf eurem Handy ein!"}
              </p>
            </div>
          )}

          {state.input === "choice" && state.choices && !reveal && <Choices choices={state.choices} />}

          <PlayerStrip state={state} room={room} />
        </div>
      </div>
    </div>
  );
}

/** Six dots: done, now, to come. */
function StageDots({ state }: { state: PixelpanikPublicState }) {
  const current = state.reveal ? state.stages.length : state.stage;
  return (
    <ol className="flex shrink-0 items-center gap-[0.5vw]" aria-label={`Stufe ${Math.min(current + 1, state.stages.length)} von ${state.stages.length}`}>
      {state.stages.map((s, i) => (
        <li
          key={i}
          title={`${s.label}: ${s.points} Punkte`}
          className={`size-[clamp(0.8rem,1.8vh,1.4rem)] rounded-full border-2 border-bulb transition ${
            i < current ? "bg-bulb/50" : i === current ? "scale-125 bg-orange" : "bg-petrol-dark/80"
          }`}
        />
      ))}
    </ol>
  );
}

function Choices({ choices }: { choices: string[] }) {
  return (
    <ul className="grid grid-cols-2 gap-[1vh]">
      {choices.map((c, i) => {
        const style = QUIZ_OPTION_STYLES[i]!;
        return (
          <li key={i} className={`fs-lg flex items-center gap-[0.8vw] rounded-2xl border-4 border-bulb px-[1vw] py-[1vh] font-bold ${style.bg} ${style.shadow}`}>
            <span className="opacity-80">{style.shape}</span>
            <span className="min-w-0 [overflow-wrap:anywhere]">{c}</span>
          </li>
        );
      })}
    </ul>
  );
}

const STATUS_TEXT: Record<PixelpanikPublicPlayer["status"], string> = {
  open: "rät …",
  correct: "erkannt!",
  out: "raus",
  locked: "wartet",
};

/** Everyone with their status – never what they typed (until the solution). */
function PlayerStrip({ state, room }: { state: PixelpanikPublicState; room: PublicRoomState }) {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const results = state.reveal?.results;
  return (
    <ul className="grid min-h-0 content-start gap-[1vh] overflow-y-auto sm:grid-cols-2">
      {room.players.map((p) => {
        const run = byId.get(p.id);
        const reaction = avatarReaction(run);
        const result = results?.[p.id];
        return (
          <li key={p.id} className={`flex items-center gap-[0.8vw] rounded-2xl chip px-[1vw] py-[0.8vh] ${reaction.dimmed ? "opacity-60" : ""}`}>
            <span className={`relative z-10 ${reaction.zoom ? "animate-pp-zoom" : run?.status === "correct" ? "animate-pop" : ""}`}>
              <AvatarBadge avatar={p.avatar} size="fluidSm" offline={!p.connected} dimmed={reaction.dimmed} expression={reaction.expression} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="fs-md truncate font-bold">{p.name}</span>
              <span className="fs-sm truncate text-cream/70">
                {result ? (result.guess ?? "kein Tipp") : run ? STATUS_TEXT[run.status] : "schaut zu"}
              </span>
            </div>
            {run?.status === "correct" && <span className="fs-lg font-bold text-bulb">+{run.points}</span>}
            {run?.status === "out" && <span className="fs-lg" aria-label="raus">❌</span>}
            {run?.status === "locked" && <span className="fs-lg" aria-label="wartet auf die nächste Stufe">⏳</span>}
          </li>
        );
      })}
    </ul>
  );
}
