/**
 * THE party mix of every game: in Party mode a round of N items gets
 * max(1, ceil(N × partyShare)) items from the party pool (adult: true),
 * spread over the round; the rest comes from the family pool. Knowledge
 * games, estimate, Führerschein, Bluff, Skurril and every future game pick
 * through `selectWithPartyShare` – no per-game copies.
 */
import { difficultyWeight, partyCountFor, partyShareOf, type ModuleInitOptions } from "@couch-clash/shared";
import { pickFresh } from "./random";

export interface PartyPickable {
  id: string;
  difficulty: number;
  adult?: boolean;
}

export type PartyPickOptions = Pick<ModuleInitOptions, "excludeContentIds" | "mode" | "log"> & {
  /** CategoryMeta.modeNeutral: no party share, the whole round is picked like outside Party mode. */
  modeNeutral?: boolean;
};

/**
 * Where the party items go in a round of `n`: evenly spread, the first one
 * at position 0 or 1 (never all at the end).
 */
export function partySlots(n: number, count: number, random: () => number): number[] {
  if (count <= 0 || n <= 0) return [];
  const k = Math.min(count, n);
  const step = n / k;
  // Shift by one now and then – only when that can't push the last slot past the end.
  const start = step > 1 && random() < 0.5 ? 1 : 0;
  return Array.from({ length: k }, (_, j) => Math.floor(j * step + start));
}

/**
 * `count` items from `candidates` (already filtered by the mode): not played
 * recently first, weighted by difficulty. Party mode: the party share,
 * limited by the unplayed party items (logged when short), spread over the
 * round. Kids / Familie never see adult items (the mode filter removed them).
 */
export function selectWithPartyShare<T extends PartyPickable>(
  candidates: readonly T[],
  count: number,
  options: PartyPickOptions,
  random: () => number,
  /** Shows up in the log (e.g. the category id). */
  label = "content",
  /**
   * Picks and orders the non-party items (default: fresh first, weighted by
   * difficulty). Games with their own mix (e.g. Führerschein: text / sign /
   * scene) plug it in here – also used for the whole round outside Party mode.
   */
  pickFamily?: (items: readonly T[], n: number) => T[],
): T[] {
  const weight = (q: T) => difficultyWeight(q.difficulty, options.mode);
  const exclude = options.excludeContentIds ?? [];
  const pickRest = pickFamily ?? ((items: readonly T[], n: number) => pickFresh(items, n, exclude, random, weight));
  const share = partyShareOf(options.mode, options);
  if (share <= 0) return pickRest(candidates, count);

  const excluded = new Set(exclude);
  const party = candidates.filter((q) => q.adult);
  const family = candidates.filter((q) => !q.adult);
  const want = partyCountFor(count, share);
  const unplayed = party.filter((q) => !excluded.has(q.id));
  const fromParty = pickFresh(unplayed, want, exclude, random, weight);
  if (fromParty.length < want) {
    options.log?.("party pool too small – filling up from the family pool", {
      label,
      wanted: want,
      unplayedParty: unplayed.length,
      partyTotal: party.length,
    });
  }
  const fromFamily = pickRest(family, count - fromParty.length);
  // Family pool too small as well → played party items fill up (never crash, never short).
  const missing = count - fromParty.length - fromFamily.length;
  const refill = missing > 0 ? pickFresh(party.filter((q) => !fromParty.includes(q)), missing, exclude, random, weight) : [];

  const partyItems = [...fromParty, ...refill];
  const n = partyItems.length + fromFamily.length;
  const slots = new Set(partySlots(n, partyItems.length, random));
  const out: T[] = [];
  // One slot per party item, all within the round – both lists run out together.
  for (let i = 0; i < n; i++) out.push((slots.has(i) ? partyItems : fromFamily).shift()!);
  return out;
}

/** Is this item from the party pool? Raw content says `adult`, prepared questions `partyItem`. */
export function isPartyItem(item: unknown): boolean {
  const x = item as { adult?: unknown; partyItem?: unknown } | null | undefined;
  return x?.adult === true || x?.partyItem === true;
}
