import { MUSIK_TEST_SONGS, RateLimiter, type SongOverride, type SongProvider } from "@couch-clash/content";
import type { MusikEvent } from "@couch-clash/games";
import type { AdminSongsResponse, SongPreviewRequest } from "@couch-clash/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { handleAdminSongs } from "../src/songs/admin";
import { createPreviewLookup } from "../src/songs/previews";
import type { SongOverrideStore } from "../src/songs/store";
import { invalidateContentFilter, loadContentFilter } from "../src/stats/content-filter";
import { MUSIK_LINES, MUSIK_SITUATIONS } from "../src/voice/musik-lines";
import { chooseMusikLine, createMusikMemory, musikTexts } from "../src/voice/musik-voice";
import { sqliteStore } from "./stats-helpers";

const T0 = 1_750_000_000_000;

beforeEach(() => invalidateContentFilter());

function memoryStore(initial: SongOverride[] = []): SongOverrideStore & { rows: SongOverride[] } {
  const rows = [...initial];
  return {
    rows,
    list: async () => [...rows],
    put: async (o) => {
      const i = rows.findIndex((r) => r.id === o.id);
      if (i >= 0) rows[i] = o;
      else rows.push(o);
    },
  };
}

describe("preview lookup", () => {
  const track = (songId: string, provider: SongPreviewRequest["provider"], previewUrl: string | null = null): SongPreviewRequest => ({
    songId,
    provider,
    trackId: songId,
    title: `T ${songId}`,
    artist: "A",
    previewUrl,
  });
  const provider = (id: SongProvider["id"], urls: Record<string, string | null>, calls: string[]): SongProvider => ({
    id,
    preview: async (ref) => {
      calls.push(`${id}:${ref.trackId}`);
      if (ref.trackId === "boom") throw new Error("down");
      return urls[ref.trackId] ?? null;
    },
  });

  it("Deezer first, iTunes as the fallback, local files as they are, errors → null", async () => {
    const calls: string[] = [];
    const lookup = createPreviewLookup({
      deezer: provider("deezer", { d1: "https://dz/1.mp3?exp" }, calls),
      itunes: provider("itunes", { d2: "https://apple/2.m4a" }, calls),
      local: { id: "local", preview: async (ref) => ref.previewUrl ?? null },
      applemusic: provider("applemusic", {}, calls),
    });
    const out = await lookup([track("d1", "deezer"), track("d2", "deezer"), track("l1", "local", "/test-audio/x.wav"), track("boom", "deezer")]);
    expect(out).toEqual({ d1: "https://dz/1.mp3?exp", d2: "https://apple/2.m4a", l1: "/test-audio/x.wav", boom: null });
    expect(calls).not.toContain("itunes:d1");
    expect(calls).not.toContain("itunes:l1");
  });

  it("RateLimiter keeps iTunes at ~20 calls per minute", async () => {
    const limiter = new RateLimiter(20, 60_000, () => 0);
    await Promise.all(Array.from({ length: 20 }, () => limiter.take()));
    expect(limiter.available()).toBe(0);
  });
});

describe("content filter", () => {
  it("adds admin corrections to the Musik-Quiz's extra content", async () => {
    const { store } = sqliteStore();
    const songs = memoryStore([{ kind: "song-override", id: "song-x", originalYear: 1990 }]);
    const filter = await loadContentFilter(store, T0, songs);
    expect(filter!.extra.musik).toEqual([{ kind: "song-override", id: "song-x", originalYear: 1990 }]);
  });
});

