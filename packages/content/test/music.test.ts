import { describe, expect, it } from "vitest";
import {
  MUSIK_SONGS,
  MUSIK_TEST_SONGS,
  RateLimiter,
  SONG_GENRE_IDS,
  SONG_IMPORT_CONFIG,
  applySongOverrides,
  cleanTitle,
  dedupeKey,
  foldText,
  isUnwantedVersion,
  mergeDuplicates,
  pickOriginalYear,
  plausibleYear,
  songId,
  splitFeaturing,
  verifyYear,
  DeezerProvider,
  ITunesProvider,
  type Song,
} from "../src";

const base = MUSIK_TEST_SONGS[0]!;
const song = (patch: Partial<Song>): Song => ({ ...base, ...patch });

describe("song files", () => {
  it("load and cover every genre in the import config", () => {
    expect(MUSIK_SONGS).toBeInstanceOf(Array);
    expect(MUSIK_TEST_SONGS.length).toBeGreaterThanOrEqual(8);
    expect(Object.keys(SONG_IMPORT_CONFIG.genres).sort()).toEqual([...SONG_GENRE_IDS].sort());
  });

  it("kids songs are only in the kids genre config", () => {
    expect(SONG_IMPORT_CONFIG.genres.kinder?.modes).toEqual(["kids"]);
  });
});

describe("versions", () => {
  it.each([
    ["Take On Me (Live)", true],
    ["Layla - Acoustic", true],
    ["Macarena (Karaoke Version)", true],
    ["Sweet Dreams - Instrumental", true],
    ["Blue (Da Ba Dee) [Club Mix]", true],
    ["Live Is Life", false],
    ["Cover Me", false],
    ["Blue (Da Ba Dee) (Radio Mix)", false],
    ["Take On Me (Remastered 2015)", false],
  ])("%s → unwanted %s", (title, unwanted) => {
    expect(isUnwantedVersion(title)).toBe(unwanted);
  });

  it("drops karaoke and tribute artists", () => {
    expect(isUnwantedVersion("Atemlos", "Karaoke Party Band")).toBe(true);
    expect(isUnwantedVersion("Atemlos", "Helene Fischer")).toBe(false);
  });
});

describe("titles and artists", () => {
  it("cleans version suffixes but keeps real brackets", () => {
    expect(cleanTitle("Take On Me (Remastered 2015)")).toBe("Take On Me");
    expect(cleanTitle("Layla - Radio Edit")).toBe("Layla");
    expect(cleanTitle("Hey Baby (feat. DJ Ötzi) [Single Version]")).toBe("Hey Baby");
    expect(cleanTitle("(I Just) Died in Your Arms")).toBe("(I Just) Died in Your Arms");
    expect(cleanTitle("Mambo No. 5 (A Little Bit Of...)")).toBe("Mambo No. 5 (A Little Bit Of...)");
  });

  it("splits featured artists", () => {
    expect(splitFeaturing("Bausa feat. Joshi Mizu & Summer Cem")).toEqual({ main: "Bausa", featured: ["Joshi Mizu", "Summer Cem"] });
    expect(splitFeaturing("Die Toten Hosen")).toEqual({ main: "Die Toten Hosen", featured: [] });
  });

  it("folds umlauts, ß and punctuation", () => {
    expect(foldText("Über den Wolken!")).toBe("ueber den wolken");
    expect(foldText("Straße & Co.")).toBe("strasse und co");
  });

  it("gives the same key to remasters and features", () => {
    expect(dedupeKey("Skandal im Sperrbezirk (Remastered)", "Spider Murphy Gang")).toBe(dedupeKey("Skandal im Sperrbezirk", "Spider Murphy Gang"));
    expect(songId("99 Luftballons", "Nena")).toBe("song-nena-99-luftballons");
  });
});

describe("mergeDuplicates", () => {
  it("keeps the most popular entry and merges genres, modes and verified years", () => {
    const a = song({ id: "song-a", title: "Hey Baby", artist: "DJ Ötzi", popularity: 10, genres: ["ballermann"], modes: ["party"], originalYear: 2000, yearVerified: true });
    const b = song({ id: "song-a", title: "Hey Baby (Radio Edit)", artist: "DJ Ötzi", popularity: 99, genres: ["2000er"], modes: ["family"], originalYear: null, yearVerified: false });
    const [merged, ...rest] = mergeDuplicates([a, b]);
    expect(rest).toHaveLength(0);
    expect(merged!.popularity).toBe(99);
    expect(merged!.genres.sort()).toEqual(["2000er", "ballermann"]);
    expect(merged!.modes.sort()).toEqual(["family", "party"]);
    expect(merged!.originalYear).toBe(2000);
    expect(merged!.yearVerified).toBe(true);
  });

  it("keeps ids unique for different songs with the same slug", () => {
    const out = mergeDuplicates([song({ id: "song-x", title: "A", artist: "B" }), song({ id: "song-x", title: "C", artist: "D" })]);
    expect(new Set(out.map((s) => s.id)).size).toBe(2);
  });
});

