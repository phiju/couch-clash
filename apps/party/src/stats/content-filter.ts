/**
 * Which questions may be played: ids that are quarantined/removed in D1 are
 * blocked, AI-generated questions are added per category. Cached ~5 minutes
 * per worker instance; without D1 the game plays without the filter.
 */
import type { StatsStore } from "./store";

export interface ContentFilter {
  blocked: ReadonlySet<string>;
  /** Raw generated items per category (validated by the category module). */
  extra: Readonly<Record<string, readonly unknown[]>>;
}

export const CONTENT_FILTER_TTL_MS = 5 * 60_000;

let cache: { at: number; value: ContentFilter } | null = null;

export function invalidateContentFilter() {
  cache = null;
}

export async function loadContentFilter(store: StatsStore | null, now: number): Promise<ContentFilter | null> {
  if (!store) return null;
  if (cache && now - cache.at < CONTENT_FILTER_TTL_MS) return cache.value;
  try {
    const [blocked, generated] = await Promise.all([store.blockedIds(), store.listGenerated()]);
    const extra: Record<string, unknown[]> = {};
    for (const row of generated) {
      if (row.status !== "active") continue;
      try {
        (extra[row.category_id] ??= []).push(JSON.parse(row.payload));
      } catch {
        // broken payload – skipped
      }
    }
    const value: ContentFilter = { blocked: new Set(blocked), extra };
    cache = { at: now, value };
    return value;
  } catch (err) {
    console.warn(`stats: content filter unavailable (${err instanceof Error ? err.message.slice(0, 80) : "error"})`);
    return cache?.value ?? null;
  }
}
