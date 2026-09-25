"use client";

import type { DoubleExtra, RiskMode } from "@couch-clash/games/meta";
import { useState } from "react";
import { signedPoints } from "../question-round/components";
import {
  ActedStrip,
  CategoryChip,
  PhoneCategoryChip,
  PreCountdown,
  knowledgeViews,
  type AddonHostProps,
  type AddonPlayerProps,
} from "../knowledge/views";

/** TV: the secret decision – only who has decided is shown. */
function HostDecide({ state, room }: AddonHostProps<DoubleExtra>) {
  const { points } = state.extra;
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-[3vh] text-center">
      <div className="w-full max-w-[70vw]">
        <PreCountdown state={state} />
      </div>
      <CategoryChip category={state.category} big />
      <h2 className="fs-title font-bold text-bulb drop-shadow-[0_6px_0_var(--color-brown)]">NORMAL oder DOUBLE?</h2>
      <div className="fs-lg grid grid-cols-2 gap-[2vw]">
        <div className="panel px-[2vw] py-[2vh]">
          <p className="fs-xl font-bold">NORMAL</p>
          <p className="text-cream/80">
            richtig {signedPoints(points.normal)} · falsch ±0
          </p>
        </div>
        <div className="rounded-3xl border-4 border-bulb bg-orange px-[2vw] py-[2vh] text-cream">
          <p className="fs-xl font-bold">🎲 DOUBLE</p>
          <p>
            richtig {signedPoints(points.double)} · falsch {signedPoints(-points.doubleLoss)}
          </p>
        </div>
      </div>
      <ActedStrip state={state} room={room} />
    </div>
  );
}

function PlayerDecide({ state, me, sendAction }: AddonPlayerProps<DoubleExtra>) {
  const [sent, setSent] = useState<{ index: number; mode: RiskMode } | null>(null);
  const { points } = state.extra;
  const mine = state.extra.myDecision ?? (sent?.index === state.index ? sent.mode : null);
  const decide = (mode: RiskMode) => {
    setSent({ index: state.index, mode });
    sendAction({ type: "risk", mode });
  };
  if (mine || state.actedPlayerIds.includes(me.id)) {
    return (
      <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 text-center">
        <PreCountdown state={state} size="sm" />
        <div className="animate-float text-7xl">{mine === "double" ? "🎲" : "🙂"}</div>
        <p className="text-3xl font-bold text-bulb">{mine === "double" ? "DOUBLE – alles oder nichts!" : "NORMAL – sicher ist sicher"}</p>
        <p className="text-xl text-cream/70">Geheim! Gleich kommt die Frage …</p>
      </div>
    );
  }
  return (
    <div className="flex w-full flex-1 flex-col gap-5">
      <PreCountdown state={state} size="sm" />
      <PhoneCategoryChip category={state.category} />
      <p className="panel px-5 py-4 text-center text-2xl font-bold">Wie mutig bist du bei dieser Frage?</p>
      <div className="grid flex-1 grid-cols-1 gap-4">
        <button
          type="button"
          onClick={() => decide("normal")}
          className="flex min-h-28 flex-col items-center justify-center rounded-[2rem] border-4 border-bulb bg-petrol px-5 py-4 text-cream shadow-[0_6px_0_var(--color-petrol-dark)] active:translate-y-1 active:shadow-none"
        >
          <span className="text-3xl font-bold">NORMAL</span>
          <span className="text-lg">richtig {signedPoints(points.normal)} · falsch ±0</span>
        </button>
        <button
          type="button"
          onClick={() => decide("double")}
          className="flex min-h-28 flex-col items-center justify-center rounded-[2rem] border-4 border-bulb bg-orange px-5 py-4 text-cream shadow-[0_6px_0_var(--color-brown)] active:translate-y-1 active:shadow-none"
        >
          <span className="text-3xl font-bold">🎲 DOUBLE</span>
          <span className="text-lg">
            richtig {signedPoints(points.double)} · falsch {signedPoints(-points.doubleLoss)}
          </span>
        </button>
      </div>
      <p className="text-center text-base text-cream/60">Keine Wahl = NORMAL</p>
    </div>
  );
}

/** TV at the reveal: who went DOUBLE (dramatic highlight). */
function DoubleBanner({ state, room }: AddonHostProps<DoubleExtra>) {
  const decisions = state.extra.decisions;
  if (!decisions) return null;
  const doubled = room.players.filter((p) => decisions[p.id] === "double");
  return (
    <p
      className={`fs-lg shrink-0 animate-pop self-center rounded-full px-6 py-[0.8vh] font-bold ${
        doubled.length ? "border-4 border-bulb bg-orange text-cream" : "chip text-cream/70"
      }`}
    >
      {doubled.length ? `🎲 DOUBLE: ${doubled.map((p) => p.name).join(", ")}` : "Niemand hat sich getraut – alle NORMAL"}
    </p>
  );
}

function MyRisk({ state }: AddonPlayerProps<DoubleExtra>) {
  const mine = state.extra.myDecision ?? "normal";
  return (
    <p className={`text-xl font-bold ${mine === "double" ? "text-orange" : "text-cream/70"}`}>
      {mine === "double" ? "🎲 Du spielst DOUBLE" : "Du spielst NORMAL"}
    </p>
  );
}

export const doubleViews = knowledgeViews<DoubleExtra>({
  HostPre: HostDecide,
  PlayerPre: PlayerDecide,
  HostBanner: DoubleBanner,
  PlayerBanner: MyRisk,
  revealTag: (state, p) =>
    state.extra.decisions?.[p.id] === "double" ? (
      <span className="fs-sm animate-pop rounded-full bg-orange px-2 py-0.5 text-cream">🎲 DOUBLE</span>
    ) : null,
});
