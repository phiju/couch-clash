"use client";

import type { SlfPublicState } from "@couch-clash/games/meta";
import type { PublicPlayer, PublicRoomState } from "@couch-clash/shared";
import { AvatarBadge } from "@/components/avatar";
import { useHostSpeech } from "@/components/host/voice";
import { useServerNow } from "@/lib/clock";
import { AnsweredStrip, Countdown, QuestionLeaderboard } from "../question-round/components";
import type { HostViewProps } from "../types";
import { answerTags, readingCategory } from "./logic";

type Props = HostViewProps<SlfPublicState>;

function Counter({ state }: { state: SlfPublicState }) {
  return (
    <span className="fs-md shrink-0 rounded-full border-2 border-bulb bg-petrol-dark/85 px-4 py-[0.6vh] font-bold whitespace-nowrap">
      Buchstabe {state.index + 1} / {state.total}
    </span>
  );
}

function Letter({ letter, size }: { letter: string; size: "hero" | "big" | "small" }) {
  const cls =
    size === "hero"
      ? "size-[min(38vh,24vw)] text-[min(30vh,19vw)] rounded-[3rem] border-8"
      : size === "big"
        ? "size-[min(22vh,14vw)] text-[min(17vh,11vw)] rounded-[2rem] border-8"
        : "size-[min(10vh,7vw)] text-[min(7.5vh,5vw)] rounded-2xl border-4";
  return (
    <span className={`flex shrink-0 items-center justify-center border-brown bg-bulb leading-none font-bold text-brown shadow-[0_10px_0_var(--color-brown)] ${cls}`}>
      {letter}
    </span>
  );
}

function CategoryChips({ state, active = null }: { state: SlfPublicState; active?: number | null }) {
  return (
    <ul className="flex flex-wrap justify-center gap-[1vw]">
      {state.categories.map((c, i) => (
        <li
          key={c.id}
          className={`fs-lg rounded-full border-4 px-[1.4vw] py-[0.6vh] font-bold transition ${
            active === i ? "scale-105 border-bulb bg-orange" : active !== null && active > i ? "border-bulb/40 bg-petrol-dark/70 text-cream/60" : "border-bulb/70 bg-petrol-dark/85"
          }`}
        >
          {c.label}
          {c.hint && <span className="fs-sm font-normal text-cream/70"> ({c.hint})</span>}
        </li>
      ))}
    </ul>
  );
}

export function SlfHostView({ state, room }: Props) {
  if (state.step === "leaderboard") {
    return <QuestionLeaderboard state={{ index: state.index, total: state.total, answeredPlayerIds: [] }} room={room} variant="tv" />;
  }
  const timed = state.step === "write" || state.step === "vote";
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-[2vh]">
      <div className="flex shrink-0 items-center justify-between gap-[1.5vw]">
        <Counter state={state} />
        {timed && (
          <div className="flex-1">
            <Countdown startedAt={state.stop?.at ?? state.stepStartedAt} endsAt={state.stepEndsAt} />
          </div>
        )}
        {!timed && state.step !== "intro" && <Letter letter={state.letter} size="small" />}
      </div>
      <StepContent state={state} room={room} />
    </div>
  );
}

function StepContent({ state, room }: { state: SlfPublicState; room: PublicRoomState }) {
  switch (state.step) {
    case "intro":
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-[4vh]">
          <p className="fs-xl font-bold text-cream/85">Der Buchstabe ist …</p>
          <div className="animate-pop">
            <Letter letter={state.letter} size="hero" />
          </div>
          <CategoryChips state={state} />
        </div>
      );
    case "write":
      return <Writing state={state} room={room} />;
    case "check":
    case "script":
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-[3vh] text-center">
          <p className="fs-hero font-bold text-bulb drop-shadow-[0_6px_0_var(--color-brown)]">Stifte weg!</p>
          <div className="fs-hero animate-float">🔎</div>
          <p className="fs-xl text-cream/85">Die Jury prüft jede Antwort …</p>
        </div>
      );
    case "reveal":
      return <Reveal state={state} room={room} />;
    case "vote":
      return <Vote state={state} room={room} />;
    default:
      return <Tally state={state} room={room} />;
  }
}

