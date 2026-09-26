/**
 * Which questions may be played: ids that are quarantined/removed in D1 are
 * blocked, AI-generated questions are added per category. Cached ~5 minutes
 * per worker instance; without D1 the game plays without the filter.
 */
import type { SongOverrideStore } from "../songs/store";
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

/**
 * @param songs Musik-Quiz corrections from /admin/songs – added to the
 *   category's extra content (the module applies them to songs.json).
 */
export async function loadContentFilter(store: StatsStore | null, now: number, songs?: SongOverrideStore | null): Promise<ContentFilter | null> {
  if (!store) return null;
  if (cache && now - cache.at < CONTENT_FILTER_TTL_MS) return cache.value;
  try {
    const [blocked, generated, overrides] = await Promise.all([
      store.blockedIds(),
      store.listGenerated(),
      songs ? songs.list().catch(() => []) : Promise.resolve([]),
    ]);
    const extra: Record<string, unknown[]> = {};
    for (const row of generated) {
      if (row.status !== "active") continue;
      try {
        (extra[row.category_id] ??= []).push(JSON.parse(row.payload));
      } catch {
        // broken payload – skipped
      }
    }
    if (overrides.length) (extra.musik ??= []).push(...overrides);
    const value: ContentFilter = { blocked: new Set(blocked), extra };
    cache = { at: now, value };
    return value;
  } catch (err) {
    console.warn(`stats: content filter unavailable (${err instanceof Error ? err.message.slice(0, 80) : "error"})`);
    return cache?.value ?? null;
  }
}
