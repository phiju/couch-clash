/** Pure helpers of the Musik-Quiz views (tested). */
import type { MusikPublicState } from "@couch-clash/games/meta";
import type { ModuleAudioScene } from "@/lib/audio/scenes";
import type { SongTarget } from "./song-player";

/** The songs are the music: no background loop while one plays, the usual stings around it. */
export function musikAudio(state: Pick<MusikPublicState, "step" | "index"> | null): ModuleAudioScene | null {
  if (!state?.step) return null;
  const i = state.index;
  switch (state.step) {
    case "loading":
      return { key: "loading", music: null, musicFade: 0.8 };
    case "announce":
      return { key: `announce:${i}`, music: null, musicFade: 0.5, enter: "sting-short" };
    case "play":
    case "answer":
    case "checking":
      return { key: `song:${i}`, music: null, musicFade: 0.3 };
    case "reveal":
      return { key: `reveal:${i}`, music: null, enter: "sting" };
    case "leaderboard":
      return { key: `leaderboard:${i}`, music: "lobby", musicFade: 1.5 };
  }
}

/** The host's "Weiter" button per step. Kids: „Auflösen“ (a child may be stuck – no timer anywhere). */
export function musikSkipLabel(state: Pick<MusikPublicState, "step" | "input">): string | null {
  switch (state.step) {
    case "loading":
      return null;
    case "announce":
      return "Musik ab ⏭";
    case "play":
      return "Auflösen ⏭";
    case "answer":
    case "checking":
      return "Zeit um ⏭";
    case "reveal":
      return "Rangliste ⏭";
    case "leaderboard":
      return "Weiter ⏭";
  }
}

/** Clip position (ms) the server expects at `now`. */
export function clipPosition(clip: NonNullable<MusikPublicState["clip"]>, now: number): number {
  return clip.pausedAt ?? Math.max(0, now - clip.startedAt);
}

/** Buzz points right now (same formula as the server, for the TV's display). */
export function currentBuzzPoints(rule: MusikPublicState["buzzRule"], positionMs: number): number {
  if (positionMs <= rule.fastMs) return rule.fast;
  const share = Math.min(1, (positionMs - rule.fastMs) / Math.max(1, rule.clipMs - rule.fastMs));
  return Math.round(rule.fast - (rule.fast - rule.slow) * share);
}

/**
 * What the TV's song player should do: play while the music runs, pause at
 * the buzz (the spot is kept), softly play on under the solution, silence
 * on the leaderboard.
 */
export function songTarget(state: Pick<MusikPublicState, "step" | "clip">, now: number): SongTarget | null {
  const clip = state.clip;
  if (!clip?.url) return null;
  const positionMs = clipPosition(clip, now);
  switch (state.step) {
    case "play":
      return { url: clip.url, playing: clip.pausedAt === null, positionMs, loop: clip.loop };
    case "answer":
    case "checking":
      return { url: clip.url, playing: false, positionMs, loop: clip.loop };
    case "reveal":
      // The song plays on quietly while everyone sees the cover.
      return { url: clip.url, playing: true, positionMs, loop: clip.loop, level: 0.6, follow: false };
    default:
      return null;
  }
}

export interface TimelineMark {
  playerId: string;
  year: number;
  /** 0–100 % along the axis. */
  x: number;
  /** Stack level for tips of the same year (0 = on the line). */
  row: number;
}

/**
 * The year timeline at the solution: an axis around the right year and all
 * tips (a little margin on both sides), avatars of the same year stacked.
 */
export function yearTimeline(tips: Readonly<Record<string, number>>, year: number): { from: number; to: number; marks: TimelineMark[]; x: (y: number) => number } {
  const years = [year, ...Object.values(tips)];
  const from = Math.min(...years) - 2;
  const to = Math.max(...years) + 2;
  const x = (y: number) => ((y - from) / Math.max(1, to - from)) * 100;
  const rows = new Map<number, number>();
  const marks = Object.entries(tips)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([playerId, tip]) => {
      const row = rows.get(tip) ?? 0;
      rows.set(tip, row + 1);
      return { playerId, year: tip, x: x(tip), row };
    });
  return { from, to, marks, x };
}

/** Ticks for the timeline: every 1, 5 or 10 years, depending on the span. */
export function timelineTicks(from: number, to: number): number[] {
  const span = to - from;
  const step = span <= 12 ? 1 : span <= 40 ? 5 : 10;
  const out: number[] = [];
  for (let y = Math.ceil(from / step) * step; y <= to; y += step) out.push(y);
  return out;
}

/** "+150", "−25" for the results list. */
export function pointsLabel(points: number): string {
  return points < 0 ? `−${Math.abs(points)}` : `+${points}`;
}
