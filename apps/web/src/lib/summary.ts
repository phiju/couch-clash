import { getCategoryMeta } from "@couch-clash/games/meta";
import { GAME_MODE_INFO, formatDuration, type SettingsSummary } from "@couch-clash/shared";

/**
 * "Familie · 3 Kategorien · 14 Fragen · ca. 15 Minuten" (a category played twice counts once);
 * the finale is named on its own: "… 3 Kategorien + Survival-Finale · …".
 */
export function summaryText(summary: SettingsSummary | null): string {
  if (!summary) return "Noch keine Kategorie gewählt";
  const ids = [...new Set(summary.categoryIds)];
  const finale = ids.map((id) => getCategoryMeta(id)).find((m) => m?.finale);
  const n = ids.filter((id) => !getCategoryMeta(id)?.finale).length;
  const mode = summary.mode ? `${GAME_MODE_INFO[summary.mode].label} · ` : "";
  const categories = `${n} ${n === 1 ? "Kategorie" : "Kategorien"}${finale ? ` + ${finale.name}` : ""}`;
  return `${mode}${categories} · ${summary.questionCount} Fragen · ${formatDuration(summary.estimatedSeconds)}`;
}
