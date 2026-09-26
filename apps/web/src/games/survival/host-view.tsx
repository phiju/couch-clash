"use client";

import type { SurvivalPublicQuestion, SurvivalPublicState } from "@couch-clash/games/meta";
import type { PublicRoomState } from "@couch-clash/shared";
import { useContext, useEffect, useRef } from "react";
import { AvatarBadge } from "@/components/avatar";
import { useHostSpeech } from "@/components/host/voice";
import { ClockContext, useServerNow } from "@/lib/clock";
import { QUIZ_OPTION_STYLES } from "../quiz/options";
import type { HostViewProps } from "../types";
import { getAudioEngine } from "@/lib/audio/engine";
import { SOUND_CUE_VOLUMES, SOUND_IDS } from "@/lib/audio/scenes";
import { launchFrame, launchStops, liveScores, newEvents, timeZone, zoneText } from "./logic";
import { ambienceFor, decaySecond, freshEvents, soundsFor, type SurvivalHookEvent } from "./sounds";
import { SurvivalBackdrop, SurvivalStage } from "./stage";

export function SurvivalHostView({ state, room }: HostViewProps<SurvivalPublicState>) {
  // The start ride is animated frame by frame (height and points in step); otherwise 5 updates a second are plenty.
  const now = useServerNow(state.step === "launch" && state.launch?.riseAt != null ? 33 : 200);
  const q = state.question;
  const zone = q && state.step === "question" ? timeZone(q, now) : null;
  const intro = state.step === "intro";
  const launch = launchFrame(state, now);
  const live = liveScores(state, now);
  const scores = launch ? Object.fromEntries([...launch].map(([id, car]) => [id, car.score])) : live;
  useSurvivalSounds(state.step);
  useLaunchSounds(state);
  useSurvivalHooks(state, now, live);
  const descending = new Set(
    zone === "decay" && q ? state.players.filter((p) => q.aliveAtStart.includes(p.id) && !p.answered && !p.eliminated).map((p) => p.id) : [],
  );

  return (
    <div className="sv-grain flex min-h-0 w-full flex-1 flex-col gap-[1.2vh]">
      <SurvivalBackdrop />
      <div className="flex shrink-0 items-center gap-[1.2vw]">
        <PhaseBadge state={state} />
        {q && (state.step === "question" || state.step === "reveal") && (
          <span className="fs-md shrink-0 rounded-full border-2 border-bulb bg-petrol-dark/85 px-4 py-[0.6vh] font-bold whitespace-nowrap">
            Frage {q.number}
          </span>
        )}
        {q && state.step === "question" && <Timeline q={q} now={now} decayPerSecond={state.rules.scoreDecayPerSecond} />}
        {state.step === "tiebreak" && state.tiebreak && (
          <SecondsBadge endsAt={state.tiebreak.endsAt} now={now} />
        )}
      </div>

      {intro && <IntroCard state={state} />}
      {state.step === "launch" && <LaunchTitle />}
      {q && (state.step === "question" || state.step === "reveal") && <QuestionCard q={q} state={state} room={room} />}
      {(state.step === "tiebreak" || state.step === "tiebreak_reveal") && <TiebreakCard state={state} room={room} />}
      {state.step === "phase_change" && <Banner title={state.phase.label} text={phaseText(state)} />}
      {state.step === "sudden_death" && (
        <Banner title="SUDDEN DEATH" text={`Alle im Schleim?! Nicht mit mir. Zurück aufs Brett – mit ${suddenScore(state)} Punkten. DEATH MODE!`} />
      )}
      {state.step === "winner" && <WinnerBanner state={state} room={room} />}

      <SurvivalStage
        state={state}
        players={room.players}
        now={now}
        scores={scores}
        launch={launch}
        descending={descending}
      />
      {state.rules.moderatorCaptions && <CaptionLine />}
    </div>
  );
}

function suddenScore(state: SurvivalPublicState): number {
  return state.players.find((p) => !p.eliminated)?.score ?? 100;
}

function phaseText(state: SurvivalPublicState): string {
  const p = state.phase;
  if (p.baseDrain > 0) return `Kein Bonus mehr – und nach jeder Frage −${p.baseDrain} für alle. Irgendwer geht jetzt baden.`;
  return `Es wird schneller: Bonus bis ${p.speedBonusThreshold} s, Verfall ab ${p.scoreDecayThreshold} s, Schluss nach ${p.questionTimeout} s.`;
}

function PhaseBadge({ state }: { state: SurvivalPublicState }) {
  const death = state.phase.id === "death";
  return (
    <span
      className={`fs-md shrink-0 rounded-full border-2 px-4 py-[0.6vh] font-bold tracking-wide whitespace-nowrap ${
        death ? "animate-pulse border-orange bg-rust text-cream" : "border-bulb bg-petrol-dark/85 text-bulb"
      }`}
    >
      🟢 SURVIVAL · {state.phase.label}
    </span>
  );
}

