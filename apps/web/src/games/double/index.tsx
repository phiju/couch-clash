"use client";

import type { DoubleExtra, DoublePlayerView } from "@couch-clash/games/meta";
import type { PublicPlayer, PublicRoomState } from "@couch-clash/shared";
import { animate } from "motion/react";
import { useEffect, useState } from "react";
import { AvatarBadge } from "@/components/avatar";
import { QuestionCounter } from "../question-round/components";
import { PreCountdown, knowledgeViews, type AddonHostProps, type AddonPlayerProps } from "../knowledge/views";
import {
  flames,
  fmt,
  isSidelined,
  levelLabel,
  levelWarning,
  outLabel,
  potMoment,
  potReaction,
  sidelinedText,
  stakeText,
  type DoubleState,
  type PotMoment,
} from "./logic";

const isKids = (room: PublicRoomState) => room.mode.mode === "kids";

/** Counts from `from` up to `to` once (the pot growing). */
function PotCount({ from, to }: { from: number; to: number }) {
  const [value, setValue] = useState(from);
  useEffect(() => {
    const controls = animate(from, to, { duration: 1.2, ease: "easeOut", delay: 0.3, onUpdate: (v) => setValue(Math.round(v)) });
    return () => controls.stop();
  }, [from, to]);
  return <>{fmt(value)}</>;
}

/** 🔥🔥🔥 · Stufe 3 · knifflig */
function LevelMeter({ level, size = "md" }: { level: number; size?: "lg" | "md" | "phone" }) {
  const text = size === "lg" ? "fs-xl" : size === "md" ? "fs-md" : "text-xl";
  const icons = size === "lg" ? "fs-title" : size === "md" ? "fs-lg" : "text-3xl";
  return (
    <div className={`flex shrink-0 items-center gap-3 ${size === "phone" ? "flex-col gap-1" : ""}`} aria-label={levelLabel(level)}>
      <span className={`${icons} leading-none tracking-tight`}>
        {flames(level).map((on, i) => (
          <span key={i} className={on ? "" : "opacity-25 grayscale"}>
            🔥
          </span>
        ))}
      </span>
      <span
        className={`${text} font-bold whitespace-nowrap drop-shadow-[0_2px_0_var(--color-brown)] ${level >= 4 ? "text-orange" : "text-bulb"}`}
      >
        {levelLabel(level)}
      </span>
    </div>
  );
}

function Warning({ level, room, phone = false }: { level: number; room: PublicRoomState; phone?: boolean }) {
  const warning = levelWarning(level, isKids(room));
  if (!warning) return null;
  return (
    <p
      className={`animate-glow self-center rounded-full border-4 border-bulb bg-rust px-6 font-bold text-cream ${phone ? "py-1 text-xl" : "fs-lg py-[0.6vh]"}`}
    >
      ⚠️ {warning}
    </p>
  );
}

/** Under the pot: what's at stake, the uncovered choice or why the player is out. */
function PotLine({ moment, player, bonus }: { moment: PotMoment; player: DoublePlayerView; bonus: number }) {
  switch (moment) {
    case "deciding":
      return <span className="text-cream/80">🤔 {stakeText(player.pot, bonus)}</span>;
    case "decided":
      return <span className="text-bulb">✅ {stakeText(player.pot, bonus)}</span>;
    case "cash":
      return <span className="animate-pop rounded-full bg-petrol px-3 font-bold text-cream">💰 KASSIERT</span>;
    case "bet":
      return <span className="animate-pop rounded-full bg-orange px-3 font-bold text-cream">🎲 SETZT</span>;
    case "playing":
      return <span className="text-cream/80">{stakeText(player.pot, bonus)}</span>;
    case "won":
      return <span className="font-bold text-bulb">{player.auto ? "🏁 gutgeschrieben" : "✅ richtig!"}</span>;
    case "busted":
      return <span className="font-bold text-orange">💥 pleite</span>;
    default:
      return <span>{outLabel(player)}</span>;
  }
}

