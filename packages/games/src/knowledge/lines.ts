/**
 * Fixed host lines of the knowledge games (read aloud, max ~14 words).
 * Chosen by a hash of the line's key, so the same moment always gets the
 * same line (readAloud is asked again on every state change).
 */
import { KNOWLEDGE_CATEGORY_LABELS, type GameMode, type KnowledgeCategory, type ModuleContext, type ReadAloud } from "@couch-clash/shared";

export type LineFn<T extends unknown[]> = (...args: T) => string;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Same key → same pick. */
export function pickLine<T>(list: readonly T[], key: string): T {
  return list[hash(key) % list.length]!;
}

/** A name as the voice says it: letters, digits and basic punctuation only. */
export function spokenName(name: string | undefined): string {
  const cleaned = (name ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} .'-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20)
    .trim();
  return cleaned || "Unbekannt";
}

export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} und ${names.at(-1)}`;
}

export function categoryLabel(category: KnowledgeCategory | null | undefined): string {
  return category ? KNOWLEDGE_CATEGORY_LABELS[category] : "Gemischtes";
}

/** "null Punkten", "1 Punkt", "1.500 Punkten". */
export function pointsDative(points: number): string {
  if (points === 0) return "null Punkten";
  if (points === 1) return "einem Punkt";
  return `${points.toLocaleString("de-DE")} Punkten`;
}

/** Friendly lines in Kids mode. */
export const isKids = (mode: GameMode) => mode === "kids";

/** Player names at this moment (the module stores the few it needs for its lines). */
export function namesOf(ctx: ModuleContext, ids: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ids) {
    const name = ctx.players.find((p) => p.id === id)?.name;
    if (name) out[id] = name;
  }
  return out;
}

/** One line to read aloud (null text → nothing to say). */
export function sayLine(key: string, text: string | null): ReadAloud | null {
  return text ? { key, items: [{ cue: key, text }] } : null;
}
