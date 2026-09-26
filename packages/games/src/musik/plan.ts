/**
 * Which songs a round plays, and with which question type (pure).
 *
 * - Songs: mode (the song's own modes), picked genres (none = Zufall = all),
 *   never one of this game, songs of earlier games in the room only when the
 *   pool is too small, better known songs more likely.
 * - Types: active types (Kids: title only) by weight, never the same type
 *   twice in a row (unless only one type is left), a type whose pool is too
 *   small is drawn less often; every slot gets spare songs of its type (the
 *   first one with a preview plays).
 */
import type { GameModeSettings } from "@couch-clash/shared";
import { foldText, type Song } from "@couch-clash/content";
import { weightedShuffle } from "../random";
import { MUSIK_CONFIG, MUSIK_QUESTION_TYPE_IDS, type MusikQuestionTypeId } from "./meta";
import { QUESTION_TYPES } from "./question-types";

export function songFitsMode(song: Pick<Song, "modes">, mode: GameModeSettings["mode"]): boolean {
  if (mode === "kids") return song.modes.includes("kids");
  if (mode === "family") return song.modes.includes("family");
  return song.modes.includes("party") || song.modes.includes("family");
}

/** Party songs (only in Party mode) – kept apart for the voice and the admin page. */
export function isPartySong(song: Pick<Song, "modes">): boolean {
  return !song.modes.includes("kids") && !song.modes.includes("family");
}

export interface SongFilter {
  mode: GameModeSettings["mode"];
  /** Picked genres; empty = Zufall (every genre). */
  genres: ReadonlySet<string>;
  blocked?: ReadonlySet<string>;
  minPopularity?: number;
}

export function eligibleSongs(songs: readonly Song[], f: SongFilter): Song[] {
  return songs.filter(
    (s) =>
      songFitsMode(s, f.mode) &&
      (f.genres.size === 0 || s.genres.some((g) => f.genres.has(g))) &&
      !f.blocked?.has(s.id) &&
      s.popularity >= (f.minPopularity ?? 0),
  );
}

export interface PlannedSlot {
  type: MusikQuestionTypeId;
  /** First = planned song, then spares of the same type. */
  candidates: Song[];
}

export interface PlanOptions {
  count: number;
  /** Type → weight (0 or missing = off). Kids: { title: 1 }. */
  weights: Partial<Record<MusikQuestionTypeId, number>>;
  /** Played in this game – never again. */
  gameIds: ReadonlySet<string>;
  /** Played earlier in this room – only if the pool is too small. */
  sessionIds: ReadonlySet<string>;
  random: () => number;
  spares?: number;
}

const popularityWeight = (s: Song) => Math.log10(10 + s.popularity);

export function planRound(pool: readonly Song[], o: PlanOptions): PlannedSlot[] {
  const fresh = pool.filter((s) => !o.gameIds.has(s.id));
  const unplayed = fresh.filter((s) => !o.sessionIds.has(s.id));
  // Songs of earlier games only when the room has played through the rest.
  const usable = weightedShuffle(unplayed.length >= o.count ? unplayed : fresh, popularityWeight, o.random);
  const types = MUSIK_QUESTION_TYPE_IDS.filter((t) => (o.weights[t] ?? 0) > 0);
  const total = types.reduce((sum, t) => sum + (o.weights[t] ?? 0), 0);
  const spares = o.spares ?? MUSIK_CONFIG.sparesPerSlot;
  const used = new Set<string>();
  const slots: PlannedSlot[] = [];
  let prev: MusikQuestionTypeId | null = null;

  for (let i = 0; i < o.count; i++) {
    const left = (t: MusikQuestionTypeId) => usable.filter((s) => !used.has(s.id) && QUESTION_TYPES[t].fits(s));
    const open = types.map((t) => ({ t, songs: left(t) })).filter((x) => x.songs.length > 0);
    if (open.length === 0) break;
    const notPrev = open.filter((x) => x.t !== prev);
    const choices = notPrev.length ? notPrev : open;
    // A small pool for a type → drawn less often (share of what it would need for the rest of the round).
    const weightOf = (x: (typeof choices)[number]) => {
      const w = o.weights[x.t] ?? 0;
      const needed = ((o.count - i) * w) / Math.max(1, total);
      return w * Math.min(1, x.songs.length / Math.max(1, needed));
    };
    const pick = weightedPick(choices, weightOf, o.random) ?? choices[0]!;
    const [song, ...rest] = pick.songs;
    used.add(song!.id);
    slots.push({ type: pick.t, candidates: [song!, ...rest.slice(0, spares)] });
    prev = pick.t;
  }
  return slots;
}

function weightedPick<T>(items: readonly T[], weight: (item: T) => number, random: () => number): T | undefined {
  const total = items.reduce((sum, it) => sum + Math.max(0, weight(it)), 0);
  if (total <= 0) return items[Math.floor(random() * items.length)];
  let r = random() * total;
  for (const it of items) {
    r -= Math.max(0, weight(it));
    if (r < 0) return it;
  }
  return items.at(-1);
}

/**
 * Kids: four titles – the song and three others, from the same genre when
 * possible (then any kids song). Titles are compared folded (no doubles).
 */
export function kidsChoices(song: Song, pool: readonly Song[], random: () => number): { choices: string[]; correct: number } {
  const seen = new Set([foldText(song.title)]);
  const same = pool.filter((s) => s.id !== song.id && s.genres.some((g) => song.genres.includes(g)));
  const others = pool.filter((s) => s.id !== song.id && !same.includes(s));
  const picked: string[] = [];
  for (const group of [same, others]) {
    for (const s of weightedShuffle(group, () => 1, random)) {
      if (picked.length >= 3) break;
      const key = foldText(s.title);
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(s.title);
    }
  }
  const choices = weightedShuffle([song.title, ...picked], () => 1, random);
  return { choices, correct: choices.indexOf(song.title) };
}
