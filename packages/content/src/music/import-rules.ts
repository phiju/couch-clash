/**
 * Pure rules of the song import (`pnpm songs:import`), also used by the game
 * to compare answers: clean titles, spot live/remix/karaoke versions, merge
 * duplicates, pick and check the original year.
 *
 * No runtime imports: the import script runs this file with Node's type
 * stripping (type-only imports are erased).
 */
import type { Song, SongGenreConfig, SongGenreId } from "./schema";

/**
 * Versions that are not the song people sing along to. Checked in the title
 * and the artist ("Karaoke Party Band", "Tribute to …").
 */
const UNWANTED_ANYWHERE =
  /\b(karaoke|instrumental|tribute|nightcore|sped up|slowed|re-?recorded|megamix|made famous|originally performed|in the style of)\b/i;
/**
 * Only in a version suffix – "(Live)", "- Acoustic", "[Club Mix]" – because
 * "Live Is Life" or "Cover Me" are songs, not versions.
 */
const UNWANTED_SUFFIX =
  /(?:\(|\[|\s-\s)[^)\]]*\b(live|remix(ed)?|rmx|cover|acoustic|unplugged|a ?cappella|bootleg|mashup|lullaby|piano|orchestral|8-?bit|mix|dub)\b/i;
/** A mix that IS the song everybody knows. */
const SONG_MIX = /\b(radio|original|single|album) mix\b/i;
const UNWANTED_ARTIST = /\b(karaoke|tribute|cover band|covers|made famous|in the style of)\b/i;

export function isUnwantedVersion(title: string, artist = ""): boolean {
  if (UNWANTED_ANYWHERE.test(title) || UNWANTED_ARTIST.test(artist)) return true;
  const suffix = UNWANTED_SUFFIX.exec(title);
  if (!suffix) return false;
  // "(Radio Mix)" is fine, "(Club Mix)" is not.
  return !(/^(mix)$/i.test(suffix[1] ?? "") && SONG_MIX.test(title));
}

/** Bracket or dash suffixes that are not part of the title people know. */
const VERSION_SUFFIX =
  /\s*(?:\(|\[|\s-\s)\s*(?:[^)\]]*\b(?:remaster(?:ed)?|radio|edit|version|single|mono|stereo|mix|deluxe|bonus|anniversary|original|extended|from|aus|live|soundtrack|ost)\b[^)\]]*|feat\.?[^)\]]*|ft\.?[^)\]]*|with [^)\]]*|\d{4})\s*[)\]]?\s*$/i;

/** "Take On Me (Remastered 2015)" → "Take On Me"; "Layla - Radio Edit" → "Layla". */
export function cleanTitle(title: string): string {
  let t = title.trim();
  for (let i = 0; i < 4; i++) {
    const next = t.replace(VERSION_SUFFIX, "").trim();
    if (next === t || next.length === 0) break;
    t = next;
  }
  return t;
}

/** "Bausa feat. Joshi Mizu" → { main: "Bausa", featured: ["Joshi Mizu"] }. */
export function splitFeaturing(artist: string): { main: string; featured: string[] } {
  const [main, ...rest] = artist.split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i);
  const featured = rest.flatMap((part) => part.split(/\s*(?:,|&| und | and )\s*/i)).map((s) => s.trim()).filter(Boolean);
  return { main: (main ?? artist).trim(), featured };
}

/** Lower case, umlauts spelled out (ä = ae, ß = ss), accents and punctuation gone, spaces collapsed. */
export function foldText(text: string): string {
  let s = text.toLowerCase().trim();
  s = s.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  s = s.normalize("NFD").replace(/\p{M}/gu, "");
  s = s.replace(/&/g, " und ").replace(/[^\p{L}\p{N}\s]/gu, " ");
  return s.replace(/\s+/g, " ").trim();
}

/** Same song, whatever the version or sampler: clean title + main artist. */
export function dedupeKey(title: string, artist: string): string {
  return `${foldText(cleanTitle(title))}|${foldText(splitFeaturing(artist).main)}`;
}

