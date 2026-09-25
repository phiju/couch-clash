/** Fisher–Yates shuffle with an injectable random source. Returns a new array. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Picks `count` distinct items, preferring ones whose id is not in `exclude`.
 * Only if there are not enough fresh items, already used ones fill up.
 * Never returns the same item twice.
 */
export function pickFresh<T extends { id: string }>(
  pool: readonly T[],
  count: number,
  exclude: readonly string[],
  random: () => number,
  /** Optional relative chance per item (e.g. by difficulty); default: all equal. */
  weight?: (item: T) => number,
): T[] {
  const excluded = new Set(exclude);
  const order = (items: T[]) => (weight ? weightedShuffle(items, weight, random) : shuffle(items, random));
  const fresh = order(pool.filter((q) => !excluded.has(q.id)));
  const used = order(pool.filter((q) => excluded.has(q.id)));
  return [...fresh, ...used].slice(0, count);
}

/** Random order where heavier items tend to come first (Efraimidis–Spirakis keys). */
export function weightedShuffle<T>(items: readonly T[], weight: (item: T) => number, random: () => number): T[] {
  return items
    .map((item) => {
      const w = Math.max(1e-6, weight(item));
      const u = Math.min(1 - 1e-12, Math.max(1e-12, random()));
      return { item, key: Math.log(u) / w };
    })
    .sort((a, b) => b.key - a.key)
    .map((x) => x.item);
}
