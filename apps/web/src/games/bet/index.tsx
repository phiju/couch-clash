"use client";

import type { BetExtra } from "@couch-clash/games/meta";
import { useState } from "react";
import {
  ActedStrip,
  CategoryChip,
  PhoneCategoryChip,
  PreCountdown,
  knowledgeViews,
  type AddonHostProps,
  type AddonPlayerProps,
} from "../knowledge/views";

const fmt = (n: number) => n.toLocaleString("de-DE");

/** TV: the category first – then everyone bets on their knowledge. */
function HostWager({ state, room }: AddonHostProps<BetExtra>) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-[3vh] text-center">
      <div className="w-full max-w-[70vw]">
        <PreCountdown state={state} />
      </div>
      <p className="fs-lg font-bold text-cream/80">Nächste Kategorie</p>
      <CategoryChip category={state.category} big />
      <h2 className="fs-title font-bold text-bulb drop-shadow-[0_6px_0_var(--color-brown)]">💰 Macht eure Einsätze!</h2>
      <p className="fs-md text-cream/80">Richtig: Einsatz gewonnen · Falsch: Einsatz weg</p>
      <ActedStrip state={state} room={room} />
    </div>
  );
}

/** Phone: 50 / 100 / 200 / own amount; the maximum is "ALL IN". */
export function WagerPicker({
  max,
  presets,
  onWager,
}: {
  max: number;
  presets: readonly number[];
  onWager: (amount: number) => void;
}) {
  const [custom, setCustom] = useState("");
  const value = Math.floor(Number(custom));
  const valid = Number.isFinite(value) && value >= 1 && value <= max;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        {presets.map((amount) => (
          <button
            key={amount}
            type="button"
            disabled={amount > max}
            onClick={() => onWager(amount)}
            className="min-h-20 rounded-[2rem] border-4 border-bulb bg-orange text-3xl font-bold text-cream shadow-[0_6px_0_var(--color-brown)] active:translate-y-1 active:shadow-none disabled:opacity-30"
          >
            {amount === max ? "ALL IN" : fmt(amount)}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-2">
        <span className="text-lg font-bold text-cream/80">Eigene Eingabe (höchstens {fmt(max)})</span>
        <div className="flex gap-3">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={max}
            step={10}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="min-w-0 flex-1 rounded-2xl bg-cream px-4 py-3 text-right text-2xl font-bold text-brown"
            aria-label="Eigener Einsatz"
          />
          <button
            type="button"
            disabled={!valid}
            onClick={() => onWager(value)}
            className="rounded-2xl border-4 border-bulb bg-petrol px-5 text-2xl font-bold text-cream disabled:opacity-40"
          >
            {valid && value === max ? "ALL IN" : "Setzen"}
          </button>
        </div>
        <button type="button" onClick={() => setCustom(String(max))} className="self-start text-lg text-bulb underline">
          Alles setzen ({fmt(max)})
        </button>
      </label>
    </div>
  );
}

function PlayerWager({ state, me, sendAction }: AddonPlayerProps<BetExtra>) {
  const [sent, setSent] = useState<{ index: number; amount: number } | null>(null);
  const max = state.extra.maxWagers[me.id] ?? 0;
  const mine = state.extra.myWager ?? (sent?.index === state.index ? sent.amount : null);
  if (mine !== null || state.actedPlayerIds.includes(me.id)) {
    return (
      <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 text-center">
        <PreCountdown state={state} size="sm" />
        <div className="animate-float text-7xl">💰</div>
        <p className="text-3xl font-bold text-bulb">{mine === max ? "ALL IN!" : `Einsatz: ${fmt(mine ?? 0)}`}</p>
        <p className="text-xl text-cream/70">Geheim! Gleich kommt die Frage …</p>
      </div>
    );
  }
  return (
    <div className="flex w-full flex-1 flex-col gap-5">
      <PreCountdown state={state} size="sm" />
      <PhoneCategoryChip category={state.category} />
      <p className="panel px-5 py-4 text-center text-2xl font-bold">Wie viel setzt du?</p>
      <WagerPicker
        max={max}
        presets={state.extra.presets}
        onWager={(amount) => {
          setSent({ index: state.index, amount });
          sendAction({ type: "wager", amount });
        }}
      />
      <p className="text-center text-base text-cream/60">Kein Einsatz = {fmt(Math.min(state.extra.defaultWager, max))}</p>
    </div>
  );
}

function wagerLabel(extra: BetExtra, id: string, wager: number) {
  return wager >= (extra.maxWagers[id] ?? Infinity) ? `ALL IN ${fmt(wager)}` : `Einsatz ${fmt(wager)}`;
}

function MyWager({ state, me }: AddonPlayerProps<BetExtra>) {
  const wager = state.extra.myWager;
  if (wager === null) return null;
  return <p className="text-xl font-bold text-bulb">💰 {wagerLabel(state.extra, me.id, wager)}</p>;
}

export const betViews = knowledgeViews<BetExtra>({
  HostPre: HostWager,
  PlayerPre: PlayerWager,
  PlayerBanner: MyWager,
  revealTag: (state, p) => {
    const wager = state.extra.wagers?.[p.id];
    if (wager === undefined) return null;
    return <span className="fs-sm rounded-full bg-orange px-2 py-0.5 text-cream">💰 {wagerLabel(state.extra, p.id, wager)}</span>;
  },
});
