/** Pure helpers for "/admin/fragen": filter, search, sort, CSV. */
import { matchesQuickFilter, type AdminQuestion, type GameMode, type QuickFilter } from "@couch-clash/shared";

export type SortKey =
  | "id"
  | "categoryId"
  | "text"
  | "difficulty"
  | "plays"
  | "score"
  | "avgResponseMs"
  | "thumbs"
  | "reports"
  | "status"
  | "lastPlayedAt";

export interface AdminView {
  category: string | null;
  /** Only questions that can come up in this game mode. */
  mode: GameMode | null;
  quick: QuickFilter | null;
  search: string;
  sort: SortKey;
  desc: boolean;
}

export const DEFAULT_VIEW: AdminView = { category: null, mode: null, quick: null, search: "", sort: "id", desc: false };

/** Correct rate, or 1 − average error for estimates (higher = easier). */
export function scoreOf(q: AdminQuestion): number | null {
  if (q.avgErrorPct !== null) return 1 - q.avgErrorPct;
  return q.correctRate;
}

function sortValue(q: AdminQuestion, key: SortKey): string | number | null {
  switch (key) {
    case "score":
      return scoreOf(q);
    case "thumbs":
      return q.thumbsUp - q.thumbsDown;
    default:
      return q[key];
  }
}

const fold = (s: string) => s.toLocaleLowerCase("de").normalize("NFKD").replace(/\p{M}/gu, "");

export function applyView(questions: readonly AdminQuestion[], view: AdminView): AdminQuestion[] {
  const needle = fold(view.search.trim());
  const rows = questions.filter(
    (q) =>
      (!view.category || q.categoryId === view.category) &&
      (!view.mode || q.modes.includes(view.mode)) &&
      (!view.quick || matchesQuickFilter(q, view.quick)) &&
      (!needle || fold(`${q.id} ${q.text} ${q.answer} ${q.tags.join(" ")}`).includes(needle)),
  );
  const dir = view.desc ? -1 : 1;
  return rows.sort((a, b) => {
    const va = sortValue(a, view.sort);
    const vb = sortValue(b, view.sort);
    // Empty values always last.
    if (va === null && vb === null) return a.id.localeCompare(b.id);
    if (va === null) return 1;
    if (vb === null) return -1;
    const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "de", { numeric: true });
    return cmp !== 0 ? cmp * dir : a.id.localeCompare(b.id);
  });
}

export function quickCounts(questions: readonly AdminQuestion[], filters: readonly QuickFilter[]): Record<QuickFilter, number> {
  const counts = {} as Record<QuickFilter, number>;
  for (const f of filters) counts[f] = questions.filter((q) => matchesQuickFilter(q, f)).length;
  return counts;
}

export const STATUS_LABELS: Record<AdminQuestion["status"], string> = {
  active: "aktiv",
  quarantined: "Quarantäne",
  removed: "rausgeworfen",
};

const CSV_COLUMNS: [string, (q: AdminQuestion) => string | number | null][] = [
  ["id", (q) => q.id],
  ["kategorie", (q) => q.categoryId],
  ["frage", (q) => q.text],
  ["antwort", (q) => q.answer],
  ["schwierigkeit", (q) => q.difficulty],
  ["gespielt", (q) => q.plays],
  ["antworten", (q) => q.answers],
  ["richtig_quote", (q) => q.correctRate],
  ["fehler_schnitt", (q) => q.avgErrorPct],
  ["zeit_schnitt_ms", (q) => q.avgResponseMs],
  ["daumen_hoch", (q) => q.thumbsUp],
  ["daumen_runter", (q) => q.thumbsDown],
  ["meldungen", (q) => q.reports],
  ["status", (q) => q.status],
  ["neu_generiert", (q) => (q.generated ? 1 : 0)],
  ["zuletzt_gespielt", (q) => (q.lastPlayedAt ? new Date(q.lastPlayedAt).toISOString() : null)],
];

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const s = String(value);
  // Quote when needed; neutralize spreadsheet formulas.
  const safe = /^[=+\-@]/.test(s) && typeof value === "string" ? `'${s}` : s;
  return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: readonly AdminQuestion[]): string {
  const lines = [CSV_COLUMNS.map(([name]) => name).join(",")];
  for (const q of rows) lines.push(CSV_COLUMNS.map(([, get]) => csvCell(get(q))).join(","));
  return lines.join("\r\n") + "\r\n";
}
