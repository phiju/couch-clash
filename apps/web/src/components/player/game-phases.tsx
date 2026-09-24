"use client";

import { getCategoryMeta } from "@couch-clash/games/meta";
import type { PublicPlayer, PublicRoomState } from "@couch-clash/shared";
import { useEffect } from "react";
import { AvatarBadge } from "@/components/avatar";
import { Screen } from "@/components/ui";
import { getGameViews } from "@/games/registry";
import { rankPlayers } from "@/lib/ranking";

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
      if (!game) return <Screen />;
      const ranked = rankPlayers(room.players, game.scores, game.roundGain);
      const mine = ranked.find((r) => r.player.id === me.id);
      const final = room.phase === "finale";
      const won = final && mine?.rank === 1;
      return (
        <Screen className="justify-center gap-6 text-center">
          <AvatarBadge avatar={me.avatar} size="lg" className={won ? "animate-float" : ""} />
          <p className="text-2xl text-white/70">{final ? "Endstand" : "Zwischenstand"}</p>
          <p className="text-7xl font-black text-spot">
            {won ? "🏆 " : ""}
            {mine?.rank}. Platz
          </p>
          <p className="text-3xl font-black">{mine?.score ?? 0} Punkte</p>
          {!final && (mine?.gain ?? 0) > 0 && (
            <p className="text-2xl font-bold text-cool">+{mine?.gain} in dieser Kategorie</p>
          )}
          {won && <p className="text-3xl font-black">Glückwunsch! 🎉</p>}
          {final && <p className="text-lg text-white/60">Der Host kann gleich nochmal starten.</p>}
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
        </Screen>
      );
    }
  }
}