function Writing({ state, room }: { state: SlfPublicState; room: PublicRoomState }) {
  const stopper = state.stop ? room.players.find((p) => p.id === state.stop!.playerId) : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[3vh]">
      <div className="flex items-center gap-[3vw]">
        <Letter letter={state.letter} size="big" />
        <div className="flex max-w-[60vw] flex-col gap-[1.5vh]">
          <p className="fs-xl font-bold">Alle schreiben – alles mit {state.letter}!</p>
          <CategoryChips state={state} />
        </div>
      </div>
      {stopper ? (
        <div className="fs-title flex animate-pop items-center gap-[1vw] rounded-3xl bg-rust px-[2vw] py-[1vh] font-bold text-cream shadow-[0_8px_0_var(--color-brown)]">
          🛑 <AvatarBadge avatar={stopper.avatar} size="fluidSm" expression="jubelnd" /> {stopper.name} ruft STOPP!
        </div>
      ) : (
        <p className="fs-md text-cream/75">Wer alle Felder hat, darf „Stopp!“ drücken – dann bleiben allen anderen noch {state.stopSeconds} Sekunden.</p>
      )}
      <AnsweredStrip state={{ index: state.index, total: state.total, answeredPlayerIds: state.donePlayerIds }} room={room} />
    </div>
  );
}

function Reveal({ state, room }: { state: SlfPublicState; room: PublicRoomState }) {
  const now = useServerNow(250);
  const speech = useHostSpeech();
  const reveal = state.reveal;
  const index = readingCategory(state, now, speech?.cue) ?? 0;
  const category = state.categories[index];
  const current = reveal?.categories[index];
  if (!reveal || !category || !current) return null;
  const byId = new Map(room.players.map((p) => [p.id, p]));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[1.8vh]">
      <CategoryChips state={state} active={index} />
      <h2 key={category.id} className="fs-title animate-pop text-center font-bold text-bulb drop-shadow-[0_6px_0_var(--color-brown)]">
        {category.label} mit {state.letter}
      </h2>
      <ul key={`list-${category.id}`} className="grid min-h-0 flex-1 content-start gap-[1vh] overflow-y-auto lg:grid-cols-2">
        {current.answers.map((a, i) => {
          const player = byId.get(a.playerId);
          return (
            <AnswerRow key={a.playerId} player={player} delay={i * 120}>
              <span className={`fs-lg font-bold [overflow-wrap:anywhere] ${a.verdict === "valid" ? "" : "text-cream/50 line-through decoration-rust decoration-4"}`}>
                {a.verdict === "censored" ? "🙊 ****" : a.text || "—"}
              </span>
              {answerTags(a).length > 0 && <span className="fs-sm text-cream/75">{answerTags(a).join(" · ")}</span>}
              <span className={`fs-xl ml-auto font-bold ${a.points > 0 ? "text-bulb" : "text-cream/40"}`}>+{a.points}</span>
            </AnswerRow>
          );
        })}
      </ul>
      <p key={`script-${category.id}`} className="fs-md shrink-0 animate-pop rounded-3xl chip px-[1.5vw] py-[1vh] leading-snug">
        🎙️ {current.script}
      </p>
      {!reveal.aiChecked && <p className="fs-sm shrink-0 text-center text-cream/60">Die Jury war verhindert – heute zählt nur der Anfangsbuchstabe.</p>}
    </div>
  );
}

