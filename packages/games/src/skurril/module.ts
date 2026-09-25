/**
 * Skurrile Ereignisse: the start of a true, bizarre story and a question –
 * everyone invents an answer, then all answers plus the true one are shown
 * and everyone bets on the truth. Same engine as the Bluff-Lexikon; this
 * file is only the content adapter.
 */
import { SKURRIL_STORIES_DE, SkurrilStorySchema, type SkurrilStory } from "@couch-clash/content";
import { pickForRound } from "../content-pool";
import { createBluffEngine, type BluffContentAdapter, type BluffEngineState } from "../bluff/engine";
import { EVENT_JUDGE_STYLE } from "../bluff/judge";
import { skurrilMeta } from "./meta";

export type SkurrilState = BluffEngineState<SkurrilStory>;

/** "https://de.wikipedia.org/wiki/…" → "de.wikipedia.org" (shown, never a link on the TV). */
export function sourceDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export const skurrilAdapter: BluffContentAdapter<SkurrilStory> = {
  meta: skurrilMeta,
  pool: SKURRIL_STORIES_DE,
  schema: SkurrilStorySchema,
  loadItems: (pool, options, random) => pickForRound(pool, SkurrilStorySchema, options, random, skurrilMeta),
  title: (s) => s.question,
  promptText: (s) => s.question,
  story: (s) => ({ context: s.context, year: s.year }),
  readPrompt: (s) => `${s.context} ${s.question}`,
  realAnswer: (s) => s.answer,
  revealLead: () => "Die Wahrheit:",
  revealExtra: (s) => ({ fact: s.fact, source: sourceDomain(s.source) }),
  judgeContext: (s) => ({ context: s.context, question: s.question, realAnswer: s.answer }),
  polishStyle: EVENT_JUDGE_STYLE,
  placeholder: "z. B. Er ist unterwegs eingeschlafen",
  taskPrefix: "skurril-check",
  texts: {
    singleOption: "Die Antwort lautet",
    knewIt: "kannte die wahre Geschichte",
    fooled: (n) => `hat ${n} Mitspieler mit der erfundenen Antwort reingelegt`,
    found: "hat die wahre Antwort gefunden",
    fellFor: "ist auf eine erfundene Antwort reingefallen",
    noAnswer: "(keine Antwort)",
    highlight:
      "Skurrile Ereignisse: Zu einer wahren, skurrilen Geschichte haben alle eine Antwort erfunden und auf die wahre getippt. Lob oder necke den besten Lügner (wer die meisten reingelegt hat) oder wer auf eine Lüge reingefallen ist. Wer die Geschichte kannte: frag scherzhaft, ob die Person etwa dabei war (z. B. „Philip, warst du etwa dabei?“ – mit dem echten Namen).",
  },
  botTexts: [
    "Er ist unterwegs eingeschlafen",
    "Ein Papagei hat alles verraten",
    "Weil es an dem Tag Pudding gab",
    "Sie wurde zur Bürgermeisterin gewählt",
    "Der Hund hat die Beweise gefressen",
    "Er hat sich im Datum geirrt",
  ],
  toEntry: (s) => ({
    id: s.id,
    text: `${s.context} ${s.question}`,
    answer: s.answer,
    difficulty: s.difficulty,
    ageRating: s.ageRating,
    tags: s.tags,
    payload: s,
    adult: s.adult,
    source: s.source,
  }),
};

export function createSkurrilModule(pool: readonly SkurrilStory[] = SKURRIL_STORIES_DE) {
  return createBluffEngine(skurrilAdapter, pool);
}

export const skurrilModule = createSkurrilModule();