/** The big number: the pot – counting up on a win, bursting on a loss. */
function PotValue({ moment, player }: { moment: PotMoment; player: DoublePlayerView }) {
  if (moment === "busted") {
    return (
      <span className="relative inline-flex">
        <span className="dn-shake text-orange line-through decoration-4">{fmt(player.lost)}</span>
        <span className="dn-burst absolute inset-0 flex items-center justify-center" aria-hidden>
          💥
        </span>
      </span>
    );
  }
  if (moment === "won") return <PotCount from={player.potBefore} to={player.pot} />;
  if (player.status === "cashed_out") return <>{fmt(player.banked ?? 0)}</>;
  if (player.status === "busted") return <>0</>;
  return <>{fmt(player.pot)}</>;
}

/** Everyone who plays the round with their pot. Active players stand out, the others are greyed out. */
function PotBoard({ state, room, compact = false }: { state: DoubleState; room: PublicRoomState; compact?: boolean }) {
  const players = room.players.filter((p) => state.extra.players[p.id]);
  const bonus = state.extra.points.bonus;
  return (
    <ul className={`grid w-full gap-[1vw] ${compact ? "grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]" : "grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]"}`}>
      {players.map((p) => (
        <PotCard key={p.id} player={p} view={state.extra.players[p.id]!} moment={potMoment(state, p.id)} bonus={bonus} compact={compact} />
      ))}
    </ul>
  );
}

function PotCard({
  player,
  view,
  moment,
  bonus,
  compact,
}: {
  player: PublicPlayer;
  view: DoublePlayerView;
  moment: PotMoment;
  bonus: number;
  compact: boolean;
}) {
  const reaction = potReaction(moment, view);
  // The pot goes onto the account right now (cash out at the showdown, credited at the end).
  const banking = moment === "cash" || (moment === "won" && view.auto) ? (view.banked ?? 0) : 0;
  return (
    <li
      className={`relative flex items-center gap-[0.8vw] rounded-2xl px-[1vw] ${compact ? "py-[0.6vh]" : "py-[1.2vh]"} transition duration-500 ${
        reaction.highlight
          ? "border-4 border-bulb bg-petrol-dark/90 shadow-[0_0_24px_rgb(253_188_95/0.35)]"
          : reaction.dimmed
            ? "chip opacity-50 grayscale"
            : "chip"
      }`}
    >
      <span className={`relative ${moment === "won" || moment === "cash" ? "animate-pop" : ""}`}>
        <AvatarBadge avatar={player.avatar} size={compact ? "fluidSm" : "fluid"} offline={!player.connected} expression={reaction.expression} />
        {banking > 0 && <span className={`dn-bank ${compact ? "fs-md" : "fs-xl"}`}>+{fmt(banking)}</span>}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={`${compact ? "fs-sm" : "fs-md"} truncate font-bold`}>{player.name}</span>
        <span className={`${compact ? "fs-lg" : "fs-xl"} font-bold tabular-nums ${reaction.dimmed ? "" : "text-bulb"}`}>
          <PotValue moment={moment} player={view} />
        </span>
        <span className={`${compact ? "fs-sm" : "fs-md"} truncate`}>
          <PotLine moment={moment} player={view} bonus={bonus} />
        </span>
      </div>
    </li>
  );
}

