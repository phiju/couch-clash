"use client";

import { expressionForChange, type LeaderboardEntry, type PublicPlayer } from "@couch-clash/shared";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { AvatarBadge } from "@/components/avatar";

/**
 * Animated ranking, driven only by the server's snapshot:
 *   0. rows in the previous order with the previous totals
 *   1. "+85" appears, totals count up to the new value
 *   2. rows slide to their new positions, rank arrows appear
 * With prefers-reduced-motion (or animate=false) it shows the final state.
 */
const STAGE_TIMES = [0, 700, 2400] as const;

type Stage = 0 | 1 | 2;

function useStage(active: boolean): Stage {
  const [stage, setStage] = useState<Stage>(active ? 0 : 2);
  useEffect(() => {
    if (!active) return;
    const timers = [
      setTimeout(() => setStage(1), STAGE_TIMES[1]),
      setTimeout(() => setStage(2), STAGE_TIMES[2]),
    ];
    return () => timers.forEach(clearTimeout);
  }, [active]);
  return stage;
}

/** Shows `from` until `start`, then counts up to `to`. Without animation: `to`. */
function CountUp({ from, to, animated, start }: { from: number; to: number; animated: boolean; start: boolean }) {
  const [value, setValue] = useState(animated ? from : to);
  useEffect(() => {
    if (!animated || !start) return;
    const controls = animate(from, to, {
      duration: 1.4,
      ease: "easeOut",
      onUpdate: (v) => setValue(Math.round(v)),
    });
    return () => controls.stop();
  }, [from, to, animated, start]);
  return <>{value}</>;
}

function RankChange({ before, after, tv, onLight }: { before: number; after: number; tv: boolean; onLight: boolean }) {
  const diff = before - after;
  const width = tv ? "fs-lg w-[4ch]" : "w-8 text-base";
  if (diff === 0) return <span className={`${width} text-center text-cream/30`}>–</span>;
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.4 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`${width} text-center font-bold ${onLight ? "text-brown" : diff > 0 ? "text-bulb" : "text-orange"}`}
    >
      {diff > 0 ? `↑${diff}` : `↓${-diff}`}
    </motion.span>
  );
}

export function Leaderboard({
  entries,
  players,
  variant = "tv",
  meId,
  animated = true,
  showGains = true,
}: {
  entries: LeaderboardEntry[];
  players: readonly PublicPlayer[];
  variant?: "tv" | "phone";
  /** Highlight (and on phones always show) this player's row. */
  meId?: string;
  animated?: boolean;
  showGains?: boolean;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const run = animated && !reduceMotion;
  const stage = useStage(run);
  const byId = new Map(players.map((p) => [p.id, p]));

  const reordered = stage === 2;
  const ordered = [...entries]
    .filter((e) => byId.has(e.playerId))
    .sort((a, b) => (reordered ? a.positionAfter - b.positionAfter : a.positionBefore - b.positionBefore));

  // Phones: top 5 plus the own row.
  const visible =
    variant === "phone" ? ordered.filter((e, i) => i < 5 || e.playerId === meId) : ordered;

  const tv = variant === "tv";

  return (
    <motion.ol
      layout={run}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduceMotion ? 0.3 : 0.25 }}
      className={`grid w-full ${tv ? "gap-[1.2vh]" : "gap-2"}`}
    >
      <AnimatePresence initial={false}>
        {visible.map((entry) => {
          const player = byId.get(entry.playerId)!;
          const isMe = entry.playerId === meId;
          const rank = reordered ? entry.rankAfter : entry.rankBefore;
          const leader = reordered && entry.rankAfter === 1;
          const gainVisible = showGains && stage >= 1 && entry.pointsGained !== 0;
          return (
            <motion.li
              key={entry.playerId}
              layout={run ? "position" : false}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ layout: { type: "spring", stiffness: 260, damping: 30 } }}
              className={`flex items-center ${tv ? "gap-[1.2vw] rounded-3xl px-[1.4vw] py-[1vh]" : "gap-3 rounded-2xl px-3 py-2"} ${
                leader ? "border-2 border-orange bg-bulb text-brown" : isMe ? "border-2 border-bulb bg-petrol ring-4 ring-bulb/60" : "chip"
              }`}
            >
              <span className={`text-center font-bold tabular-nums ${tv ? "fs-xl w-[3ch]" : "w-8 text-2xl"}`}>
                {rank}.
              </span>
              <AvatarBadge
                avatar={player.avatar}
                size={tv ? "fluidSm" : "xs"}
                dimmed={!player.connected}
                // Photo avatars react to the change: cheering, disappointed, shocked.
                expression={
                  showGains && reordered
                    ? expressionForChange(entry, player.avatar.photo?.expressions ?? [])
                    : "neutral"
                }
              />
              <span className={`min-w-0 flex-1 leading-tight font-bold [overflow-wrap:anywhere] ${tv ? "fs-xl" : "text-xl"}`}>
                {player.name}
              </span>
              {showGains && reordered && (
                <RankChange before={entry.rankBefore} after={entry.rankAfter} tv={tv} onLight={leader} />
              )}
              <span
                className={`font-bold tabular-nums transition-opacity duration-300 ${tv ? "fs-lg w-[5ch] text-right" : "text-lg"} ${
                  gainVisible ? "opacity-100" : "opacity-0"
                } ${leader ? "text-brown/70" : entry.pointsGained < 0 ? "text-orange" : "text-bulb"}`}
              >
                {entry.pointsGained < 0 ? `−${Math.abs(entry.pointsGained)}` : `+${entry.pointsGained}`}
              </span>
              <span className={`text-right font-bold tabular-nums ${tv ? "fs-xl w-[5ch]" : "w-16 text-2xl"}`}>
                <CountUp from={entry.scoreBefore} to={entry.scoreAfter} animated={run} start={stage >= 1} />
              </span>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </motion.ol>
  );
}
