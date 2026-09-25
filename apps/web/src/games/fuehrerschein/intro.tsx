"use client";

import { useEffect } from "react";
import { playHorn } from "./sfx";

/** Category intro: the yellow FAHRSCHULE roof sign drops onto the card – hup hup! */
export function FahrschuleIntro() {
  useEffect(() => {
    const t = setTimeout(playHorn, 1_050);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="roof-sign pointer-events-none flex flex-col items-center" aria-hidden>
      <div className="relative rounded-t-[3rem] rounded-b-xl border-[6px] border-brown bg-bulb px-[3vw] pt-[1.2vh] pb-[0.8vh] shadow-[0_8px_0_var(--color-brown)]">
        <span className="fs-title block font-stamp tracking-[0.18em] text-brown">FAHRSCHULE</span>
        <span className="absolute top-1/2 left-[0.9vw] h-[1.4vh] w-[1.4vh] -translate-y-1/2 rounded-full border-4 border-brown bg-cream" />
        <span className="absolute top-1/2 right-[0.9vw] h-[1.4vh] w-[1.4vh] -translate-y-1/2 rounded-full border-4 border-brown bg-cream" />
      </div>
      <div className="h-[1.2vh] w-[60%] rounded-b-lg border-x-[6px] border-b-[6px] border-brown bg-[#8d8f93]" />
    </div>
  );
}

/** Clipboard prop for the host while he plays the driving instructor (overlay on the mascot). */
export function Clipboard() {
  return (
    <svg viewBox="0 0 120 150" className="h-full w-full drop-shadow-[0_8px_10px_rgb(0_0_0/0.4)]" aria-hidden>
      <rect x="8" y="14" width="104" height="130" rx="12" fill="#a0612f" stroke="#562512" strokeWidth="6" />
      <rect x="20" y="30" width="80" height="104" rx="4" fill="#fbf1d8" stroke="#562512" strokeWidth="3" />
      <rect x="38" y="4" width="44" height="22" rx="8" fill="#9aa0a6" stroke="#562512" strokeWidth="5" />
      {[48, 66, 84, 102].map((y) => (
        <g key={y}>
          <rect x="28" y={y - 7} width="12" height="12" rx="2" fill="none" stroke="#562512" strokeWidth="3" />
          <path d={`M 30 ${y - 1} l 3 4 l 6 -9`} fill="none" stroke="#2f8a4c" strokeWidth="3.5" strokeLinecap="round" />
          <line x1="46" y1={y} x2="92" y2={y} stroke="#562512" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
        </g>
      ))}
      <text x="60" y="126" textAnchor="middle" fontSize="13" fontWeight="700" fill="#c2330a" transform="rotate(-8 60 126)">
        TÜV
      </text>
    </svg>
  );
}