/** TV before the question: the level, what's at stake, then everyone's choice uncovered at once. */
function HostDecide({ state, room }: AddonHostProps<DoubleExtra>) {
  const showdown = state.step === "showdown";
  const decisions = state.extra.decisions ?? {};
  const betting = Object.values(decisions).filter((d) => d === "bet").length;
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-[2.2vh] text-center">
      {!showdown && (
        <div className="w-full max-w-[70vw]">
          <PreCountdown state={state} />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-[2vw]">
        <QuestionCounter state={state} />
        <LevelMeter level={state.extra.level} size="lg" />
      </div>
      <Warning level={state.extra.level} room={room} />
      <h2 className="fs-title font-bold text-bulb drop-shadow-[0_6px_0_var(--color-brown)]">
        {showdown ? (betting > 0 ? "Aufgedeckt!" : "Alle kassieren!") : "KASSIEREN oder SETZEN?"}
      </h2>
      {!showdown && <p className="fs-lg text-cream/80">Richtig: Topf × 2 + {state.extra.points.bonus} · Falsch: alles weg</p>}
      <div className="min-h-0 w-full overflow-y-auto">
        <PotBoard state={state} room={room} />
      </div>
    </div>
  );
}

/** TV above the question: level + everyone's pot. In the reveal the list below takes over. */
function HostBanner({ state, room }: AddonHostProps<DoubleExtra>) {
  if (state.reveal) return <LevelMeter level={state.extra.level} />;
  return (
    <div className="flex shrink-0 flex-col items-center gap-[1vh]">
      <LevelMeter level={state.extra.level} />
      <PotBoard state={state} room={room} compact />
    </div>
  );
}

/** Reveal list: pot instead of "+0" – growing, burst or on the account. */
function RevealPot({ state, player }: { state: DoubleState; player: PublicPlayer }) {
  const view = state.extra.players[player.id];
  if (!view) return <span className="fs-md text-cream/40">schaut zu</span>;
  const moment = potMoment(state, player.id);
  const color = moment === "busted" ? "text-orange" : moment === "won" ? "text-bulb" : "text-cream/50";
  return (
    <span className="relative flex flex-col items-end">
      <span className={`fs-xl font-bold tabular-nums ${color}`}>
        <PotValue moment={moment} player={view} />
      </span>
      <span className="fs-sm text-cream/70">
        <PotLine moment={moment} player={view} bonus={state.extra.points.bonus} />
      </span>
    </span>
  );
}

/** Phone: the choice. Big buttons with what's at stake. */
function PlayerDecide({ state, room, me, sendAction }: AddonPlayerProps<DoubleExtra>) {
  const [sent, setSent] = useState<{ index: number; choice: "cash" | "bet" } | null>(null);
  const mine = state.extra.players[me.id];
  if (!mine) return null;
  if (state.step === "showdown") return <PlayerShowdown state={state} room={room} me={me} sendAction={sendAction} />;
  const bonus = state.extra.points.bonus;
  const chosen = state.extra.myDecision && state.extra.myDecision !== "none" ? state.extra.myDecision : sent?.index === state.index ? sent.choice : null;
  const choose = (choice: "cash" | "bet") => {
    setSent({ index: state.index, choice });
    sendAction({ type: "risk", choice });
  };
  if (chosen || state.actedPlayerIds.includes(me.id)) {
    return (
      <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 text-center">
        <PreCountdown state={state} size="sm" />
        <LevelMeter level={state.extra.level} size="phone" />
        <div className="animate-float text-7xl">{chosen === "bet" ? "🎲" : "💰"}</div>
        <p className="text-3xl font-bold text-bulb">
          {chosen === "bet" ? `Du setzt: ${stakeText(mine.pot, bonus)}` : `Du kassierst ${fmt(mine.pot)} Punkte`}
        </p>
        <p className="text-xl text-cream/70">Geheim! Gleich wird aufgedeckt …</p>
      </div>
    );
  }
  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PreCountdown state={state} size="sm" />
      <p className="text-center text-lg text-cream/70">
        Frage {state.index + 1} von {state.total}
      </p>
      <LevelMeter level={state.extra.level} size="phone" />
      <Warning level={state.extra.level} room={room} phone />
      <p className="panel px-5 py-3 text-center text-2xl font-bold">
        Dein Topf: <span className="text-bulb">{fmt(mine.pot)}</span>
      </p>
      <div className="grid flex-1 grid-cols-1 gap-4">
        <button
          type="button"
          onClick={() => choose("cash")}
          className="flex min-h-28 flex-col items-center justify-center rounded-[2rem] border-4 border-bulb bg-petrol px-5 py-4 text-cream shadow-[0_6px_0_var(--color-petrol-dark)] active:translate-y-1 active:shadow-none"
        >
          <span className="text-3xl font-bold">💰 Kassieren</span>
          <span className="text-xl">{fmt(mine.pot)} Punkte sicher</span>
        </button>
        <button
          type="button"
          onClick={() => choose("bet")}
          className="flex min-h-28 flex-col items-center justify-center rounded-[2rem] border-4 border-bulb bg-orange px-5 py-4 text-cream shadow-[0_6px_0_var(--color-brown)] active:translate-y-1 active:shadow-none"
        >
          <span className="text-3xl font-bold">🎲 Setzen</span>
          <span className="text-xl">{stakeText(mine.pot, bonus)} Punkte</span>
          <span className="text-base text-cream/80">falsch = alles weg</span>
        </button>
      </div>
      <p className="text-center text-base text-cream/60">Keine Wahl = Kassieren</p>
    </div>
  );
}

