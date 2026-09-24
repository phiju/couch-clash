import { formatDuration, type SettingsSummary } from "@couch-clash/shared";

/** "2 Kategorien · 14 Fragen · ca. 8 Minuten" */
export function summaryText(summary: SettingsSummary | null): string {
  if (!summary) return "Noch keine Kategorie gewählt";
  const n = summary.categoryIds.length;
  return `${n} ${n === 1 ? "Kategorie" : "Kategorien"} · ${summary.questionCount} Fragen · ${formatDuration(summary.estimatedSeconds)}`;
}
