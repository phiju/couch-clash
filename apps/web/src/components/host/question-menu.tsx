"use client";

import type { ClientMessage, PublicRoomState } from "@couch-clash/shared";
import { useEffect, useRef, useState } from "react";

type Send = (msg: ClientMessage) => void;

/** How long "Rückgängig" is offered (the room allows 10 s). */
const UNDO_MS = 10_000;

/**
 * Host "⋯" menu during a question's reveal: "⚠️ Stimmt nicht?" takes the
 * question out of play right away (quarantine) – with 10 s to undo.
 */
export function QuestionMenu({ room, send }: { room: PublicRoomState; send: Send }) {
  const current = room.game?.currentQuestion;
  const [open, setOpen] = useState(false);
  const [reported, setReported] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!reported) return;
    const t = setTimeout(() => setReported(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [reported]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const canReport = !!current?.revealed;

  return (
    <>
      {canReport && (
        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-label="Mehr Optionen"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="fs-md rounded-full px-4 py-1 font-bold text-cream/60 hover:bg-petrol-dark/70 hover:text-cream"
          >
            ⋯
          </button>
          {open && (
            <div className="panel absolute top-full right-0 z-40 mt-2 min-w-max p-2">
              <button
                type="button"
                onClick={() => {
                  send({ type: "report_question", contentId: current.contentId });
                  setReported(current.contentId);
                  setOpen(false);
                }}
                className="fs-md w-full rounded-xl px-4 py-2 text-left font-bold hover:bg-petrol-dark/70"
              >
                ⚠️ Stimmt nicht?
              </button>
            </div>
          )}
        </div>
      )}
      {reported && (
        <div
          role="status"
          className="fs-md fixed bottom-[3vh] left-1/2 z-50 flex -translate-x-1/2 animate-pop items-center gap-4 rounded-full border-2 border-bulb/70 bg-petrol-dark/95 px-6 py-3 font-bold shadow-xl"
        >
          <span>Zur Prüfung markiert</span>
          <button
            type="button"
            onClick={() => {
              send({ type: "undo_report", contentId: reported });
              setReported(null);
            }}
            className="rounded-full bg-bulb px-4 py-1 text-brown hover:brightness-110"
          >
            Rückgängig
          </button>
        </div>
      )}
    </>
  );
}