function SecondsBadge({ endsAt, now }: { endsAt: number; now: number }) {
  return (
    <span className="fs-title ml-auto font-bold text-bulb tabular-nums">{Math.max(0, Math.ceil((endsAt - now) / 1000))}</span>
  );
}

/** Bonus zone · neutral · decay zone, with the "now" marker and the zone's hint. */
function Timeline({ q, now, decayPerSecond }: { q: SurvivalPublicQuestion; now: number; decayPerSecond: number }) {
  const total = Math.max(1, q.timeoutAt - q.startedAt);
  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - q.startedAt) / total) * 100))}%`;
  const zone = timeZone(q, now);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-[1vw]">
      <div className="sv-timeline flex-1">
        {q.phase.speedBonus > 0 && <span className="sv-timeline-zone bg-bulb/80" style={{ left: 0, width: pct(q.bonusUntil) }} />}
        <span className="sv-timeline-zone bg-rust/80" style={{ left: pct(q.decayFrom), right: 0 }} />
        <span className="sv-timeline-now" style={{ left: pct(now) }} />
      </div>
      <span
        className={`fs-md shrink-0 rounded-full px-3 py-[0.4vh] font-bold whitespace-nowrap ${
          zone === "bonus" ? "bg-bulb text-brown" : zone === "decay" ? "animate-pulse bg-rust text-cream" : "chip text-cream/80"
        }`}
      >
        {zoneText(zone, q, decayPerSecond)}
      </span>
      <span className={`fs-title w-[2.5ch] text-right font-bold tabular-nums ${zone === "decay" ? "text-orange" : "text-bulb"}`}>
        {Math.max(0, Math.ceil((q.timeoutAt - now) / 1000))}
      </span>
    </div>
  );
}

function QuestionCard({ q, state, room }: { q: SurvivalPublicQuestion; state: SurvivalPublicState; room: PublicRoomState }) {
  const reveal = state.reveal;
  return (
    <div className="flex shrink-0 flex-col gap-[1vh]">
      <h2 className="panel fs-xl px-[2vw] py-[1.4vh] text-center font-bold text-balance">{q.text}</h2>
      <ul className="grid grid-cols-2 gap-[1vh] lg:grid-cols-4">
        {q.options.map((option, i) => {
          const style = QUIZ_OPTION_STYLES[i]!;
          const correct = reveal?.correctIndex === i;
          const pickedBy = reveal ? room.players.filter((p) => reveal.answers[p.id] === i) : [];
          return (
            <li
              key={i}
              className={`flex min-h-[6.5vh] items-center gap-[0.8vw] rounded-[1.4rem] border-4 border-bulb px-[1vw] py-[0.8vh] transition duration-500 ${style.bg} ${style.shadow} ${
                reveal && !correct ? "scale-95 opacity-30 grayscale" : ""
              } ${correct ? "ring-8 ring-cream/90" : ""}`}
            >
              <span className="fs-lg opacity-80">{style.shape}</span>
              <span className="fs-lg min-w-0 flex-1 font-bold">{option}</span>
              {pickedBy.map((p) => (
                <AvatarBadge key={p.id} avatar={p.avatar} size="fluidSm" className="animate-pop" />
              ))}
              {correct && <span className="fs-xl">✅</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Start sequence: the title while the moderator opens and the elevators ride up to their start. */
function LaunchTitle() {
  return (
    <div className="panel sv-banner shrink-0 px-[2vw] py-[1.2vh] text-center">
      <h2 className="fs-hero font-bold text-bulb drop-shadow-[0_6px_0_var(--color-brown)]">SURVIVAL-FINALE</h2>
      <p className="fs-xl text-cream/90">Eure Punkte werden zu Lebensenergie. Wer vorne lag, steht höher.</p>
    </div>
  );
}

/** The rules (right after the last normal round – no standings in between). */
function IntroCard({ state }: { state: SurvivalPublicState }) {
  const p = state.phase;
  const lines = [
    `RICHTIG IN UNTER ${p.speedBonusThreshold} SEKUNDEN: +${p.speedBonus}`,
    `RICHTIG IN ${p.speedBonusThreshold}–${p.scoreDecayThreshold} SEKUNDEN: ±0`,
    `NACH ${p.scoreDecayThreshold} SEKUNDEN: −${state.rules.scoreDecayPerSecond} PRO SEKUNDE`,
    `FALSCHE ANTWORT ODER KEINE ANTWORT: −${state.rules.wrongAnswerPenalty}`,
    "ES WIRD IMMER SCHNELLER.",
    "0 PUNKTE: DU BIST RAUS.",
  ];
  return (
    <div className="panel sv-banner shrink-0 px-[2vw] py-[1.4vh] text-center">
      <h2 className="fs-title font-bold text-bulb">DEINE PUNKTE SIND DEIN LEBEN.</h2>
      <ul className="fs-lg mt-[0.6vh] grid gap-x-[2vw] gap-y-[0.3vh] font-bold lg:grid-cols-2">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p className="fs-xl mt-[0.8vh] font-bold text-orange">DER LETZTE SPIELER GEWINNT.</p>
    </div>
  );
}

function Banner({ title, text }: { title: string; text: string }) {
  return (
    <div key={title} className="panel sv-banner shrink-0 px-[2vw] py-[1.6vh] text-center">
      <h2 className="fs-title font-bold text-orange drop-shadow-[0_6px_0_var(--color-brown)]">{title}</h2>
      <p className="fs-xl text-cream/90">{text}</p>
    </div>
  );
}

function WinnerBanner({ state, room }: { state: SurvivalPublicState; room: PublicRoomState }) {
  const winner = room.players.find((p) => p.id === state.winnerId);
  if (!winner) {
    return <Banner title="GLUB GLUB." text="Alle im Schleim. Das war das Survival-Finale!" />;
  }
  return (
    <div className="panel sv-banner shrink-0 px-[2vw] py-[1.6vh] text-center">
      <h2 className="fs-title font-bold text-bulb drop-shadow-[0_6px_0_var(--color-brown)]">WIR HABEN EINEN ÜBERLEBENDEN!</h2>
      <p className="fs-xl font-bold">{winner.name} bleibt trocken und gewinnt Couch Clash!</p>
    </div>
  );
}

function TiebreakCard({ state, room }: { state: SurvivalPublicState; room: PublicRoomState }) {
  const tb = state.tiebreak;
  if (!tb) return null;
  const byId = new Map(room.players.map((p) => [p.id, p]));
  const fmt = (n: number) => (tb.format === "year" ? String(Math.round(n)) : `${n.toLocaleString("de-DE")}${tb.unit ? ` ${tb.unit}` : ""}`);
  return (
    <div className="panel flex shrink-0 flex-col gap-[1vh] px-[2vw] py-[1.4vh] text-center">
      <p className="fs-lg font-bold text-orange">SCHÄTZFRAGE ENTSCHEIDET! Wer am nächsten dran ist, bleibt trocken.</p>
      <h2 className="fs-xl font-bold text-balance">{tb.text}</h2>
      {tb.reveal ? (
        <>
          <p className="fs-title font-bold text-bulb">Richtig: {fmt(tb.reveal.answer)}</p>
          <ol className="flex flex-wrap justify-center gap-[1vw]">
            {tb.reveal.order.map((id, i) => {
              const p = byId.get(id);
              const a = tb.reveal!.answers[id];
              return (
                <li key={id} className={`fs-lg flex items-center gap-2 rounded-full chip px-4 py-1 font-bold ${i === 0 && tb.reveal!.winnerId ? "ring-4 ring-bulb" : ""}`}>
                  {p && <AvatarBadge avatar={p.avatar} size="fluidSm" />}
                  {p?.name}: {a === undefined ? "keine Antwort" : fmt(a)}
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <div className="flex flex-wrap justify-center gap-[1vw]">
          {tb.participants.map((id) => {
            const p = byId.get(id);
            return p ? (
              <AvatarBadge key={id} avatar={p.avatar} size="fluidSm" dimmed={!tb.answeredPlayerIds.includes(id)} />
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}

/** Optional subtitle line over the slime (off by default – the host SPEAKS, there are no bubbles). */
function CaptionLine() {
  const line = useHostSpeech();
  return (
    <p className="fs-md pointer-events-none fixed inset-x-0 bottom-[1vh] z-40 text-center font-bold text-cream drop-shadow-[0_2px_0_var(--color-brown)]" aria-live="polite">
      {line?.text ?? ""}
    </p>
  );
}

/**
 * Hooks for sound and effects: every new game event, a DECAY_TICK for each
 * −10 of the live decay and AMBIENCE for the background loops go out as a DOM
 * event ("couchclash:survival") – sounds, lamps and other effects listen to it
 * without touching the game. A reconnecting TV never replays old events
 * (only the last few seconds, e.g. the intro it just appeared for).
 */
export const SURVIVAL_HOOK_EVENT = "couchclash:survival";

function emitHook(detail: SurvivalHookEvent) {
  window.dispatchEvent(new CustomEvent(SURVIVAL_HOOK_EVENT, { detail }));
}

function useSurvivalHooks(state: SurvivalPublicState, now: number, scores: Readonly<Record<string, number>>) {
  const lastSeq = useRef<number | null>(null);
  const lastTick = useRef<string | null>(null);
  const lastAmbience = useRef<string | null>(null);
  useEffect(() => {
    const maxSeq = state.events.at(-1)?.seq ?? 0;
    const events = lastSeq.current === null ? freshEvents(state.events, now) : newEvents(state.events, lastSeq.current);
    for (const event of events) emitHook(event);
    lastSeq.current = Math.max(lastSeq.current ?? 0, maxSeq);
    // Only new events matter here – `now` is read, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.events]);

  // One tick per booked −10 (the first one a full second after the threshold).
  const q = state.step === "question" ? state.question : null;
  const second = decaySecond(q, now);
  useEffect(() => {
    if (second === null || !q) return;
    const key = `${q.number}:${second}`;
    if (lastTick.current === key) return;
    lastTick.current = key;
    const playerIds = state.players.filter((p) => q.aliveAtStart.includes(p.id) && !p.answered && !p.eliminated).map((p) => p.id);
    if (playerIds.length) emitHook({ type: "DECAY_TICK", playerIds });
  }, [second, q, state.players]);

  // Background loops follow the live danger.
  const ambience = ambienceFor(state, scores);
  const ambienceKey = `${ambience.slime}:${ambience.threat}:${ambience.lamp}`;
  useEffect(() => {
    if (lastAmbience.current === ambienceKey) return;
    lastAmbience.current = ambienceKey;
    emitHook({ type: "AMBIENCE", ...ambience });
    // ambienceKey covers every field of ambience.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambienceKey]);
  // The finale is gone (next round, reload): loops off.
  useEffect(
    () => () => {
      lastAmbience.current = null; // mounted again (e.g. React's dev double-mount): send the state anew
      emitHook({ type: "AMBIENCE", slime: false, threat: 0, lamp: false });
    },
    [],
  );
}

/** Plays the hook events on the host (never on phones): one-shots and the three loops. */
function useSurvivalSounds(step: SurvivalPublicState["step"]) {
  // Server time at the moment of the event (the splash is timed to the impact).
  const offset = useContext(ClockContext);
  const ctx = useRef({ step, offset });
  useEffect(() => {
    ctx.current = { step, offset };
  }, [step, offset]);
  useEffect(() => {
    const engine = getAudioEngine();
    engine.preloadSounds(SOUND_IDS);
    const onHook = (e: Event) => {
      const detail = (e as CustomEvent<SurvivalHookEvent>).detail;
      if (detail.type === "AMBIENCE") {
        // Levels: SOUND_LEVELS (lib/audio/scenes.ts).
        engine.setLoop("survival-slime-bubble-loop", detail.slime ? 1 : 0, 1.2);
        engine.setLoop("survival-slime-threat-loop", detail.slime ? detail.threat : 0, 1);
        engine.setLoop("survival-warning-lamp-loop", detail.slime && detail.lamp ? 1 : 0, 0.3);
        return;
      }
      const { step: current, offset: clock } = ctx.current;
      for (const cue of soundsFor([detail], { step: current, now: Date.now() + clock })) engine.playSound(cue.id, cue.delayMs, cue.maxLateMs);
    };
    window.addEventListener(SURVIVAL_HOOK_EVENT, onHook);
    return () => {
      window.removeEventListener(SURVIVAL_HOOK_EVENT, onHook);
      engine.stopLoops();
    };
  }, []);
}

/** A ride that started longer ago than this is not replayed (a TV that just appeared). */
const LAUNCH_SOUND_MAX_LATE_MS = 600;

/**
 * Start ride: the rise sound with the ride, a quieter clack each time an
 * elevator stops (cars stopping together share one). Scheduled once per
 * ride, in server time; a missing file is simply silent.
 */
function useLaunchSounds(state: SurvivalPublicState) {
  const offset = useContext(ClockContext);
  const riseAt = state.step === "launch" ? (state.launch?.riseAt ?? null) : null;
  const played = useRef<number | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    if (riseAt === null || played.current === riseAt) return;
    played.current = riseAt;
    const now = Date.now() + offset;
    if (now - riseAt > LAUNCH_SOUND_MAX_LATE_MS) return;
    const engine = getAudioEngine();
    engine.playSound("survival-elevator-rise", Math.max(0, riseAt - now), LAUNCH_SOUND_MAX_LATE_MS);
    const frame = launchFrame(stateRef.current, riseAt);
    for (const stop of frame ? launchStops(frame) : []) {
      engine.playSound("survival-elevator-jolt", Math.max(0, stop - now), 0, SOUND_CUE_VOLUMES.launchStop);
    }
  }, [riseAt, offset]);
}
