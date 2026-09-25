/** Client-safe types for the Bluff-Lexikon (no logic, no content). */
import type { ScoreResult } from "../scoring/final";

/**
 * Per word: write (60 s) → check (AI, ≤ 7 s) → present (options read out)
 * → vote (30 s) → reveal (who fooled whom) → solution (the real one) → leaderboard.
 */
export type BluffStep = "write" | "check" | "present" | "vote" | "reveal" | "solution" | "leaderboard";

export type BluffAction = { type: "define"; text: string } | { type: "vote"; option: number };

export interface BluffResult extends ScoreResult {
  votedCorrect: boolean;
  /** Wrote an essentially correct definition. */
  knewIt: boolean;
  /** Players who voted for this player's invented definition. */
  fooled: number;
}

export interface BluffRevealOption {
  text: string;
  correct: boolean;
  /** Player ids who wrote it (several when merged). Empty for the real one. */
  authors: string[];
  /** Player ids who voted for it. */
  voters: string[];
}

export interface BluffPublicState {
  step: BluffStep;
  index: number;
  total: number;
  word: string;
  /** "Ein Borborygmus ist …?" – the word with the right article as a question. */
  question: string;
  stepStartedAt: number;
  stepEndsAt: number;
  /** Who has written a definition (not what). */
  submittedPlayerIds: string[];
  /** Only for the viewing player. */
  mySubmission: string | null;
  /** Viewing player wrote an essentially correct definition (known after the check). */
  iKnewIt: boolean;
  /** From "present" on: the options A, B, C, … (no authors). */
  options: { text: string }[] | null;
  /** Options the viewing player wrote (cannot vote for them). */
  myOptions: number[];
  /** The viewing player may vote in this word. */
  canVote: boolean;
  votedPlayerIds: string[];
  myVote: number | null;
  /** Points for finding the real definition (the other amounts are shares of it). */
  maxPoints: number;
  /** Reading timing on the host when the voice is silent. */
  presentLeadMs: number;
  presentMsPerOption: number;
  /** From "reveal" on. */
  reveal: {
    options: BluffRevealOption[];
    correctIndex: number;
    definition: string;
    /** "Ein Borborygmus ist:" */
    lead: string;
    knewItPlayerIds: string[];
    results: Record<string, BluffResult>;
    /** Authors' original texts (host option, default off), else null. */
    originals: Record<string, string> | null;
  } | null;
}
