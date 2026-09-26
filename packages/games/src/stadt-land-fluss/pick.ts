/**
 * The letters and categories of a round. Party categories come up ONLY in
 * Party mode – the one filter is `categoriesForMode`.
 */
import type { SlfCategory, SlfFile } from "@couch-clash/content";
import type { GameMode, ModuleInitOptions } from "@couch-clash/shared";
import { pickFresh, shuffle } from "../random";

/** Content ids (usedContentIds): a letter or a category played in this game / room. */
export const letterContentId = (letter: string) => `slf-letter:${letter}`;
export const categoryContentId = (id: string) => `slf-cat:${id}`;

/** Kids: kids categories · Familie: family + kids · Party: family + party. */
const MODE_POOLS: Record<GameMode, readonly SlfCategory["mode"][]> = {
  kids: ["kinder"],
  family: ["familie", "kinder"],
  party: ["familie", "party"],
};

export function categoriesForMode(data: Pick<SlfFile, "categories">, mode: GameMode): SlfCategory[] {
  const pools = MODE_POOLS[mode];
  return data.categories.filter((c) => pools.includes(c.mode));
}

export function lettersForMode(data: Pick<SlfFile, "letters">, mode: GameMode): string[] {
  const key = mode === "kids" ? "kinder" : mode === "family" ? "familie" : "party";
  return [...data.letters[key]];
}

/**
 * `count` different letters: never one already played in this game (as long
 * as the pool lasts), letters of earlier games in this room only if needed.
 */
export function pickLetters(pool: readonly string[], count: number, options: ModuleInitOptions, random: () => number): string[] {
  const inGame = new Set((options.currentGameContentIds ?? []).filter((id) => id.startsWith("slf-letter:")));
  const items = pool.map((l) => ({ id: letterContentId(l), letter: l }));
  const fresh = items.filter((l) => !inGame.has(l.id));
  const picked = pickFresh(fresh, count, options.excludeContentIds, random);
  // A very long game used up the whole alphabet: only then letters come again.
  const more = picked.length < count ? pickFresh(items.filter((l) => !picked.includes(l)), count - picked.length, [], random) : [];
  return [...picked, ...more].map((l) => l.letter);
}

export interface CategoryMix {
  partyMinPerRound: number;
  creativeMinPerRound: number;
}

/**
 * `n` categories for one letter: Party mode at least `partyMin` from the
 * party pool, always at least `creativeMin` "kreativ" ones (the vote needs
 * them), categories not played yet first.
 */
export function pickCategories(
  pool: readonly SlfCategory[],
  n: number,
  mode: GameMode,
  mix: CategoryMix,
  used: readonly string[],
  random: () => number,
): SlfCategory[] {
  const out: SlfCategory[] = [];
  const exclude = used.map((id) => (id.startsWith("slf-cat:") ? id.slice(8) : id));
  const take = (candidates: readonly SlfCategory[], k: number) => {
    if (k <= 0) return;
    out.push(...pickFresh(candidates.filter((c) => !out.includes(c)), k, exclude, random));
  };
  if (mode === "party") take(pool.filter((c) => c.mode === "party"), Math.min(n, mix.partyMinPerRound));
  const creative = out.filter((c) => c.type === "kreativ").length;
  take(pool.filter((c) => c.type === "kreativ"), Math.min(n - out.length, mix.creativeMinPerRound - creative));
  take(pool, n - out.length);
  return shuffle(out, random);
}
