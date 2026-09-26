/**
 * Free-text answers with typo tolerance: both sides are normalized
 * (lower case, umlauts, accents, spaces, hyphens, leading articles), then
 * the Levenshtein distance may be up to `allowedTypos(length)` – short
 * words must be exact, long ones may have up to three typos.
 *
 * Guard: a guess that is closer to ANOTHER motif of the catalog than to this
 * one is wrong ("Irland" is not a typo of "Island").
 */

/** Leading articles people type in front of the answer ("der Eiffelturm"). */
const ARTICLES = /^(der|die|das|den|dem|des|ein|eine|einen|the|la|le|il|el)\s+/;

export function normalizeAnswer(text: string): string {
  let s = text.toLowerCase().trim();
  s = s.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  // é → e, ç → c, … (after the German umlauts, which have their own spelling)
  s = s.normalize("NFD").replace(/\p{M}/gu, "");
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  s = s.replace(ARTICLES, "");
  return s.replace(/[^\p{L}\p{N}]/gu, "");
}

/** Typos allowed for a (normalized) answer of this length. */
export function allowedTypos(length: number): number {
  if (length <= 3) return 0;
  if (length <= 5) return 1;
  if (length <= 9) return 2;
  return 3;
}

/** Levenshtein distance; stops early once it is certainly above `max` (returns max + 1). */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      row.push(value);
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length]!;
}

export interface MatchTarget {
  /** Normalized answer + synonyms of the motif. */
  terms: readonly string[];
}

/** Every motif's normalized terms – the guard compares a guess with the others. */
export interface MatchCatalog {
  /** motif id → normalized terms */
  terms: ReadonlyMap<string, readonly string[]>;
}

export function buildCatalog(motifs: readonly { id: string; answer: string; synonyms: readonly string[] }[]): MatchCatalog {
  return { terms: new Map(motifs.map((m) => [m.id, termsOf(m)])) };
}

export function termsOf(motif: { answer: string; synonyms: readonly string[] }): string[] {
  return [...new Set([motif.answer, ...motif.synonyms].map(normalizeAnswer).filter((t) => t.length > 0))];
}

/** Distance of the guess to the closest term (at most `max + 1`). */
function closest(guess: string, terms: readonly string[], max: number): { distance: number; allowed: boolean } {
  let distance = max + 1;
  let allowed = false;
  for (const term of terms) {
    const d = levenshtein(guess, term, max);
    if (d < distance) distance = d;
    if (d <= allowedTypos(term.length)) allowed = true;
  }
  return { distance, allowed };
}

/** Is this free-text guess right for the motif `motifId`? */
export function isCorrectGuess(guess: string, motifId: string, catalog: MatchCatalog, own?: readonly string[]): boolean {
  const g = normalizeAnswer(guess);
  if (!g) return false;
  const terms = own ?? catalog.terms.get(motifId) ?? [];
  const mine = closest(g, terms, 3);
  if (!mine.allowed) return false;
  if (mine.distance === 0) return true;
  // Closer to another motif than to this one → that other thing was meant.
  for (const [id, others] of catalog.terms) {
    if (id === motifId) continue;
    const other = closest(g, others, mine.distance - 1);
    if (other.distance < mine.distance) return false;
  }
  return true;
}
