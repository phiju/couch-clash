/** Question texts with the right indefinite article (client-safe). */
export interface BluffNoun {
  article: "der" | "die" | "das";
  word: string;
  plural?: boolean;
}

/** "Ein Borborygmus" / "Eine Glabella" / "Ein Philtrum" / "Vibrissen" */
export function withIndefiniteArticle(n: BluffNoun): string {
  if (n.plural) return n.word;
  return `${n.article === "die" ? "Eine" : "Ein"} ${n.word}`;
}

/** "Ein Borborygmus ist …?" / "Vibrissen sind …?" */
export function bluffQuestion(n: BluffNoun): string {
  return `${withIndefiniteArticle(n)} ${n.plural ? "sind" : "ist"} …?`;
}

/** "Ein Borborygmus ist:" – before the real definition at the reveal. */
export function bluffLead(n: BluffNoun): string {
  return `${withIndefiniteArticle(n)} ${n.plural ? "sind" : "ist"}:`;
}
