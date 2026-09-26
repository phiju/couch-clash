/**
 * Global game mode: who is playing. Filters categories and questions for
 * every category and sets the host voice's default "Frechheit".
 */
import { z } from "zod";
import type { CategoryMeta } from "./game-module";
import type { Cheekiness } from "./voice";

export const GAME_MODES = ["kids", "family", "party"] as const;
export type GameMode = (typeof GAME_MODES)[number];

/** Question mix by difficulty (Familie / Party only). */
export const DIFFICULTY_MIXES = ["easy", "mixed", "hard"] as const;
export type DifficultyMix = (typeof DIFFICULTY_MIXES)[number];

/**
 * Party mode: the share of each round that comes from the party pool
 * (adult: alcohol, love, sex). THE config for every game – the host can
 * pick one of `shares` ("Party-Anteil").
 */
export const PARTY_CONFIG = {
  defaultShare: 0.3,
  shares: [0.3, 0.5, 1] as const,
} as const;
export type PartyShare = (typeof PARTY_CONFIG.shares)[number];

export const GameModeSettingsSchema = z.object({
  mode: z.enum(GAME_MODES),
  /** Familie: also questions rated 16. */
  allow16: z.boolean(),
  difficulty: z.enum(DIFFICULTY_MIXES),
  /** Party only: share of party items per round (default PARTY_CONFIG.defaultShare). */
  partyShare: z.union(PARTY_CONFIG.shares.map((s) => z.literal(s))).optional(),
});
export type GameModeSettings = z.infer<typeof GameModeSettingsSchema>;

export const DEFAULT_MODE_SETTINGS: GameModeSettings = { mode: "family", allow16: false, difficulty: "mixed" };

export const GAME_MODE_INFO: Record<GameMode, { label: string; emoji: string; who: string }> = {
  kids: { label: "Kids", emoji: "🧸", who: "Kinder ca. 6–11" },
  family: { label: "Familie", emoji: "👨‍👩‍👧", who: "gemischt, Kinder dabei" },
  party: { label: "Party", emoji: "🍸", who: "nur Erwachsene" },
};

export const DIFFICULTY_MIX_LABELS: Record<DifficultyMix, string> = { easy: "leicht", mixed: "gemischt", hard: "schwer" };

/** Host voice per mode: default and allowed levels. */
export const MODE_CHEEKINESS: Record<GameMode, { default: Cheekiness; allowed: readonly Cheekiness[] }> = {
  kids: { default: "nett", allowed: ["nett", "frech"] },
  family: { default: "frech", allowed: ["nett", "frech", "gnadenlos"] },
  party: { default: "frech", allowed: ["nett", "frech", "gnadenlos"] },
};

/** The level the host actually uses: the chosen one if allowed in this mode, else the mode default. */
export function cheekinessForMode(chosen: Cheekiness, mode: GameMode): Cheekiness {
  const rule = MODE_CHEEKINESS[mode];
  return rule.allowed.includes(chosen) ? chosen : rule.default;
}

/** Everything a content item needs for the mode filter. */
export interface ContentFlags {
  ageRating: number;
  difficulty: number;
  alcohol?: boolean;
  /** Sexual / suggestive content (never explicit). */
  adult?: boolean;
}

export function maxAgeRating(s: GameModeSettings): number {
  if (s.mode === "kids") return 6;
  if (s.mode === "family") return s.allow16 ? 16 : 12;
  return 18;
}

/** The part of a category's meta the mode filter needs (kidsMaxDifficulty, default 1). */
export type ModeFilterMeta = Pick<CategoryMeta, "id" | "kidsMaxDifficulty">;

/** THE filter for every category's question pool. */
export function eligibleForMode(item: ContentFlags, s: GameModeSettings, meta?: ModeFilterMeta): boolean {
  switch (s.mode) {
    case "kids":
      return item.ageRating <= 6 && item.difficulty <= (meta?.kidsMaxDifficulty ?? 1) && !item.alcohol && !item.adult;
    case "family":
      return item.ageRating <= maxAgeRating(s) && !item.adult;
    case "party":
      return true;
  }
}

/** The party share a round uses: the host's choice in Party mode, 0 otherwise (and always 0 for mode-neutral categories). */
export function partyShareOf(s: GameModeSettings | undefined, meta?: Pick<CategoryMeta, "modeNeutral">): number {
  if (s?.mode !== "party" || meta?.modeNeutral) return 0;
  return s.partyShare ?? PARTY_CONFIG.defaultShare;
}

/**
 * How many of `n` items come from the party pool: max(1, ceil(n × share)),
 * at most n (0 for n = 0 or share 0). The pool size limits it further.
 */
export function partyCountFor(n: number, share: number): number {
  if (n < 1 || share <= 0) return 0;
  // 10 × 0.3 is 3.0000000000000004 in floating point – that must stay 3.
  return Math.min(n, Math.max(1, Math.ceil(n * share - 1e-9)));
}

/** Relative chance per difficulty (1–3) for the question selection. */
export const DIFFICULTY_WEIGHTS: Record<DifficultyMix, Record<1 | 2 | 3, number>> = {
  easy: { 1: 4, 2: 1.5, 3: 0.4 },
  mixed: { 1: 1, 2: 1, 3: 1 },
  hard: { 1: 0.4, 2: 1.5, 3: 4 },
};

export function difficultyWeight(difficulty: number, s: GameModeSettings | undefined): number {
  if (!s || s.mode === "kids") return 1;
  const d = Math.min(3, Math.max(1, Math.round(difficulty))) as 1 | 2 | 3;
  return DIFFICULTY_WEIGHTS[s.difficulty][d];
}

/** Old or broken stored values → Familie. */
export function normalizeModeSettings(raw: unknown): GameModeSettings {
  const parsed = GameModeSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_MODE_SETTINGS };
}

/** Which modes a content item can come up in (admin page). */
export function modesFor(item: ContentFlags, allow16 = false, meta?: ModeFilterMeta): GameMode[] {
  return GAME_MODES.filter((mode) => eligibleForMode(item, { mode, allow16, difficulty: "mixed" }, meta));
}
