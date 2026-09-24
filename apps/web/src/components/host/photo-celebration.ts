"use client";

import type { PublicPlayer } from "@couch-clash/shared";
import { useEffect, useRef, useState } from "react";
import { getAudioEngine } from "@/lib/audio/engine";
import { newlyReadyPhotos, type ReadySnapshot } from "@/lib/photo-celebration";

const CELEBRATION_MS = 1800;

/** Ids of players whose photo avatar just arrived: sparkle on screen + short sting. */
export function usePhotoCelebration(players: readonly PublicPlayer[]): ReadonlySet<string> {
  const snapshot = useRef<ReadySnapshot>(new Map());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [celebrating, setCelebrating] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const { ready, snapshot: next } = newlyReadyPhotos(snapshot.current, players);
    snapshot.current = next;
    if (ready.length === 0) return;
    void getAudioEngine().playEffect("sting-short");
    // Timers survive further state updates (only cleared on unmount).
    const later = (ms: number, fn: () => void) => {
      const t = setTimeout(() => {
        timers.current.delete(t);
        fn();
      }, ms);
      timers.current.add(t);
    };
    later(0, () => setCelebrating((s) => new Set([...s, ...ready])));
    later(CELEBRATION_MS, () => setCelebrating((s) => new Set([...s].filter((id) => !ready.includes(id)))));
  }, [players]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending) clearTimeout(t);
    };
  }, []);

  return celebrating;
}
