/** Musik-Quiz corrections from /admin/songs in D1 (table song_overrides). */
import { SongOverrideSchema, type SongOverride } from "@couch-clash/content";

export interface SongOverrideStore {
  list(): Promise<SongOverride[]>;
  /** Replaces the song's correction (merge happens in the admin route). */
  put(override: SongOverride, now: number): Promise<void>;
}

export function d1SongOverrideStore(db: D1Database): SongOverrideStore {
  return {
    async list() {
      const { results } = await db.prepare("SELECT payload FROM song_overrides").all<{ payload: string }>();
      return results.flatMap((r) => {
        try {
          const parsed = SongOverrideSchema.safeParse(JSON.parse(r.payload));
          return parsed.success ? [parsed.data] : [];
        } catch {
          return [];
        }
      });
    },
    async put(override, now) {
      await db
        .prepare(
          "INSERT INTO song_overrides (song_id, payload, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(song_id) DO UPDATE SET payload = ?2, updated_at = ?3",
        )
        .bind(override.id, JSON.stringify(override), now)
        .run();
    },
  };
}
