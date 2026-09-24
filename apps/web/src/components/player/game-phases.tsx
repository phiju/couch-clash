"use client";

import { getCategoryMeta } from "@couch-clash/games/meta";
import type { PublicPlayer, PublicRoomState } from "@couch-clash/shared";
import { useEffect } from "react";
import { AvatarBadge } from "@/components/avatar";
import { summaryText } from "@/lib/summary";
import { Leaderboard } from "@/components/leaderboard";
import { Screen } from "@/components/ui";
import { getGameViews } from "@/games/registry";

interface Props {
  room: PublicRoomState;
  me: PublicPlayer;
  sendAction: (action: unknown) => void;
  error: string | null;
  onErrorShown: () => void;
}

/** Phone screen for everything after joining – switches on the room phase. */
export function PlayerGame({ room, me, sendAction, error, onErrorShown }: Props) {
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(onErrorShown, 3000);
    return () => clearTimeout(t);
  }, [error, onErrorShown]);

  return (
    <>
      <PhaseContent room={room} me={me} sendAction={sendAction} />
      {error && (
        <div className="fixed top-4 right-4 left-4 z-50 rounded-2xl bg-hot px-4 py-3 text-center text-lg font-bold shadow-xl">
          {error}
        </div>
      )}
    </>
  );
}

function PhaseContent({ room, me, sendAction }: Omit<Props, "error" | "onErrorShown">) {
  const game = room.game;
  const round = game?.rounds[game.roundIndex];
  const meta = round ? getCategoryMeta(round.categoryId) : undefined;

  switch (room.phase) {
    case "intro":
      return (
        <Screen className="justify-center gap-6 text-center">
          <div className="animate-float text-9xl">{meta?.emoji}</div>
          <p className="text-xl text-white/70">Gleich geht&apos;s los mit</p>
          <p className="text-5xl font-black text-spot">{meta?.name}</p>
          <p className="text-xl text-white/80">{meta?.description}</p>
        </Screen>
      );

    case "play": {
      const views = round ? getGameViews(round.categoryId) : undefined;
      if (!views || game?.module == null) return <Screen />;
      return (
        <Screen className="max-w-lg gap-4">
          <div className="flex w-full items-center justify-between text-lg font-bold text-white/70">
            <span>
              {meta?.emoji} {meta?.name}
            </span>
            <span className="flex items-center gap-2">
              <AvatarBadge avatar={me.avatar} size="xs" />
              {game.scores[me.id] ?? 0}
            </span>
          </div>
          <views.PlayerView state={game.module} room={room} me={me} sendAction={sendAction} />
        </Screen>
      );
    }

    case "scoreboard":
    case "finale": {
      if (!game?.leaderboard) return <Screen />;
      const mine = game.leaderboard.find((e) => e.playerId === me.id);
      const final = room.phase === "finale";
      const won = final && mine?.rankAfter === 1;
      return (
        <Screen className="max-w-lg gap-5">
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-xl text-white/70">{final ? "Endstand" : "Zwischenstand"}</p>
            <p className="text-5xl font-black text-spot">
              {won ? "🏆 " : ""}
              {mine?.rankAfter}. Platz
            </p>
            {won && <p className="text-2xl font-black">Glückwunsch! 🎉</p>}
          </div>
          <Leaderboard
            key={`${room.phase}-${game.roundIndex}`}
            entries={game.leaderboard}
            players={room.players}
            variant="phone"
            meId={me.id}
            animated={!final}
            showGains={!final}
          />
          {final && <p className="text-center text-lg text-white/60">Der Host kann gleich nochmal starten.</p>}
        </Screen>
      );
    }

    default: {
      // lobby, setup
      const others = room.players.length - 1;
      return (
        <Screen className="justify-center gap-8 text-center">
          <AvatarBadge avatar={me.avatar} size="lg" className="animate-float" />
          <p className="text-4xl font-black">{me.name}</p>
          {room.phase === "lobby" ? (
            <>
              <p className="text-2xl font-bold text-spot">Du bist dabei! 🎉</p>
              <p className="text-xl text-white/70">
                Schau auf den Fernseher. Es geht los, sobald der Host startet.
                {others > 0 && (
                  <>
                    <br />
                    {others === 1 ? "1 weitere Person ist" : `${others} weitere Personen sind`} schon da.
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="text-3xl font-black text-spot">Der Host wählt die Spiele aus … 👀</p>
          )}
          {room.settingsSummary && (
            <p className="rounded-full bg-white/10 px-5 py-2 text-lg font-bold">{summaryText(room.settingsSummary)}</p>
          )}
        </Screen>
      );
    }
  }
}
