/** Filters and helpers of the admin page /admin/songs (pure, tested). */
import type { AdminSong, AdminSongEdit } from "@couch-clash/shared";

export interface SongView {
  search: string;
  /** "" = every genre */
  genre: string;
  /** Only songs whose year is not verified yet (they never play "Aus welchem Jahr?"). */
  unverifiedOnly: boolean;
  showDisabled: boolean;
}

export const DEFAULT_SONG_VIEW: SongView = { search: "", genre: "", unverifiedOnly: true, showDisabled: true };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

export function filterSongs(songs: readonly AdminSong[], view: SongView): AdminSong[] {
  const q = fold(view.search.trim());
  return songs
    .filter((s) => (!view.unverifiedOnly || !s.yearVerified) && (view.showDisabled || !s.disabled))
    .filter((s) => !view.genre || s.genres.includes(view.genre))
    .filter((s) => !q || fold(`${s.artist} ${s.title} ${s.titleAliases.join(" ")} ${s.artistAliases.join(" ")}`).includes(q))
    .sort((a, b) => b.popularity - a.popularity);
}

/** "Hulapalu, Hulapalu-Song" → ["Hulapalu", "Hulapalu-Song"] (trimmed, no empties, no doubles). */
export function parseAliases(text: string): string[] {
  return [...new Set(text.split(",").map((a) => a.trim()).filter(Boolean))];
}

/** A year typed on the page → an edit (empty = no year; a changed year is not verified until confirmed). */
export function yearEdit(text: string, confirm: boolean): AdminSongEdit | null {
  const t = text.trim();
  if (!t) return confirm ? null : { originalYear: null, yearVerified: false };
  const year = Number(t);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return null;
  return { originalYear: year, yearVerified: confirm };
}
