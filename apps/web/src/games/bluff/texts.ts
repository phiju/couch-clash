/** UI texts of the bluff views per game (the engine and the components are shared). */
import type { BluffPublicState } from "@couch-clash/games/meta";

/** Reveal tag of an AI decoy ("KI-Lügen ergänzen"). */
export const DECOY_LABEL = "🤖 Erfunden vom Moderator";

export interface BluffUiTexts {
  /** Counter on the TV: "Wort 2 / 5". */
  counter: string;
  /** TV hint per step. */
  hints: Partial<Record<BluffPublicState["step"], string>>;
  /** Phone: above the text field. */
  writeLabel: string;
  /** Phone: the player's answer was correct. */
  knewIt: string;
  /** Phone: above the vote buttons. */
  voteQuestion: string;
}

export const LEXIKON_TEXTS: BluffUiTexts = {
  counter: "Wort",
  hints: {
    write: "Schreibt eine glaubwürdige Erklärung aufs Handy!",
    check: "Die Erklärungen werden gemischt …",
    present: "Hört gut zu – eine davon ist echt!",
    vote: "Welche Erklärung ist die echte? Stimmt auf dem Handy ab!",
    reveal: "Wer hat wen reingelegt?",
  },
  writeLabel: "Deine erfundene Erklärung:",
  knewIt: "Deine Erklärung war richtig. Lehn dich zurück.",
  voteQuestion: "Welche Erklärung ist echt?",
};

export const SKURRIL_TEXTS: BluffUiTexts = {
  counter: "Geschichte",
  hints: {
    write: "Erfindet eine glaubwürdige Antwort auf dem Handy!",
    check: "Die Antworten werden gemischt …",
    present: "Hört gut zu – eine davon ist wahr!",
    vote: "Welche Antwort ist die wahre? Stimmt auf dem Handy ab!",
    reveal: "Wer hat wen reingelegt?",
  },
  writeLabel: "Deine erfundene Antwort:",
  knewIt: "Deine Antwort war richtig. Lehn dich zurück.",
  voteQuestion: "Welche Antwort ist wahr?",
};
