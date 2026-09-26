/**
 * Song providers behind one interface (`SongProvider`), so the audio source
 * can be swapped: Deezer is the default, iTunes the fallback, local test
 * files for development, Apple Music a stub for later.
 *
 * Every call goes out from the server – the Cloudflare Worker (fresh preview
 * URLs when a round starts) or the import script – never from a browser, and
 * none of them needs a key. `fetch` is injected (cost metering, tests).
 *
 * No runtime imports: the import script runs this file with Node's type
 * stripping.
 */
import type { SongProviderId } from "./schema";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** One track as a provider describes it. */
export interface ProviderTrack {
  provider: SongProviderId;
  trackId: string;
  title: string;
  /** Title without the version in brackets, where the provider has it (Deezer title_short). */
  titleShort: string;
  artist: string;
  /** Main artists (duets); featured artists are not in here. */
  mainArtists: string[];
  album: string | null;
  coverUrl: string | null;
  sourceUrl: string | null;
  previewUrl: string | null;
  /** Popularity (Deezer rank), null if unknown. */
  rank: number | null;
  /** Provider's release date – often a sampler or remaster: never used as the original year. */
  releaseDate: string | null;
  isrc: string | null;
}

export interface PlaylistInfo {
  id: string;
  title: string;
  trackCount: number;
  owner: string | null;
  url: string | null;
}

/** What the game needs to find a track's audio again. */
export interface TrackRef {
  provider: SongProviderId;
  trackId: string;
  title: string;
  artist: string;
  /** Local test songs: the file. */
  previewUrl?: string | null;
}

export interface SongProvider {
  readonly id: SongProviderId;
  /**
   * A fresh preview URL for this track, or null when there is none. Provider
   * URLs carry expiring tokens: ask right before a round, never store them.
   */
  preview(ref: TrackRef): Promise<string | null>;
  track?(trackId: string): Promise<ProviderTrack | null>;
  playlistTracks?(playlistId: string, limit?: number): Promise<ProviderTrack[]>;
  charts?(limit?: number): Promise<ProviderTrack[]>;
  searchPlaylists?(query: string, limit?: number): Promise<PlaylistInfo[]>;
}

export class ProviderError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** At most `max` calls per `windowMs` (sliding window); `take()` waits for a free slot. */
export class RateLimiter {
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private calls: number[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(max: number, windowMs: number, now: () => number = Date.now, sleep: (ms: number) => Promise<void> = defaultSleep) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
    this.sleep = sleep;
  }

  /** Free slots right now (without waiting). */
  available(): number {
    const t = this.now();
    this.calls = this.calls.filter((c) => t - c < this.windowMs);
    return Math.max(0, this.max - this.calls.length);
  }

