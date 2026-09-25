"use client";

import type { PublicRoomState } from "@couch-clash/shared";
import { AvatarBadge } from "@/components/avatar";
import { QUIZ_OPTION_STYLES } from "./options";

/** The four answers on the TV; at the reveal: the right one lit, who picked what, optional note under it. */
export function OptionGrid({
  options,
  correct,
  answers,
  room,
  columns = 2,
  belowCorrect,
  compact = false,
  onlyCorrect = false,
}: {
  options: readonly string[];
  /** Null while the question is open. */
  correct: number | null;
  answers: Record<string, number> | null;
  room: PublicRoomState;
  columns?: 1 | 2;
  /** E.g. the explanation, shown inside the correct answer's card. */
  belowCorrect?: React.ReactNode;
  compact?: boolean;
  /** At the reveal show only the right answer (little room next to a picture). */
  onlyCorrect?: boolean;
}) {
  const revealed = correct !== null;
  return (
    <ul className={`grid content-start ${compact ? "gap-[1.4vh]" : "gap-[2vh]"} ${columns === 2 ? "sm:grid-cols-2" : ""}`}>
      {options.map((option, i) => {
        const style = QUIZ_OPTION_STYLES[i]!;
        const isCorrect = correct === i;
        const pickedBy = answers ? room.players.filter((p) => answers[p.id] === i) : [];
        if (onlyCorrect && revealed && !isCorrect) return null;
        return (
          <li
            key={i}
            className={`flex flex-col justify-center gap-[1vh] rounded-[2rem] border-4 border-bulb px-[1.5vw] transition duration-500 ${
              compact ? "min-h-[9vh] py-[1.1vh]" : "min-h-[12vh] py-[1.6vh]"
            } ${style.bg} ${style.shadow} ${revealed && !isCorrect ? "scale-95 opacity-30 grayscale" : ""} ${
              revealed && isCorrect ? `${onlyCorrect ? "" : "scale-[1.03]"} ring-8 ring-cream/90` : ""
            }`}
          >
            <div className="flex items-center gap-4">
              <span className="fs-xl opacity-80">{style.shape}</span>
              <span className={`${compact ? "fs-lg" : "fs-xl"} font-bold`}>{option}</span>
              {isCorrect && <span className="fs-title ml-auto">✅</span>}
            </div>
            {pickedBy.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {pickedBy.map((p) => (
                  <AvatarBadge key={p.id} avatar={p.avatar} size="fluidSm" className="animate-pop" />
                ))}
              </div>
            )}
            {isCorrect && belowCorrect}
          </li>
        );
      })}
    </ul>
  );
}
