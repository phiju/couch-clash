/**
 * Admin page "/admin/fragen": question statistics joined with the content.
 * Aggregated numbers only – never player names or answers.
 */
import type { GameMode } from "./modes";
import type { AccountUsage } from "./voice";
export const QUESTION_STATUSES = ["active", "quarantined", "removed"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export interface AdminQuestion {
  id: string;
  categoryId: string;
  text: string;
  /** Correct answer as displayed (option text, number with unit, …). */
  answer: string;
  /** Source link of the content (e.g. Skurrile Ereignisse), null when there is none. */
  source: string | null;
  difficulty: 1 | 2 | 3;
  ageRating: number;
  tags: string[];
  plays: number;
  answers: number;
  /** correct / answers, null without answers. */
  correctRate: number | null;
  /** Average error share (estimate categories), null when not applicable. */
  avgErrorPct: number | null;
  avgResponseMs: number | null;
  thumbsUp: number;
  thumbsDown: number;
  reports: number;
  status: QuestionStatus;
  lastPlayedAt: number | null;
  /** AI-generated replacement ("neu generiert"). */
  generated: boolean;
  replacesId: string | null;
  createdAt: number | null;
  /** Raw content item – only for generated questions (edit form). */
  payload: unknown;
  /** Game modes this question can come up in (Familie with questions up to 16 counts as Familie). */
  modes: GameMode[];
  /** From the party pool (adult: alcohol, love, sex) – Party mode only. */
  party: boolean;
}

export interface AdminGenerationLogEntry {
  createdAt: number;
  categoryId: string;
  replacesId: string | null;
  ok: boolean;
  message: string | null;
}

export interface AdminQuestionsResponse {
  questions: AdminQuestion[];
  generationLog: AdminGenerationLogEntry[];
  generationsToday: number;
  dailyGenerationLimit: number;
}

export interface AdminStatusRequest {
  items: { id: string; categoryId: string }[];
  status: QuestionStatus;
}

export const QUICK_FILTERS = [
  "quarantined",
  "removed",
  "generated",
  "reported",
  "thumbsDown",
  "difficultyMismatch",
  "neverPlayed",
  "party",
] as const;
export type QuickFilter = (typeof QUICK_FILTERS)[number];

export const QUICK_FILTER_LABELS: Record<QuickFilter, string> = {
  quarantined: "Quarantäne",
  removed: "rausgeworfen",
  generated: "neu generiert",
  reported: "gemeldet",
  thumbsDown: "viele 👎",
  difficultyMismatch: "Schwierigkeit passt nicht",
  neverPlayed: "nie gespielt",
  party: "nur Party",
};

/** "viele 👎": at least this many votes … */
export const THUMBS_DOWN_MIN_VOTES = 3;
/** … and at least this share of them 👎. */
export const THUMBS_DOWN_MIN_SHARE = 0.5;
/** "Schwierigkeit passt nicht" needs this many plays. */
export const DIFFICULTY_MIN_PLAYS = 5;

export function matchesQuickFilter(q: AdminQuestion, filter: QuickFilter): boolean {
  switch (filter) {
    case "quarantined":
      return q.status === "quarantined";
    case "removed":
      return q.status === "removed";
    case "generated":
      return q.generated;
    case "reported":
      return q.reports > 0;
    case "thumbsDown": {
      const votes = q.thumbsUp + q.thumbsDown;
      return votes >= THUMBS_DOWN_MIN_VOTES && q.thumbsDown / votes >= THUMBS_DOWN_MIN_SHARE;
    }
    case "difficultyMismatch":
      if (q.plays < DIFFICULTY_MIN_PLAYS || q.correctRate === null) return false;
      return (q.difficulty === 3 && q.correctRate > 0.8) || (q.difficulty === 1 && q.correctRate < 0.4);
    case "neverPlayed":
      return q.plays === 0;
    case "party":
      return q.party;
  }
}

/** Admin: the host's voice (ElevenLabs usage this month, voiced library lines). */
export interface AdminVoiceResponse {
  account: AccountUsage | null;
  snark: { total: number; cached: number };
}

/** One batch of "Moderator-Sprüche vertonen". */
export interface AdminVoiceRunResponse extends AdminVoiceResponse {
  ok: boolean;
  error?: string;
  generated: number;
  failed: number;
}
