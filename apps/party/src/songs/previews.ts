/**
 * Songs and fresh preview URLs for a Musik-Quiz round: the live catalog
 * (module task "song_catalog", Deezer playlists per genre) and previews for
 * songs from songs.json / test songs (module task "song_previews").
 * Deezer per track id first, iTunes (country DE, ~20 calls/min, cached) as
 * the fallback, local test files as they are. URLs are handed to the round
 * only – never stored (Deezer's carry expiring tokens).
 */
import {
  AppleMusicProvider,
  DeezerProvider,
  ITunesProvider,
  LocalProvider,
  RateLimiter,
  SONG_GENRE_IDS,
  SONG_IMPORT_CONFIG,
  TtlCache,
  foldText,
  liveSongCatalog,
  type Fetch,
  type LiveCatalogResult,
  type PlaylistInfo,
  type SongGenreId,
  type SongProvider,
  type SongProviderId,
  type TrackRef,
} from "@couch-clash/content";
import type { SongPreviewRequest } from "@couch-clash/shared";

export type PreviewLookup = (tracks: readonly SongPreviewRequest[]) => Promise<Record<string, string | null>>;

export const PREVIEW_CONFIG = {
  /** Tracks looked up at the same time. */
  parallel: 4,
  /** The game never waits long for a free iTunes slot. */
  itunesMaxWaitMs: 0,
} as const;

/** One per worker instance: the iTunes limit and cache are shared by every room on it. */
const itunesLimiter = new RateLimiter(20, 60_000);
const deezerLimiter = new RateLimiter(45, 5_000);

const playlistCache = new TtlCache<PlaylistInfo[]>(12 * 60 * 60_000);

export function createProviders(fetchFn: Fetch): Record<SongProviderId, SongProvider> & { itunes: ITunesProvider; deezer: DeezerProvider } {
  return {
    deezer: new DeezerProvider({ fetch: fetchFn, limiter: deezerLimiter }),
    itunes: new ITunesProvider({
      fetch: fetchFn,
      limiter: itunesLimiter,
      maxWaitMs: PREVIEW_CONFIG.itunesMaxWaitMs,
      same: (a, b) => foldText(a) === foldText(b),
    }),
    local: new LocalProvider(),
    applemusic: new AppleMusicProvider(),
  };
}

async function safe(provider: SongProvider, ref: TrackRef): Promise<string | null> {
  try {
    return await provider.preview(ref);
  } catch (err) {
    console.warn(`songs: ${provider.id} preview failed (${err instanceof Error ? err.message.slice(0, 60) : "error"})`);
    return null;
  }
}

export function createPreviewLookup(providers: Record<SongProviderId, SongProvider>): PreviewLookup {
  return async (tracks) => {
    const out: Record<string, string | null> = {};
    let i = 0;
    const worker = async () => {
      while (i < tracks.length) {
        const t = tracks[i++]!;
        const ref: TrackRef = { provider: t.provider, trackId: t.trackId, title: t.title, artist: t.artist, previewUrl: t.previewUrl ?? null };
        let url = await safe(providers[t.provider], ref);
        // Fallback: the same song at iTunes (never for the local test files).
        if (!url && t.provider !== "local" && t.provider !== "itunes") url = await safe(providers.itunes, ref);
        out[t.songId] = url;
      }
    };
    await Promise.all(Array.from({ length: PREVIEW_CONFIG.parallel }, worker));
    return out;
  };
}

export type SongCatalog = (input: { genres: readonly string[]; questions: number }) => Promise<LiveCatalogResult>;

/** Songs for a round, live from Deezer playlists of the genres (module task "song_catalog"). */
export function createSongCatalog(deezer: DeezerProvider): SongCatalog {
  return (input) =>
    liveSongCatalog(
      { genres: input.genres.filter((g): g is SongGenreId => (SONG_GENRE_IDS as readonly string[]).includes(g)), questions: input.questions },
      {
        source: deezer,
        config: SONG_IMPORT_CONFIG,
        random: Math.random,
        nowYear: new Date().getUTCFullYear(),
        playlistCache,
        log: (message) => console.warn(message),
      },
    );
}
