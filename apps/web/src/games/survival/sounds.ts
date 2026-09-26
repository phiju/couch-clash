/**
 * Survival-Finale: which sound plays for which event (pure, tested).
 * Sound ids = file names in public/audio (docs/survival-sounds.md).
 *
 * The TV sends every game event plus DECAY_TICK and AMBIENCE as a DOM event
 * ("couchclash:survival"); the host's sound player maps them with these
 * functions. Nothing here ever waits for audio.
 */
import { getDangerLevel, type SurvivalEvent, type SurvivalPublicState, type SurvivalStep } from "@couch-clash/games/meta";
import type { SurvivalOneShotId } from "@/lib/audio/scenes";

/** The car hits the slime this long after the elimination (the splash in globals.css starts at 1.35 s). */
export const SPLASH_IMPACT_MS = 1_350;
/** A splash for an elimination older than this is not played any more (a reloaded TV). */
export const SPLASH_MAX_AGE_MS = 2_500;

/** Hook events on top of the game events. */
export type SurvivalHookEvent =
  | SurvivalEvent
  /** One −10 of the live decay was booked (once per full second after the threshold). */
  | { type: "DECAY_TICK"; playerIds: string[] }
  /** Background: slime bubbling on/off, threat level 0…1 (from CRITICAL), warning lamp (ELIMINATION_IMMINENT). */
  | { type: "AMBIENCE"; slime: boolean; threat: number; lamp: boolean };

export interface SoundCue {
  id: SurvivalOneShotId;
  delayMs: number;
  /** May still start this late if the file wasn't loaded yet (default 0: skip). */
  maxLateMs?: number;
}

/** One-shots for a batch of hook events – each sound at most once per batch (three wrong answers at once = one "wrong"). */
export function soundsFor(events: readonly SurvivalHookEvent[], ctx: { step: SurvivalStep; now: number }): SoundCue[] {
  const out: SoundCue[] = [];
  const add = (id: SurvivalOneShotId, delayMs = 0, maxLateMs?: number) => {
    if (!out.some((c) => c.id === id && c.delayMs === delayMs)) out.push({ id, delayMs, ...(maxLateMs ? { maxLateMs } : {}) });
  };
  for (const e of events) {
    switch (e.type) {
      case "FINALE_STARTED":
        // The opener may start a moment late; ticks and hits never do.
        add("survival-intro", 0, 3_000);
        break;
      case "FAST_CORRECT":
        add("survival-bonus");
        break;
      case "WRONG_ANSWER":
      case "TIMEOUT":
        // −200: the buzz and the elevator dropping, together.
        add("survival-wrong");
        add("survival-elevator-jolt");
        break;
      case "DECAY_TICK":
        add("survival-decay-tick");
        break;
      case "ELIMINATED": {
        const age = ctx.now - e.at;
        if (age <= SPLASH_MAX_AGE_MS) add("survival-splash", Math.min(SPLASH_IMPACT_MS, Math.max(0, SPLASH_IMPACT_MS - age)));
        break;
      }
      case "FINAL_TWO":
        // A finale that starts with two players has its intro sound instead.
        if (ctx.step !== "intro") add("survival-final-two");
        break;
      case "WINNER":
        add("survival-winner");
        break;
    }
  }
  return out;
}

export interface Ambience {
  slime: boolean;
  /** 0 = off; 0.5 = someone CRITICAL; 0.75 = several; 1 = someone ELIMINATION_IMMINENT. */
  threat: number;
  lamp: boolean;
}

/** Background loops from the live scores (the same danger rules as the TV). */
export function ambienceFor(state: Pick<SurvivalPublicState, "players" | "rules" | "step">, scores: Readonly<Record<string, number>>): Ambience {
  if (state.step === "winner") return { slime: true, threat: 0, lamp: false };
  const dangers = state.players
    .filter((p) => !p.eliminated)
    .map((p) => getDangerLevel(scores[p.id] ?? p.score, state.rules));
  const imminent = dangers.filter((d) => d === "ELIMINATION_IMMINENT").length;
  const critical = dangers.filter((d) => d === "CRITICAL").length + imminent;
  const threat = imminent > 0 ? 1 : critical >= 2 ? 0.75 : critical === 1 ? 0.5 : 0;
  return { slime: true, threat, lamp: imminent > 0 };
}

/** Events a TV that just appeared should still react to (only the last seconds – never replays old ones). */
export const FRESH_EVENT_MS = 3_000;
export function freshEvents(events: readonly SurvivalEvent[], now: number): SurvivalEvent[] {
  return events.filter((e) => now - e.at <= FRESH_EVENT_MS);
}

/** The decay second that just got booked (1 = the first −10), or null. */
export function decaySecond(q: { decayFrom: number; timeoutAt: number } | null, now: number): number | null {
  if (!q || now < q.decayFrom + 1000) return null;
  return Math.floor((Math.min(now, q.timeoutAt) - q.decayFrom) / 1000);
}
