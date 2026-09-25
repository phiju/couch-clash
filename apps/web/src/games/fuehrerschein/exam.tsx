"use client";

/** Prüfungsbogen styling, the explanation box and the BESTANDEN / DURCHGEFALLEN results. */
import { examStampDelayMs, type ExamSummary } from "@couch-clash/games/meta";
import type { PublicRoomState } from "@couch-clash/shared";
import { useEffect } from "react";
import { AvatarBadge } from "../../components/avatar";
import { playStamp } from "./sfx";

/** Header strip of the exam sheet: "PRÜFUNGSBOGEN · Frage 3 / 8". */
export function ExamHeader({ index, total, kind }: { index: number; total: number; kind: "text" | "sign" | "scene" }) {
  const label = { text: "Theorie", sign: "Verkehrszeichen", scene: "Vorfahrt" }[kind];
  return (
    <div className="flex items-center justify-between gap-4 border-b-[3px] border-dashed border-brown/60 pb-[0.8vh] font-stamp">
      <span className="fs-md tracking-[0.2em] uppercase">Prüfungsbogen · {label}</span>
      <span className="fs-md whitespace-nowrap">
        Frage {index + 1} / {total}
      </span>
    </div>
  );
}

/** Shown under the correct answer at the reveal (not read out). */
export function Explanation({ text, variant = "tv" }: { text: string; variant?: "tv" | "phone" }) {
  return (
    <p
      className={`exam-box animate-pop font-stamp text-brown ${variant === "tv" ? "fs-md px-[1vw] py-[1vh]" : "px-4 py-3 text-lg"}`}
      style={{ animationDelay: "250ms", animationFillMode: "backwards" }}
    >
      <span className="mr-2 font-bold text-[#2f8a4c]">✔ Merke:</span>
      {text}
    </p>
  );
}

export function Stamp({ passed, className = "", delayMs = 0 }: { passed: boolean; className?: string; delayMs?: number }) {
  return (
    <span className={`exam-stamp inline-block font-bold ${className}`} data-passed={passed} style={{ animationDelay: `${delayMs}ms` }}>
      {passed ? "Bestanden" : "Durchgefallen"}
    </span>
  );
}

/** TV: every player's exam result, stamps one after another (with a thump each). */
export function ExamResultsTv({ summary, room }: { summary: ExamSummary; room: PublicRoomState }) {
  const results = summary.results.filter((r) => room.players.some((p) => p.id === r.playerId));
  const n = results.length;
  useEffect(() => {
    const timers = results.map((r, i) => setTimeout(() => playStamp(r.passed), examStampDelayMs(i, n) + 120));
    return () => timers.forEach(clearTimeout);
    // Once per summary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const passed = results.filter((r) => r.passed).length;
  const cols = n <= 4 ? 1 : n <= 10 ? 2 : 3;
  return (
    <div className="exam-sheet flex min-h-0 w-full max-w-[1500px] flex-1 flex-col gap-[1.6vh] self-center p-[3vh]">
      <div className="flex items-end justify-between gap-4 border-b-[3px] border-dashed border-brown/60 pb-[1vh]">
        <h2 className="fs-title font-stamp tracking-[0.12em] uppercase">Prüfungsergebnis</h2>
        <span className="fs-md font-stamp">
          Bestanden ab {Math.round(summary.passShare * 100)} % · {passed} von {n} bestanden
        </span>
      </div>
      <ul className={`grid min-h-0 flex-1 content-start gap-[1.4vh] overflow-y-auto ${["", "grid-cols-1", "grid-cols-2", "grid-cols-3"][cols]}`}>
        {results.map((r, i) => {
          const p = room.players.find((x) => x.id === r.playerId)!;
          return (
            <li key={r.playerId} className="exam-box relative flex items-center gap-[1vw] px-[1.4vw] py-[1.6vh]">
              <AvatarBadge avatar={p.avatar} size="fluidSm" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className={`${cols === 1 ? "fs-xl" : "fs-lg"} truncate font-bold`}>{p.name}</span>
                <span className="fs-md font-stamp">
                  {r.correct} / {r.total} richtig
                </span>
              </div>
              <Stamp passed={r.passed} delayMs={examStampDelayMs(i, n)} className={`mr-[0.6vw] shrink-0 ${cols === 1 ? "fs-xl" : cols === 2 ? "fs-lg" : "fs-md"}`} />
            </li>
          );
        })}
      </ul>
      <p className="fs-sm font-stamp text-brown/70">Nur Show – an euren Punkten ändert das nichts.</p>
    </div>
  );
}

/** Phone: the own exam result, big. */
export function ExamResultPhone({ summary, meId }: { summary: ExamSummary; meId: string }) {
  const mine = summary.results.find((r) => r.playerId === meId);
  const index = Math.max(0, summary.results.findIndex((r) => r.playerId === meId));
  return (
    <div className="exam-sheet flex w-full flex-col items-center gap-5 p-6 text-center">
      <p className="font-stamp text-2xl tracking-[0.12em] uppercase">Prüfungsergebnis</p>
      {mine ? (
        <>
          <p className="font-stamp text-xl">
            {mine.correct} von {mine.total} Fragen richtig
          </p>
          <Stamp passed={mine.passed} delayMs={examStampDelayMs(index, summary.results.length)} className="py-2 text-4xl" />
          <p className="text-lg">{mine.passed ? "Glückwunsch – ab auf die Straße! 🚗" : "Wir sehen uns nächste Woche wieder … 📚"}</p>
        </>
      ) : (
        <p className="text-xl">Diesmal nicht mitgeprüft.</p>
      )}
      <p className="text-sm text-brown/70">Nur Show – an deinen Punkten ändert das nichts.</p>
    </div>
  );
}
