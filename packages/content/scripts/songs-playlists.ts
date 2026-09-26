/**
 * `pnpm songs:playlists` – suggests Deezer playlists per genre: the search
 * terms of data/musik/genres.json → /search/playlist, the biggest 2–3
 * candidates with their track count and a few example songs. Pick the ones
 * you like and put their ids into `deezerPlaylistIds`, then run
 * `pnpm songs:import`.
 *
 *   pnpm songs:playlists                   # every genre
 *   pnpm songs:playlists --genre 80er      # one genre
 *   pnpm songs:playlists --count 3 --json  # machine-readable
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isUnwantedVersion } from "../src/music/import-rules.ts";
import { DeezerProvider, type PlaylistInfo } from "../src/music/providers.ts";
import { SongImportConfigSchema, type SongGenreId } from "../src/music/schema.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = SongImportConfigSchema.parse(JSON.parse(readFileSync(join(root, "data/musik/genres.json"), "utf8")));
const args = process.argv.slice(2);
const only = new Set(args.flatMap((a, i) => (a === "--genre" && args[i + 1] ? [args[i + 1]!] : [])));
const countArg = args.indexOf("--count");
const count = countArg >= 0 ? Number(args[countArg + 1]) || 3 : 3;
const asJson = args.includes("--json");

const deezer = new DeezerProvider({ fetch });
const result: Record<string, (PlaylistInfo & { popularTracks: number; examples: string[] })[]> = {};

for (const genre of Object.keys(config.genres) as SongGenreId[]) {
  if (only.size && !only.has(genre)) continue;
  const g = config.genres[genre]!;
  const seen = new Map<string, PlaylistInfo>();
  for (const q of g.searchQueries) {
    for (const p of await deezer.searchPlaylists(q, 10)) if (p.trackCount >= 30) seen.set(p.id, p);
  }
  const ranked = [...seen.values()].sort((a, b) => b.trackCount - a.trackCount).slice(0, count * 3);
  const scored = [];
  for (const p of ranked) {
    const tracks = await deezer.playlistTracks(p.id, 100);
    const popular = tracks.filter((t) => (t.rank ?? 0) >= config.minPopularity && !isUnwantedVersion(t.title, t.artist));
    scored.push({ ...p, popularTracks: popular.length, examples: popular.slice(0, 5).map((t) => `${t.artist} – ${t.titleShort}`) });
  }
  // The most well-known songs first (a big playlist full of unknown tracks is no help).
  result[genre] = scored.sort((a, b) => b.popularTracks - a.popularTracks).slice(0, count);
}

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  for (const [genre, list] of Object.entries(result)) {
    console.log(`\n## ${config.genres[genre as SongGenreId]!.label}`);
    for (const p of list) {
      console.log(`- ${p.title} (id ${p.id}) · ${p.trackCount} Tracks, ${p.popularTracks} bekannte · ${p.owner ?? "?"}`);
      for (const e of p.examples) console.log(`    · ${e}`);
    }
  }
}
