import { GAME_MODE_INFO, formatDuration, type SettingsSummary } from "@couch-clash/shared";

/** "Familie · 3 Kategorien · 14 Fragen · ca. 15 Minuten" (a category played twice counts once) */
export function summaryText(summary: SettingsSummary | null): string {
  if (!summary) return "Noch keine Kategorie gewählt";
  const n = new Set(summary.categoryIds).size;
  const mode = summary.mode ? `${GAME_MODE_INFO[summary.mode].label} · ` : "";
  return `${mode}${n} ${n === 1 ? "Kategorie" : "Kategorien"} · ${summary.questionCount} Fragen · ${formatDuration(summary.estimatedSeconds)}`;
}
