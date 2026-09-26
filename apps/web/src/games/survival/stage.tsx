"use client";

import { getDangerLevel, type SurvivalPublicPlayer, type SurvivalPublicState } from "@couch-clash/games/meta";
import { figureUrl, type PublicPlayer } from "@couch-clash/shared";
import { memo } from "react";
import { AvatarBadge } from "@/components/avatar";
import { StandingFigure } from "@/components/standing-figure";
import { PARTY_HTTP_URL } from "@/lib/config";
import { poseForDanger, reactionForEvent, type FigureReaction } from "@/lib/figure";
import { signedPoints } from "../question-round/components";
import {
  MOOD_EMOJI,
  MOOD_EXPRESSION,
  heightReference,
  isFinalTwo,
  isFreshElimination,
  laneGrow,
  laneSize,
  moodFor,
  visualHeight,
} from "./logic";

export interface StageProps {
  state: SurvivalPublicState;
  players: readonly PublicPlayer[];
  /** Server time (drives live decay and fresh splashes). */
  now: number;
  /** Displayed score per player (live decay included). */
  scores: Readonly<Record<string, number>>;
  /** Intro: the elevators ride up from the slime to their start (0 … 1). */
  introProgress?: number;
  /** Players currently losing points to the clock. */
  descending?: ReadonlySet<string>;
}

/**
 * The finale's stage: one lane per candidate, left → right. The elevator IS
 * the bar chart – its height is the VISUAL survival position (logic.ts),
 * never the game score itself. Slime across the whole width at the bottom.
 */
