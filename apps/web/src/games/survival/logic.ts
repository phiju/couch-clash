/**
 * Survival-Finale: pure presentation logic (tested). Everything here is show
 * only – the server's scores decide the game; this only turns them into
 * heights, moods and hints.
 */
import {
  liveSurvivalScore,
  type DangerLevel,
  type SurvivalEvent,
  type SurvivalPublicPlayer,
  type SurvivalPublicQuestion,
  type SurvivalPublicState,
} from "@couch-clash/games/meta";
import type { PhotoExpression } from "@couch-clash/shared";
import type { ModuleAudioScene } from "@/lib/audio/scenes";

/**
 * VISUAL SURVIVAL POSITION (≠ game score). Tuning knobs for how the
 * elevators move – changing them never changes the rules.
 */
export const ELEVATOR_TUNING = {
  /** < 1 stretches the low end: the last few hundred points above the slime get the most room. */
  exponent: 0.65,
  /** Reference never below this (a finale where everyone is low still uses the full height). */
  minReference: 600,
  /** Headroom above the best player (bonuses can lift a player above the start). */
  headroom: 1.08,
} as const;

/** 0 (in the slime) … 1 (top) for a score, relative to the finale's reference. */
export function visualHeight(score: number, reference: number): number {
  if (score <= 0) return 0;
  const ref = Math.max(ELEVATOR_TUNING.minReference, reference) * ELEVATOR_TUNING.headroom;
  return Math.min(1, Math.pow(Math.min(score, ref) / ref, ELEVATOR_TUNING.exponent));
}

/** Reference for all lanes: the highest start or current score (stable within the finale). */
export function heightReference(players: readonly Pick<SurvivalPublicPlayer, "startScore" | "score">[]): number {
  return Math.max(0, ...players.map((p) => Math.max(p.startScore, p.score)));
}

/** Everyone's score as shown right now (live decay between the server's ticks). */
export function liveScores(state: SurvivalPublicState, now: number): Record<string, number> {
  const q = state.question;
  const out: Record<string, number> = {};
  for (const p of state.players) {
    out[p.id] =
      q && state.step === "question" && q.aliveAtStart.includes(p.id)
        ? liveSurvivalScore({
            score: p.score,
            decayApplied: p.decayApplied,
            startedAt: q.startedAt,
            now,
            phase: q.phase,
            answered: p.answered,
            eliminated: p.eliminated,
            scoreDecayPerSecond: state.rules.scoreDecayPerSecond,
          })
        : p.score;
  }
  return out;
}

/** Where the clock stands in a question (phones and TV). */
export type TimeZone = "bonus" | "neutral" | "decay" | "over";

export function timeZone(q: Pick<SurvivalPublicQuestion, "bonusUntil" | "decayFrom" | "timeoutAt" | "phase">, now: number): TimeZone {
  if (now >= q.timeoutAt) return "over";
  if (now > q.decayFrom) return "decay";
  if (now <= q.bonusUntil && q.phase.speedBonus > 0) return "bonus";
  return "neutral";
}

/** The hint for the current zone ("SCHNELLANTWORT +50", "−10 PRO SEKUNDE", …). */
export function zoneText(zone: TimeZone, q: Pick<SurvivalPublicQuestion, "phase">, decayPerSecond: number): string {
  switch (zone) {
    case "bonus":
      return `SCHNELLANTWORT +${q.phase.speedBonus}`;
    case "neutral":
      return q.phase.baseDrain > 0 ? `DEATH MODE: −${q.phase.baseDrain} FÜR ALLE NACH DER FRAGE` : "RICHTIG = KEIN VERLUST";
    case "decay":
      return `−${decayPerSecond} PRO SEKUNDE`;
    case "over":
      return "ZEIT UM";
  }
}

/** Mood of a candidate (avatar face + a small emoji). */
export type Mood = "confident" | "worried" | "scared" | "panic" | "cheering" | "shocked" | "gone";

export function moodFor(p: Pick<SurvivalPublicPlayer, "danger" | "change" | "eliminated">, liveDanger?: DangerLevel): Mood {
  if (p.eliminated) return "gone";
  if (p.change && p.change.penalty > 0) return "shocked";
  if (p.change && p.change.bonus > 0) return "cheering";
  switch (liveDanger ?? p.danger) {
    case "WARNING":
      return "worried";
    case "CRITICAL":
      return "scared";
    case "ELIMINATION_IMMINENT":
      return "panic";
    case "ELIMINATED":
      return "gone";
    default:
      return "confident";
  }
}

