import type { AdminSong } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { currentBuzzPoints, musikAudio, musikSkipLabel, songTarget, timelineTicks, yearTimeline } from "../src/games/musik/logic";
import { filterSongs, parseAliases, yearEdit } from "../src/lib/admin-songs";

const clip = { url: "/test-audio/x.wav", startedAt: 1_000, pausedAt: null, lengthMs: 30_000, loop: false };

describe("Musik-Quiz views", () => {
  it("no background music while a song plays; stings on announce and solution", () => {
    expect(musikAudio({ step: "announce", index: 0 })).toMatchObject({ music: null, enter: "sting-short" });
    expect(musikAudio({ step: "play", index: 0 })).toMatchObject({ music: null });
    expect(musikAudio({ step: "answer", index: 0 })!.key).toBe(musikAudio({ step: "play", index: 0 })!.key);
    expect(musikAudio({ step: "reveal", index: 0 })).toMatchObject({ enter: "sting" });
    expect(musikAudio({ step: "leaderboard", index: 0 })).toMatchObject({ music: "lobby" });
  });

  it("the host's button: „Auflösen“ while a song plays (Kids too), none while loading", () => {
    expect(musikSkipLabel({ step: "play", input: "choice" })).toBe("Auflösen ⏭");
    expect(musikSkipLabel({ step: "loading", input: "buzzer" })).toBeNull();
  });

  it("song target: plays with the server, pauses at the buzz, plays on softly under the solution", () => {
    expect(songTarget({ step: "play", clip }, 6_000)).toEqual({ url: clip.url, playing: true, positionMs: 5_000, loop: false });
    const paused = { ...clip, pausedAt: 4_200 };
    expect(songTarget({ step: "answer", clip: paused }, 9_000)).toMatchObject({ playing: false, positionMs: 4_200 });
    expect(songTarget({ step: "reveal", clip: paused }, 9_000)).toMatchObject({ playing: true, level: 0.6, follow: false });
    expect(songTarget({ step: "leaderboard", clip }, 9_000)).toBeNull();
    expect(songTarget({ step: "play", clip: { ...clip, url: null } }, 9_000)).toBeNull();
  });

  it("buzz points on the TV match the server formula", () => {
    const rule = { fast: 200, slow: 50, fastMs: 5_000, clipMs: 30_000 };
    expect(currentBuzzPoints(rule, 3_000)).toBe(200);
    expect(currentBuzzPoints(rule, 17_500)).toBe(125);
    expect(currentBuzzPoints(rule, 30_000)).toBe(50);
  });

  it("timeline: axis around year and tips, equal tips stacked", () => {
    const t = yearTimeline({ a: 1984, b: 1984, c: 1990 }, 1986);
    expect([t.from, t.to]).toEqual([1982, 1992]);
    expect(t.marks.map((m) => [m.playerId, m.row])).toEqual([["a", 0], ["b", 1], ["c", 0]]);
    expect(t.x(1982)).toBe(0);
    expect(t.x(1992)).toBe(100);
    expect(timelineTicks(1982, 1992)).toHaveLength(11);
    expect(timelineTicks(1950, 2020)).toEqual([1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020]);
  });
});

describe("admin songs", () => {
  const song = (patch: Partial<AdminSong>): AdminSong => ({
    id: "song-a",
    title: "Hulapalu",
    titleAliases: [],
    artist: "Andreas Gabalier",
    artistAliases: [],
    coverUrl: null,
    provider: "deezer",
    sourceUrl: null,
    originalYear: 2015,
    yearVerified: false,
    popularity: 10,
    genres: ["schlager-party"],
    modes: ["family"],
    musicbrainzId: null,
    edited: false,
    disabled: false,
    ...patch,
  });
  const songs = [song({}), song({ id: "song-b", title: "Atemlos", artist: "Helene Fischer", yearVerified: true, popularity: 99, genres: ["schlager-party", "ballermann"] })];

  it("filters: without verified year, genre, search (accents ignored)", () => {
    const base = { search: "", genre: "", unverifiedOnly: false, showDisabled: true };
    expect(filterSongs(songs, base).map((s) => s.id)).toEqual(["song-b", "song-a"]);
    expect(filterSongs(songs, { ...base, unverifiedOnly: true }).map((s) => s.id)).toEqual(["song-a"]);
    expect(filterSongs(songs, { ...base, genre: "ballermann" }).map((s) => s.id)).toEqual(["song-b"]);
    expect(filterSongs(songs, { ...base, search: "hélène" }).map((s) => s.id)).toEqual(["song-b"]);
  });

  it("aliases and year edits", () => {
    expect(parseAliases(" Hulapalu-Song ,, Hulapalu-Song, Hula ")).toEqual(["Hulapalu-Song", "Hula"]);
    expect(yearEdit("2015", true)).toEqual({ originalYear: 2015, yearVerified: true });
    expect(yearEdit("2016", false)).toEqual({ originalYear: 2016, yearVerified: false });
    expect(yearEdit("", false)).toEqual({ originalYear: null, yearVerified: false });
    expect(yearEdit("", true)).toBeNull();
    expect(yearEdit("neunzehn", true)).toBeNull();
  });
});
