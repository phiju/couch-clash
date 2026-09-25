import { difficultyWeight, type ModuleInitOptions } from "@couch-clash/shared";
import type { FuehrerscheinQuestion } from "@couch-clash/content";
import { pickFresh, shuffle } from "../random";

export type QuestionKind = "text" | "sign" | "scene";

export const kindOf = (q: { media?: { kind: string } | null }): QuestionKind => (q.media?.kind as QuestionKind | undefined) ?? "text";

/**
 * Mixes the three question types evenly (text / sign / scene), in a
 * rotating order so the same type never comes twice in a row while others
 * are left. A type with too few questions (e.g. scenes in Kids) is filled
 * up from the others.
 */
export function pickMixed(
  pool: readonly FuehrerscheinQuestion[],
  options: Pick<ModuleInitOptions, "questionCount" | "excludeContentIds" | "mode">,
  random: () => number,
): FuehrerscheinQuestion[] {
  const kinds = shuffle<QuestionKind>(["text", "sign", "scene"], random);
  const byKind = new Map(
    kinds.map((k) => [
      k,
      pickFresh(
        pool.filter((q) => kindOf(q) === k),
        options.questionCount,
        options.excludeContentIds,
        random,
        (q) => difficultyWeight(q.difficulty, options.mode),
      ),
    ]),
  );
  const out: FuehrerscheinQuestion[] = [];
  while (out.length < options.questionCount) {
    let added = false;
    for (const k of kinds) {
      const next = byKind.get(k)!.shift();
      if (!next || out.length >= options.questionCount) continue;
      out.push(next);
      added = true;
    }
    if (!added) break;
  }
  return out;
}
