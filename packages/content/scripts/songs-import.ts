/**
 * `pnpm songs:import` – builds the Musik-Quiz song database
 * (packages/content/data/musik/songs.json, commit it afterwards):
 *
 *   1. Deezer playlists per genre (data/musik/genres.json) → tracks
 *   2. filter: popularity ≥ minPopularity, no live / remix / karaoke /
 *      instrumental / cover versions, a preview must exist
 *   3. duplicates merged (same clean title + main artist)
 *   4. original year from MusicBrainz (recording → first-release-date,
 *      1 request per second, own User-Agent) – never Deezer's release date,
 *      which is often a sampler or remaster; plausibility check against the
 *      genre, in doubt yearVerified = false (the admin page confirms it)
 *
 * Preview URLs are never stored (they carry expiring tokens) – the worker
 * fetches them fresh per track when a round starts.
 *
 * Idempotent: songs already in the file keep their year, aliases and members
 * (hand edits survive). Runs with Node ≥ 22.18 (type stripping):
 *
 *   pnpm songs:import                          # every genre with playlist ids
 *   pnpm songs:import --genre 80er --genre ndw # only these
 *   pnpm songs:import --refresh-years          # ask MusicBrainz again for unverified years
 *   pnpm songs:import --dry-run                # print, don't write
 *   MUSICBRAINZ_CONTACT=me@example.org pnpm songs:import
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanTitle, isUnwantedVersion, mergeDuplicates, pickOriginalYear, songId, splitFeaturing, verifyYear } from "../src/music/import-rules.ts";
import { DeezerProvider, MusicBrainzClient, type ProviderTrack } from "../src/music/providers.ts";
import { SongFileSchema, SongImportConfigSchema, SongSchema, type Song, type SongGenreId } from "../src/music/schema.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const songsPath = join(root, "data/musik/songs.json");
const config = SongImportConfigSchema.parse(JSON.parse(readFileSync(join(root, "data/musik/genres.json"), "utf8")));

const args = process.argv.slice(2);
const only = new Set(args.flatMap((a, i) => (a === "--genre" && args[i + 1] ? [args[i + 1]!] : [])));
const dryRun = args.includes("--dry-run");
const refreshYears = args.includes("--refresh-years");
const contact = process.env.MUSICBRAINZ_CONTACT ?? "https://github.com/phiju/couch-clash";
const userAgent = `CouchClash-SongImport/1.0 ( ${contact} )`;
const nowYear = new Date().getFullYear();

const deezer = new DeezerProvider({ fetch });
const musicbrainz = new MusicBrainzClient({ fetch, userAgent });

const existing = new Map<string, Song>(SongFileSchema.parse(JSON.parse(readFileSync(songsPath, "utf8"))).items.map((s) => [s.id, s]));

function save(songs: readonly Song[]) {
  if (dryRun) return;
  const items = [...songs].sort((a, b) => a.id.localeCompare(b.id));
  const file = { category: "musik", importedAt: new Date().toISOString(), items };
  SongFileSchema.parse(file);
  writeFileSync(songsPath, `${JSON.stringify(file, null, 2)}\n`);
}

/** One playlist track → a song candidate (year comes later). */
function candidate(track: ProviderTrack, genre: SongGenreId): Song | null {
  const title = cleanTitle(track.titleShort || track.title);
  const { main } = splitFeaturing(track.artist);
  const id = songId(title, track.artist);
  const old = existing.get(id);
  const song = {
    id,
    title,
    titleAliases: old?.titleAliases ?? [],
    artist: main,
    artistAliases: old?.artistAliases ?? [],
    mainArtists: old?.mainArtists ?? [main],
    members: old?.members ?? [],
    coverUrl: track.coverUrl,
    provider: "deezer" as const,
    providerTrackId: track.trackId,
    sourceUrl: track.sourceUrl,
    previewUrl: null,
    originalYear: old?.originalYear ?? null,
    yearVerified: old?.yearVerified ?? false,
    popularity: track.rank ?? 0,
    genres: [...new Set([...(old?.genres ?? []), genre])],
    modes: [...new Set([...(old?.modes ?? []), ...config.genres[genre]!.modes])],
    musicbrainzId: old?.musicbrainzId ?? null,
  };
  const parsed = SongSchema.safeParse(song);
  if (!parsed.success) {
    console.warn(`  ✗ ${track.artist} – ${track.title}: ${parsed.error.issues[0]?.message}`);
    return null;
  }
  return parsed.data;
}

async function main() {
  const genres = (Object.keys(config.genres) as SongGenreId[]).filter((g) => only.size === 0 || only.has(g));
  const found: Song[] = [];
  for (const genre of genres) {
    const g = config.genres[genre]!;
    if (g.deezerPlaylistIds.length === 0) {
      console.log(`– ${g.label}: no playlist ids yet (pnpm songs:playlists suggests some)`);
      continue;
    }
    for (const playlistId of g.deezerPlaylistIds) {
      const tracks = await deezer.playlistTracks(playlistId, 500);
      const kept = tracks
        .filter((t) => (t.rank ?? 0) >= config.minPopularity && t.previewUrl && !isUnwantedVersion(t.title, t.artist))
        .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
        .slice(0, config.maxTracksPerPlaylist);
      console.log(`✓ ${g.label} · playlist ${playlistId}: ${kept.length} of ${tracks.length} tracks kept`);
      for (const track of kept) {
        // Duets / "feat.": the main artists come with the track details.
        const details = await deezer.track(track.trackId).catch(() => null);
        const song = candidate(details ?? track, genre);
        if (song) found.push(details && details.mainArtists.length > 1 && !existing.has(song.id) ? { ...song, mainArtists: details.mainArtists } : song);
      }
    }
  }

  // Songs of genres not imported this time stay as they are.
  const untouched = [...existing.values()].filter((s) => !s.genres.some((g) => genres.includes(g)));
  const songs = mergeDuplicates([...found, ...untouched]);
  console.log(`\n${songs.length} songs after merging duplicates – looking up original years …`);

  let asked = 0;
  for (const [i, song] of songs.entries()) {
    if (song.yearVerified || (song.originalYear !== null && !refreshYears)) continue;
    const hits = await musicbrainz.searchRecordings(cleanTitle(song.title), song.mainArtists[0] ?? song.artist).catch((err: unknown) => {
      console.warn(`  ✗ MusicBrainz ${song.id}: ${err instanceof Error ? err.message : "error"}`);
      return [];
    });
    asked++;
    const pick = pickOriginalYear(hits, song.title, song.mainArtists[0] ?? song.artist);
    const verified = verifyYear(pick, song.genres, config.genres, nowYear);
    songs[i] = { ...song, originalYear: pick.year, yearVerified: verified, musicbrainzId: pick.musicbrainzId };
    console.log(`  ${verified ? "✓" : "?"} ${song.artist} – ${song.title}: ${pick.year ?? "kein Jahr"}${verified ? "" : " (prüfen)"}`);
    if (asked % 20 === 0) save(songs);
  }

  save(songs);
  const unverified = songs.filter((s) => !s.yearVerified).length;
  console.log(`\n${dryRun ? "(dry run) " : ""}${songs.length} songs, ${unverified} without a verified year → /admin/songs`);
}

await main();
