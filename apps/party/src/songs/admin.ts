/**
 * Admin API for /admin/songs (same ADMIN_TOKEN as /admin/fragen): list the
 * songs with their corrections, correct / confirm years, keep aliases,
 * switch a song off. Corrections are stored in D1 (song_overrides) and apply
 * from the next round on.
 */
import {
  MUSIK_SONGS,
  MUSIK_SONGS_IMPORTED_AT,
  SongOverrideSchema,
  applySongOverrides,
  type Song,
  type SongOverride,
} from "@couch-clash/content";
import type { AdminSong, AdminSongsResponse } from "@couch-clash/shared";
import { json } from "../http";
import { invalidateContentFilter } from "../stats/content-filter";
import type { SongOverrideStore } from "./store";

const EditSchema = SongOverrideSchema.omit({ kind: true, id: true }).strict();

function adminSong(song: Song, override: SongOverride | undefined, disabled: boolean): AdminSong {
  return {
    id: song.id,
    title: song.title,
    titleAliases: song.titleAliases,
    artist: song.artist,
    artistAliases: song.artistAliases,
    coverUrl: song.coverUrl,
    provider: song.provider,
    sourceUrl: song.sourceUrl,
    originalYear: song.originalYear,
    yearVerified: song.yearVerified,
    popularity: song.popularity,
    genres: song.genres,
    modes: song.modes,
    musicbrainzId: song.musicbrainzId ?? null,
    edited: !!override,
    disabled,
  };
}

export async function listAdminSongs(store: SongOverrideStore, songs: readonly Song[] = MUSIK_SONGS): Promise<AdminSongsResponse> {
  const overrides = await store.list();
  const byId = new Map(overrides.map((o) => [o.id, o]));
  const list = songs.map((song) => {
    const o = byId.get(song.id);
    // Show a switched-off song with its other corrections.
    const applied = applySongOverrides([song], o ? [{ ...o, disabled: false }] : [])[0] ?? song;
    return adminSong(applied, o, o?.disabled === true);
  });
  return { songs: list, importedAt: MUSIK_SONGS_IMPORTED_AT };
}

/** /api/admin/songs…; null for other paths. Auth is checked by the caller. */
export async function handleAdminSongs(
  request: Request,
  url: URL,
  store: SongOverrideStore | null,
  now: number,
  songs: readonly Song[] = MUSIK_SONGS,
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/admin/songs")) return null;
  if (!store) return json({ error: "Datenbank (STATS) ist nicht eingerichtet." }, 503);
  try {
    if (url.pathname === "/api/admin/songs" && request.method === "GET") return json(await listAdminSongs(store, songs));
    const one = url.pathname.match(/^\/api\/admin\/songs\/([^/]+)$/);
    if (one && request.method === "PUT") {
      const id = decodeURIComponent(one[1]!);
      const song = songs.find((s) => s.id === id);
      if (!song) return json({ error: "Song nicht gefunden." }, 404);
      const edit = EditSchema.safeParse(await request.json().catch(() => undefined));
      if (!edit.success) return json({ error: edit.error.issues[0]?.message ?? "Ungültige Anfrage." }, 400);
      const previous = (await store.list()).find((o) => o.id === id);
      const next: SongOverride = { ...previous, ...edit.data, kind: "song-override", id };
      // A verified year needs a year.
      const year = next.originalYear !== undefined ? next.originalYear : song.originalYear;
      if ((next.yearVerified ?? song.yearVerified) && year === null) return json({ error: "Ein bestätigtes Jahr braucht ein Jahr." }, 400);
      await store.put(next, now);
      invalidateContentFilter();
      return json({ ok: true });
    }
  } catch (err) {
    console.warn(`admin songs: request failed (${err instanceof Error ? err.message.slice(0, 80) : "error"})`);
    return json({ error: "Datenbank nicht erreichbar." }, 503);
  }
  return json({ error: "Not found" }, 404);
}

