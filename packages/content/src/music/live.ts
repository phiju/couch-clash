/**
 * The live song catalog of the Musik-Quiz: when a round starts, the worker
 * asks Deezer for playlists of the picked genres (search terms from
 * data/musik/genres.json, or fixed playlist ids where the file has some),
 * takes the best known tracks and turns them into songs – with a fresh
 * preview URL each, so no second lookup is needed. Nothing is stored.
 *
 * The year ("Aus welchem Jahr?") comes from the track's album: only an
 * original album or single counts (no sampler, no remaster / best-of), and
 * only when it fits the genre's years. Anything else simply doesn't play
 * the year question. Admin corrections (/admin/songs) apply on top by song id.
 *
 * Runs in the worker (and tests, with a fake source).
 */
import { cleanTitle, isUnwantedVersion, mergeDuplicates, plausibleYear, songId, splitFeaturing } from "./import-rules";
import type { AlbumInfo, PlaylistInfo, ProviderTrack, TtlCache } from "./providers";
import { SongSchema, type Song, type SongGenreId, type SongImportConfig } from "./schema";

export const LIVE_CATALOG_CONFIG = {
  /** Genres asked per round (Zufall / many picked → a random few, keeps the round start fast). */
  maxGenres: 4,
  /** Playlist search hits a genre picks from at random (variety between rounds). */
  playlistChoices: 4,
  /** A playlist needs at least this many tracks to be used. */
  minPlaylistTracks: 20,
  /** Tracks read per playlist. */
  tracksPerPlaylist: 100,
  /** Songs wanted per question of the round (planned song + spares + Kids' wrong options). */
  songsPerQuestion: 4,
  /** Songs taken per genre at most. */
  maxPerGenre: 60,
  /** Album lookups for the year (the best known songs first). */
  yearLookups: 30,
  /** Playlist search results are stable – cached per worker instance. */
  playlistCacheMs: 12 * 60 * 60_000,
} as const;

/** Album titles that are not the original release (the year would be wrong). */
const NOT_ORIGINAL_ALBUM =
  /\b(best of|greatest|hits|collection|anthology|remaster(?:ed)?|deluxe|anniversary|edition|essential|essentials|the very best|compilation|sampler|vol\.?|volume|jahre|years|gold|platinum|ultimate|definitive|complete)\b/i;

export interface LiveCatalogRequest {
  /** Genres of the round (already filtered by mode); empty → nothing. */
  genres: readonly SongGenreId[];
  /** Questions of the round. */
  questions: number;
}

export interface LiveCatalogResult {
  songs: Song[];
  /** Song id → fresh preview URL (every song in `songs` has one). */
  previews: Record<string, string>;
}

/** The Deezer calls the catalog needs (DeezerProvider has them). */
export interface LiveCatalogSource {
  searchPlaylists(query: string, limit?: number): Promise<PlaylistInfo[]>;
  playlistTracks(playlistId: string, limit?: number): Promise<ProviderTrack[]>;
  album(albumId: string): Promise<AlbumInfo | null>;
}

export interface LiveCatalogDeps {
  source: LiveCatalogSource;
  config: SongImportConfig;
  random: () => number;
  nowYear: number;
  /** Shared by the rooms of a worker instance. */
  playlistCache?: TtlCache<PlaylistInfo[]>;
  log?: (message: string) => void;
}

const pick = <T>(items: readonly T[], random: () => number): T | undefined => items[Math.floor(random() * items.length)];

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

async function playlistFor(genre: SongGenreId, deps: LiveCatalogDeps): Promise<string | null> {
  const g = deps.config.genres[genre];
  if (!g) return null;
  // Fixed playlists in genres.json win over the search.
  if (g.deezerPlaylistIds.length) return pick(g.deezerPlaylistIds, deps.random) ?? null;
  const query = pick(g.searchQueries, deps.random)!;
  let hits = deps.playlistCache?.get(query);
  if (!hits) {
    hits = await deps.source.searchPlaylists(query, 10);
    deps.playlistCache?.set(query, hits);
  }
  const usable = hits.filter((p) => p.trackCount >= LIVE_CATALOG_CONFIG.minPlaylistTracks).slice(0, LIVE_CATALOG_CONFIG.playlistChoices);
  return pick(usable, deps.random)?.id ?? null;
}

