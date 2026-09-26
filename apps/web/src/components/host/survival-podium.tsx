"use client";

import { hasFigure, type LeaderboardEntry, type PublicPlayer } from "@couch-clash/shared";
import { AvatarBadge } from "@/components/avatar";
import { StandingFigure } from "@/components/standing-figure";
import { survivalPodium } from "@/lib/finale";

/**
 * The Survival-Finale's award ceremony: a classic podium in the show's look
 * (2 · 1 · 3). The winner holds the trophy (the trophy figure made during
 * the final two; otherwise the cheering figure with a drawn cup). Places 2
 * and 3 stand in their standard figure – still dripping from the slime.
 * Without standing figures: the round avatar.
 */
export function SurvivalPodium({ entries, byId }: { entries: readonly LeaderboardEntry[]; byId: ReadonlyMap<string, PublicPlayer> }) {
  return (
    <ol className="podium" aria-label="Siegertreppchen">
      {survivalPodium(entries).map(({ step, entry, place }) => {
        const player = entry ? byId.get(entry.playerId) : undefined;
        return (
          <li key={step} className="podium-place" data-step={step}>
            {player ? <PodiumFigure player={player} winner={place === 1} /> : <div className="podium-empty" />}
            <span className="podium-name">{player?.name ?? ""}</span>
            <div className="podium-step">
              <span className="podium-number">{entry ? place : ""}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function PodiumFigure({ player, winner }: { player: PublicPlayer; winner: boolean }) {
  const photo = player.avatar.photo;
  const trophyFigure = winner && hasFigure(photo, "pokal");
  const standing = hasFigure(photo, "standard");
  return (
    <div className="podium-figure" data-winner={winner || undefined} data-round={!standing || undefined}>
      <StandingFigure
        player={player}
        pose={winner ? (trophyFigure ? "pokal" : "jubelnd") : "standard"}
        className={standing ? "podium-fig" : ""}
        fallback={<AvatarBadge avatar={player.avatar} size="fluid" expression={winner ? "jubelnd" : "enttaeuscht"} />}
      />
      {/* No trophy figure (yet): the cheering winner gets a drawn cup. */}
      {winner && !trophyFigure && <TrophyCup className="podium-cup" />}
      {!winner && <SlimeDrips />}
    </div>
  );
}

/** A shiny golden cup (drawn, the fallback for the trophy figure). */
export function TrophyCup({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 140" role="img" aria-label="Pokal">
      <defs>
        <linearGradient id="cup-gold" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#b8791a" />
          <stop offset="0.35" stopColor="#ffe08a" />
          <stop offset="0.6" stopColor="#fdbc5f" />
          <stop offset="1" stopColor="#a8650f" />
        </linearGradient>
      </defs>
      <g stroke="#562512" strokeWidth="5" strokeLinejoin="round">
        <path d="M22 22 C2 22 2 62 36 64" fill="none" />
        <path d="M98 22 C118 22 118 62 84 64" fill="none" />
        <path d="M24 10 H96 V36 C96 66 80 82 60 84 C40 82 24 66 24 36 Z" fill="url(#cup-gold)" />
        <path d="M52 84 H68 V104 H52 Z" fill="url(#cup-gold)" />
        <path d="M34 104 H86 L92 126 H28 Z" fill="url(#cup-gold)" />
      </g>
      <path d="M38 20 C36 40 40 58 50 70" stroke="#fff6d0" strokeWidth="6" strokeLinecap="round" fill="none" opacity="0.8" />
      <text x="60" y="121" textAnchor="middle" fontSize="16" fontWeight="700" fill="#562512">1</text>
    </svg>
  );
}

/** Green slime still dripping off places 2 and 3 (they were in it). */
function SlimeDrips() {
  return (
    <span className="podium-drips" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="podium-drip" style={{ ["--i" as string]: i }} />
      ))}
    </span>
  );
}
