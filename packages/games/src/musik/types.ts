/** Client-safe types of the Musik-Quiz (no logic, no songs). */
import type { MusikQuestionTypeId } from "./meta";

/**
 * loading (live songs from Deezer, fresh preview URLs) → per song: announce (question type, 2–3 s)
 * → play (music; buzzer / year / kids choice) ⇄ answer (someone buzzed,
 * music paused) ⇄ checking (optional AI check) → reveal → leaderboard.
 */
export type MusikStep = "loading" | "announce" | "play" | "answer" | "checking" | "reveal" | "leaderboard";

/** How the phones answer: buzzer + free text, a year for everyone, or (Kids) four titles. */
export type MusikInput = "buzzer" | "year" | "choice";

export interface MusikClip {
  /** TV only: the audio (phones never get it). */
  url: string | null;
  /** Server time at which the clip would have been at 0 ms (moved on every resume). */
  startedAt: number;
  /** Position (ms) where the clip is paused, or null while it plays. */
  pausedAt: number | null;
  lengthMs: number;
  /** Kids: the preview loops until everyone answered. */
  loop: boolean;
}

export interface MusikPublicPlayer {
  id: string;
  /** Buzzer: wrong for this song (can't buzz again). */
  lockedOut: boolean;
  /** Year / Kids: has answered (never what). */
  answered: boolean;
}

export interface MusikRevealResult {
  /** What they typed / picked / estimated (null: nothing). */
  answer: string | null;
  correct: boolean;
  /** "Wer singt das?": a band member instead of the band. */
  partial: boolean;
  points: number;
}

export interface MusikPublicState {
  step: MusikStep;
  /** 0-based song index and total songs this round. */
  index: number;
  total: number;
  type: MusikQuestionTypeId;
  input: MusikInput;
  /** What the TV shows big before the song. */
  typeInfo: { label: string; emoji: string; hint: string };
  stepStartedAt: number;
  /** Null: no timer (Kids play until everyone answered). */
  stepEndsAt: number | null;
  clip: MusikClip | null;
  /** TV only: the next song's audio (preloaded). */
  nextUrl: string | null;
  /** "Aus welchem Jahr?": title and artist are shown. */
  shown: { title: string; artist: string } | null;
  /** Kids: the four titles. */
  choices: string[] | null;
  /** Who buzzed and is answering right now. */
  buzz: { playerId: string; endsAt: number } | null;
  /** The last wrong answer (TV shows it briefly). */
  lastWrong: { playerId: string; answer: string | null; at: number } | null;
  players: MusikPublicPlayer[];
  /** Only for the viewing player. */
  me: {
    lockedOut: boolean;
    /** Year: my tip. Kids: the index I picked (changeable until the solution). */
    year: number | null;
    choice: number | null;
  } | null;
  /** Year slider range. */
  years: { min: number; max: number; start: number };
  /** Buzz points fall from `fast` (until `fastMs` into the clip) to `slow` at the clip's end. */
  buzzRule: { fast: number; slow: number; fastMs: number; clipMs: number };
  reveal: {
    title: string;
    artist: string;
    year: number | null;
    coverUrl: string | null;
    sourceUrl: string | null;
    results: Record<string, MusikRevealResult>;
    /** Year: everyone's tip for the timeline. */
    yearTips: Record<string, number>;
    /** Year: players who got the closest bonus. */
    closest: string[];
  } | null;
}

export type MusikAction =
  | { type: "buzz" }
  | { type: "answer"; text: string }
  | { type: "year"; year: number }
  | { type: "choice"; index: number };

/** Moments the host comments (event-driven, apps/party/src/voice/musik-voice.ts). */
export const MUSIK_EVENT_TYPES = [
  "ANNOUNCE",
  "WRONG",
  "FAST_CORRECT",
  "CORRECT",
  "PARTIAL",
  "NOBODY",
  "YEAR_BULLSEYE",
  "YEAR_WAY_OFF",
  "KIDS_ALL_RIGHT",
] as const;
export type MusikEventType = (typeof MUSIK_EVENT_TYPES)[number];

export interface MusikEvent {
  seq: number;
  type: MusikEventType;
  at: number;
  index: number;
  /** ANNOUNCE: which question type ("kids" for the kids' multiple choice). */
  questionType: MusikQuestionTypeId | "kids";
  playerId?: string;
}
