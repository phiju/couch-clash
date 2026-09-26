/**
 * Free-text answers for "Wie heißt der Song?" and "Wer singt das?".
 *
 * Normalization (both sides): lower case, umlauts/ß spelled out (ä = ae),
 * accents and punctuation gone, "feat. …" and version brackets
 * ("Remastered", "Radio Edit") dropped, a leading article optional
 * ("Toten Hosen" = "Die Toten Hosen"), spaces ignored. Then a Levenshtein
 * tolerance by length (0 typos up to 3 letters … 3 from 10) against the
 * title / artist and every alias.
 */
import { cleanTitle, foldText, splitFeaturing } from "@couch-clash/content";
import { allowedTypos, levenshtein } from "../pixelpanik/match";

const ARTICLES = /^(der|die|das|den|dem|des|the|la|le|les|los|el|il|a|an|ein|eine)\s+/;

/** The spellings an answer or a term may have (with and without a leading article), spaces removed. */
export function songVariants(text: string): string[] {
  const folded = foldText(cleanTitle(splitFeaturing(text).main));
  const out = new Set<string>();
  const add = (s: string) => {
    const compact = s.replace(/\s+/g, "");
    if (compact) out.add(compact);
  };
  add(folded);
  add(folded.replace(ARTICLES, ""));
  return [...out];
}

/** Terms for a title: the title, its aliases, and the title without a bracket part ("(I Just) Died in Your Arms" → "Died in Your Arms"). */
export function titleTerms(title: string, aliases: readonly string[]): string[] {
  const texts = [title, ...aliases];
  for (const t of [title, ...aliases]) {
    const bare = t.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
    if (bare && bare !== t) texts.push(bare);
  }
  return unique(texts.flatMap(songVariants));
}

/** Terms for an artist: the artist as shown, aliases, and every main artist on its own (duets, "feat."). */
export function artistTerms(artist: string, aliases: readonly string[], mainArtists: readonly string[]): string[] {
  const featured = splitFeaturing(artist).featured;
  return unique([artist, ...aliases, ...mainArtists].flatMap(songVariants)).filter(
    // A featured guest alone is not the artist.
    (t) => !featured.some((f) => songVariants(f).includes(t)),
  );
}

export function memberTerms(members: readonly string[]): string[] {
  return unique(members.flatMap(songVariants));
}

function unique(xs: readonly string[]): string[] {
  return [...new Set(xs)];
}

/** Smallest distance of any spelling of the answer to any term. */
function bestDistance(answer: string, terms: readonly string[]): { distance: number; allowed: boolean } {
  let distance = Infinity;
  let allowed = false;
  for (const a of songVariants(answer)) {
    for (const term of terms) {
      const d = levenshtein(a, term, 6);
      if (d < distance) distance = d;
      if (d <= allowedTypos(term.length)) allowed = true;
    }
  }
  return { distance, allowed };
}

export function matchesTerms(answer: string, terms: readonly string[]): boolean {
  return terms.length > 0 && bestDistance(answer, terms).allowed;
}

export type ArtistMatch = "full" | "partial" | null;

/** Right artist (full points), a band member (partial points) or wrong. */
export function checkArtist(answer: string, terms: { artist: readonly string[]; members: readonly string[] }): ArtistMatch {
  if (matchesTerms(answer, terms.artist)) return "full";
  if (matchesTerms(answer, terms.members)) return "partial";
  return null;
}

/**
 * Not accepted, but close enough that a human might count it: a few more
 * typos than allowed, or one contains the other (≥ 4 letters). Only these
 * go to the optional AI check.
 */
export function isBorderline(answer: string, terms: readonly string[]): boolean {
  const { distance, allowed } = bestDistance(answer, terms);
  if (allowed) return false;
  for (const a of songVariants(answer)) {
    for (const term of terms) {
      if (distance <= allowedTypos(term.length) + 2 && term.length >= 4) return true;
      if (a.length >= 4 && term.length >= 4 && (a.includes(term) || term.includes(a))) return true;
    }
  }
  return false;
}
