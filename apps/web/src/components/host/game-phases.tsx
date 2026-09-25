"use client";

import { getCategoryMeta } from "@couch-clash/games/meta";
import type { ClientMessage, LeaderboardEntry, PublicPlayer, PublicRoomState } from "@couch-clash/shared";
import { useEffect, useRef, useState } from "react";
import { AvatarBadge } from "@/components/avatar";
import { Mascot } from "@/components/mascot";
import { QuestionMenu } from "./question-menu";
import { useHostSpeech } from "./voice";
import { Button, Screen } from "@/components/ui";
import { getGameViews } from "@/games/registry";
import { useServerNow } from "@/lib/clock";
import { EARLY_FINALE_TITLE, podiumOrder, splitPodium } from "@/lib/finale";
import { Leaderboard } from "@/components/leaderboard";

type Send = (msg: ClientMessage) => void;

function currentRound(room: PublicRoomState) {
  const game = room.game;
  const round = game?.rounds[game.roundIndex];
  return { game, round, meta: round ? getCategoryMeta(round.categoryId) : undefined };
}

/** Top bar during a game: category, progress, host controls. */
function GameBar({ room, send, skipLabel, questionMenu }: { room: PublicRoomState; send: Send; skipLabel?: string; questionMenu?: boolean }) {
  const { game, meta } = currentRound(room);
  return (
    <header className="flex w-full shrink-0 flex-wrap items-center justify-between gap-4 pr-14">
      <div className="fs-lg flex items-center gap-3 rounded-full chip px-5 py-[0.8vh] font-bold">
        <span className="fs-xl">{meta?.emoji}</span>
        <span>{meta?.name}</span>
        {game && game.rounds.length > 1 && (
          <span className="fs-sm font-bold text-cream/60">
            Kategorie {game.roundIndex + 1} von {game.rounds.length}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {questionMenu && <QuestionMenu room={room} send={send} />}
        <EndGameButton room={room} send={send} />
        {skipLabel && (
          <Button variant="secondary" onClick={() => send({ type: "skip" })} className="fs-md !px-[1.4vw] !py-[0.9vh] whitespace-nowrap">
            {skipLabel}
          </Button>
        )}
      </div>
    </header>
  );
}

/** "Spiel beenden" with its own confirm dialog (big enough for the TV, no browser popup). */
function EndGameButton({ room, send }: { room: PublicRoomState; send: Send }) {
  const [open, setOpen] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const anyScores = Object.values(room.game?.scores ?? {}).some((points) => points !== 0);
  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fs-sm rounded-full px-4 py-2 font-bold text-cream/60 hover:bg-petrol-dark/70 hover:text-cream"
      >
        Spiel beenden
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="end-game-title"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-brown/70 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="panel flex max-w-[min(48rem,90vw)] animate-pop flex-col items-center gap-[3vh] p-[4vh] text-center"
          >
            <h2 id="end-game-title" className="fs-title font-bold text-bulb">
              Spiel jetzt beenden?
            </h2>
            <p className="fs-lg text-cream/90">
              {anyScores
                ? "Es gibt eine Siegerehrung mit dem aktuellen Stand."
                : "Noch hat niemand Punkte – es geht direkt zurück in die Lobby."}
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Button
                ref={confirmRef}
                onClick={() => {
                  setOpen(false);
                  send({ type: "end_game" });
                }}
                className="fs-lg !px-[2vw] !py-[1.2vh]"
              >
                Beenden
              </Button>
              <Button variant="secondary" onClick={() => setOpen(false)} className="fs-lg !px-[2vw] !py-[1.2vh]">
                Weiter spielen
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SecondsLeft({ endsAt }: { endsAt: number | null }) {
  const now = useServerNow(250);
  if (!endsAt) return null;
  return <>{Math.max(0, Math.ceil((endsAt - now) / 1000))}</>;
}

export function HostIntro({ room, send }: { room: PublicRoomState; send: Send }) {
  const { round, meta } = currentRound(room);
  const speech = useHostSpeech();
  const views = round ? getGameViews(round.categoryId) : undefined;
  const Decor = views?.IntroDecor;
  const Prop = views?.MascotProp;
  return (
    <Screen fit className="max-w-[1900px]">
      <GameBar room={room} send={send} skipLabel="Weiter ⏭" />
      <div key={room.game?.roundIndex} className="flex min-h-0 w-full flex-1 items-end justify-center gap-6">
        {/* The host slides in and announces the category. */}
        <Mascot
          pose="announce"
          talking={!!speech}
          className="z-10 hidden shrink-0 md:flex"
          imageClassName="h-[min(62vh,720px)]"
          prop={Prop ? <Prop /> : undefined}
        />
        <div className="panel flex max-w-[min(56rem,70vw)] flex-1 animate-pop flex-col items-center gap-[2vh] self-center p-[4vh] text-center">
          {Decor && <Decor />}
          <div className="animate-float text-[min(9rem,15vh)] leading-none">{meta?.emoji}</div>
          {/* Long names ("Führerscheinprüfung") would overflow the card at hero size. */}
          <h2 className={`${(meta?.name.length ?? 0) > 14 ? "fs-title" : "fs-hero"} font-bold text-bulb drop-shadow-[0_6px_0_var(--color-brown)]`}>
            {meta?.name}
          </h2>
          <p className="fs-xl text-cream/90">{meta?.description}</p>
          <p className="fs-lg font-bold text-cream/70">
            {round?.questionCount} Fragen · los geht&apos;s in <SecondsLeft endsAt={room.phaseEndsAt} />
          </p>
        </div>
      </div>
    </Screen>
  );
}

export function HostPlay({ room, send }: { room: PublicRoomState; send: Send }) {
  const { round } = currentRound(room);
  const views = round ? getGameViews(round.categoryId) : undefined;
  const moduleState = room.game?.module as { step?: string } | null;
  if (!views || !moduleState) return <Screen />;
  const skipLabel =
    moduleState.step === "question" ? "Auflösen ⏭" : moduleState.step === "reveal" ? "Rangliste ⏭" : "Weiter ⏭";
  return (
    <Screen fit className="max-w-[2000px]">
      <GameBar room={room} send={send} skipLabel={skipLabel} questionMenu />
      <views.HostView state={moduleState} room={room} sendAction={(action) => send({ type: "action", action })} />
    </Screen>
  );
}

export function HostScoreboard({ room, send }: { room: PublicRoomState; send: Send }) {
  const { game } = currentRound(room);
  if (!game?.leaderboard) return <Screen />;
  const isLast = game.roundIndex + 1 >= game.rounds.length;
  return (
    <Screen fit className="max-w-[1500px]">
      <GameBar room={room} send={send} skipLabel={isLast ? "Zum Finale 🏆" : "Nächste Kategorie ⏭"} />
      <div className="panel flex min-h-0 w-full flex-1 flex-col gap-[2vh] p-[2.5vh]">
        <h2 className="fs-title shrink-0 text-center font-bold text-bulb">Zwischenstand</h2>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Leaderboard key={game.roundIndex} entries={game.leaderboard} players={room.players} />
        </div>
      </div>
      <p className="fs-md shrink-0 text-cream/70">
        Weiter in <SecondsLeft endsAt={room.phaseEndsAt} /> s
      </p>
    </Screen>
  );
}

const CONFETTI_COLORS = ["#fdbc5f", "#e15a14", "#217b77", "#fff3d6", "#cc3e05"];

function Confetti() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden motion-reduce:hidden" aria-hidden>
      {Array.from({ length: 60 }, (_, i) => (
        <span
          key={i}
          className="absolute top-[-5%] block h-4 w-2 animate-[confetti_4s_linear_infinite] rounded-sm"
          style={{
            left: `${(i * 37) % 100}%`,
            backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            animationDelay: `${(i % 12) * 0.35}s`,
            animationDuration: `${3 + (i % 5) * 0.6}s`,
          }}
        />
      ))}
    </div>
  );
}

export function HostFinale({ room, send }: { room: PublicRoomState; send: Send }) {
  const entries = room.game?.leaderboard;
  const speech = useHostSpeech();
  if (!entries) return <Screen />;
  const early = room.game?.endedEarly ?? false;
  const byId = new Map(room.players.map((p) => [p.id, p]));
  const winners = entries.filter((e) => e.rankAfter === 1).flatMap((e) => byId.get(e.playerId) ?? []);
  const { podium, rest } = splitPodium(entries);
  return (
    <Screen fit className="max-w-[1500px]">
      <Confetti />
      <div className="flex shrink-0 items-end justify-center gap-4">
        {/* The host celebrates next to the winner. */}
        <Mascot
          pose="cheer"
          talking={!!speech}
          className="z-10 hidden md:flex"
          imageClassName={early ? "h-[min(26vh,340px)]" : "h-[min(34vh,460px)]"}
        />
        <div className="flex flex-col items-center gap-[1.5vh] pb-[1.5vh] text-center">
          {!early && (
            <div className="flex -space-x-6">
              {winners.map((w) => (
                <AvatarBadge key={w.id} avatar={w.avatar} size="fluid" className="animate-float" />
              ))}
            </div>
          )}
          <h2 className="fs-title font-bold text-bulb drop-shadow-[0_6px_0_var(--color-brown)]">
            {early
              ? `🏁 ${EARLY_FINALE_TITLE}`
              : `🏆 ${winners.map((w) => w.name).join(" & ")} ${winners.length > 1 ? "gewinnen" : "gewinnt"}!`}
          </h2>
        </div>
      </div>
      {early ? (
        <>
          <Podium entries={podium} byId={byId} />
          {rest.length > 0 && (
            <div className="panel min-h-0 w-full flex-1 overflow-y-auto p-[2vh]">
              <Leaderboard entries={rest} players={room.players} animated={false} showGains={false} />
            </div>
          )}
        </>
      ) : (
        <div className="panel min-h-0 w-full flex-1 overflow-y-auto p-[2.5vh]">
          <Leaderboard entries={entries} players={room.players} animated={false} showGains={false} />
        </div>
      )}
      <div className="flex shrink-0 flex-col items-center gap-[0.8vh]">
        <Button
          onClick={() => send({ type: "back_to_lobby" })}
          glow
          className="fs-xl !px-[2.5vw] !py-[1.3vh] whitespace-nowrap"
        >
          {early ? "Weiter ⏭" : "Zurück zur Lobby"}
        </Button>
        {room.phaseEndsAt && (
          <p className="fs-sm text-cream/60">
            Zurück zur Lobby in <SecondsLeft endsAt={room.phaseEndsAt} /> s
          </p>
        )}
      </div>
    </Screen>
  );
}

const PODIUM_STEP: Record<number, string> = { 1: "h-[18vh]", 2: "h-[13vh]", 3: "h-[9vh]" };

/** Early finale: the top 3 on their steps (2nd · 1st · 3rd). */
function Podium({ entries, byId }: { entries: LeaderboardEntry[]; byId: Map<string, PublicPlayer> }) {
  return (
    <ol className="flex w-full shrink-0 items-end justify-center gap-[1.5vw]" aria-label="Siegertreppchen">
      {podiumOrder(entries).map((entry) => {
        const player = byId.get(entry.playerId);
        if (!player) return null;
        const first = entry.rankAfter === 1;
        return (
          <li key={entry.playerId} className="flex w-[min(22vw,340px)] animate-pop flex-col items-center gap-[1vh]">
            <AvatarBadge avatar={player.avatar} size="fluid" className={first ? "animate-float" : ""} />
            <span className="fs-lg line-clamp-2 w-full text-center leading-tight font-bold [overflow-wrap:anywhere]">
              {player.name}
            </span>
            <div
              className={`flex w-full flex-col items-center justify-center rounded-t-3xl border-4 border-b-0 ${PODIUM_STEP[entry.rankAfter] ?? PODIUM_STEP[3]} ${
                first ? "border-orange bg-bulb text-brown" : "border-bulb/60 bg-petrol-dark/85"
              }`}
            >
              <span className="fs-title leading-none font-bold">{entry.rankAfter}.</span>
              <span className="fs-md font-bold tabular-nums">{entry.scoreAfter.toLocaleString("de-DE")} Punkte</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
