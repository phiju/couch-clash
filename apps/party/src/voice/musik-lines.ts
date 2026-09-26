/**
 * The host's lines for the Musik-Quiz (German). Add or change lines here –
 * the voice picks them up by itself (audio is made and cached on first use).
 *
 * - `announce*`: the host names the question type before each song (short:
 *   the TV shows it for under 3 s, the music starts right after).
 * - `{name}` is replaced with the player's name (voiced per player, cached
 *   globally, so the same name costs only once).
 * - `family`: Familie and Party · `party`: only in Party mode, on top
 *   (cheekier, suggestive at most – never explicit) · `kids`: Kids only.
 * - The last 3 lines played per situation are locked (no repeats).
 *
 * Tone: a cheeky DJ, never really insulting.
 */
import type { MusikEventType } from "@couch-clash/games";

export const MUSIK_SITUATIONS = [
  "announceTitle",
  "announceArtist",
  "announceYear",
  "announceKids",
  "wrong",
  "fastCorrect",
  "correct",
  "partial",
  "nobody",
  "yearBullseye",
  "yearWayOff",
  "kidsAllRight",
] as const;
export type MusikSituation = (typeof MUSIK_SITUATIONS)[number];

export interface MusikLinePools {
  family: readonly string[];
  party: readonly string[];
  kids: readonly string[];
}

