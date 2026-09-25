"use client";

import type { RoomNotice } from "@couch-clash/shared";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { displayJoinLink, joinUrl as buildJoinUrl } from "@/lib/config";
import { noticeText } from "@/lib/rejoin";

export { showJoinChip } from "@/lib/rejoin";

const subscribeNoop = () => () => {};

/**
 * During the game: room code + mini QR in the corner, so anyone can get
 * (back) in without going to the lobby. Tap or "Q" enlarges it.
 */
export function JoinCornerChip({ code }: { code: string }) {
  const [big, setBig] = useState(false);
  const url = useSyncExternalStore(subscribeNoop, () => buildJoinUrl(code), () => null);
  const link = useSyncExternalStore(subscribeNoop, () => displayJoinLink(), () => "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "q" || e.key === "Q") setBig((b) => !b);
      else if (e.key === "Escape") setBig(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!url) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setBig(true)}
        aria-label={`Raumcode ${code} – QR-Code vergrößern (Taste Q)`}
        className="fixed right-[1vw] bottom-[1.5vh] z-30 flex items-center gap-[0.6vw] rounded-2xl border-2 border-bulb/60 bg-petrol-dark/85 p-[0.6vh] pr-[0.9vw] opacity-80 transition hover:opacity-100"
      >
        <span className="block size-[clamp(2.5rem,6vh,4.5rem)] rounded-lg bg-cream p-1">
          <QRCodeSVG value={url} size={128} marginSize={0} style={{ width: "100%", height: "100%" }} />
        </span>
        <span className="fs-md font-bold tracking-widest">{code}</span>
      </button>
      {big && (
        <div
          role="dialog"
          aria-label="Beitreten"
          onClick={() => setBig(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-brown/70 backdrop-blur-sm"
        >
          <div className="panel flex flex-col items-center gap-[2vh] p-[4vh] text-center">
            <p className="fs-title font-bold">Wieder rein oder neu dabei?</p>
            <span className="block size-[min(50vh,40vw)] rounded-3xl bg-cream p-[2vh]">
              <QRCodeSVG value={url} size={512} marginSize={0} style={{ width: "100%", height: "100%" }} />
            </span>
            <p className="fs-xl font-bold">
              {link} · Code <span className="tracking-widest text-bulb">{code}</span>
            </p>
            <p className="fs-md text-cream/70">Scannen und deinen Namen antippen · Q schließt</p>
          </div>
        </div>
      )}
    </>
  );
}

interface Toast {
  id: number;
  text: string;
}

/** Short toasts on the TV (~4.5 s each). */
export function useHostToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const push = useCallback((notice: RoomNotice) => {
    const id = ++next.current;
    setToasts((t) => [...t.slice(-2), { id, text: noticeText(notice) }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4_500);
  }, []);
  return { toasts, push };
}

/** In the game above the corner chip; elsewhere (no chip, "Spiel starten" bottom right) bottom center. */
export function HostToasts({ toasts, centered = false }: { toasts: Toast[]; centered?: boolean }) {
  if (toasts.length === 0) return null;
  const place = centered
    ? "bottom-[3vh] left-1/2 -translate-x-1/2 items-center"
    : "right-[1vw] bottom-[calc(1.5vh+clamp(2.5rem,6vh,4.5rem)+2.5vh)] items-end";
  return (
    <div role="status" className={`pointer-events-none fixed z-40 flex flex-col gap-2 ${place}`}>
      {toasts.map((t) => (
        <p key={t.id} className="fs-lg animate-pop rounded-full border-2 border-bulb bg-petrol-dark/95 px-5 py-2 font-bold shadow-xl">
          {t.text}
        </p>
      ))}
    </div>
  );
}
