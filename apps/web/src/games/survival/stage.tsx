"use client";

import { getDangerLevel, type SurvivalPublicPlayer, type SurvivalPublicState } from "@couch-clash/games/meta";
import { figureUrl, getAvatarOption, photoAvatarUrl, type FigurePose, type PublicPlayer } from "@couch-clash/shared";
import { memo, useLayoutEffect, useRef, useState } from "react";
import { StandingFigure } from "@/components/standing-figure";
import { PARTY_HTTP_URL } from "@/lib/config";
import { POSE_EXPRESSION, reactionForEvent, stagePose, type FigureReaction } from "@/lib/figure";
import { signedPoints } from "../question-round/components";
import { heightReference, isFinalTwo, isFreshElimination, laneGrow, laneSize, type LaunchCar, visualHeight } from "./logic";

export interface StageProps {
  state: SurvivalPublicState;
  players: readonly PublicPlayer[];
  /** Server time (drives live decay and fresh splashes). */
  now: number;
  /** Displayed score per player (live decay included). */
  scores: Readonly<Record<string, number>>;
  /** Start sequence: every car's height and points right now (null: the game's own heights). */
  launch?: ReadonlyMap<string, LaunchCar> | null;
  /** Players currently losing points to the clock. */
  descending?: ReadonlySet<string>;
}

/**
 * The finale's stage: one lane per candidate, left → right. The elevator IS
 * the bar chart – its height is the VISUAL survival position (logic.ts),
 * never the game score itself. Slime across the whole width at the bottom.
 */
export function SurvivalStage({ state, players, now, scores, launch, descending }: StageProps) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const finalTwo = isFinalTwo(state);
  const reference = heightReference(state.players);
  const size = laneSize(state.players.length, finalTwo);
  const critical = state.players.filter((p) => !p.eliminated && (p.danger === "CRITICAL" || p.danger === "ELIMINATION_IMMINENT")).length;
  const bubbling = critical >= 2 ? "wild" : critical === 1 || state.phase.id === "death" ? "busy" : "calm";
  const winnerId = state.step === "winner" ? state.winnerId : null;
  const reactions = figureReactions(state.events, now);
  const reveal = state.step === "reveal" ? state.reveal : null;
  const stageRef = useSlimeAnchor(finalTwo);
  return (
    <div ref={stageRef} className="sv-stage" data-final-two={finalTwo || undefined} data-winner={winnerId ? true : undefined}>
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
            launchHeight={launch?.get(p.id)?.h}
            fresh={isFreshElimination(p.eliminatedAt, now)}
            descending={!!descending?.has(p.id)}
            winner={winnerId === p.id}
            revived={state.step === "sudden_death" && !p.eliminated}
            questionNumber={state.question?.number ?? 0}
            rules={state.rules}
            reaction={reactions.get(p.id) ?? null}
            correct={reveal && p.id in reveal.answers ? reveal.answers[p.id] === reveal.correctIndex : null}
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

/**
 * The slime is fixed to the bottom of the viewport; its surface follows the
 * stage's slime line (--sv-surface: px from the viewport top), measured on
 * every resize – no strip of background below it on any screen shape.
 */
function useSlimeAnchor(finalTwo: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const slime = parseFloat(getComputedStyle(el).getPropertyValue("--sv-slime")) || 17;
      el.style.setProperty("--sv-surface", `${rect.bottom - (rect.height * slime) / 100}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(document.documentElement);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
    // The final two raise the slime line (--sv-slime) without a resize.
  }, [finalTwo]);
  return ref;
}

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
  launchHeight,
  fresh,
  descending,
  winner,
  revived,
  questionNumber,
  rules,
  reaction,
  correct,
}: {
  p: SurvivalPublicPlayer;
  player: PublicPlayer | undefined;
  score: number;
  reference: number;
  grow: number;
  size: "xl" | "lg" | "md" | "sm";
  launchHeight?: number;
  fresh: boolean;
  descending: boolean;
  winner: boolean;
  revived: boolean;
  questionNumber: number;
  rules: SurvivalPublicState["rules"];
  reaction: FigureReaction | null;
  /** Reveal: the answer was right (null: no reveal or no answer). */
  correct: boolean | null;
}) {
  const liveDanger = p.eliminated ? "ELIMINATED" : getDangerLevel(score, rules);
  // Standing figures when the player has one; the round avatar (as a portrait) otherwise.
  const hasFigure = !!player && figureUrl(PARTY_HTTP_URL, player.avatar.photo, "standard") !== null;
  const change = p.change;
  const pose = stagePose({ danger: liveDanger, winner, descending, correct, pointsChange: change?.total ?? null });
  // The winner rides up demonstratively (not into the banner above).
  const target = winner ? 0.9 : visualHeight(score, reference);
  const h = launchHeight ?? target;
  const deltaKey = change ? `${questionNumber}:${change.bonus}:${change.penalty}` : null;
  const showDelta = change && (change.bonus > 0 || change.penalty > 0);
  const shown = Math.max(0, score);
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
      data-launch={launchHeight !== undefined || undefined}
    >
      <div className="sv-shaft" />
      <div className="sv-piston" />
      <div className="sv-car">
        {showDelta && (
          <span key={deltaKey} className="sv-delta" data-kind={change.penalty > 0 ? "loss" : "gain"}>
            {change.penalty > 0 ? signedPoints(-change.penalty) : signedPoints(change.bonus)}
          </span>
        )}
        <div className="sv-rider" data-figure={hasFigure || undefined} data-pose={pose}>
          {player && (
            <StandingFigure
              player={player}
              pose={pose}
              reaction={reaction}
              className={hasFigure ? "sv-figure" : ""}
              ground
              fallback={<StagePortrait player={player} pose={pose} />}
            />
          )}
        </div>
        <div className="sv-platform">
          <div className="sv-deck" />
          <div className="sv-front">
            <span className="sv-lamp" />
            <div className="sv-plate">
              <span className="sv-name">{player?.name ?? "?"}</span>
              {/* Keyed by the value: every change pops the number once. */}
              <span key={shown} className="sv-points tabular-nums">
                {shown.toLocaleString("de-DE")}
              </span>
            </div>
            <span className="sv-lamp" />
          </div>
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

/**
 * No standing figure: the round avatar as a portrait standing on the
 * platform – no ring, no circle. Emoji avatars stand there as a big emoji.
 */
function StagePortrait({ player, pose }: { player: PublicPlayer; pose: FigurePose }) {
  const url = photoAvatarUrl(PARTY_HTTP_URL, player.avatar.photo, POSE_EXPRESSION[pose]);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (url && failedUrl !== url) {
    return (
      // Plain <img>: the image comes from the party worker, not from Next.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" draggable={false} className="sv-portrait" onError={() => setFailedUrl(url)} />
    );
  }
  return <span className="sv-portrait-emoji">{getAvatarOption("character", player.avatar.character)?.value ?? "❓"}</span>;
}

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

/**
 * The finale's own backdrop (slime tanks, copper pipes, arch of lights),
 * over the normal stage: vignette at the edges, dark behind the question
 * area at the top; its green fog at the bottom runs into the slime.
 */
export function SurvivalBackdrop() {
  return (
    <div className="sv-backdrop" aria-hidden>
      {/* Plain <img>: object-fit cover, centered – one fixed picture, nothing to optimize per size. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/survival-stage.webp" alt="" draggable={false} className="sv-backdrop-img" fetchPriority="high" />
    </div>
  );
}
