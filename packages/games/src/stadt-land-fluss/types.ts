/** Client-safe types of Stadt, Land, Fluss (no logic, no content). */

/**
 * Per letter: intro (the letter) → write (Stopp! → the others get a few
 * seconds more) → check (AI) → script (the host's gags, AI) → reveal (every
 * answer, category by category) → vote (funniest answer) → tally → leaderboard.
 */
export type SlfStep = "intro" | "write" | "check" | "script" | "reveal" | "vote" | "tally" | "leaderboard";

export type SlfCategoryType = "fakt" | "kreativ";

export interface SlfPublicCategory {
  id: string;
  label: string;
  hint?: string;
  type: SlfCategoryType;
}

/**
 * valid · letter: wrong first letter · invalid: not a real … (fakt) ·
 * empty · censored: not read out (offensive in this mode).
 */
export type SlfVerdict = "valid" | "letter" | "invalid" | "empty" | "censored";

export interface SlfPublicAnswer {
  playerId: string;
  /** What the player wrote (empty for "empty", hidden for "censored"). */
  text: string;
  verdict: SlfVerdict;
  points: number;
  /** Same answer as someone else (also with spelling variants). */
  duplicate: boolean;
  /** The only valid answer of the category. */
  only: boolean;
  /** Clearly misspelled – still counts (the host may tease). */
  typo: boolean;
}

export interface SlfPublicReveal {
  categories: {
    categoryId: string;
    answers: SlfPublicAnswer[];
    /** What the host says (every answer + one gag). Also shown when the voice is silent. */
    script: string;
    /** When the voice is silent: ms after the step start this category is shown. */
    startsAtMs: number;
  }[];
  /** False: the AI check failed – only the first letter was checked. */
  aiChecked: boolean;
}

export interface SlfVoteCandidate {
  categoryId: string;
  text: string;
}

export interface SlfPublicState {
  step: SlfStep;
  /** 0-based letter index and letters in this round. */
  index: number;
  total: number;
  letter: string;
  categories: SlfPublicCategory[];
  stepStartedAt: number;
  stepEndsAt: number;
  /** Writing time of this round (for the countdown before a stop). */
  writeSeconds: number;
  stopSeconds: number;
  /** Who shouted "Stopp!" (and when) – everyone else has `stopSeconds` left. */
  stop: { playerId: string; at: number } | null;
  /** Players with every field filled (never what they wrote). */
  donePlayerIds: string[];
  /** Players who wrote anything at all. */
  startedPlayerIds: string[];
  /** Only for the viewing player: what the room has stored so far. */
  myAnswers: string[] | null;
  /** From the reveal on. */
  reveal: SlfPublicReveal | null;
  /** From the vote on: the "kreativ" answers everyone may vote for (anonymous). */
  candidates: SlfVoteCandidate[] | null;
  /** Candidates the viewing player wrote (can't vote for them). */
  myCandidates: number[];
  canVote: boolean;
  votedPlayerIds: string[];
  myVote: number | null;
  /** From the tally on. */
  tally: {
    /** Winning candidates (ties: all of them) with authors; empty when nobody voted. */
    winners: { candidate: number; playerId: string; votes: number }[];
    /** Per player: category points + vote bonus. */
    points: Record<string, { categories: number; vote: number; total: number }>;
  } | null;
  points: { only: number; unique: number; duplicate: number; vote: number };
}

export type SlfAction =
  | { type: "answers"; answers: string[] }
  | { type: "stop"; answers: string[] }
  | { type: "vote"; candidate: number };
