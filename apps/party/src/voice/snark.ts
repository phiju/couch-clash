/**
 * Pure decisions for the host's cached snark lines (unit-tested): which
 * situation a reveal is, whom it is about, and which name-free line from the
 * library fits. The line's audio is cached globally; the player's name clip
 * is played in front of it.
 */
import type { SnarkLines, SnarkPool, SnarkSituation } from "@couch-clash/content";
import type { GameMode, LeaderboardEntry, RevealFacts } from "@couch-clash/shared";

export interface SituationHit {
  situation: SnarkSituation;
  /** Players the line would be about (empty: about everyone, e.g. "Alle daneben"). */
  targetIds: string[];
}

export interface SituationInput {
  playerIds: readonly string[];
  facts: RevealFacts;
  leaderboard: readonly LeaderboardEntry[];
  /** Wrong answers in a row per player BEFORE this question. */
  wrongStreaksBefore: Readonly<Record<string, number>>;
}

export const SNARK_RULES = {
  /** Estimates: accuracy at or above this is a bullseye … */
  bullseyeAccuracy: 0.97,
  /** … and at or below this a wild guess. */
  wildAccuracy: 0,
  /** Wrong answers in a row that make a streak. */
  wrongStreak: 2,
  /** Bluff: fooled at least this many (and at least half of the others). */
  fooledMany: 2,
  /** A line may come back only after this many other lines (when a pool ran dry). */
  reuseGap: 5,
} as const;

/** Most interesting first – the host picks the first one with a free target. */
const PRIORITY: readonly SnarkSituation[] = [
  "fooledMany",
  "bullseye",
  "surpriseRight",
  "leader",
  "allWrong",
  "allRight",
  "wildEstimate",
  "wrongStreak",
  "lastPlace",
  "fooledNone",
  "wrong",
];

/** Everything noteworthy about this reveal, most interesting first. Plain "wrong" is the everyday case. */
export function detectSituations(input: SituationInput): SituationHit[] {
  const { playerIds, facts, leaderboard, wrongStreaksBefore } = input;
  const hits = new Map<SnarkSituation, string[]>();
  const add = (s: SnarkSituation, id?: string) => {
    const list = hits.get(s) ?? [];
    if (id) list.push(id);
    hits.set(s, list);
  };
  const answered = playerIds.filter((id) => facts.answers[id]);
  const estimate = facts.answerKind === "estimate";
  const bluff = answered.some((id) => facts.answers[id]!.fooled !== undefined);

  if (playerIds.length > 0 && answered.length === 0) add("allWrong");
  if (answered.length >= 2 && answered.every((id) => !facts.answers[id]!.correct)) add("allWrong");
  if (answered.length >= 2 && answered.every((id) => facts.answers[id]!.correct)) add("allRight");
  const rightOnes = answered.filter((id) => facts.answers[id]!.correct);
  const rankBefore = (id: string) => leaderboard.find((e) => e.playerId === id)?.rankBefore ?? 1;

  for (const id of playerIds) {
    const a = facts.answers[id];
    const wrongBefore = wrongStreaksBefore[id] ?? 0;
    const correct = !!a?.correct;
    if (a && estimate && a.accuracy >= SNARK_RULES.bullseyeAccuracy) add("bullseye", id);
    if (a && estimate && a.accuracy <= SNARK_RULES.wildAccuracy) add("wildEstimate", id);
    if (a?.fooled !== undefined) {
      const others = Math.max(1, playerIds.length - 1);
      if (a.fooled >= SNARK_RULES.fooledMany && a.fooled >= Math.ceil(others / 2)) add("fooledMany", id);
      if (a.fooled === 0 && playerIds.length > 1) add("fooledNone", id);
    }
    // Right after a wrong streak – or the only one right in a bigger round (unless already leading: no surprise).
    const loneRight = answered.length >= 3 && rightOnes.length === 1 && rankBefore(id) > 1;
    if (correct && (wrongBefore >= SNARK_RULES.wrongStreak || loneRight)) {
      add("surpriseRight", id);
    }
    if (!correct && wrongBefore + 1 >= SNARK_RULES.wrongStreak) add("wrongStreak", id);
    if (a && !correct && !(bluff && a.fooled !== undefined && a.fooled > 0)) add("wrong", id);
  }

  const ranked = leaderboard.filter((e) => playerIds.includes(e.playerId));
  const leaders = ranked.filter((e) => e.rankAfter === 1);
  if (leaders.length === 1 && leaders[0]!.rankBefore !== 1 && leaders[0]!.scoreAfter > 0 && ranked.length > 1) {
    add("leader", leaders[0]!.playerId);
  }
  if (ranked.length >= 3) {
    const worst = Math.max(...ranked.map((e) => e.rankAfter));
    const last = ranked.filter((e) => e.rankAfter === worst);
    if (last.length === 1 && last[0]!.rankBefore !== worst) add("lastPlace", last[0]!.playerId);
  }

  return PRIORITY.flatMap((s) => (hits.has(s) ? [{ situation: s, targetIds: hits.get(s)! }] : []));
}