export const MOOD_EMOJI: Record<Mood, string> = {
  confident: "😎",
  worried: "😟",
  scared: "😨",
  panic: "😱",
  cheering: "🤩",
  shocked: "😵",
  gone: "🫧",
};

/** Photo avatars have four faces – the closest one per mood. */
export const MOOD_EXPRESSION: Record<Mood, PhotoExpression> = {
  confident: "neutral",
  worried: "neutral",
  scared: "geschockt",
  panic: "geschockt",
  cheering: "jubelnd",
  shocked: "enttaeuscht",
  gone: "enttaeuscht",
};

/** Lane widths (flex-grow): the final two get the stage, the eliminated step back. */
export function laneGrow(p: Pick<SurvivalPublicPlayer, "eliminated">, finalTwo: boolean): number {
  if (!finalTwo) return p.eliminated ? 0.8 : 1;
  return p.eliminated ? 0.45 : 3;
}

/** Size class of the candidates by number of lanes (2 → huge, 7+ → compact). */
export function laneSize(count: number, finalTwo: boolean): "xl" | "lg" | "md" | "sm" {
  if (finalTwo || count <= 2) return "xl";
  if (count <= 4) return "lg";
  if (count <= 6) return "md";
  return "sm";
}

/** Final two: exactly two alive in a game that started with more. */
export function isFinalTwo(state: Pick<SurvivalPublicState, "players" | "step">): boolean {
  if (state.step === "intro" || state.step === "winner") return false;
  return state.players.length > 2 && state.players.filter((p) => !p.eliminated).length === 2;
}

/** A splash plays only for fresh eliminations (a reconnecting TV doesn't replay old ones). */
export const SPLASH_MS = 2_600;
export function isFreshElimination(eliminatedAt: number | null, now: number): boolean {
  return eliminatedAt !== null && now - eliminatedAt < SPLASH_MS;
}

/** Events the screen has not reacted to yet (by seq). */
export function newEvents(events: readonly SurvivalEvent[], lastSeq: number): SurvivalEvent[] {
  return events.filter((e) => e.seq > lastSeq);
}

/** Background music for the finale: tension in questions, silence for the big moments. */
export function survivalAudio(state: SurvivalPublicState | null): ModuleAudioScene | null {
  if (!state) return null;
  const n = state.question?.number ?? 0;
  switch (state.step) {
    case "intro":
      return { key: "survival:intro", music: "lobby", musicLevel: 0.6 };
    case "question":
      return { key: `survival:q:${n}`, music: "think" };
    case "reveal":
      return { key: `survival:r:${n}`, music: null, musicFade: 0.3, enter: "sting-short" };
    case "phase_change":
    case "sudden_death":
      return { key: `survival:${state.step}:${state.phaseIndex}:${state.suddenDeaths}`, music: null, enter: "sting" };
    case "tiebreak":
      return { key: `survival:tb:${state.tiebreak?.attempt ?? 0}`, music: "think" };
    case "tiebreak_reveal":
      return { key: `survival:tbr:${state.tiebreak?.attempt ?? 0}`, music: null, enter: "sting" };
    case "winner":
      // The winner has its own sound (survival-winner, from the WINNER event); the fanfare follows at the ceremony.
      return { key: "survival:winner", music: null, musicFade: 0.4 };
  }
}

/** The host's "Weiter" button: never during a question (the clock is the rule). */
export function survivalSkipLabel(state: SurvivalPublicState): string | null {
  switch (state.step) {
    case "question":
    case "tiebreak":
      return null;
    case "winner":
      return "Siegerehrung ⏭";
    default:
      return "Weiter ⏭";
  }
}

/** Count-up/-down during the intro: main-game points → life energy. */
export function conversionValue(from: number, to: number, progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  const eased = 1 - Math.pow(1 - t, 3);
  return Math.round(from + (to - from) * eased);
}

/** "Anna" / "Anna & Ben" / "Anna, Ben & Clara". */
export function namesText(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
}