  /** Waits (in call order) until a slot is free, then books it. */
  take(): Promise<void> {
    const turn = this.queue.then(async () => {
      for (;;) {
        const t = this.now();
        this.calls = this.calls.filter((c) => t - c < this.windowMs);
        if (this.calls.length < this.max) {
          this.calls.push(t);
          return;
        }
        await this.sleep(this.calls[0]! + this.windowMs - t + 1);
      }
    });
    this.queue = turn.catch(() => undefined);
    return turn;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Small time-bounded cache (per worker instance / script run). */
export class TtlCache<T> {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, { at: number; value: T }>();

  constructor(ttlMs: number, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  get(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T) {
    this.entries.set(key, { at: this.now(), value });
    // Bounded: drop the oldest entries.
    if (this.entries.size > 2_000) this.entries.delete(this.entries.keys().next().value!);
  }
}

async function getJson(fetchFn: Fetch, url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetchFn(url, init);
  if (!res.ok) throw new ProviderError(res.status, `HTTP ${res.status}`);
  return res.json();
}

// ── Deezer (default) ────────────────────────────────────────────────────

interface DeezerTrack {
  id: number;
  title: string;
  title_short?: string;
  link?: string;
  rank?: number;
  preview?: string;
  release_date?: string;
  isrc?: string;
  artist?: { name: string };
  album?: { title?: string; cover_medium?: string; cover_big?: string; release_date?: string };
  contributors?: { name: string; role?: string }[];
}

export const DEEZER_API = "https://api.deezer.com";

export function deezerTrack(t: DeezerTrack): ProviderTrack {
  const artist = t.artist?.name ?? "";
  const main = (t.contributors ?? []).filter((c) => (c.role ?? "Main") === "Main").map((c) => c.name);
  return {
    provider: "deezer",
    trackId: String(t.id),
    title: t.title,
    titleShort: t.title_short ?? t.title,
    artist,
    mainArtists: main.length ? [...new Set(main)] : [artist],
    album: t.album?.title ?? null,
    coverUrl: t.album?.cover_big ?? t.album?.cover_medium ?? null,
    sourceUrl: t.link ?? null,
    previewUrl: t.preview || null,
    rank: typeof t.rank === "number" ? t.rank : null,
    releaseDate: t.release_date ?? t.album?.release_date ?? null,
    isrc: t.isrc ?? null,
  };
}

/** Deezer answers errors with HTTP 200 and `{ error: { code, message } }`. */
function deezerData<T>(body: unknown): T {
  const error = (body as { error?: { code?: number; message?: string } } | null)?.error;
  if (error) throw new ProviderError(error.code === 4 ? 429 : error.code === 800 ? 404 : 502, error.message ?? "Deezer error");
  return body as T;
}

export interface DeezerOptions {
  fetch: Fetch;
  /** Deezer allows 50 calls per 5 s. */
  limiter?: RateLimiter;
}

export class DeezerProvider implements SongProvider {
  readonly id = "deezer" as const;
  private readonly fetchFn: Fetch;
  private readonly limiter: RateLimiter;

  constructor(opts: DeezerOptions) {
    this.fetchFn = opts.fetch;
    this.limiter = opts.limiter ?? new RateLimiter(45, 5_000);
  }

  private async call<T>(path: string): Promise<T> {
    await this.limiter.take();
    return deezerData<T>(await getJson(this.fetchFn, `${DEEZER_API}${path}`));
  }

  async track(trackId: string): Promise<ProviderTrack | null> {
    try {
      return deezerTrack(await this.call<DeezerTrack>(`/track/${encodeURIComponent(trackId)}`));
    } catch (err) {
      if (err instanceof ProviderError && err.status === 404) return null;
      throw err;
    }
  }

  async preview(ref: TrackRef): Promise<string | null> {
    return (await this.track(ref.trackId))?.previewUrl ?? null;
  }

  async playlistTracks(playlistId: string, limit = 500): Promise<ProviderTrack[]> {
    const out: ProviderTrack[] = [];
    for (let index = 0; out.length < limit; index += 100) {
      const page = await this.call<{ data?: DeezerTrack[]; next?: string }>(
        `/playlist/${encodeURIComponent(playlistId)}/tracks?index=${index}&limit=100`,
      );
      out.push(...(page.data ?? []).map(deezerTrack));
      if (!page.next || !page.data?.length) break;
    }
    return out.slice(0, limit);
  }

  async charts(limit = 100): Promise<ProviderTrack[]> {
    const page = await this.call<{ data?: DeezerTrack[] }>(`/chart/0/tracks?limit=${limit}`);
    return (page.data ?? []).map(deezerTrack);
  }

  async searchPlaylists(query: string, limit = 10): Promise<PlaylistInfo[]> {
    const page = await this.call<{ data?: { id: number; title: string; nb_tracks?: number; link?: string; user?: { name?: string } }[] }>(
      `/search/playlist?q=${encodeURIComponent(query)}&limit=${limit}`,
    );
    return (page.data ?? []).map((p) => ({
      id: String(p.id),
      title: p.title,
      trackCount: p.nb_tracks ?? 0,
      owner: p.user?.name ?? null,
      url: p.link ?? null,
    }));
  }
}

// ── iTunes (fallback, country DE) ────────────────────────────────────────

interface ITunesResult {
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName?: string;
  previewUrl?: string;
  artworkUrl100?: string;
  trackViewUrl?: string;
  releaseDate?: string;
}

export interface ITunesOptions {
  fetch: Fetch;
  /** Apple allows roughly 20 calls per minute. */
  limiter?: RateLimiter;
  cache?: TtlCache<string | null>;
  /** How long to wait for a free rate-limit slot before giving up (the game never waits long). */
  maxWaitMs?: number;
  /** Compares titles/artists (defaults to lower-case equality) – the game passes its answer folding. */
  same?: (a: string, b: string) => boolean;
}

export class ITunesProvider implements SongProvider {
  readonly id = "itunes" as const;
  private readonly fetchFn: Fetch;
  private readonly limiter: RateLimiter;
  private readonly cache: TtlCache<string | null>;
  private readonly maxWaitMs: number;
  private readonly same: (a: string, b: string) => boolean;

  constructor(opts: ITunesOptions) {
    this.fetchFn = opts.fetch;
    this.limiter = opts.limiter ?? new RateLimiter(20, 60_000);
    // Search results are stable; the preview files have no token.
    this.cache = opts.cache ?? new TtlCache(6 * 60 * 60_000);
    this.maxWaitMs = opts.maxWaitMs ?? Infinity;
    this.same = opts.same ?? ((a, b) => a.trim().toLowerCase() === b.trim().toLowerCase());
  }

  async search(term: string, limit = 10): Promise<ProviderTrack[]> {
    if (this.maxWaitMs !== Infinity && this.limiter.available() === 0) return [];
    await this.limiter.take();
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=DE&media=music&entity=song&limit=${limit}`;
    const body = (await getJson(this.fetchFn, url)) as { results?: ITunesResult[] };
    return (body.results ?? []).map((r) => ({
      provider: "itunes" as const,
      trackId: String(r.trackId),
      title: r.trackName,
      titleShort: r.trackName,
      artist: r.artistName,
      mainArtists: [r.artistName],
      album: r.collectionName ?? null,
      coverUrl: r.artworkUrl100 ? r.artworkUrl100.replace("100x100", "600x600") : null,
      sourceUrl: r.trackViewUrl ?? null,
      previewUrl: r.previewUrl ?? null,
      rank: null,
      releaseDate: r.releaseDate ?? null,
      isrc: null,
    }));
  }

  /** Looks the song up by artist + title (the track id of another provider means nothing here). */
  async preview(ref: TrackRef): Promise<string | null> {
    const key = `${ref.artist}|${ref.title}`.toLowerCase();
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const hits = await this.search(`${ref.artist} ${ref.title}`, 10);
    const hit =
      hits.find((h) => this.same(h.title, ref.title) && this.same(h.artist, ref.artist)) ??
      hits.find((h) => this.same(h.title, ref.title));
    const url = hit?.previewUrl ?? null;
    this.cache.set(key, url);
    return url;
  }
}

// ── Local test files (development and tests) ─────────────────────────────

/** Plays the files in apps/web/public/test-audio (the song's previewUrl). */
export class LocalProvider implements SongProvider {
  readonly id = "local" as const;
  async preview(ref: TrackRef): Promise<string | null> {
    return ref.previewUrl ?? null;
  }
}

// ── Apple Music (not built yet) ──────────────────────────────────────────

/** Placeholder for a later Apple Music integration (needs a developer token). Finds nothing. */
export class AppleMusicProvider implements SongProvider {
  readonly id = "applemusic" as const;
  async preview(): Promise<string | null> {
    return null;
  }
}

// ── MusicBrainz (original year, import only) ─────────────────────────────

export interface MusicBrainzOptions {
  fetch: Fetch;
  /** MusicBrainz asks for a meaningful User-Agent with contact info. */
  userAgent: string;
  /** 1 call per second. */
  limiter?: RateLimiter;
}

interface MbRecording {
  id: string;
  score?: number;
  title: string;
  "first-release-date"?: string;
  "artist-credit"?: { name?: string; artist?: { name?: string } }[];
}

export class MusicBrainzClient {
  private readonly fetchFn: Fetch;
  private readonly userAgent: string;
  private readonly limiter: RateLimiter;

  constructor(opts: MusicBrainzOptions) {
    this.fetchFn = opts.fetch;
    this.userAgent = opts.userAgent;
    this.limiter = opts.limiter ?? new RateLimiter(1, 1_100);
  }

  /** Recordings matching title and artist, with their first release date. */
  async searchRecordings(title: string, artist: string, limit = 25) {
    const esc = (s: string) => s.replace(/(["\\])/g, "\\$1");
    const query = `recording:"${esc(title)}" AND artist:"${esc(artist)}"`;
    await this.limiter.take();
    const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}`;
    const body = (await getJson(this.fetchFn, url, { headers: { "User-Agent": this.userAgent, Accept: "application/json" } })) as {
      recordings?: MbRecording[];
    };
    return (body.recordings ?? []).map((r) => ({
      id: r.id,
      score: r.score ?? 0,
      title: r.title,
      artist: (r["artist-credit"] ?? []).map((c) => c.name ?? c.artist?.name ?? "").join(" "),
      firstReleaseDate: r["first-release-date"] || null,
    }));
  }
}
