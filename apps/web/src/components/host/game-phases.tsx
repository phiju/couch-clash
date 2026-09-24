"use client";

import { getCategoryMeta } from "@couch-clash/games/meta";
import type { ClientMessage, PublicRoomState } from "@couch-clash/shared";
import { AvatarBadge } from "@/components/avatar";
import { Mascot } from "@/components/mascot";
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
    <header className="flex w-full flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3 rounded-full chip px-5 py-2 text-2xl font-bold lg:text-3xl">
        <span className="text-4xl">{meta?.emoji}</span>
        <span>{meta?.name}</span>
        {game && game.rounds.length > 1 && (
          <span className="text-lg font-bold text-cream/60">
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
          className="rounded-full px-4 py-2 text-base font-bold text-cream/60 hover:bg-petrol-dark/70 hover:text-cream"
        >
          Spiel beenden
        </button>
        {skipLabel && (
          <Button variant="secondary" onClick={() => send({ type: "skip" })} className="px-6 py-3 text-xl">
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
  return (
    <Screen className="max-w-[1600px] gap-8 lg:py-10">
      <GameBar room={room} send={send} skipLabel="Weiter ⏭" />
      <div key={room.game?.roundIndex} className="flex w-full flex-1 items-end justify-center gap-6">
        {/* The host slides in and announces the category. */}
        <Mascot
          pose="announce"
          message={<>Jetzt kommt: {meta?.name}!</>}
          className="z-10 hidden shrink-0 md:flex"
          imageClassName="h-[62vh] max-h-[720px]"
          bubbleClassName="!bottom-[97%] !left-[25%] text-3xl"
        />
        <div className="panel flex max-w-4xl flex-1 animate-pop flex-col items-center gap-6 self-center p-10 text-center">
          <div className="animate-float text-[9rem] leading-none">{meta?.emoji}</div>
          <h2 className="text-7xl font-bold text-bulb drop-shadow-[0_6px_0_var(--color-brown)] lg:text-8xl">
            {meta?.name}
          </h2>
          <p className="text-3xl text-cream/90 lg:text-4xl">{meta?.description}</p>
          <p className="text-2xl font-bold text-cream/70">
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
    <Screen className="max-w-[1800px] gap-8 lg:py-10">
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
    <Screen className="max-w-[1400px] gap-6 lg:py-10">
      <GameBar room={room} send={send} skipLabel={isLast ? "Zum Finale 🏆" : "Nächste Kategorie ⏭"} />
      <div className="panel flex w-full flex-col gap-5 p-6">
        <h2 className="text-center text-6xl font-bold text-bulb lg:text-7xl">Zwischenstand</h2>
        <Leaderboard key={game.roundIndex} entries={game.leaderboard} players={room.players} />
      </div>
      <p className="text-xl text-cream/70">
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
  if (!entries) return <Screen />;
  const byId = new Map(room.players.map((p) => [p.id, p]));
  const winners = entries.filter((e) => e.rankAfter === 1).flatMap((e) => byId.get(e.playerId) ?? []);
  return (
    <Screen className="max-w-[1400px] gap-8 lg:py-10">
      <Confetti />
      <div className="flex items-end justify-center gap-4">
        {/* The host celebrates next to the winner. */}
        <Mascot
          pose="cheer"
          message={<>Applaus für {winners.map((w) => w.name).join(" & ")}!</>}
          className="z-10 hidden md:flex"
          imageClassName="h-[42vh] max-h-[460px]"
        />
        <div className="flex flex-col items-center gap-4 pb-4 text-center">
          <div className="flex -space-x-6">
            {winners.map((w) => (
              <AvatarBadge key={w.id} avatar={w.avatar} size="lg" className="animate-float" />
            ))}
          </div>
          <h2 className="text-6xl font-bold text-bulb drop-shadow-[0_6px_0_var(--color-brown)] lg:text-7xl">
            🏆 {winners.map((w) => w.name).join(" & ")} {winners.length > 1 ? "gewinnen" : "gewinnt"}!
          </h2>
        </div>
      </div>
      <div className="panel w-full p-6">
        <Leaderboard entries={entries} players={room.players} animated={false} showGains={false} />
      </div>
      <Button onClick={() => send({ type: "play_again" })} glow className="px-12 py-5 text-4xl">
        Nochmal spielen
      </Button>
    </Screen>
  );
}
