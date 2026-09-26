/**
 * The difficulty ladder of Double or Nothing: question n has level n
 * (1 easy … 5 very hard), measured within the mode's own pool – level 5 in
 * Kids mode is hard for children, not for adults.
 */
import type { QuizQuestion } from "@couch-clash/content";
import { partyCountFor, partyShareOf, type GameMode, type ModuleInitOptions } from "@couch-clash/shared";
import { partySlots } from "../party-share";
import { shuffle } from "../random";
import { DOUBLE_CONFIG } from "./meta";

/** Level of a question in this mode. Items without a level (e.g. generated ones) fall back to their difficulty (1–3). */
export function ladderLevel(q: Pick<QuizQuestion, "difficulty" | "level" | "kidsLevel">, mode: GameMode): number {
  const own = mode === "kids" ? q.kidsLevel : q.level;
  return own ?? Math.min(DOUBLE_CONFIG.maxLevel, q.difficulty + 1);
}

/** The target level of question `index` (0-based). */
export const targetLevel = (index: number) => Math.min(index + 1, DOUBLE_CONFIG.maxLevel);

export interface LadderStep {
  question: QuizQuestion;
  level: number;
}

/**
 * The round's questions, level by level. A level without an unplayed
 * question falls back to the next lower one – but never below the previous
 * question's level, so the round never gets easier. Only when every level in
 * that range is played out does a played question come back; a pool with
 * nothing in range climbs to the next higher level instead.
 * Party mode: the party share (partySlots) plays party questions of the level if there are any.
 */
export function planLadder(
  candidates: readonly QuizQuestion[],
  count: number,
  options: Pick<ModuleInitOptions, "excludeContentIds" | "mode" | "log">,
  random: () => number,
  /** Shows up in the log. */
  label = "double-or-nothing",
): LadderStep[] {
  const mode = options.mode?.mode ?? "family";
  const excluded = new Set(options.excludeContentIds);
  const share = partyShareOf(options.mode);
  const party = new Set(share > 0 ? partySlots(count, partyCountFor(count, share), random) : []);
  const byLevel = new Map<number, QuizQuestion[]>();
  for (const q of candidates) {
    const level = ladderLevel(q, mode);
    byLevel.set(level, [...(byLevel.get(level) ?? []), q]);
  }
  const used = new Set<string>();
  const out: LadderStep[] = [];
  let floor = 1;
  let short = 0;

  const pickAt = (level: number, fresh: boolean, index: number): QuizQuestion | null => {
    const open = (byLevel.get(level) ?? []).filter((q) => !used.has(q.id) && (!fresh || !excluded.has(q.id)));
    if (open.length === 0) return null;
    // Party mode: party slots prefer party questions, the others family questions – if the level has them.
    const wanted = share > 0 ? open.filter((q) => !!q.adult === party.has(index)) : open;
    return shuffle(wanted.length > 0 ? wanted : open, random)[0]!;
  };

  for (let index = 0; index < count; index++) {
    const target = Math.max(targetLevel(index), floor);
    let pick: QuizQuestion | null = null;
    for (const fresh of [true, false]) {
      for (let level = target; level >= floor && !pick; level--) pick = pickAt(level, fresh, index);
    }
    for (let level = target + 1; level <= DOUBLE_CONFIG.maxLevel && !pick; level++) pick = pickAt(level, false, index);
    if (!pick) break;
    if (party.has(index) && !pick.adult) short++;
    const picked = ladderLevel(pick, mode);
    used.add(pick.id);
    floor = picked;
    out.push({ question: pick, level: picked });
  }
  if (short > 0) {
    options.log?.("party pool too small – filling up from the family pool", { label, wanted: party.size, missing: short });
  }
  return out;
}
