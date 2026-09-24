"use client";

import { getCategoryMeta } from "@couch-clash/games/meta";
import type { ClientMessage, PublicRoomState } from "@couch-clash/shared";
import { AvatarBadge } from "@/components/avatar";
import { Mascot } from "@/components/mascot";
import { useHostSpeech } from "./voice";
import { Button, Screen } from "@/components/ui";
import { getGameViews } from "@/games/registry";
import { useServerNow } from "@/lib/clock";
import { Leaderboard } from "@/components/leaderboard";

type Send = (msg: ClientMessage) => void;

function currentRound(room: PublicRoomState) {
  const game = room.game;
  const round = game?.rounds[game.roundIndex];
  return { game, round, meta: round ? getCategoryMeta(round.categoryId) : undefined };
}

/** Top bar during a game: category, progress, host controls. */
function GameBar({ room, send, skipLabel }: { room: PublicRoomState; send: Send; skipLabel?: string }) {
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
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Spiel beenden und zurück zur Auswahl?")) send({ type: "play_again" });
          }}
          className="fs-sm rounded-full px-4 py-2 font-bold text-cream/60 hover:bg-petrol-dark/70 hover:text-cream"
        >
          Spiel beenden
        </button>
        {skipLabel && (
          <Button variant="secondary" onClick={() => send({ type: "skip" })} className="fs-md !px-[1.4vw] !py-[0.9vh] whitespace-nowrap">
            {skipLabel}
          </Button>
        )}
      </div>
    </header>
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
  return (
    <Screen fit className="max-w-[1900px]">
      <GameBar room={room} send={send} skipLabel="Weiter ⏭" />
      <div key={room.game?.roundIndex} className="flex min-h-0 w-full flex-1 items-end justify-center gap-6">
        {/* The host slides in and announces the category. */}
        <Mascot
          pose="announce"
          talking={!!speech}
          message={speech?.text ?? <>Jetzt kommt: {meta?.name}!</>}
          className="z-10 hidden shrink-0 md:flex"
          imageClassName="h-[min(62vh,720px)]"
          bubbleClassName="fs-lg !bottom-[97%] !left-[25%]"
        />
        <div className="panel flex max-w-[min(56rem,70vw)] flex-1 animate-pop flex-col items-center gap-[2vh] self-center p-[4vh] text-center">
          <div className="animate-float text-[min(9rem,15vh)] leading-none">{meta?.emoji}</div>
          <h2 className="fs-hero font-bold text-bulb drop-shadow-[0_6px_0_var(--color-brown)]">
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
      <GameBar room={room} send={send} skipLabel={skipLabel} />
      <views.HostView state={moduleState} room={room} />
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
  const byId = new Map(room.players.map((p) => [p.id, p]));
  const winners = entries.filter((e) => e.rankAfter === 1).flatMap((e) => byId.get(e.playerId) ?? []);
  return (
    <Screen fit className="max-w-[1500px]">
      <Confetti />
      <div className="flex shrink-0 items-end justify-center gap-4">
        {/* The host celebrates next to the winner. */}
        <Mascot
          pose="cheer"
          talking={!!speech}
          message={speech?.text ?? <>Applaus für {winners.map((w) => w.name).join(" & ")}!</>}
          className="z-10 hidden md:flex"
          imageClassName="h-[min(34vh,460px)]"
        />
        <div className="flex flex-col items-center gap-[1.5vh] pb-[1.5vh] text-center">
          <div className="flex -space-x-6">
            {winners.map((w) => (
              <AvatarBadge key={w.id} avatar={w.avatar} size="fluid" className="animate-float" />
            ))}
          </div>
          <h2 className="fs-title font-bold text-bulb drop-shadow-[0_6px_0_var(--color-brown)]">
            🏆 {winners.map((w) => w.name).join(" & ")} {winners.length > 1 ? "gewinnen" : "gewinnt"}!
          </h2>
        </div>
      </div>
      <div className="panel min-h-0 w-full flex-1 overflow-y-auto p-[2.5vh]">
        <Leaderboard entries={entries} players={room.players} animated={false} showGains={false} />
      </div>
      <Button onClick={() => send({ type: "play_again" })} glow className="fs-xl shrink-0 !px-[2.5vw] !py-[1.3vh] whitespace-nowrap">
        Nochmal spielen
      </Button>
    </Screen>
  );
}
