"use client";

import Image from "next/image";
import { SHOW_VOICE_ATTRIBUTION } from "@/lib/config";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getAudioEngine } from "@/lib/audio/engine";
import { SoundControls } from "@/lib/audio/react";
import { computeStageLayout, type StageLayout } from "@/lib/stage-layout";

type IntroState = "welcome" | "play" | "done";

const CONFETTI_AT_MS = 2400;
const CONFETTI_COLORS = ["#fdbc5f", "#e15a14", "#217b77", "#fff3d6", "#cc3e05"];

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Start page: a welcome card on the dark stage. "Los geht's!" unlocks audio
 * for the whole session, plays the title jingle and the intro (lights,
 * spotlight, logo pop with confetti, host walk-in), then the buttons
 * (children). Any click, tap or key during the intro skips to the end.
 * The welcome card shows on every fresh visit of the start page.
 */
export function StageIntro({ children, onDone }: { children: React.ReactNode; onDone?: () => void }) {
  // Coming back to "/" within the app (audio already on): skip the welcome card.
  const [state, setState] = useState<IntroState>(() => (getAudioEngine().unlocked ? "done" : "welcome"));
  const [layout, setLayout] = useState<StageLayout | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  function start() {
    const engine = getAudioEngine();
    engine.unlock(); // inside the click: browsers allow audio from here on
    void engine.playTitleJingle();
    setState("play");
  }

  // Position the host + logo group from the background's cover scale; recompute on resize.
  useLayoutEffect(() => {
    const place = () => {
      const actions = actionsRef.current;
      const actionsTop = actions ? actions.getBoundingClientRect().top : window.innerHeight;
      setLayout(computeStageLayout(window.innerWidth, window.innerHeight, actionsTop));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("orientationchange", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("orientationchange", place);
    };
  }, []);

  // Intro finished (or skipped): the page may show things on top (e.g. "Neuigkeiten").
  useEffect(() => {
    if (state === "done") onDone?.();
  }, [state, onDone]);

  // While playing: skip on any input, finish after the sequence, confetti burst.
  useEffect(() => {
    if (state !== "play") return;
    const finish = () => setState("done");
    const endTimer = setTimeout(finish, 5600);
    const confettiTimer = reducedMotion() ? undefined : setTimeout(() => burst(canvasRef.current), CONFETTI_AT_MS);
    window.addEventListener("pointerdown", finish);
    window.addEventListener("keydown", finish);
    return () => {
      clearTimeout(endTimer);
      if (confettiTimer) clearTimeout(confettiTimer);
      window.removeEventListener("pointerdown", finish);
      window.removeEventListener("keydown", finish);
    };
  }, [state]);

  const logoStyle = layout
    ? {
        left: layout.logo.left,
        top: layout.logo.top,
        width: layout.logo.width,
        transformOrigin: "64% 98.8%", // grow out of the stage, at the sofa feet
      }
    : { visibility: "hidden" as const };
  const hostStyle = layout
    ? ({
        left: layout.host.left,
        top: layout.host.top,
        height: layout.host.height,
        width: layout.host.width,
        // Walk-in from fully outside the screen (left edge + his width + 40 px).
        "--host-start-x": `${layout.hostStartX}px`,
      } as React.CSSProperties)
    : { visibility: "hidden" as const };

  return (
    <div className="intro" data-state={state}>
      <div className="intro-bg" aria-hidden />
      <div className="intro-spot" aria-hidden />
      <Image
        src="/brand/host.webp"
        alt=""
        width={520}
        height={1123}
        priority
        sizes="(max-aspect-ratio: 3/4) 45vw, 22vw"
        className="intro-host"
        style={hostStyle}
      />
      <Image
        src="/brand/logo.webp"
        alt="Couch Clash"
        width={1100}
        height={731}
        priority
        sizes="(max-aspect-ratio: 3/4) 74vw, 50vw"
        className="intro-logo"
        style={logoStyle}
      />
      <canvas ref={canvasRef} className="intro-confetti" aria-hidden />
      <div className="intro-vignette" aria-hidden />
      {state !== "done" && <WelcomeCard onStart={start} />}
      {state !== "welcome" && <SoundControls />}
      <div
        ref={actionsRef}
        className="intro-actions bottom-[5%] left-1/2 flex w-[82vw] -translate-x-1/2 flex-col gap-4 wide:bottom-[8%] wide:w-auto wide:flex-row wide:gap-5"
      >
        {children}
      </div>
      {state === "play" && (
        <p className="absolute top-3 right-4 z-10 text-sm text-cream/60" aria-hidden>
          Tippen zum Überspringen
        </p>
      )}
      {SHOW_VOICE_ATTRIBUTION && (
        <p className="absolute right-3 bottom-2 z-10 text-xs text-cream/50">Stimme: ElevenLabs</p>
      )}
    </div>
  );
}

function WelcomeCard({ onStart }: { onStart: () => void }) {
  return (
    <div className="welcome absolute inset-0 z-20 flex items-center justify-center p-[3vmin]">
      <div className="panel flex max-h-full w-[min(40rem,94vw)] flex-col items-center gap-[clamp(0.6rem,2.2vh,1.5rem)] overflow-hidden !rounded-[2rem] px-[clamp(1rem,4vw,3rem)] py-[clamp(1rem,4vh,3rem)] text-center shadow-[0_0_60px_rgb(253_188_95/0.35)]">
        <p className="text-[clamp(0.75rem,1.9vh,1.1rem)] font-bold tracking-[0.18em] text-bulb uppercase">
          Die Partyshow fürs Wohnzimmer
        </p>
        <h1 className="text-[clamp(1.6rem,min(7vw,5.8vh),3.6rem)] leading-tight font-bold text-balance">
          Willkommen bei Couch Clash
        </h1>
        <p className="text-[clamp(0.95rem,min(4vw,2.6vh),1.4rem)] text-cream/90">
          Der Fernseher ist die Bühne, eure Handys sind die Buzzer.
        </p>
        <ul className="flex w-full flex-col gap-[clamp(0.35rem,1.2vh,0.8rem)] text-left text-[clamp(0.9rem,min(3.8vw,2.4vh),1.3rem)]">
          {[
            ["📺", "Spiel auf dem Fernseher oder Laptop starten"],
            ["📱", "Alle scannen den QR-Code mit dem Handy"],
            ["🏆", "Raten, schätzen, punkten – wer holt den Pokal?"],
          ].map(([emoji, text]) => (
            <li key={text} className="flex items-center gap-3 rounded-2xl chip px-4 py-[clamp(0.3rem,1vh,0.7rem)]">
              <span className="text-[1.4em]">{emoji}</span>
              <span>{text}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onStart}
          className="btn btn-primary animate-glow px-[clamp(1.5rem,5vw,3rem)] py-[clamp(0.5rem,1.6vh,1rem)] text-[clamp(1.4rem,min(6vw,4.4vh),2.6rem)] whitespace-nowrap"
        >
          Los geht&apos;s!
        </button>
        <p className="text-[clamp(0.8rem,min(3.4vw,2vh),1.1rem)] text-cream/80">
          🔊 Couch Clash läuft mit Ton – Lautsprecher an!
        </p>
      </div>
    </div>
  );
}

/** Confetti burst from above the logo (port of the prototype). */
function burst(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  const cx = canvas.width / 2;
  const cy = canvas.height * 0.3;
  let parts = Array.from({ length: 160 }, (_, i) => {
    const a = Math.random() * Math.PI * 2;
    const speed = (4 + Math.random() * 10) * dpr;
    return {
      x: cx,
      y: cy,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed - 6 * dpr,
      w: (6 + Math.random() * 8) * dpr,
      h: (4 + Math.random() * 6) * dpr,
      r: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.3,
      c: CONFETTI_COLORS[i % CONFETTI_COLORS.length]!,
      life: 1,
    };
  });
  const tick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.vy += 0.35 * dpr;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      p.life -= 0.006;
      ctx.save();
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    parts = parts.filter((p) => p.life > 0 && p.y < canvas.height + 50);
    if (parts.length) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
  tick();
}
