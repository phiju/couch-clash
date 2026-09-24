/**
 * Pure decisions for the host's voice (unit-tested): when to comment, how
 * cheeky, how to batch welcomes, how long the leaderboard may wait.
 */
import {
  DEFAULT_VOICE_SETTINGS,
  KIDS_AGE_RATING_LIMIT,
  VoiceSettingsSchema,
  type Cheekiness,
  type CategoryMeta,
  type CommentFrequency,
  type LeaderboardEntry,
  type RevealFacts,
  type VoiceSettings,
} from "@couch-clash/shared";
import { VOICE_CONFIG } from "./config";
import type { CommentPlayerFacts } from "./prompt";

/** Persisted in the room record. */
export interface RoomVoice {
  settings: VoiceSettings;
  /** Generated (AI) lines in this room – limited to VOICE_CONFIG.maxLinesPerRoom. */
  linesUsed: number;
  /** Consecutive right answers per player id (current game). */
  streaks: Record<string, number>;
  /** Player ids the last comments were about (most recent first). */
  lastTargets: string[];
  /** Last commented question in the current category. */
  lastComment: { roundIndex: number; index: number } | null;
}

export function defaultRoomVoice(): RoomVoice {
  return { settings: DEFAULT_VOICE_SETTINGS, linesUsed: 0, streaks: {}, lastTargets: [], lastComment: null };
}

export function normalizeRoomVoice(voice: Partial<RoomVoice> | undefined): RoomVoice {
  const settings = VoiceSettingsSchema.safeParse(voice?.settings);
  return {
    ...defaultRoomVoice(),
    ...voice,
    settings: settings.success ? settings.data : DEFAULT_VOICE_SETTINGS,
  };
}

/** Kids' categories (age rating < 12) → "nett", unless the host explicitly overrides. */
export function effectiveCheekiness(settings: VoiceSettings, categories: readonly Pick<CategoryMeta, "ageRating">[]): Cheekiness {
  if (!settings.cheekinessOverride && hasKidsCategory(categories)) return "nett";
  return settings.cheekiness;
}

export function hasKidsCategory(categories: readonly Pick<CategoryMeta, "ageRating">[]): boolean {
  return categories.some((c) => c.ageRating < KIDS_AGE_RATING_LIMIT);
}

/** Questions between two comments: "oft" = every 2nd (the maximum), "selten" = only at the end of a category. */
const COMMENT_GAP: Record<CommentFrequency, number> = { oft: 2, normal: 3, selten: Number.POSITIVE_INFINITY };

/**
 * Comment after this question? Never after every question; always after
 * the last question of a category.
 */
export function shouldComment(
  frequency: CommentFrequency,
  index: number,
  total: number,
  lastCommentIndex: number | null,
): boolean {
  if (index === total - 1) return true;
  const gap = COMMENT_GAP[frequency];
  const since = lastCommentIndex === null ? index + 1 : index - lastCommentIndex;
  return since >= gap;
}

/**
 * Welcome lines: at most `capacity` more lines (3 minus the ones already
 * waiting). If more names wait than fit, the rest share one merged line.
 */
export function planWelcomes<T>(pending: readonly T[], capacity: number): { batches: T[][]; rest: T[] } {
  if (capacity <= 0 || pending.length === 0) return { batches: [], rest: [...pending] };
  if (pending.length <= capacity) return { batches: pending.map((p) => [p]), rest: [] };
  const singles = pending.slice(0, capacity - 1).map((p) => [p]);
  return { batches: [...singles, pending.slice(capacity - 1)], rest: [] };
}

/**
 * The leaderboard waits (at most `maxExtra` ms) for a commentary line that
 * is still playing. Never shortens the hold.
 */
export function extendedPhaseEnd(
  currentEnd: number,
  baseEnd: number,
  lineEndsAt: number,
  maxExtra: number = VOICE_CONFIG.maxHoldExtensionMs,
): number {
  const wanted = Math.min(baseEnd + maxExtra, lineEndsAt + 300);
  return Math.max(currentEnd, wanted);
}

export function updateStreaks(
  streaks: Readonly<Record<string, number>>,
  playerIds: readonly string[],
  facts: RevealFacts,
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const id of playerIds) next[id] = facts.answers[id]?.correct ? (streaks[id] ?? 0) + 1 : 0;
  return next;
}

/** Remember who the last comment was about (no piling on the same player). */
export function rememberTarget(lastTargets: readonly string[], targetId: string | null): string[] {
  if (!targetId) return [...lastTargets];
  return [targetId, ...lastTargets.filter((t) => t !== targetId)].slice(0, 2);
}

/** Per-player facts for the commentary prompt. */
export function commentPlayers(
  players: readonly { id: string; name: string }[],
  facts: RevealFacts,
  leaderboard: readonly LeaderboardEntry[],
  streaks: Readonly<Record<string, number>>,
): CommentPlayerFacts[] {
  const answered = Object.entries(facts.answers);
  const fastestId = answered.length
    ? answered.reduce((best, cur) => (cur[1].responseMs < best[1].responseMs ? cur : best))[0]
    : null;
  return players.flatMap((p) => {
    const entry = leaderboard.find((e) => e.playerId === p.id);
    if (!entry) return [];
    const a = facts.answers[p.id];
    return [
      {
        name: p.name,
        answer: a ? a.text : null,
        correct: !!a?.correct,
        accuracy: a ? a.accuracy : null,
        seconds: a ? Math.round(a.responseMs / 100) / 10 : null,
        fastest: p.id === fastestId,
        points: entry.pointsGained,
        total: entry.scoreAfter,
        rankBefore: entry.rankBefore,
        rankAfter: entry.rankAfter,
        streak: streaks[p.id] ?? 0,
      },
    ];
  });
}

/** Short hints so the model finds "the most interesting thing" quickly. */
export function commentHighlights(players: readonly CommentPlayerFacts[]): string[] {
  const out: string[] = [];
  if (players.length === 0) return out;
  const answered = players.filter((p) => p.answer !== null);
  if (answered.length > 0 && answered.every((p) => !p.correct)) out.push("Alle lagen falsch.");
  if (answered.length > 1 && answered.every((p) => p.correct)) out.push("Alle lagen richtig.");
  const leaders = players.filter((p) => p.rankAfter === 1);
  const newLeader = leaders.find((p) => p.rankBefore !== 1);
  if (newLeader && leaders.length === 1) out.push(`Neue Führung: ${newLeader.name}.`);
  const jump = [...players].sort((a, b) => b.rankBefore - b.rankAfter - (a.rankBefore - a.rankAfter))[0];
  if (jump && jump.rankBefore - jump.rankAfter >= 2) {
    out.push(`${jump.name} springt von Platz ${jump.rankBefore} auf ${jump.rankAfter}.`);
  }
  const sorted = [...players].sort((a, b) => b.total - a.total);
  if (sorted.length > 1 && sorted[0]!.total > 0 && sorted[0]!.total - sorted[1]!.total <= sorted[0]!.total * 0.05) {
    out.push(`Knappes Rennen zwischen ${sorted[0]!.name} und ${sorted[1]!.name}.`);
  }
  for (const p of players) if (p.streak >= 3) out.push(`${p.name} hat ${p.streak} richtige in Folge.`);
  for (const p of players) if (p.answer === null) out.push(`${p.name} hat nicht geantwortet.`);
  const fastest = players.find((p) => p.fastest);
  if (fastest) out.push(`${fastest.name} war am schnellsten (${fastest.seconds} s)${fastest.correct ? "" : " – aber falsch"}.`);
  return out;
}