function toSong(track: ProviderTrack, genre: SongGenreId, config: SongImportConfig): Song | null {
  const title = cleanTitle(track.titleShort || track.title);
  const { main } = splitFeaturing(track.artist);
  const parsed = SongSchema.safeParse({
    id: songId(title, track.artist),
    title,
    titleAliases: [],
    artist: main,
    artistAliases: [],
    mainArtists: track.mainArtists.length > 1 ? track.mainArtists : [main],
    members: [],
    coverUrl: track.coverUrl,
    provider: track.provider,
    providerTrackId: track.trackId,
    sourceUrl: track.sourceUrl,
    previewUrl: null,
    originalYear: null,
    yearVerified: false,
    popularity: Math.max(0, Math.round(track.rank ?? 0)),
    genres: [genre],
    modes: [...config.genres[genre]!.modes],
  });
  return parsed.success ? parsed.data : null;
}

/** One genre: a playlist, its best known usable tracks. */
async function genreTracks(genre: SongGenreId, perGenre: number, deps: LiveCatalogDeps): Promise<{ song: Song; track: ProviderTrack }[]> {
  const playlistId = await playlistFor(genre, deps);
  if (!playlistId) {
    deps.log?.(`musik live: no playlist for ${genre}`);
    return [];
  }
  const tracks = (await deps.source.playlistTracks(playlistId, LIVE_CATALOG_CONFIG.tracksPerPlaylist))
    .filter((t) => t.previewUrl && !isUnwantedVersion(t.title, t.artist))
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  // Well-known songs first; less known ones only when the playlist has too few.
  const known = tracks.filter((t) => (t.rank ?? 0) >= deps.config.minPopularity);
  const chosen = known.length >= perGenre ? known : [...known, ...tracks.filter((t) => !known.includes(t))];
  return chosen.slice(0, perGenre).flatMap((track) => {
    const song = toSong(track, genre, deps.config);
    return song ? [{ song, track }] : [];
  });
}

/** Original year from the album, or null when the album is a sampler / re-release. */
export function albumYear(album: AlbumInfo | null): number | null {
  if (!album?.releaseDate || album.recordType === "compile" || NOT_ORIGINAL_ALBUM.test(album.title)) return null;
  const year = Number(album.releaseDate.slice(0, 4));
  return Number.isInteger(year) && year >= 1900 ? year : null;
}

export async function liveSongCatalog(req: LiveCatalogRequest, deps: LiveCatalogDeps): Promise<LiveCatalogResult> {
  const genres = shuffled([...new Set(req.genres)], deps.random).slice(0, LIVE_CATALOG_CONFIG.maxGenres);
  if (genres.length === 0) return { songs: [], previews: {} };
  const perGenre = Math.min(
    LIVE_CATALOG_CONFIG.maxPerGenre,
    Math.ceil((Math.max(1, req.questions) * LIVE_CATALOG_CONFIG.songsPerQuestion) / genres.length),
  );
  const found = await Promise.all(
    genres.map((g) =>
      genreTracks(g, perGenre, deps).catch((err: unknown) => {
        deps.log?.(`musik live: ${g} failed (${err instanceof Error ? err.message.slice(0, 60) : "error"})`);
        return [];
      }),
    ),
  );
  const byTrack = new Map<string, ProviderTrack>();
  for (const { track } of found.flat()) byTrack.set(track.trackId, track);
  const songs = mergeDuplicates(found.flat().map((x) => x.song)).sort((a, b) => b.popularity - a.popularity);

  // The year from the album – the best known songs first, each album once.
  const albums = new Map<string, Promise<AlbumInfo | null>>();
  const withYear = await Promise.all(
    songs.map(async (song, i) => {
      const track = byTrack.get(song.providerTrackId);
      if (i >= LIVE_CATALOG_CONFIG.yearLookups || !track?.albumId || (track.album && NOT_ORIGINAL_ALBUM.test(track.album))) return song;
      if (!albums.has(track.albumId)) albums.set(track.albumId, deps.source.album(track.albumId).catch(() => null));
      const year = albumYear(await albums.get(track.albumId)!);
      if (year === null) return song;
      return { ...song, originalYear: year, yearVerified: plausibleYear(year, song.genres, deps.config.genres, deps.nowYear) };
    }),
  );

  const previews: Record<string, string> = {};
  const out: Song[] = [];
  for (const song of withYear) {
    const url = byTrack.get(song.providerTrackId)?.previewUrl;
    if (!url) continue;
    previews[song.id] = url;
    out.push(song);
  }
  return { songs: out, previews };
}