/** URL-safe id from title and artist ("song-nena-99-luftballons"). */
export function songId(title: string, artist: string): string {
  const slug = foldText(`${splitFeaturing(artist).main} ${cleanTitle(title)}`)
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `song-${slug || "x"}`;
}

/**
 * Duplicates (same key) become one song: the most popular entry wins, genres
 * and modes are merged, aliases kept.
 */
export function mergeDuplicates(songs: readonly Song[]): Song[] {
  const byKey = new Map<string, Song>();
  for (const song of songs) {
    const key = dedupeKey(song.title, song.artist);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, song);
      continue;
    }
    const [best, other] = song.popularity > prev.popularity ? [song, prev] : [prev, song];
    const union = <T>(a: readonly T[], b: readonly T[]) => [...new Set([...a, ...b])];
    byKey.set(key, {
      ...best,
      genres: union(best.genres, other.genres),
      modes: union(best.modes, other.modes),
      titleAliases: union(best.titleAliases, other.titleAliases),
      artistAliases: union(best.artistAliases, other.artistAliases),
      // A verified year beats an unverified one.
      ...(!best.yearVerified && other.yearVerified ? { originalYear: other.originalYear, yearVerified: true } : {}),
    });
  }
  // Ids must stay unique even if two different songs slug the same.
  const seen = new Map<string, number>();
  return [...byKey.values()].map((s) => {
    const n = seen.get(s.id) ?? 0;
    seen.set(s.id, n + 1);
    return n === 0 ? s : { ...s, id: `${s.id}-${n + 1}` };
  });
}

/** One MusicBrainz recording search hit (the fields the year pick needs). */
export interface RecordingHit {
  id: string;
  /** Search score 0–100. */
  score: number;
  title: string;
  artist: string;
  /** "1985", "1985-10" or "1985-10-19"; missing for some recordings. */
  firstReleaseDate: string | null;
}

export interface YearPick {
  year: number | null;
  musicbrainzId: string | null;
  /** How many matching recordings agree on that year. */
  agreeing: number;
}

/** The earliest first-release year among recordings that are really this song. */
export function pickOriginalYear(hits: readonly RecordingHit[], title: string, artist: string): YearPick {
  const wantTitle = foldText(cleanTitle(title));
  const wantArtist = foldText(splitFeaturing(artist).main);
  const years: { year: number; id: string }[] = [];
  for (const hit of hits) {
    if (hit.score < 80 || !hit.firstReleaseDate) continue;
    if (isUnwantedVersion(hit.title)) continue;
    const t = foldText(cleanTitle(hit.title));
    const a = foldText(hit.artist);
    if (t !== wantTitle || !(a.includes(wantArtist) || wantArtist.includes(a))) continue;
    const year = Number(hit.firstReleaseDate.slice(0, 4));
    if (Number.isInteger(year) && year >= 1900) years.push({ year, id: hit.id });
  }
  if (years.length === 0) return { year: null, musicbrainzId: null, agreeing: 0 };
  const earliest = years.reduce((a, b) => (b.year < a.year ? b : a));
  return { year: earliest.year, musicbrainzId: earliest.id, agreeing: years.filter((y) => y.year === earliest.year).length };
}

/**
 * Is the year believable for the song's genres? Every genre with a year
 * range must contain it (±1 for re-releases at the turn of a decade).
 */
export function plausibleYear(
  year: number | null,
  genres: readonly SongGenreId[],
  config: Partial<Record<SongGenreId, Pick<SongGenreConfig, "years">>>,
  nowYear: number,
): boolean {
  if (year === null || year < 1900 || year > nowYear) return false;
  return genres.every((g) => {
    const range = config[g]?.years;
    return !range || (year >= range[0] - 1 && year <= range[1] + 1);
  });
}

/**
 * The year counts as verified when it is plausible for the genres and at
 * least `minAgreeing` matching recordings share it (a single hit can be a
 * mislabelled compilation).
 */
export function verifyYear(
  pick: YearPick,
  genres: readonly SongGenreId[],
  config: Partial<Record<SongGenreId, Pick<SongGenreConfig, "years">>>,
  nowYear: number,
  minAgreeing = 2,
): boolean {
  return pick.agreeing >= minAgreeing && plausibleYear(pick.year, genres, config, nowYear);
}
