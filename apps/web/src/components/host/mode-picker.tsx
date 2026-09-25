"use client";

import {
  DIFFICULTY_MIX_LABELS,
  DIFFICULTY_MIXES,
  GAME_MODE_INFO,
  GAME_MODES,
  normalizeModeSettings,
  type ClientMessage,
  type GameMode,
  type GameModeSettings,
} from "@couch-clash/shared";
import { useEffect, useRef, useState } from "react";
import { modeStore } from "@/lib/storage";

/**
 * Global game mode at the very top of the settings: 🧸 Kids · 👨‍👩‍👧 Familie · 🍸 Party.
 * Party asks once per room "sind alle über 18?". Familie/Party get a difficulty mix.
 */
export function ModePicker({
  mode,
  partyConfirmed,
  send,
  canSend,
  compact = false,
}: {
  mode: GameModeSettings;
  partyConfirmed: boolean;
  send: (msg: ClientMessage) => void;
  canSend: boolean;
  compact?: boolean;
}) {
  const [confirming, setConfirming] = useState<GameModeSettings | null>(null);
  const restored = useRef(false);

  const apply = (next: GameModeSettings, confirmAdult = false) => {
    modeStore.set(next);
    send({ type: "update_mode", mode: next, ...(confirmAdult ? { confirmAdult: true } : {}) });
  };
  const choose = (next: GameModeSettings) => {
    if (next.mode === "party" && !partyConfirmed) setConfirming(next);
    else apply(next);
  };

  // A new room starts with Familie: bring back this device's last mode (Party only after confirming again).
  useEffect(() => {
    if (!canSend || restored.current) return;
    restored.current = true;
    const stored = modeStore.get<unknown>();
    if (stored === null) return;
    const last = normalizeModeSettings(stored);
    if (last.mode === "party" && !partyConfirmed) return;
    if (JSON.stringify(last) !== JSON.stringify(mode)) send({ type: "update_mode", mode: last });
  }, [canSend, mode, partyConfirmed, send]);

  const text = compact ? "fs-md" : "text-xl";
  return (
    <section className="flex flex-col gap-2" aria-label="Spielmodus">
      <div role="radiogroup" aria-label="Wer spielt?" className="grid grid-cols-3 gap-2">
        {GAME_MODES.map((m: GameMode) => {
          const info = GAME_MODE_INFO[m];
          const active = mode.mode === m;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={!canSend}
              onClick={() => choose({ ...mode, mode: m })}
              className={`flex flex-col items-center rounded-2xl border-4 px-2 font-bold transition ${compact ? "py-[0.8vh]" : "py-3"} ${
                active ? "border-bulb bg-orange shadow-[0_5px_0_var(--color-brown)]" : "border-cream/20 bg-petrol-dark/70 hover:border-cream/50"
              }`}
            >
              <span className={compact ? "fs-xl" : "text-3xl"}>{info.emoji}</span>
              <span className={text}>{info.label}</span>
            </button>
          );
        })}
      </div>
      <p className={`text-center text-cream/70 ${compact ? "fs-sm" : "text-base"}`}>{GAME_MODE_INFO[mode.mode].who}</p>

      {mode.mode !== "kids" && (
        <div className={`flex flex-wrap items-center justify-between gap-2 ${compact ? "fs-sm" : "text-base"}`}>
          <span className="font-bold text-cream/80">Schwierigkeit</span>
          <div className="flex gap-1" role="radiogroup" aria-label="Schwierigkeit">
            {DIFFICULTY_MIXES.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={mode.difficulty === d}
                disabled={!canSend}
                onClick={() => choose({ ...mode, difficulty: d })}
                className={`rounded-full px-3 py-1 font-bold ${mode.difficulty === d ? "bg-bulb text-brown" : "bg-petrol-dark/70 text-cream/80"}`}
              >
                {DIFFICULTY_MIX_LABELS[d]}
              </button>
            ))}
          </div>
        </div>
      )}
      {mode.mode === "family" && (
        <label className={`flex cursor-pointer items-center justify-between gap-2 text-cream/80 ${compact ? "fs-sm" : "text-base"}`}>
          <span>Auch Fragen ab 16 erlauben</span>
          <input
            type="checkbox"
            checked={mode.allow16}
            disabled={!canSend}
            onChange={(e) => choose({ ...mode, allow16: e.target.checked })}
            className="size-5 accent-[var(--color-orange)]"
          />
        </label>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal>
          <div className="panel flex w-full max-w-md flex-col items-center gap-5 p-8 text-center">
            <div className="text-6xl">🍸</div>
            <p className="text-2xl font-bold">Party-Modus: Nur für Erwachsene – sind alle über 18?</p>
            <div className="flex gap-3">
              <button type="button" className="btn btn-secondary px-6 py-2 text-xl" onClick={() => setConfirming(null)}>
                Abbrechen
              </button>
              <button
                type="button"
                className="btn btn-primary px-6 py-2 text-xl"
                onClick={() => {
                  apply(confirming, true);
                  setConfirming(null);
                }}
              >
                Ja
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
