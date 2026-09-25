/** Pure helpers for the Führerschein views (unit-tested). */
import type { FuehrerscheinPublicState } from "@couch-clash/games/meta";
import { questionRoundAudio, type ModuleAudioScene } from "../../lib/audio/scenes";

/** Drive-through at the reveal: 3–5 s, one actor after the other. */
export const DRIVE = { leadMs: 500, driveMs: 1_500, gapMs: 1_000 } as const;

export interface DriveSlot {
  id: string;
  startMs: number;
  endMs: number;
}

export function driveSchedule(order: readonly string[]): DriveSlot[] {
  return order.map((id, i) => {
    const startMs = DRIVE.leadMs + i * DRIVE.gapMs;
    return { id, startMs, endMs: startMs + DRIVE.driveMs };
  });
}

export function driveTotalMs(order: readonly string[]): number {
  return driveSchedule(order).at(-1)?.endMs ?? 0;
}

/** 0 = still waiting, 1 = gone. Eased: pulls away slowly, then drives off. */
export function driveProgress(slot: DriveSlot | undefined, elapsedMs: number): number {
  if (!slot) return 0;
  const t = Math.min(1, Math.max(0, (elapsedMs - slot.startMs) / (slot.endMs - slot.startMs)));
  return t * t * (3 - 2 * t);
}

/** Question round audio; the exam result keeps the lobby loop quietly under the stamps. */
export function fuehrerscheinAudio(state: Pick<FuehrerscheinPublicState, "step" | "index"> | null): ModuleAudioScene | null {
  if (state?.step === "summary") return { key: "exam", music: "lobby", musicLevel: 0.35, musicFade: 0.6, enter: "sting-short" };
  return questionRoundAudio(state);
}

/** The kind of question (text / sign / scene), for layout decisions. */
export function mediaKind(state: Pick<FuehrerscheinPublicState, "question">): "text" | "sign" | "scene" {
  return state.question.media?.kind ?? "text";
}
