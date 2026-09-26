/** Client-safe types of Pixelpanik (no logic, no content). */

/** stage (the picture gets sharper) → reveal (the solution, 5 s) → leaderboard → next picture. */
export type PixelpanikStep = "stage" | "reveal" | "leaderboard";

/** Familie / Party: free text on the phone. Kids: four options. */
export type PixelpanikInput = "text" | "choice";

/**
 * open: may still guess · correct: points secured, locked · out: wrong (free
 * text) – watches until the next picture · locked: Kids, wrong option – may
 * try again from the next stage.
 */
export type PixelpanikPlayerStatus = "open" | "correct" | "out" | "locked";

export interface PixelpanikPublicPlayer {
  id: string;
  status: PixelpanikPlayerStatus;
  /** 0-based stage of the right answer (null: not yet / never). */
  stage: number | null;
  /** Points secured with the right answer (shown as soon as they are secured). */
  points: number;
}

export interface PixelpanikStageInfo {
  /** Blocks per side (0 = full resolution). */
  size: number;
  label: string;
  points: number;
}

export interface PixelpanikPublicState {
  step: PixelpanikStep;
  /** 0-based picture index and total pictures in this round. */
  index: number;
  total: number;
  input: PixelpanikInput;
  /** 0-based current stage (the last one is full resolution). */
  stage: number;
  stages: PixelpanikStageInfo[];
  stageStartedAt: number;
  /** Server time when the current step (stage, reveal, leaderboard) ends. */
  stepEndsAt: number;
  /**
   * TV only: the picture of the CURRENT stage – N×N pre-rendered pixels
   * (size N) or the full picture (size 0). Later stages are never sent
   * early, the phones never get a picture.
   */
  image: { url: string; size: number } | null;
  /** Kids: the four options (TV and phones). */
  choices: string[] | null;
  players: PixelpanikPublicPlayer[];
  /** Only for the viewing player. */
  me: {
    status: PixelpanikPlayerStatus;
    /** Free text: what I sent (my own text only). */
    guess: string | null;
    /** Kids: options I picked wrong (stay greyed out). */
    wrongChoices: number[];
  } | null;
  /** From the reveal on. */
  reveal: {
    answer: string;
    /** Painting: where the picture comes from. */
    source: { title: string; author?: string; license?: string; url: string } | null;
    /** Per player: what they sent (free text) or picked (Kids, the last pick), right or not, points. */
    results: Record<string, { guess: string | null; correct: boolean; stage: number | null; points: number }>;
  } | null;
}

export type PixelpanikAction = { type: "guess"; text: string } | { type: "choice"; index: number };

/** Moments the host comments (event-driven, see apps/party/src/voice/pixelpanik-voice.ts). */
export const PIXELPANIK_EVENT_TYPES = ["NOBODY_YET", "WRONG", "EARLY_CORRECT", "CORRECT", "LATE_CORRECT", "NOBODY"] as const;
export type PixelpanikEventType = (typeof PIXELPANIK_EVENT_TYPES)[number];

export interface PixelpanikEvent {
  /** Increasing per round – consumers remember the last one they handled. */
  seq: number;
  type: PixelpanikEventType;
  at: number;
  /** 0-based picture index. */
  index: number;
  stage: number;
  /** Whom it is about (NOBODY_YET: a random player the host picks on). */
  playerId?: string;
}
