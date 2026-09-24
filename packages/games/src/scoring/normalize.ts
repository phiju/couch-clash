import { ScoringSettingsSchema, type CategoryMeta, type ScoringSettings } from "@couch-clash/shared";

/**
 * Turns whatever is stored (host input, localStorage, a room saved by an
 * older version) into valid settings for this category:
 * - invalid/old shapes → category defaults
 * - the mode always comes from the category
 * - fields the host may not edit → category defaults
 */
export function normalizeScoring(meta: Pick<CategoryMeta, "scoring" | "scoringFields">, raw: unknown): ScoringSettings {
  const defaults = meta.scoring;
  const parsed = ScoringSettingsSchema.safeParse(raw);
  if (!parsed.success) return structuredClone(defaults);
  const fields = new Set(meta.scoringFields);
  return {
    mode: defaults.mode,
    maxPoints: fields.has("maxPoints") ? parsed.data.maxPoints : defaults.maxPoints,
    speedModifier: fields.has("speedModifier") ? parsed.data.speedModifier : { ...defaults.speedModifier },
  };
}
