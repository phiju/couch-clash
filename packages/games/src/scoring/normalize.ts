import { DEFAULT_PER_QUESTION_CAP, ScoringSettingsSchema, type CategoryMeta, type ScoringSettings } from "@couch-clash/shared";

/**
 * Turns whatever is stored (host input, localStorage, a room saved by an
 * older version) into valid settings for this category:
 * - invalid/old shapes → category defaults
 * - the mode always comes from the category
 * - fields the host may not edit → category defaults
 */
export function normalizeScoring(
  meta: Pick<CategoryMeta, "scoring" | "scoringFields" | "scoringPoints">,
  raw: unknown,
): ScoringSettings {
  const defaults = meta.scoring;
  const parsed = ScoringSettingsSchema.safeParse(raw);
  const fields = new Set(meta.scoringFields);
  const data = parsed.success ? parsed.data : undefined;
  const points: Record<string, number> = {};
  for (const p of meta.scoringPoints ?? []) {
    const value = fields.has("points") ? data?.points?.[p.id] : undefined;
    points[p.id] = value ?? defaults.points?.[p.id] ?? p.default;
  }
  const defaultCap = defaults.perQuestionCap ?? DEFAULT_PER_QUESTION_CAP;
  return {
    mode: defaults.mode,
    maxPoints: data && fields.has("maxPoints") ? data.maxPoints : defaults.maxPoints,
    speedModifier: data && fields.has("speedModifier") ? data.speedModifier : { ...defaults.speedModifier },
    ...(meta.scoringPoints?.length ? { points } : {}),
    perQuestionCap: data && fields.has("perQuestionCap") ? (data.perQuestionCap ?? defaultCap) : defaultCap,
  };
}
