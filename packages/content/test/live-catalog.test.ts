import { describe, expect, it } from "vitest";
import { SONG_IMPORT_CONFIG, TtlCache, albumYear, liveSongCatalog, type AlbumInfo, type LiveCatalogSource, type PlaylistInfo, type ProviderTrack } from "../src";

const track = (n: number, patch: Partial<ProviderTrack> = {}): ProviderTrack => ({
  provider: "deezer",
  trackId: String(n),
  title: `Song ${n}`,
  titleShort: `Song ${n}`,
  artist: `Artist ${n}`,
  mainArtists: [`Artist ${n}`],
  album: `Album ${n}`,
  albumId: String(9000 + n),
  coverUrl: null,
  sourceUrl: null,
  previewUrl: `https://cdn.example/${n}.mp3?hdnea=exp`,
  rank: 900_000 - n * 1_000,
  releaseDate: null,
  isrc: null,
  ...patch,
});

function fakeSource(tracks: ProviderTrack[], albums: Record<string, AlbumInfo> = {}) {
  const calls = { search: [] as string[], playlist: [] as string[], album: [] as string[] };
  const source: LiveCatalogSource = {
    async searchPlaylists(query) {
      calls.search.push(query);
      return [
        { id: "1", title: "too small", trackCount: 5, owner: null, url: null },
        { id: "2", title: query, trackCount: 80, owner: null, url: null },
      ] satisfies PlaylistInfo[];
    },
    async playlistTracks(id) {
      calls.playlist.push(id);
      return tracks;
    },
    async album(id) {
      calls.album.push(id);
      return albums[id] ?? null;
    },
  };
  return { source, calls };
}

const deps = (source: LiveCatalogSource, cache?: TtlCache<PlaylistInfo[]>) => ({
  source,
  config: SONG_IMPORT_CONFIG,
  random: () => 0,
  nowYear: 2026,
  playlistCache: cache,
});

describe("live song catalog", () => {
  it("takes the best known usable tracks of a genre's playlist, each with its fresh preview", async () => {
    const tracks = [
      track(1),
      track(2, { title: "Song 2 (Live)" }),
      track(3, { previewUrl: null }),
      track(4, { title: "Song 4 - Remastered 2011", titleShort: "Song 4" }),
      track(5, { artist: "Karaoke Party Band" }),
    ];
    const { source, calls } = fakeSource(tracks);
    const r = await liveSongCatalog({ genres: ["90er"], questions: 3 }, deps(source));
    expect(calls.playlist).toEqual(["2"]);
    expect(r.songs.map((s) => s.title)).toEqual(["Song 1", "Song 4"]);
    expect(r.songs.every((s) => s.genres[0] === "90er" && s.modes.includes("family"))).toBe(true);
    expect(r.previews[r.songs[0]!.id]).toBe("https://cdn.example/1.mp3?hdnea=exp");
  });

  it("year only from an original album or single that fits the genre", async () => {
    const tracks = [track(1), track(2), track(3), track(4, { album: "Greatest Hits" })];
    const { source, calls } = fakeSource(tracks, {
      "9001": { id: "9001", title: "Album 1", recordType: "album", releaseDate: "1994-05-01" },
      "9002": { id: "9002", title: "Bravo Hits 90", recordType: "compile", releaseDate: "2015-01-01" },
      "9003": { id: "9003", title: "Album 3", recordType: "single", releaseDate: "2019-01-01" },
    });
    const r = await liveSongCatalog({ genres: ["90er"], questions: 3 }, deps(source));
    const byTitle = Object.fromEntries(r.songs.map((s) => [s.title, s]));
    expect(byTitle["Song 1"]).toMatchObject({ originalYear: 1994, yearVerified: true });
    expect(byTitle["Song 2"]).toMatchObject({ originalYear: null, yearVerified: false });
    // 2019 is not a 90s year: kept, but not asked as a year question.
    expect(byTitle["Song 3"]).toMatchObject({ originalYear: 2019, yearVerified: false });
    // A best-of album is not even looked up.
    expect(calls.album).not.toContain("9004");
  });

  it("playlist searches are cached; a failing genre doesn't stop the others", async () => {
    const { source, calls } = fakeSource([track(1)]);
    const cache = new TtlCache<PlaylistInfo[]>(60_000);
    await liveSongCatalog({ genres: ["90er"], questions: 1 }, deps(source, cache));
    await liveSongCatalog({ genres: ["90er"], questions: 1 }, deps(source, cache));
    expect(calls.search).toHaveLength(1);
    const failing: LiveCatalogSource = {
      ...source,
      searchPlaylists: async (query) => [{ id: query.includes("80") ? "80" : "90", title: query, trackCount: 50, owner: null, url: null }],
      playlistTracks: async (id) => (id === "80" ? Promise.reject(new Error("HTTP 429")) : [track(7)]),
    };
    const r = await liveSongCatalog({ genres: ["80er", "90er"], questions: 2 }, deps(failing));
    expect(r.songs.map((s) => s.title)).toEqual(["Song 7"]);
  });

  it("no genres → nothing asked", async () => {
    const { source, calls } = fakeSource([track(1)]);
    expect(await liveSongCatalog({ genres: [], questions: 5 }, deps(source))).toEqual({ songs: [], previews: {} });
    expect(calls.search).toHaveLength(0);
  });

  it("albumYear skips samplers and re-releases", () => {
    expect(albumYear({ id: "1", title: "Alles nur geklaut", recordType: "album", releaseDate: "1993-01-01" })).toBe(1993);
    expect(albumYear({ id: "1", title: "30 Jahre – Deluxe Edition", recordType: "album", releaseDate: "2020-01-01" })).toBeNull();
    expect(albumYear({ id: "1", title: "Party", recordType: "compile", releaseDate: "2020-01-01" })).toBeNull();
    expect(albumYear(null)).toBeNull();
  });
});