/** Phone at the showdown: your choice, uncovered. */
function PlayerShowdown({ state, me }: AddonPlayerProps<DoubleExtra>) {
  const mine = state.extra.players[me.id]!;
  const choice = state.extra.decisions?.[me.id];
  if (choice === "cash") {
    return (
      <div className="panel flex w-full flex-col items-center gap-4 p-6 text-center">
        <div className="animate-pop text-8xl">💰</div>
        <p className="text-3xl font-bold text-bulb">Du hast {fmt(mine.banked ?? 0)} Punkte kassiert!</p>
        <p className="text-xl text-cream/70">Die sind sicher auf deinem Konto.</p>
      </div>
    );
  }
  return (
    <div className="panel flex w-full flex-col items-center gap-4 p-6 text-center">
      <div className="animate-float text-8xl">🎲</div>
      <p className="text-3xl font-bold text-bulb">Du setzt {fmt(mine.pot)} Punkte!</p>
      <LevelMeter level={state.extra.level} size="phone" />
      <p className="text-xl text-cream/70">Gleich kommt die Frage …</p>
    </div>
  );
}

/** Phone above the options: level and what's at stake. */
function PlayerBanner({ state, me }: AddonPlayerProps<DoubleExtra>) {
  const mine = state.extra.players[me.id];
  if (!mine || state.reveal) return null;
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <LevelMeter level={state.extra.level} size="phone" />
      <p className="text-lg text-cream/80">
        {mine.pot > 0 ? `Topf: ${stakeText(mine.pot, state.extra.points.bonus)}` : `Richtig: ${fmt(state.extra.points.bonus)} Punkte im Topf`}
      </p>
    </div>
  );
}

/** Phone at the reveal: the pot grew, burst or went onto the account. */
function PlayerReveal({ state, me }: AddonPlayerProps<DoubleExtra>) {
  const mine = state.extra.players[me.id];
  if (!mine) return null;
  if (mine.status === "busted") {
    return (
      <>
        <div className="animate-pop text-8xl">💥</div>
        <p className="text-4xl font-bold text-orange">{mine.lost > 0 ? `${fmt(mine.lost)} Punkte weg!` : "Falsch – du bist raus!"}</p>
        {mine.lost > 0 && <p className="text-xl text-cream/70">Dein Topf ist geplatzt.</p>}
      </>
    );
  }
  if (mine.auto) {
    return (
      <>
        <div className="animate-pop text-8xl">🏁</div>
        <p className="text-4xl font-bold text-bulb">+{fmt(mine.banked ?? 0)}</p>
        <p className="text-xl">Durchgezogen! Dein Topf ist gutgeschrieben.</p>
      </>
    );
  }
  return (
    <>
      <div className="animate-pop text-8xl">🎉</div>
      <p className="text-xl">Richtig! Dein Topf:</p>
      <p className="text-6xl font-bold text-bulb">
        <PotCount from={mine.potBefore} to={mine.pot} />
      </p>
    </>
  );
}

/** Phone: out of the round (or joined later) – status, no input. */
function PlayerSidelined({ state, me }: AddonPlayerProps<DoubleExtra>) {
  const { emoji, title, text } = sidelinedText(state.extra.players[me.id]);
  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-5 text-center">
      <div className="animate-float text-8xl">{emoji}</div>
      <p className="text-3xl font-bold text-bulb">{title}</p>
      <p className="text-xl text-cream/70">{text}</p>
      <p className="text-lg text-cream/60">
        Frage {state.index + 1} von {state.total} · {levelLabel(state.extra.level)}
      </p>
    </div>
  );
}

export const doubleViews = knowledgeViews<DoubleExtra>({
  HostPre: HostDecide,
  PlayerPre: PlayerDecide,
  HostBanner,
  PlayerBanner,
  revealAnswer: (state, p) => {
    if (p.id in (state.reveal?.answers ?? {})) return undefined;
    const view = state.extra.players[p.id];
    // Played and no answer → that counts as wrong.
    if (view && state.reveal && p.id in state.reveal.results) return undefined;
    if (!view) return "schaut zu";
    return view.status === "busted" ? "war schon raus" : "hat vorher kassiert";
  },
  revealPoints: (state, p) => <RevealPot state={state} player={p} />,
  revealExpression: (state, p) => potReaction(potMoment(state, p.id), state.extra.players[p.id]).expression,
  sidelined: isSidelined,
  PlayerSidelined,
  PlayerReveal,
});