describe("original year", () => {
  const hits = [
    { id: "1", score: 100, title: "Take On Me", artist: "a-ha", firstReleaseDate: "1985-04-01" },
    { id: "2", score: 100, title: "Take On Me", artist: "a-ha", firstReleaseDate: "1984" },
    { id: "3", score: 95, title: "Take On Me", artist: "a-ha", firstReleaseDate: "1984-10" },
    { id: "4", score: 100, title: "Take On Me (Live)", artist: "a-ha", firstReleaseDate: "1982" },
    { id: "5", score: 100, title: "Take On Me", artist: "A1", firstReleaseDate: "1980" },
  ];

  it("takes the earliest matching first release, ignoring live versions and other artists", () => {
    expect(pickOriginalYear(hits, "Take On Me (2015 Remaster)", "a-ha")).toEqual({ year: 1984, musicbrainzId: "2", agreeing: 2 });
  });

  it("checks the year against the genre", () => {
    const years = { "80er": { years: [1978, 1991] as [number, number] }, ballermann: { years: null } };
    expect(plausibleYear(1984, ["80er"], years, 2026)).toBe(true);
    expect(plausibleYear(2012, ["80er"], years, 2026)).toBe(false);
    expect(plausibleYear(2012, ["ballermann"], years, 2026)).toBe(true);
    expect(verifyYear({ year: 1984, musicbrainzId: "2", agreeing: 1 }, ["80er"], years, 2026)).toBe(false);
    expect(verifyYear({ year: 1984, musicbrainzId: "2", agreeing: 2 }, ["80er"], years, 2026)).toBe(true);
  });
});

describe("overrides", () => {
  it("apply admin corrections and never break a song", () => {
    const [s] = applySongOverrides([base], [{ kind: "song-override", id: base.id, originalYear: 1990, titleAliases: ["Samba"] }]);
    expect(s!.originalYear).toBe(1990);
    expect(s!.titleAliases).toEqual(["Samba"]);
    // Verified without a year would be invalid → ignored.
    const [t] = applySongOverrides([base], [{ kind: "song-override", id: base.id, originalYear: null, yearVerified: true }]);
    expect(t).toEqual(base);
    expect(applySongOverrides([base], [{ kind: "song-override", id: base.id, disabled: true }])).toEqual([]);
  });
});

describe("providers", () => {
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

  it("Deezer: fresh preview per track, errors in the body", async () => {
    const calls: string[] = [];
    const deezer = new DeezerProvider({
      fetch: (url) => {
        calls.push(url);
        if (url.endsWith("/track/1")) return json({ id: 1, title: "X", preview: "https://cdn/p.mp3?hdnea=exp", artist: { name: "Y" }, contributors: [{ name: "Y", role: "Main" }, { name: "Z", role: "Featured" }] });
        return json({ error: { code: 800, message: "no data" } });
      },
    });
    expect(await deezer.preview({ provider: "deezer", trackId: "1", title: "X", artist: "Y" })).toBe("https://cdn/p.mp3?hdnea=exp");
    expect((await deezer.track("1"))!.mainArtists).toEqual(["Y"]);
    expect(await deezer.preview({ provider: "deezer", trackId: "2", title: "X", artist: "Y" })).toBeNull();
    expect(calls[0]).toBe("https://api.deezer.com/track/1");
  });

  it("iTunes: searches artist + title in DE, caches, gives up when the rate limit is used up", async () => {
    let calls = 0;
    const itunes = new ITunesProvider({
      fetch: (url) => {
        calls++;
        expect(url).toContain("country=DE");
        return json({ results: [{ trackId: 5, trackName: "Hey Baby", artistName: "DJ Ötzi", previewUrl: "https://apple/p.m4a" }] });
      },
      limiter: new RateLimiter(1, 60_000),
      maxWaitMs: 0,
    });
    const ref = { provider: "deezer" as const, trackId: "9", title: "Hey Baby", artist: "DJ Ötzi" };
    expect(await itunes.preview(ref)).toBe("https://apple/p.m4a");
    expect(await itunes.preview(ref)).toBe("https://apple/p.m4a");
    expect(calls).toBe(1);
    expect(await itunes.preview({ ...ref, title: "Anton aus Tirol" })).toBeNull();
    expect(calls).toBe(1);
  });

  it("RateLimiter waits for a free slot", async () => {
    let t = 0;
    const slept: number[] = [];
    const limiter = new RateLimiter(2, 1_000, () => t, async (ms) => {
      slept.push(ms);
      t += ms;
    });
    await limiter.take();
    await limiter.take();
    await limiter.take();
    expect(slept).toEqual([1_001]);
  });
});
