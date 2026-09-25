/**
 * Bluff-Lexikon: a rare real word, everyone invents a definition, then all
 * invented ones plus the real one are shown as A, B, C, … and everyone bets
 * on the real one. The game runs on the bluff engine (./engine) – this file
 * is only the content adapter.
 */
import { BLUFF_WORDS_DE, BluffWordSchema, type BluffWord } from "@couch-clash/content";
import type { ContentEntry } from "@couch-clash/shared";
import { createBluffEngine, pickWithPartyShare, type BluffContentAdapter, type BluffEngineState } from "./engine";
import { LEXIKON_JUDGE_STYLE, normalizeText } from "./judge";
import { bluffMeta } from "./meta";
import { bluffLead, bluffQuestion } from "./text";

export { cleanDefinition, displayDefinition } from "./engine";

export type BluffState = BluffEngineState<BluffWord>;

/** For comparing texts: lower case, letters and digits only. */
export const normalizeDefinition = normalizeText;

/** Party mode: share of words from the party set. */
const PARTY_SHARE = 1 / 3;

const entry = (w: BluffWord): ContentEntry => ({
  id: w.id,
  text: `${w.article} ${w.word}`,
  answer: w.definition,
  difficulty: w.difficulty,
  ageRating: w.ageRating,
  tags: w.tags,
  payload: w,
  alcohol: w.alcohol,
  adult: w.adult,
});

export const lexikonAdapter: BluffContentAdapter<BluffWord> = {
  meta: bluffMeta,
  pool: BLUFF_WORDS_DE,
  schema: BluffWordSchema,
  loadItems: (pool, options, random) => pickWithPartyShare(pool, BluffWordSchema, bluffMeta, PARTY_SHARE, options, random),
  title: (w) => w.word,
  promptText: bluffQuestion,
  realAnswer: (w) => w.definition,
  revealLead: bluffLead,
  judgeContext: (w) => ({ word: `${w.article} ${w.word}`, realDefinition: w.definition }),
  polishStyle: LEXIKON_JUDGE_STYLE,
  placeholder: "… z. B. ein Werkzeug, das …",
  taskPrefix: "bluff-check",
  texts: {
    singleOption: "Die Erklärung lautet",
    knewIt: "wusste die echte Bedeutung",
    fooled: (n) => `hat ${n} Mitspieler mit der erfundenen Erklärung reingelegt`,
    found: "hat die echte Erklärung gefunden",
    fellFor: "ist auf eine erfundene Erklärung reingefallen",
    noAnswer: "(keine Erklärung)",
    highlight:
      "Bluff-Runde: Alle haben Erklärungen erfunden und auf die echte getippt. Lob oder necke den besten Bluffer (wer die meisten reingelegt hat) oder wer auf einen Bluff reingefallen ist.",
  },
  botTexts: [
    "Ein Hut für besonders kleine Hunde",
    "Wenn jemand beim Niesen pfeift",
    "Ein Werkzeug zum Knödelrollen",
    "Eine Tanzfigur aus Bayern",
    "Ein Kuchen ohne Boden",
    "Wenn jemand rückwärts einparkt",
  ],
  toEntry: entry,
};

export function createBluffModule(pool: readonly BluffWord[] = BLUFF_WORDS_DE) {
  return createBluffEngine(lexikonAdapter, pool);
}

export const bluffModule = createBluffModule();