describe("admin songs", () => {
  const songs = MUSIK_TEST_SONGS;
  const call = async (store: SongOverrideStore | null, path: string, init: RequestInit = {}) => {
    const request = new Request(`https://party.test${path}`, init);
    return (await handleAdminSongs(request, new URL(request.url), store, T0, songs))!;
  };
  const put = (body: unknown): RequestInit => ({ method: "PUT", body: JSON.stringify(body) });

  it("lists songs with their corrections; 503 without a database", async () => {
    const store = memoryStore([{ kind: "song-override", id: songs[0]!.id, originalYear: 1990, disabled: true }]);
    const body = (await (await call(store, "/api/admin/songs")).json()) as AdminSongsResponse;
    expect(body.songs).toHaveLength(songs.length);
    expect(body.songs[0]).toMatchObject({ originalYear: 1990, edited: true, disabled: true });
    expect((await call(null, "/api/admin/songs")).status).toBe(503);
  });

  it("corrects and confirms a year, keeps aliases; merges with earlier corrections", async () => {
    const store = memoryStore();
    const id = songs.find((s) => !s.yearVerified)!.id;
    expect((await call(store, `/api/admin/songs/${id}`, put({ originalYear: 2011 }))).status).toBe(200);
    expect((await call(store, `/api/admin/songs/${id}`, put({ yearVerified: true, artistAliases: ["Pieper"] }))).status).toBe(200);
    expect(store.rows).toEqual([{ kind: "song-override", id, originalYear: 2011, yearVerified: true, artistAliases: ["Pieper"] }]);
  });

  it("refuses bad input", async () => {
    const store = memoryStore();
    const id = songs[0]!.id;
    expect((await call(store, "/api/admin/songs/song-unknown", put({ originalYear: 2000 }))).status).toBe(404);
    expect((await call(store, `/api/admin/songs/${id}`, put({ originalYear: "neunzehn" }))).status).toBe(400);
    expect((await call(store, `/api/admin/songs/${id}`, put({ originalYear: null, yearVerified: true }))).status).toBe(400);
    expect((await call(store, `/api/admin/songs/${id}`, put({ sneaky: 1 }))).status).toBe(400);
  });
});

describe("Musik voice", () => {
  const ev = (type: MusikEvent["type"], questionType: MusikEvent["questionType"], seq: number, playerId?: string, at = T0): MusikEvent => ({
    seq,
    type,
    at,
    index: 0,
    questionType,
    ...(playerId ? { playerId } : {}),
  });
  const input = { mode: "family" as const, names: { a: "Tina" }, now: T0 + 100, random: () => 0, ready: () => true };

  it("every situation has lines for the modes that use it", () => {
    for (const s of MUSIK_SITUATIONS) {
      const pools = MUSIK_LINES[s];
      expect(pools.family.length + pools.kids.length, s).toBeGreaterThan(0);
    }
  });

  it("announces the question type (even right after another line)", () => {
    const busy = { ...createMusikMemory(), lastSpokenAt: T0 };
    const { pick } = chooseMusikLine([ev("ANNOUNCE", "year", 1)], busy, input);
    expect(MUSIK_LINES.announceYear.family).toContain(pick!.text);
    const kids = chooseMusikLine([ev("ANNOUNCE", "kids", 2)], createMusikMemory(), { ...input, mode: "kids" });
    expect(MUSIK_LINES.announceKids.kids).toContain(kids.pick!.text);
  });

  it("names the player on a wrong buzz; no repeats of the last 3", () => {
    let memory = createMusikMemory();
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const r = chooseMusikLine([ev("WRONG", "title", i + 1, "a", T0 + i * 5_000)], memory, { ...input, now: T0 + 100 + i * 5_000, random: () => 0 });
      expect(r.pick!.text).toContain("Tina");
      if (i < 3) expect(seen.has(r.pick!.text)).toBe(false);
      seen.add(r.pick!.text);
      memory = r.memory;
    }
  });

  it("only lines with audio ready; old events are dropped", () => {
    expect(chooseMusikLine([ev("NOBODY", "title", 1)], createMusikMemory(), { ...input, ready: () => false }).pick).toBeNull();
    expect(chooseMusikLine([ev("NOBODY", "title", 1)], createMusikMemory(), { ...input, now: T0 + 10_000 }).pick).toBeNull();
  });

  it("warm-up: announcements first, names filled in", () => {
    const texts = musikTexts("family", { a: "Tina" });
    expect(texts.announce).toContain("Wie heißt der Song?");
    expect([...texts.first, ...texts.rest].every((t) => !t.includes("{name}"))).toBe(true);
    expect(musikTexts("kids", {}).announce.every((t) => MUSIK_LINES.announceKids.kids.includes(t))).toBe(true);
  });
});