/** "normal" comments on these: anything but the everyday wrong answer. */
export function isNoteworthy(hits: readonly SituationHit[]): boolean {
  return hits.some((h) => h.situation !== "wrong");
}

export interface SituationChoice {
  situation: SnarkSituation;
  targetId: string | null;
}

/**
 * Who and what, in order of preference: every situation with a target that
 * is not the one the last comment was about (never the same target twice
 * in a row – unless there is only one player); group situations have no
 * target. Situations that are only about the last target come last and
 * WITHOUT a name (no name clip) – never silent, never piling on by name.
 */
export function situationChoices(
  hits: readonly SituationHit[],
  lastTargetId: string | null,
  playerCount: number,
  random: () => number,
): SituationChoice[] {
  const named: SituationChoice[] = [];
  const unnamed: SituationChoice[] = [];
  for (const hit of hits) {
    if (hit.targetIds.length === 0) {
      named.push({ situation: hit.situation, targetId: null });
      continue;
    }
    const free = playerCount <= 1 ? hit.targetIds : hit.targetIds.filter((id) => id !== lastTargetId);
    if (free.length > 0) named.push({ situation: hit.situation, targetId: free[Math.floor(random() * free.length) % free.length]! });
    else unnamed.push({ situation: hit.situation, targetId: null });
  }
  return [...named, ...unnamed];
}

/**
 * The cached line for this reveal: the most interesting situation that
 * still has a line not used in this game. Only when every fitting line was
 * used already (small Kids pool, very long game) one comes back.
 */
export function chooseSnark(
  hits: readonly SituationHit[],
  lastTargetId: string | null,
  playerCount: number,
  library: SnarkLines,
  mode: GameMode,
  usedInGame: readonly string[],
  random: () => number,
): (SituationChoice & { text: string }) | null {
  const choices = situationChoices(hits, lastTargetId, playerCount, random);
  for (const choice of choices) {
    const text = pickSnarkLine(library, choice.situation, mode, usedInGame, random, false);
    if (text) return { ...choice, text };
  }
  const first = choices[0];
  const text = first ? pickSnarkLine(library, first.situation, mode, usedInGame, random, true) : null;
  return first && text ? { ...first, text } : null;
}

/** Which parts of the library a mode may use: Kids only kids lines, Party the family lines plus the party ones. */
export function snarkPoolsFor(mode: GameMode): SnarkPool[] {
  if (mode === "kids") return ["kids"];
  if (mode === "party") return ["family", "party"];
  return ["family"];
}

/**
 * A random line for the situation that was not used in this game yet. Only
 * when every line of the situation was used (small Kids pool, very long
 * game) one comes back – never one of the last few.
 */
export function pickSnarkLine(
  library: SnarkLines,
  situation: SnarkSituation,
  mode: GameMode,
  usedInGame: readonly string[],
  random: () => number,
  /** False: only lines not used in this game yet (null if there are none). */
  allowReuse = true,
): string | null {
  const lines = snarkPoolsFor(mode).flatMap((pool) => library[situation][pool]);
  if (lines.length === 0) return null;
  const used = new Set(usedInGame);
  const fresh = lines.filter((l) => !used.has(l));
  if (fresh.length > 0) return fresh[Math.floor(random() * fresh.length) % fresh.length]!;
  if (!allowReuse) return null;
  const recent = new Set(usedInGame.slice(-SNARK_RULES.reuseGap));
  // Oldest use first.
  const byAge = [...lines].sort((a, b) => usedInGame.lastIndexOf(a) - usedInGame.lastIndexOf(b));
  return byAge.find((l) => !recent.has(l)) ?? byAge[0]!;
}

/** Wrong answers in a row (no answer counts as wrong). */
export function updateWrongStreaks(
  streaks: Readonly<Record<string, number>>,
  playerIds: readonly string[],
  facts: RevealFacts,
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const id of playerIds) next[id] = facts.answers[id]?.correct ? 0 : (streaks[id] ?? 0) + 1;
  return next;
}

/** Every line of the library once (admin task "Moderator-Sprüche vertonen"). */
export function allSnarkLines(library: SnarkLines): string[] {
  return Object.values(library).flatMap((m) => [...m.family, ...m.party, ...m.kids]);
}
