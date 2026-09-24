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
): T[] {
  const excluded = new Set(exclude);
  const fresh = shuffle(
    pool.filter((q) => !excluded.has(q.id)),
    random,
  );
  const used = shuffle(
    pool.filter((q) => excluded.has(q.id)),
    random,
  );
  return [...fresh, ...used].slice(0, count);
}