function AnswerRow({ player, delay, children }: { player: PublicPlayer | undefined; delay: number; children: React.ReactNode }) {
  return (
    <li
      className="flex animate-pop flex-wrap items-center gap-x-[1vw] gap-y-[0.4vh] rounded-2xl chip px-[1vw] py-[0.9vh]"
      style={{ animationDelay: `${delay}ms`, animationFillMode: "backwards" }}
    >
      {player && <AvatarBadge avatar={player.avatar} size="fluidSm" />}
      <span className="fs-md font-bold text-cream/80">{player?.name ?? "?"}</span>
      {children}
    </li>
  );
}

function Vote({ state, room }: { state: SlfPublicState; room: PublicRoomState }) {
  const label = (id: string) => state.categories.find((c) => c.id === id)?.label ?? "";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[2vh]">
      <h2 className="fs-title text-center font-bold text-bulb drop-shadow-[0_6px_0_var(--color-brown)]">Welche Antwort war die witzigste?</h2>
      <ul className="grid min-h-0 flex-1 content-start gap-[1.2vh] overflow-y-auto lg:grid-cols-2">
        {(state.candidates ?? []).map((c, i) => (
          <li key={i} className="flex flex-col rounded-[1.6rem] border-4 border-bulb/60 bg-petrol-dark/85 px-[1.4vw] py-[1vh]">
            <span className="fs-sm font-bold text-cream/70">{label(c.categoryId)}</span>
            <span className="fs-lg font-bold [overflow-wrap:anywhere]">{c.text}</span>
          </li>
        ))}
      </ul>
      <AnsweredStrip state={{ index: state.index, total: state.total, answeredPlayerIds: state.votedPlayerIds }} room={room} />
    </div>
  );
}

function Tally({ state, room }: { state: SlfPublicState; room: PublicRoomState }) {
  const tally = state.tally;
  if (!tally) return null;
  const byId = new Map(room.players.map((p) => [p.id, p]));
  const won = [...new Set(tally.winners.map((w) => w.candidate))];
  const rows = Object.entries(tally.points).sort((a, b) => b[1].total - a[1].total);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[2vh]">
      {won.length > 0 ? (
        <div className="panel flex shrink-0 animate-pop flex-col items-center gap-[1vh] px-[2vw] py-[2vh] text-center">
          <p className="fs-lg font-bold text-cream/85">🏆 {won.length > 1 ? "Gleichstand! Die witzigsten Antworten" : "Die witzigste Antwort"}</p>
          <div className="flex flex-wrap items-start justify-center gap-x-[4vw] gap-y-[1vh]">
            {won.map((i) => (
              <div key={i} className="flex flex-col items-center gap-[0.6vh]">
                <p className="fs-title font-bold text-bulb drop-shadow-[0_6px_0_var(--color-brown)] [overflow-wrap:anywhere]">
                  „{state.candidates?.[i]?.text}“
                </p>
                <div className="fs-lg flex flex-wrap items-center justify-center gap-[1vw] font-bold">
                  {tally.winners
                    .filter((w) => w.candidate === i)
                    .map((w) => {
                      const p = byId.get(w.playerId);
                      return p ? (
                        <span key={w.playerId} className="flex items-center gap-2">
                          <AvatarBadge avatar={p.avatar} size="fluidSm" expression="jubelnd" />
                          {p.name} +{tally.points[w.playerId]?.vote ?? 0}
                        </span>
                      ) : null;
                    })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="fs-xl shrink-0 text-center text-cream/80">Keine Abstimmung diesmal.</p>
      )}
      <ul className="grid min-h-0 flex-1 content-start gap-[1vh] overflow-y-auto lg:grid-cols-2">
        {rows.map(([id, r], i) => (
          <AnswerRow key={id} player={byId.get(id)} delay={i * 100}>
            <span className="fs-md text-cream/75">
              {r.categories} Punkte{r.vote > 0 ? ` + ${r.vote} witzigste Antwort` : ""}
            </span>
            <span className={`fs-xl ml-auto font-bold ${r.total > 0 ? "text-bulb" : "text-cream/40"}`}>+{r.total}</span>
          </AnswerRow>
        ))}
      </ul>
    </div>
  );
}
