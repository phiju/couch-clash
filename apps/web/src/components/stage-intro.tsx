"use client";

import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { computeStageLayout, type StageLayout } from "@/lib/stage-layout";

type IntroState = "pending" | "play" | "done";

const SEEN_KEY = "couchclash:intro-seen";
const CONFETTI_AT_MS = 2400;
const CONFETTI_COLORS = ["#fdbc5f", "#e15a14", "#217b77", "#fff3d6", "#cc3e05"];

function introAlreadySeen(): boolean {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markIntroSeen() {
  try {
    window.sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    // ignore – the intro just plays again next time
  }
}

/**
 * Per page visit: was the intro already seen in this browser session?
 * Read once (and marked as seen), so it stays stable while the page is open.
 */
function createSeenStore() {
  let seen: boolean | null = null;
  return {
    subscribe: () => () => {},
    getSnapshot: () => {
      if (seen === null) {
        seen = introAlreadySeen();
        if (!seen) markIntroSeen();
      }
      return seen;
    },
    getServerSnapshot: () => null,
  };
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Start page stage: lights, spotlight, logo pop with confetti, host walk-in,
 * then the buttons (children). Plays once per browser session; any click,
 * tap or key skips to the final state.
 */
export function StageIntro({ children }: { children: React.ReactNode }) {
  const [seenStore] = useState(createSeenStore);
  const seen = useSyncExternalStore(seenStore.subscribe, seenStore.getSnapshot, seenStore.getServerSnapshot);
  const [finished, setFinished] = useState(false);
  const [layout, setLayout] = useState<StageLayout | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // pending (SSR / hydration) → play (first visit) → done (finished, skipped or seen before)
  const state: IntroState = seen === null ? "pending" : seen || finished ? "done" : "play";

  // Position logo + host from the background's cover scale; recompute on resize.
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

  // While playing: skip on any input, finish after the sequence, confetti burst.
  useEffect(() => {
    if (state !== "play") return;
    const finish = () => setFinished(true);
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
    ? { left: layout.host.left, top: layout.host.top, height: layout.host.height, width: layout.host.width }
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