export const MUSIK_LINES: Record<MusikSituation, MusikLinePools> = {
  announceTitle: {
    family: [
      "Wie heißt der Song?",
      "Titel gesucht! Finger an den Buzzer.",
      "Na, wie heißt das Ding?",
      "Titel raten! Wer zuerst drückt, darf ran.",
      "Ohren auf: Wie heißt der Song?",
      "Buzzer bereit? Titel gesucht!",
    ],
    party: ["Titel gesucht. Mitgrölen ist erlaubt, Buzzern ist Pflicht.", "Wie heißt der Song? Und nein, „Das eine da“ zählt nicht."],
    kids: [],
  },
  announceArtist: {
    family: [
      "Wer singt das?",
      "Interpret gesucht! Wer steckt dahinter?",
      "Wer singt denn da?",
      "Stimme erkannt? Wer ist das?",
      "Wer trällert hier? Buzzer!",
    ],
    party: ["Wer singt das? Tipp: nicht du unter der Dusche.", "Interpret gesucht. Der Karaoke-König von gestern zählt nicht."],
    kids: [],
  },
  announceYear: {
    family: [
      "Aus welchem Jahr?",
      "Zeitreise! Aus welchem Jahr ist der Song?",
      "Jahr schätzen, alle gleichzeitig!",
      "Wann kam das raus? Alle tippen!",
      "Ab in die Zeitmaschine: Welches Jahr?",
    ],
    party: ["Aus welchem Jahr? Nicht verwechseln mit dem Jahr, in dem ihr dazu das letzte Mal getanzt habt."],
    kids: [],
  },
  announceKids: {
    family: [],
    party: [],
    kids: [
      "Hört gut zu! Wie heißt das Lied?",
      "Welches Lied ist das? Tippt es an!",
      "Ohren spitzen! Welches Lied hören wir?",
      "Musik ab! Wie heißt das Lied?",
      "Kennt ihr das? Tippt den richtigen Titel!",
    ],
  },
  wrong: {
    family: [
      "{name}, knapp daneben ist auch vorbei. Musik läuft weiter!",
      "Nein, {name}. Aber schön selbstbewusst gebuzzert.",
      "{name}, das war nix. Die anderen dürfen wieder.",
      "Falsch, {name}! Ab auf die Zuschauerbank.",
      "{name}, das war ein anderer Song. Ein ganz anderer.",
      "Oh {name}. Mutig, aber leider falsch.",
      "{name}, der Buzzer war schneller als dein Kopf.",
      "Leider nein, {name}. Weiter geht die Musik!",
    ],
    party: [
      "{name}, das hast du beim letzten Rausch anders in Erinnerung, oder?",
      "{name}, falsch. Aber mitgrölen darfst du trotzdem.",
      "{name}, das war nix. Noch ein Getränk, dann klappt's.",
    ],
    kids: [],
  },
  fastCorrect: {
    family: [
      "{name}, nach drei Tönen! Das ist unheimlich.",
      "Wahnsinn, {name}! Hast du den Song geschrieben?",
      "{name} ist schneller als das Intro!",
      "{name}, blitzschnell! Ich bin beeindruckt. Ein bisschen.",
      "Zack, {name}! Volle Punktzahl.",
      "{name}, das war Rekord. Verdächtig schnell.",
    ],
    party: ["{name}, so schnell warst du sonst nur an der Bar.", "{name}, du hörst den Song offensichtlich zu oft. Nachts. Allein."],
    kids: [],
  },
  correct: {
    family: [
      "Richtig, {name}!",
      "{name} hat's! Nicht schnell, aber richtig.",
      "Stimmt, {name}. Da hat's endlich geklingelt.",
      "{name}, richtig! Hat ein bisschen gedauert, aber gut.",
      "Jawohl, {name}! Punkte gibt's.",
      "{name}, korrekt! Das Radio in deinem Kopf funktioniert.",
    ],
    party: ["{name}, richtig. Jetzt bitte nicht die ganze Strophe singen."],
    kids: [],
  },
  partial: {
    family: [
      "{name}, das ist ein Bandmitglied, nicht die Band. Halbe Punkte!",
      "Fast, {name}! Richtige Person, falsche Truppe. Teilpunkte.",
      "{name}, du kennst die Leute, aber nicht den Bandnamen. Halbe Portion.",
    ],
    party: [],
    kids: [],
  },
  nobody: {
    family: [
      "Keiner? Wirklich keiner? Das war ein Klassiker!",
      "Niemand hat's gewusst. Das Radio ist enttäuscht.",
      "Stille. Nur die Musik hat's gewusst.",
      "Keiner! Da muss ich wohl mehr Radio laufen lassen.",
      "Null Treffer. Den Song legen wir nächstes Jahr nochmal auf.",
    ],
    party: ["Keiner? Ihr seid doch sonst bei jedem Refrain dabei!", "Niemand. Morgen wisst ihr's wieder, garantiert um drei Uhr nachts."],
    kids: [
      "Oh, das war aber knifflig!",
      "Das Lied hat euch ausgetrickst! Beim nächsten klappt's.",
      "Huch, das war schwer. Weiter geht's!",
    ],
  },
  yearBullseye: {
    family: [
      "{name}, auf das Jahr genau! Warst du dabei?",
      "Volltreffer, {name}! Exakt das Jahr.",
      "{name} hat eine eingebaute Zeitmaschine!",
      "{name}, genau richtig. Wikipedia auf zwei Beinen.",
    ],
    party: ["{name}, auf das Jahr genau. Da hast du wohl deinen ersten Kuss bekommen."],
    kids: [],
  },
  yearWayOff: {
    family: [
      "{name}, knapp daneben. Also so ungefähr ein Jahrzehnt.",
      "{name}, das war eine sehr große Zeitreise. In die falsche Richtung.",
      "{name}, da lag nur eine Generation dazwischen.",
      "{name}, mutig geschätzt. Leider in einem anderen Jahrhundert.",
    ],
    party: ["{name}, da warst du wohl noch nicht geboren. Oder schon zu betrunken."],
    kids: [],
  },
  kidsAllRight: {
    family: [],
    party: [],
    kids: [
      "Alle richtig! Ihr seid ja echte Musikprofis!",
      "Super, alle haben's gewusst!",
      "Wow, alle richtig! Da muss ich mir ein schwereres Lied suchen.",
      "Klasse! Alle haben das Lied erkannt!",
    ],
  },
};

/** Which situation an event is (ANNOUNCE by question type). */
export function musikSituation(type: MusikEventType, questionType: string): MusikSituation | null {
  switch (type) {
    case "ANNOUNCE":
      return questionType === "kids" ? "announceKids" : questionType === "artist" ? "announceArtist" : questionType === "year" ? "announceYear" : "announceTitle";
    case "WRONG":
      return "wrong";
    case "FAST_CORRECT":
      return "fastCorrect";
    case "CORRECT":
      return "correct";
    case "PARTIAL":
      return "partial";
    case "NOBODY":
      return "nobody";
    case "YEAR_BULLSEYE":
      return "yearBullseye";
    case "YEAR_WAY_OFF":
      return "yearWayOff";
    case "KIDS_ALL_RIGHT":
      return "kidsAllRight";
  }
}

export function musikLinesFor(situation: MusikSituation, mode: "kids" | "family" | "party"): readonly string[] {
  const pools = MUSIK_LINES[situation];
  if (mode === "kids") return pools.kids;
  if (mode === "party") return [...pools.family, ...pools.party];
  return pools.family;
}
