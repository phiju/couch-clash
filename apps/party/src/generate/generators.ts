/**
 * Replacement question writers, one per category. Each knows the JSON its
 * category needs; the result is validated with the category's own schema
 * (module.parseContent) afterwards.
 */
import type { ContentEntry } from "@couch-clash/shared";

export interface QuestionGenerator {
  /** What the model must return (JSON object). */
  format: string;
  /** Extra rules for this category. */
  rules: string[];
  /** Model JSON + the original's metadata → content item (validated later). */
  toItem(json: Record<string, unknown>, base: GeneratedBase): unknown;
  /** One line describing an item for the checking call. */
  describe(item: Record<string, unknown>): string;
}

export interface GeneratedBase {
  id: string;
  ageRating: number;
  difficulty: number;
  tags: string[];
}

export const GENERATORS: Readonly<Record<string, QuestionGenerator>> = {
  quiz: {
    format: '{"text": "Frage", "options": ["A", "B", "C", "D"], "correctIndex": 0}',
    rules: [
      "Genau 4 verschiedene, kurze Antwortoptionen, genau eine ist richtig.",
      "Die falschen Optionen sind plausibel, aber eindeutig falsch.",
    ],
    toItem: (json, base) => ({ ...base, text: json.text, options: json.options, correctIndex: json.correctIndex }),
    describe: (item) => {
      const options = Array.isArray(item.options) ? item.options : [];
      return `Frage: ${String(item.text)}\nOptionen: ${options.join(" | ")}\nAls richtig markiert: ${String(options[Number(item.correctIndex)])}`;
    },
  },
  estimate: {
    format:
      '{"text": "Schätzfrage", "answer": 123, "unit": "m", "format": "number" | "year", "zeroRange": 50 (nur bei Jahren oder Antwort 0 nötig), "fact": "kurzer Fakt"}',
    rules: [
      "Nur stabile Fakten, die sich nicht ändern (keine Rekorde, Einwohnerzahlen, Preise oder Ranglisten).",
      "Die Antwort ist eine einzelne Zahl, unit höchstens 20 Zeichen (leer bei Jahren).",
      "Bei format \"year\" immer zeroRange zwischen 25 und 100 angeben.",
    ],
    toItem: (json, base) => ({
      ...base,
      text: json.text,
      answer: json.answer,
      unit: typeof json.unit === "string" ? json.unit : "",
      format: json.format === "year" ? "year" : "number",
      ...(typeof json.zeroRange === "number" && json.zeroRange > 0 ? { zeroRange: json.zeroRange } : {}),
      ...(typeof json.fact === "string" && json.fact ? { fact: json.fact.slice(0, 200) } : {}),
    }),
    describe: (item) =>
      `Schätzfrage: ${String(item.text)}\nAntwort: ${String(item.answer)} ${String(item.unit ?? "")}${item.fact ? `\nFakt: ${String(item.fact)}` : ""}`,
  },
  bluff: {
    format: '{"word": "seltenes deutsches Wort", "definition": "kurze Erklärung wie im Wörterbuch"}',
    rules: [
      "Nur ECHTE, sehr seltene Wörter, die im Duden, DWDS oder Wiktionary stehen (veraltet, regional, Fachwort oder seltenes Fremdwort). Keine Fantasiewörter, nichts Anstößiges.",
      "Die Erklärung ist kurz (höchstens 80 Zeichen), sachlich wie ein Wörterbucheintrag, ohne Angaben wie (österr.) oder (veraltet).",
      "Das Wort darf nicht schon im Spiel vorkommen (Liste unten).",
    ],
    toItem: (json, base) => ({ ...base, word: json.word, definition: json.definition }),
    describe: (item) =>
      `Wort: ${String(item.word)}\nErklärung: ${String(item.definition)}\nPrüfe: Gibt es das Wort wirklich im Deutschen (Duden/DWDS/Wiktionary) und stimmt die Erklärung?`,
  },
};

export function similarEntries(original: ContentEntry, all: readonly ContentEntry[], max: number): ContentEntry[] {
  const tags = new Set(original.tags);
  return all.filter((e) => e.id !== original.id && e.tags.some((t) => tags.has(t))).slice(0, max);
}
