/**
 * Songs for the Musik-Quiz. The song database is `data/musik/songs.json`,
 * written by `pnpm songs:import` (Deezer playlists → filter → MusicBrainz
 * year) and committed. Corrections from the admin page (/admin/songs) live
 * in D1 as overrides and are applied on top when a round starts.
 *
 * Only zod is imported here: the import script runs this file with Node's
 * type stripping (no bundler).
 */
import { z } from "zod";

/** Where a song's audio comes from. `local` = test files in apps/web/public/test-audio. */
export const SONG_PROVIDERS = ["deezer", "itunes", "local", "applemusic"] as const;
export type SongProviderId = (typeof SONG_PROVIDERS)[number];

export const SONG_MODES = ["kids", "family", "party"] as const;
export type SongMode = (typeof SONG_MODES)[number];

/** The genres a host can pick (labels and emojis: MUSIK_GENRES in @couch-clash/games). */
export const SONG_GENRE_IDS = [
  "80er",
  "90er",
  "2000er",
  "schlager-klassiker",
  "schlager-party",
  "ballermann",
  "oktoberfest",
  "ndw",
  "party-international",
  "kinder",
] as const;
export type SongGenreId = (typeof SONG_GENRE_IDS)[number];

const songText = z.string().trim().min(1).max(120);

export const SongSchema = z
  .object({
    id: z.string().regex(/^song-[a-z0-9-]+$/),
    /** Clean title (no "Remastered", "Radio Edit", "feat. …"). */
    title: songText,
    /** Also right for "Wie heißt der Song?" (other spellings, the chorus line people know it by). */
    titleAliases: z.array(songText),
    /** As shown ("Nena & Kim Wilde"). */
    artist: songText,
    /** Also right for "Wer singt das?" (e.g. "DJ Ötzi" ↔ "Ötzi"). */
    artistAliases: z.array(songText),
    /** Every main artist counts as right on its own (duets, "feat."). Default: [artist]. */
    mainArtists: z.array(songText).min(1),
    /** Band members – naming one instead of the band gives partial points. */
    members: z.array(songText),
    coverUrl: z.url().nullable(),
    provider: z.enum(SONG_PROVIDERS),
    providerTrackId: z.string().min(1).max(64),
    /** Link to the track at the provider (admin page, reveal). */
    sourceUrl: z.url().nullable(),
    /**
     * Only for `local` test files (a path under /test-audio). Provider
     * previews carry expiring tokens: they are never stored, the worker
     * fetches a fresh one per track when a round starts.
     */
    previewUrl: z.string().regex(/^\/test-audio\/[\w.-]+$/).nullable(),
    /** Year of the first release (MusicBrainz), not the sampler / remaster date. */
    originalYear: z.number().int().min(1900).max(2100).nullable(),
    /** The year passed the checks (or an admin confirmed it). Only these play "Aus welchem Jahr?". */
    yearVerified: z.boolean(),
    /** Provider popularity (Deezer "rank"); the bigger, the better known. */
    popularity: z.number().int().min(0),
    genres: z.array(z.enum(SONG_GENRE_IDS)).min(1),
    modes: z.array(z.enum(SONG_MODES)).min(1),
    /** MusicBrainz recording the year comes from (admin page link). */
    musicbrainzId: z.string().max(64).nullable().optional(),
  })
  .refine((s) => !s.yearVerified || s.originalYear !== null, {
    message: "A verified year needs originalYear",
    path: ["yearVerified"],
  })
  .refine((s) => (s.provider === "local") === (s.previewUrl !== null), {
    message: "previewUrl only (and always) for local test songs",
    path: ["previewUrl"],
  });
export type Song = z.infer<typeof SongSchema>;

export const SongFileSchema = z.object({
  category: z.literal("musik"),
  /** When `pnpm songs:import` last wrote the file (ISO), null before the first import. */
  importedAt: z.string().nullable(),
  items: z.array(SongSchema),
});

/**
 * A correction from the admin page (stored in D1, applied on top of
 * songs.json). Only the given fields change.
 */
export const SongOverrideSchema = z.object({
  kind: z.literal("song-override"),
  id: z.string().regex(/^song-[a-z0-9-]+$/),
  originalYear: z.number().int().min(1900).max(2100).nullable().optional(),
  yearVerified: z.boolean().optional(),
  titleAliases: z.array(songText).max(20).optional(),
  artistAliases: z.array(songText).max(20).optional(),
  /** The song is never played (bad audio, wrong track, …). */
  disabled: z.boolean().optional(),
});
export type SongOverride = z.infer<typeof SongOverrideSchema>;

/** Applies admin overrides (later ones win). An override that would break the song is ignored. */
export function applySongOverrides(songs: readonly Song[], overrides: readonly SongOverride[]): Song[] {
  const byId = new Map<string, SongOverride>();
  for (const o of overrides) byId.set(o.id, { ...byId.get(o.id), ...o });
  return songs.flatMap((song) => {
    const o = byId.get(song.id);
    if (!o) return [song];
    if (o.disabled) return [];
    const next = {
      ...song,
      ...(o.originalYear !== undefined ? { originalYear: o.originalYear } : {}),
      ...(o.yearVerified !== undefined ? { yearVerified: o.yearVerified } : {}),
      ...(o.titleAliases ? { titleAliases: o.titleAliases } : {}),
      ...(o.artistAliases ? { artistAliases: o.artistAliases } : {}),
    };
    const parsed = SongSchema.safeParse(next);
    return [parsed.success ? parsed.data : song];
  });
}

/** Per genre: Deezer playlists to import and the years its songs plausibly come from. */
export const SongGenreConfigSchema = z.object({
  label: z.string().min(1),
  /** Deezer playlist ids (the host picks them from the candidates `pnpm songs:playlists` suggests). */
  deezerPlaylistIds: z.array(z.string().regex(/^\d+$/)),
  /** Search terms for the playlist candidates (`/search/playlist`). */
  searchQueries: z.array(z.string().min(1)).min(1),
  /** Plausible release years (inclusive) – a MusicBrainz year outside is not verified. Null: no check. */
  years: z.tuple([z.number().int(), z.number().int()]).nullable(),
  /** Game modes the genre's songs are played in. */
  modes: z.array(z.enum(SONG_MODES)).min(1),
});
export type SongGenreConfig = z.infer<typeof SongGenreConfigSchema>;

export const SongImportConfigSchema = z.object({
  /** Minimum Deezer rank (popularity) for a song to be imported and played. */
  minPopularity: z.number().int().min(0),
  /** Tracks taken per playlist (the most popular first). */
  maxTracksPerPlaylist: z.number().int().min(1).max(500),
  genres: z.record(z.enum(SONG_GENRE_IDS), SongGenreConfigSchema),
});
export type SongImportConfig = z.infer<typeof SongImportConfigSchema>;
