import {
  difficultyWeight,
  eligibleForMode,
  type ContentEntry,
  type ContentFlags,
  type GameModeSettings,
  type ModeFilterMeta,
  type ModuleInitOptions,
} from "@couch-clash/shared";
import type { z } from "zod";
import { pickFresh } from "./random";

/**
 * The questions a category may play: static content + valid extra content
 * (AI-generated), minus blocked ids (quarantined / removed). Invalid extra
 * items are skipped, never played.
 */
export function playablePool<T extends { id: string }>(
  staticPool: readonly T[],
  schema: z.ZodType<T>,
  options: Pick<ModuleInitOptions, "blockedContentIds" | "extraContent" | "mode">,
  /** The category's meta (e.g. kidsMaxDifficulty) – needed when a mode is set. */
  meta?: ModeFilterMeta,
): T[] {
  const extra = (options.extraContent ?? []).flatMap((raw) => {
    const parsed = schema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
  const ids = new Set(staticPool.map((q) => q.id));
  const merged = [...staticPool, ...extra.filter((q) => !ids.has(q.id))];
  const blocked = options.blockedContentIds;
  const allowed = blocked && blocked.size > 0 ? merged.filter((q) => !blocked.has(q.id)) : merged;
  // The global game mode decides which questions may come up (all categories).
  const mode = options.mode;
  return mode ? allowed.filter((q) => eligibleForMode(q as unknown as ContentFlags, mode, meta)) : allowed;
}

/** The questions for one round: mode filter, not played recently first, weighted by difficulty. */
export function pickForRound<T extends { id: string; difficulty: number }>(
  staticPool: readonly T[],
  schema: z.ZodType<T>,
  options: ModuleInitOptions,
  random: () => number,
  meta: ModeFilterMeta,
): T[] {
  const pool = playablePool(staticPool, schema, options, meta);
  return pickFresh(pool, options.questionCount, options.excludeContentIds, random, (q) => difficultyWeight(q.difficulty, options.mode));
}

/** How many questions a category has in this mode (settings panel: warning + slider cap). */
export function modePoolSize(entries: readonly ContentFlags[], mode: GameModeSettings, meta: ModeFilterMeta): number {
  return entries.filter((e) => eligibleForMode(e, mode, meta)).length;
}

export function parseWith<T>(schema: z.ZodType<T>, raw: unknown): { ok: true; value: T } | { ok: false; error: string } {
  const parsed = schema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "item"}: ${i.message}`).join("; ") };
}

/** Admin catalog: static + valid extra items as ContentEntry. */
export function listEntries<T extends { id: string }>(
  staticPool: readonly T[],
  schema: z.ZodType<T>,
  extraContent: readonly unknown[] | undefined,
  toEntry: (item: T) => ContentEntry,
): ContentEntry[] {
  return playablePool(staticPool, schema, { extraContent }).map(toEntry);
}
