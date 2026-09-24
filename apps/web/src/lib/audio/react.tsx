"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getAudioEngine } from "./engine";
import type { AudioScene } from "./scenes";

const noop = () => () => {};

export function useAudioState() {
  const engine = getAudioEngine();
  const unlocked = useSyncExternalStore(engine.subscribe, () => engine.unlocked, () => false);
  const volume = useSyncExternalStore(engine.subscribe, () => engine.volume, () => 0.8);
  return { engine, unlocked, volume };
}

/** Plays whatever the current scene asks for (host only). */
export function AudioDirector({ scene }: { scene: AudioScene | null }) {
  const { engine, unlocked } = useAudioState();
  const key = scene?.key;
  useEffect(() => {
    if (unlocked) engine.applyScene(scene);
    // Re-run only when the scene changes or audio gets unlocked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, unlocked, engine]);
  return null;
}

/**
 * Speaker menu (top right): master volume, remembered on this device.
 * Before audio is unlocked (e.g. host page reloaded directly) it shows a
 * "Ton aktivieren" button instead.
 */
export function SoundControls() {
  const { engine, unlocked, volume } = useAudioState();
  const [open, setOpen] = useState(false);
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return null;

  if (!unlocked) {
    return (
      <button
        type="button"
        onClick={() => engine.unlock()}
        className="btn btn-primary animate-glow fixed top-[2vh] right-[1vw] z-50 px-4 py-2 text-base"
      >
        🔊 Ton aktivieren
      </button>
    );
  }

  return (
    <div className="fixed top-[2vh] right-[1vw] z-50 flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Lautstärke"
        aria-expanded={open}
        className="flex size-11 items-center justify-center rounded-full border-2 border-bulb bg-petrol-dark/90 text-xl shadow-lg"
      >
        {volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}
      </button>
      {open && (
        <label className="panel flex items-center gap-3 !rounded-2xl px-4 py-3 text-sm font-bold">
          Lautstärke
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => engine.setVolume(Number(e.target.value))}
            className="w-36 accent-[var(--color-orange)]"
          />
        </label>
      )}
    </div>
  );
}
