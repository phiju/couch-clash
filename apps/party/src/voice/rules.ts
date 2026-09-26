/**
 * Pure decisions for the host's voice (unit-tested): when to comment, how
 * cheeky, how to batch welcomes, how long the leaderboard may wait.
 */
import {
  DEFAULT_VOICE_SETTINGS,
  cheekinessForMode,
  type GameMode,
  VoiceSettingsSchema,
  type Cheekiness,
  type CommentFrequency,
  type LeaderboardEntry,
  type RevealFacts,
  type AccountUsage,
  type VoiceSettings,
  type VoiceStatus,
} from "@couch-clash/shared";
import { ELEVENLABS_CREDITS_PER_CHAR } from "../costs/prices";
import { CREDITS_PER_CHAR, VOICE_CONFIG } from "./config";
import type { SpeechStyle } from "./provider";
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
  /** ElevenLabs credits spent on NEW audio in this room (cached audio is free). */
  creditsUsed: number;
  /** Wrong answers in a row per player id (current game). */
  wrongStreaks: Record<string, number>;
  /** Library lines used in the current game (never twice). */
  usedSnark: string[];
  /** Name clip ("Max …") per player id: the cached audio path. */
  nameClips: Record<string, string>;
  /** Last known ElevenLabs account usage this month (credits). */
  account: AccountUsage | null;
  /**
   * "unavailable": the voice service refused (quota, key, …); "budget": the
   * room's budget is used up. Both: no NEW audio – cached lines still play.
   */
  status: VoiceStatus;
  /** Short error code of the last refusal, e.g. "401 missing_permissions" (shown to the host). */
  errorCode: string | null;
}

export function defaultRoomVoice(): RoomVoice {
  return {
    settings: DEFAULT_VOICE_SETTINGS,
    linesUsed: 0,
    streaks: {},
    lastTargets: [],
    lastComment: null,
    creditsUsed: 0,
    wrongStreaks: {},
    usedSnark: [],
    nameClips: {},
    account: null,
    status: "ok",
    errorCode: null,
  };
}

export function normalizeRoomVoice(voice: Partial<RoomVoice> | undefined): RoomVoice {
  // Settings from before a field existed keep their values, the new field gets its default.
  const settings = VoiceSettingsSchema.safeParse({ ...DEFAULT_VOICE_SETTINGS, ...voice?.settings });
  // Rooms saved before credits counted characters.
  const { charsUsed, ...rest } = (voice ?? {}) as Partial<RoomVoice> & { charsUsed?: number };
  return {
    ...defaultRoomVoice(),
    ...rest,
    ...(rest.creditsUsed === undefined && charsUsed !== undefined ? { creditsUsed: charsUsed } : {}),
    settings: settings.success ? settings.data : DEFAULT_VOICE_SETTINGS,
  };
}

/** The global game mode decides which levels are allowed (Kids: nett or frech). */
export function effectiveCheekiness(settings: VoiceSettings, mode: GameMode): Cheekiness {
  return cheekinessForMode(settings.cheekiness, mode);
}

/** At the latest every n-th question: "oft" every question, "normal" every 2nd, "selten" every 3rd. */
export const COMMENT_EVERY: Record<CommentFrequency, number> = { oft: 1, normal: 2, selten: 3 };

/**
 * Comment after this question? "oft": always. "normal": whenever something
 * noteworthy happened (streaks, new leader, all wrong, …) and at least
 * every 2nd question. "selten": every 3rd. Always after the last question
 * of a category.
 */
export function shouldComment(
  frequency: CommentFrequency,
  index: number,
  total: number,
  lastCommentIndex: number | null,
  noteworthy = false,
): boolean {
  if (index === total - 1) return true;
  if (frequency === "normal" && noteworthy) return true;
  const since = lastCommentIndex === null ? index + 1 : index - lastCommentIndex;
  return since >= COMMENT_EVERY[frequency];
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
        ...(a?.note ? { note: a.note } : {}),
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

/** ElevenLabs credits for a text: characters × the model's rate (flash ½, v3 1); unknown models by style. */
export function creditsFor(chars: number, style: SpeechStyle, model?: string): number {
  const rate = (model ? ELEVENLABS_CREDITS_PER_CHAR[model] : undefined) ?? CREDITS_PER_CHAR[style];
  return Math.ceil(chars * rate);
}

/** Reserves `credits` from the room's budget; null if it does not fit (then only cached audio). */
export function reserveCredits(voice: RoomVoice, credits: number, budget: number = VOICE_CONFIG.creditBudgetPerRoom): RoomVoice | null {
  if (voice.status !== "ok" || voice.creditsUsed + credits > budget) return null;
  return { ...voice, creditsUsed: voice.creditsUsed + credits };
}

/**
 * The account is nearly used up this month (less than
 * VOICE_CONFIG.accountReserveShare left): no NEW audio, only cached.
 * Unknown usage never blocks.
 */
export function accountLow(account: AccountUsage | null): boolean {
  if (!account || account.limit <= 0) return false;
  return account.limit - account.used < account.limit * VOICE_CONFIG.accountReserveShare;
}