export function SurvivalStage({ state, players, now, scores, introProgress, descending }: StageProps) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const finalTwo = isFinalTwo(state);
  const reference = heightReference(state.players);
  const size = laneSize(state.players.length, finalTwo);
  const critical = state.players.filter((p) => !p.eliminated && (p.danger === "CRITICAL" || p.danger === "ELIMINATION_IMMINENT")).length;
  const bubbling = critical >= 2 ? "wild" : critical === 1 || state.phase.id === "death" ? "busy" : "calm";
  const winnerId = state.step === "winner" ? state.winnerId : null;
  const reactions = figureReactions(state.events, now);
  return (
    <div className="sv-stage" data-final-two={finalTwo || undefined} data-winner={winnerId ? true : undefined}>
      <ol className="sv-lanes" aria-hidden>
        {state.players.map((p) => (
          <Lane
            key={p.id}
            p={p}
            player={byId.get(p.id)}
            score={scores[p.id] ?? p.score}
            reference={reference}
            grow={laneGrow(p, finalTwo)}
            size={size}
            introProgress={introProgress}
            fresh={isFreshElimination(p.eliminatedAt, now)}
            descending={!!descending?.has(p.id)}
            winner={winnerId === p.id}
            revived={state.step === "sudden_death" && !p.eliminated}
            questionNumber={state.question?.number ?? 0}
            rules={state.rules}
            reaction={reactions.get(p.id) ?? null}
          />
        ))}
      </ol>
      <SlimePool bubbling={bubbling} />
      {/* Accessibility: the numbers the elevators stand for. */}
      <table className="sr-only">
        <caption>Lebensenergie</caption>
        <tbody>
          {state.players.map((p) => (
            <tr key={p.id}>
              <th scope="row">{byId.get(p.id)?.name}</th>
              <td>{p.eliminated ? "eliminiert" : `${scores[p.id] ?? p.score} Punkte`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const AVATAR_SCALE = { xl: 1.6, lg: 1.2, md: 1, sm: 0.8 } as const;

/** Reactions shorter-lived than this are not replayed by a TV that just appeared. */
const REACTION_MAX_AGE_MS = 3_000;

/** The latest reaction per player (+50 / comeback / winner → cheering, wrong → shocked). */
function figureReactions(events: SurvivalPublicState["events"], now: number): Map<string, FigureReaction> {
  const out = new Map<string, FigureReaction>();
  for (const e of events) {
    if (!e.playerId || now - e.at > REACTION_MAX_AGE_MS) continue;
    const reaction = reactionForEvent(e.type, e.seq);
    if (reaction) out.set(e.playerId, reaction);
  }
  return out;
}

const Lane = memo(function Lane({
  p,
  player,
  score,
  reference,
  grow,
  size,
  introProgress,
  fresh,
  descending,
  winner,
  revived,
  questionNumber,
  rules,
  reaction,
}: {
  p: SurvivalPublicPlayer;
  player: PublicPlayer | undefined;
  score: number;
  reference: number;
  grow: number;
  size: keyof typeof AVATAR_SCALE;
  introProgress?: number;
  fresh: boolean;
  descending: boolean;
  winner: boolean;
  revived: boolean;
  questionNumber: number;
  rules: SurvivalPublicState["rules"];
  reaction: FigureReaction | null;
}) {
  const liveDanger = p.eliminated ? "ELIMINATED" : getDangerLevel(score, rules);
  const mood = winner ? "cheering" : moodFor(p, liveDanger);
  // Standing figures when the player has one; the round avatar otherwise.
  const hasFigure = !!player && figureUrl(PARTY_HTTP_URL, player.avatar.photo, "standard") !== null;
  // The winner rides up demonstratively (not into the banner above).
  const target = winner ? 0.9 : visualHeight(score, reference);
  const h = introProgress === undefined ? target : target * introProgress;
  const change = p.change;
  const deltaKey = change ? `${questionNumber}:${change.bonus}:${change.penalty}` : null;
  const showDelta = change && (change.bonus > 0 || change.penalty > 0);
  return (
    <li
      className="sv-lane"
      style={{ flexGrow: grow, ["--h" as string]: h }}
      data-danger={liveDanger}
      data-out={p.eliminated || undefined}
      data-fresh={fresh || undefined}
      data-descending={descending || undefined}
      data-winner={winner || undefined}
      data-revived={revived || undefined}
      data-size={size}
    >
      <div className="sv-shaft" />
      <div className="sv-piston" />
      <div className="sv-car">
        {showDelta && (
          <span key={deltaKey} className="sv-delta" data-kind={change.penalty > 0 ? "loss" : "gain"}>
            {change.penalty > 0 ? signedPoints(-change.penalty) : signedPoints(change.bonus)}
          </span>
        )}
        <span className="sv-score tabular-nums">{Math.max(0, score).toLocaleString("de-DE")}</span>
        <div className="sv-rider" data-figure={hasFigure || undefined}>
          {player && (
            <StandingFigure
              player={player}
              // The winner cheers; everyone else shows their danger (live, while the score melts).
              pose={winner ? "jubelnd" : poseForDanger(liveDanger)}
              reaction={reaction}
              className={hasFigure ? "sv-figure" : ""}
              fallback={
                <span style={{ transform: `scale(${AVATAR_SCALE[size]})` }} className="inline-flex origin-bottom">
                  <AvatarBadge avatar={player.avatar} size="fluid" expression={MOOD_EXPRESSION[mood]} />
                </span>
              }
            />
          )}
          {!hasFigure && <span className="sv-mood">{MOOD_EMOJI[mood]}</span>}
        </div>
        <div className="sv-platform">
          <span className="sv-lamp" />
          <span className="sv-name">{player?.name ?? "?"}</span>
          <span className="sv-lamp" />
        </div>
      </div>
      {p.eliminated && (
        <>
          {fresh && <Splash />}
          <span className="sv-fizzles" />
          <span className="sv-out">ELIMINIERT</span>
        </>
      )}
    </li>
  );
});

/** The cartoon splash when someone hits the slime. */
function Splash() {
  return (
    <span className="sv-splash">
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className="sv-drop" style={{ ["--i" as string]: i }} />
      ))}
      <span className="sv-splash-ring" />
    </span>
  );
}

const BUBBLES = Array.from({ length: 18 }, (_, i) => ({
  left: (i * 53) % 100,
  size: 0.6 + ((i * 7) % 5) * 0.25,
  delay: (i * 0.37) % 3.2,
  duration: 1.8 + ((i * 11) % 7) * 0.3,
}));

/** Glossy, bubbling cartoon slime over the whole width. */
export const SlimePool = memo(function SlimePool({ bubbling }: { bubbling: "calm" | "busy" | "wild" }) {
  return (
    <div className="sv-slime" data-bubbling={bubbling}>
      <svg className="sv-slime-waves" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="sv-slime-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#b6f03a" />
            <stop offset="0.35" stopColor="#7cc81e" />
            <stop offset="1" stopColor="#2f7d12" />
          </linearGradient>
        </defs>
        <g className="sv-wave sv-wave-back">
          <path d="M0 40 Q75 10 150 40 T300 40 T450 40 T600 40 T750 40 T900 40 T1050 40 T1200 40 T1350 40 T1500 40 V120 H0 Z" fill="#5aa818" />
        </g>
        <g className="sv-wave sv-wave-front">
          <path
            d="M0 55 Q60 30 120 55 T240 55 T360 55 T480 55 T600 55 T720 55 T840 55 T960 55 T1080 55 T1200 55 T1320 55 T1440 55 V120 H0 Z"
            fill="url(#sv-slime-body)"
            stroke="#562512"
            strokeWidth="5"
          />
          <path d="M40 62 Q120 48 200 60" stroke="#f4ffd0" strokeWidth="7" strokeLinecap="round" fill="none" opacity="0.7" />
          <path d="M520 64 Q600 50 680 62" stroke="#f4ffd0" strokeWidth="7" strokeLinecap="round" fill="none" opacity="0.6" />
          <path d="M880 63 Q940 52 1000 61" stroke="#f4ffd0" strokeWidth="6" strokeLinecap="round" fill="none" opacity="0.55" />
        </g>
      </svg>
      <div className="sv-slime-body">
        {BUBBLES.map((b, i) => (
          <span
            key={i}
            className="sv-fizz"
            style={{
              left: `${b.left}%`,
              ["--s" as string]: b.size,
              animationDelay: `${b.delay}s`,
              animationDuration: `${b.duration}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
});
