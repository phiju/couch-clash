"use client";

/**
 * Developer mode: the Survival-Finale's stage and ceremony with made-up
 * players – 2 to 10 lanes, the start ride, eliminations (does anything show
 * under the slime?), the winner and the podium. /dev/survival?n=6&scene=elim
 * (in `next dev` right away, in production once with ?dev=1).
 * Standing figures: ?fig=1 (the images come from the party worker's paths).
 */
import { SURVIVAL_CONFIG, SURVIVAL_PHASES, type SurvivalPublicPlayer, type SurvivalPublicState } from "@couch-clash/games/meta";
import { AVATAR_CHARACTERS, AVATAR_COLORS, type LeaderboardEntry, type PublicPlayer } from "@couch-clash/shared";
import { useEffect, useState, useSyncExternalStore } from "react";
import { SurvivalPodium } from "@/components/host/survival-podium";
import { Screen } from "@/components/ui";
import { devModeOn } from "@/lib/dev-mode";
import { launchFrame } from "@/games/survival/logic";
import { SurvivalStage } from "@/games/survival/stage";

const noop = () => () => {};
const SCENES = ["launch", "elim", "winner", "podium"] as const;
type Scene = (typeof SCENES)[number];
const NAMES = ["Anna", "Ben", "Cleo", "Dario", "Emma", "Finn", "Greta", "Hugo", "Ida", "Jonas"];

function params() {
  const q = new URLSearchParams(window.location.search);
  const n = Math.min(10, Math.max(2, Number(q.get("n")) || 5));
  const scene = (SCENES as readonly string[]).includes(q.get("scene") ?? "") ? (q.get("scene") as Scene) : "elim";
  return { n, scene, fig: q.get("fig") === "1" };
}

function players(n: number, fig: boolean): PublicPlayer[] {
  return NAMES.slice(0, n).map((name, i) => ({
    id: `p${i}`,
    name,
    joinedAt: i,
    connected: true,
    online: true,
    avatar: {
      character: AVATAR_CHARACTERS[i % AVATAR_CHARACTERS.length]!.id,
      color: AVATAR_COLORS[i % AVATAR_COLORS.length]!.id,
      ...(fig && i % 3 !== 2
        ? {
            photo: {
              status: "ready" as const,
              version: 1,
              readyVersion: 1,
              accepted: true,
              expressions: ["neutral" as const],
              regenerationsLeft: 0,
              reason: null,
              path: `/api/rooms/DEV0/avatar/p${i}`,
              saved: true,
              figures: ["standard" as const, "jubelnd" as const, "besorgt" as const, "panisch" as const, "geschockt" as const, ...(i === 0 ? (["pokal"] as const) : [])],
              figuresPending: false,
            },
          }
        : {}),
    } as PublicPlayer["avatar"],
  }));
}

function survival(ps: PublicPlayer[], over: { now: number; scene: Scene; riseAt: number | null; outAt: number | null }): SurvivalPublicState {
  const { now, scene, riseAt, outAt } = over;
  const starts = ps.map((_, i) => Math.max(200, 1200 - i * 110));
  const out = (i: number) => (scene === "elim" || scene === "winner") && outAt !== null && i % 2 === 1;
  const sp: SurvivalPublicPlayer[] = ps.map((p, i) => ({
    id: p.id,
    lane: i,
    mainScore: 2000 - i * 180,
    startScore: starts[i]!,
    score: out(i) ? 0 : scene === "launch" ? starts[i]! : Math.max(40, starts[i]! - i * 60),
    danger: "SAFE",
    eliminated: out(i),
    eliminatedAt: out(i) ? outAt : null,
    eliminatedQuestion: out(i) ? 3 : null,
    answered: false,
    decayApplied: 0,
    change: null,
  }));
  return {
    step: scene === "launch" ? "launch" : scene === "winner" ? "winner" : "reveal",
    stepStartedAt: now,
    stepEndsAt: now + 10_000,
    phaseIndex: 0,
    phase: SURVIVAL_PHASES[0]!,
    questionsPlayed: 3,
    suddenDeaths: 0,
    players: sp,
    question: null,
    myAnswer: null,
    reveal: null,
    tiebreak: null,
    launch: scene === "launch" ? { riseAt, riseMs: SURVIVAL_CONFIG.riseMs } : null,
    winnerId: scene === "winner" ? "p0" : null,
    solo: false,
    ranking: null,
    events: [],
    rules: { wrongAnswerPenalty: 200, scoreDecayPerSecond: 10, moderatorCaptions: false, danger: SURVIVAL_CONFIG.danger },
  };
}

export function SurvivalPreview() {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const dev = useSyncExternalStore(noop, devModeOn, () => false);
  if (!mounted) return null;
  if (!dev) {
    return (
      <Screen dim="soft">
        <p className="panel px-6 py-4 text-center text-lg font-bold">Nur im Entwicklermodus (einmal mit ?dev=1 öffnen).</p>
      </Screen>
    );
  }
  return <Preview {...params()} />;
}

function Preview({ n, scene, fig }: { n: number; scene: Scene; fig: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  // Start ride / elimination begin shortly after (again with "Nochmal").
  const [startAt, setStartAt] = useState(() => Date.now() + 800);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 33);
    return () => clearInterval(id);
  }, []);
  const ps = players(n, fig);
  const started = now >= startAt;
  const state = survival(ps, { now: startAt, scene, riseAt: scene === "launch" ? startAt : null, outAt: started ? startAt : null });
  const launch = launchFrame(state, now);
  const scores = launch
    ? Object.fromEntries([...launch].map(([id, c]) => [id, c.score]))
    : Object.fromEntries(state.players.map((p) => [p.id, p.score]));
  const entries: LeaderboardEntry[] = ps.map((p, i) => ({
    playerId: p.id,
    scoreBefore: 0,
    pointsGained: 0,
    scoreAfter: 2000 - i * 180,
    rankBefore: i + 1,
    rankAfter: i + 1,
    positionBefore: i,
    positionAfter: i,
  }));

  const bar = (
    <nav className="flex shrink-0 flex-wrap items-center gap-2 text-sm" aria-label="Vorschau">
      {SCENES.map((s) => (
        <a key={s} href={`?n=${n}&scene=${s}${fig ? "&fig=1" : ""}`} className={`rounded-full px-3 py-1 font-bold ${s === scene ? "bg-bulb text-brown" : "chip"}`}>
          {s}
        </a>
      ))}
      {[2, 3, 4, 5, 6, 8, 10].map((k) => (
        <a key={k} href={`?n=${k}&scene=${scene}${fig ? "&fig=1" : ""}`} className={`rounded-full px-3 py-1 font-bold ${k === n ? "bg-bulb text-brown" : "chip"}`}>
          {k}
        </a>
      ))}
      <button type="button" onClick={() => setStartAt(Date.now() + 800)} className="chip rounded-full px-3 py-1 font-bold">
        ↻ Nochmal
      </button>
    </nav>
  );

  if (scene === "podium") {
    return (
      <Screen fit className="max-w-[1500px]">
        {bar}
        <SurvivalPodium entries={entries.slice(0, n)} byId={new Map(ps.map((p) => [p.id, p]))} />
      </Screen>
    );
  }
  return (
    <Screen fit className="max-w-[2000px] !items-stretch">
      <div className="sv-grain flex min-h-0 w-full flex-1 flex-col gap-[1.2vh]">
        {bar}
        <SurvivalStage state={state} players={ps} now={now} scores={scores} launch={launch} />
      </div>
    </Screen>
  );
}
