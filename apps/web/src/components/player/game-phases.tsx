"use client";

import { getCategoryMeta } from "@couch-clash/games/meta";
import type { PublicPlayer, PublicRoomState } from "@couch-clash/shared";
import { useEffect, useState, type ReactNode } from "react";
import { AvatarBadge } from "@/components/avatar";
import { placeText } from "@/lib/finale";
import { summaryText } from "@/lib/summary";
import { Leaderboard } from "@/components/leaderboard";
import { Screen } from "@/components/ui";
import { getGameViews } from "@/games/registry";

interface Props {
  room: PublicRoomState;
  me: PublicPlayer;
  sendAction: (action: unknown) => void;
  /** 👍 / 👎 for the current question (after the reveal). */
  onRate?: (contentId: string, vote: "up" | "down") => void;
  error: string | null;
  onErrorShown: () => void;
  /** Extra content on the lobby card (photo avatar options). */
  lobbyExtra?: ReactNode;
}

/** Phone screen for everything after joining – switches on the room phase. */
export function PlayerGame({ room, me, sendAction, onRate, error, onErrorShown, lobbyExtra }: Props) {
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(onErrorShown, 3000);
    return () => clearTimeout(t);
  }, [error, onErrorShown]);

  return (
    <>
      <PhaseContent room={room} me={me} sendAction={sendAction} onRate={onRate} lobbyExtra={lobbyExtra} />
      {error && (
        <div className="fixed top-4 right-4 left-4 z-50 rounded-2xl bg-rust px-4 py-3 text-center text-lg font-bold shadow-xl">
          {error}
        </div>
      )}
    </>
  );
}

function PhaseContent({ room, me, sendAction, onRate, lobbyExtra }: Omit<Props, "error" | "onErrorShown">) {
  // Back in the lobby after a game on this phone → "Warte auf das nächste Spiel …".
  const [playedHere, setPlayedHere] = useState(false);
  if (room.phase !== "lobby" && !playedHere) setPlayedHere(true);
  const game = room.game;
  const round = game?.rounds[game.roundIndex];
  const meta = round ? getCategoryMeta(round.categoryId) : undefined;

  switch (room.phase) {
    case "intro":
      return (
        <Screen className="justify-center">
          <div className="panel flex animate-pop flex-col items-center gap-5 p-8 text-center">
            <div className="animate-float text-9xl">{meta?.emoji}</div>
            <p className="text-xl text-cream/80">Gleich geht&apos;s los mit</p>
            <p className="text-5xl font-bold text-bulb drop-shadow-[0_4px_0_var(--color-brown)]">{meta?.name}</p>
            <p className="text-xl text-cream/90">{meta?.description}</p>
          </div>
        </Screen>
      );

    case "play": {
      const views = round ? getGameViews(round.categoryId) : undefined;
      if (!views || game?.module == null) return <Screen />;
      return (
        <Screen className="max-w-lg gap-4">
          <div className="flex w-full items-center justify-between rounded-full border-2 border-bulb/60 bg-petrol-dark/85 px-4 py-1.5 text-lg font-bold">
            <span>
              {meta?.emoji} {meta?.name}
            </span>
            <span className="flex items-center gap-2">
              <AvatarBadge avatar={me.avatar} size="xs" />
              {game.scores[me.id] ?? 0}
            </span>
          </div>
          <views.PlayerView state={game.module} room={room} me={me} sendAction={sendAction} />
          {onRate && game.currentQuestion?.revealed && (
            <QuestionRating
              key={game.currentQuestion.contentId}
              onRate={(vote) => onRate(game.currentQuestion!.contentId, vote)}
            />
          )}
        </Screen>
      );
    }

    case "scoreboard":
    case "finale": {
      if (!game?.leaderboard) return <Screen />;
      const mine = game.leaderboard.find((e) => e.playerId === me.id);
      const final = room.phase === "finale";
      const early = final && game.endedEarly;
      const won = final && mine?.rankAfter === 1;
      const place = final ? placeText(game.leaderboard, me.id, { points: !game.rankedFinale }) : null;
      return (
        <Screen className="max-w-lg gap-5">
          <div className="panel flex w-full flex-col items-center gap-2 p-5 text-center">
            <p className="text-xl text-cream/80">{early ? "Spiel beendet – Zwischenstand" : final ? "Endstand" : "Zwischenstand"}</p>
            {place ? (
              // "Platz 2 von 5 – 740 Punkte"
              <p className="text-3xl font-bold text-bulb">
                {won ? "🏆 " : ""}
                {place}
              </p>
            ) : (
              <p className="text-5xl font-bold text-bulb">{mine?.rankAfter}. Platz</p>
            )}
            {won && <p className="text-2xl font-bold">Glückwunsch! 🎉</p>}
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
          {final && <p className="text-center text-lg text-cream/80">Gleich geht&apos;s zurück in die Lobby.</p>}
        </Screen>
      );
    }

    default: {
      // lobby
      const others = room.players.length - 1;
      return (
        <Screen dim="soft" className="justify-center">
          <div className="panel flex w-full max-w-md flex-col items-center gap-6 p-8 text-center">
          <AvatarBadge avatar={me.avatar} size="lg" className="animate-float" />
          <p className="text-4xl font-bold">{me.name}</p>
          {playedHere ? (
            <>
              <p className="text-3xl font-bold text-bulb">Warte auf das nächste Spiel …</p>
              <p className="text-xl text-cream/85">Du bleibst dabei. Es geht los, sobald der Host startet.</p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold text-bulb">Du bist dabei! 🎉</p>
              <p className="text-xl text-cream/85">
                Schau auf den Fernseher. Es geht los, sobald der Host startet.
                {others > 0 && (
                  <>
                    <br />
                    {others === 1 ? "1 weitere Person ist" : `${others} weitere Personen sind`} schon da.
                  </>
                )}
              </p>
            </>
          )}
          {room.settingsSummary && (
            <p className="rounded-2xl border-2 border-bulb/60 bg-petrol/60 px-5 py-2 text-lg font-bold">
              {summaryText(room.settingsSummary)}
            </p>
          )}
          {lobbyExtra}
          </div>
        </Screen>
      );
    }
  }
}

/** 👍 / 👎 after the reveal: one vote per question, tapping the other one changes it. Not shown on the TV. */
function QuestionRating({ onRate }: { onRate: (vote: "up" | "down") => void }) {
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  const button = (value: "up" | "down", emoji: string, label: string) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={vote === value}
      onClick={() => {
        setVote(value);
        onRate(value);
      }}
      className={`flex h-14 w-20 items-center justify-center rounded-full border-2 text-3xl transition active:scale-95 ${
        vote === value ? "border-bulb bg-bulb/25 scale-105" : "border-cream/30 bg-petrol-dark/70 opacity-80"
      }`}
    >
      {emoji}
    </button>
  );
  return (
    <div className="flex w-full animate-pop items-center justify-center gap-4 rounded-full bg-petrol-dark/60 px-4 py-2">
      <span className="text-lg text-cream/85">{vote ? "Danke!" : "Gute Frage?"}</span>
      {button("up", "👍", "Gute Frage")}
      {button("down", "👎", "Schlechte Frage")}
    </div>
  );
}
