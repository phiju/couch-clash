import type { ModulePlayer, RoundSummaryFacts } from "@couch-clash/shared";
import { FUEHRERSCHEIN_CONFIG } from "./meta";
import type { ExamSummary } from "./types";

/** BESTANDEN from passShare right answers in this round (show only – no points). */
export function buildExam(input: {
  players: readonly ModulePlayer[];
  correctCounts: Readonly<Record<string, number>>;
  total: number;
}): ExamSummary {
  const passShare = FUEHRERSCHEIN_CONFIG.passShare;
  return {
    passShare,
    results: input.players.map((p) => {
      const correct = input.correctCounts[p.id] ?? 0;
      return { playerId: p.id, correct, total: input.total, passed: input.total > 0 && correct / input.total >= passShare - 1e-9 };
    }),
  };
}

export function examDurationMs(summary: ExamSummary): number {
  const c = FUEHRERSCHEIN_CONFIG;
  return Math.min(c.examMaxMs, c.examBaseMs + summary.results.length * c.examMsPerPlayer);
}

/** Stamp delay per player on the screens: fast with many players. */
export function examStampDelayMs(index: number, count: number): number {
  const step = count <= 4 ? 900 : Math.max(250, Math.floor(3_600 / count));
  return 600 + index * step;
}

export function examFacts(summary: ExamSummary): RoundSummaryFacts {
  const passed = summary.results.filter((r) => r.passed).length;
  const n = summary.results.length;
  const highlights: string[] = [];
  if (n > 0 && passed === n) highlights.push("Alle haben bestanden.");
  else if (passed === 0) highlights.push("Niemand hat bestanden.");
  else if (passed === 1 && n > 1) highlights.push("Nur eine Person hat bestanden.");
  else if (passed === n - 1 && n > 1) highlights.push("Nur eine Person ist durchgefallen.");
  const perfect = summary.results.filter((r) => r.total > 0 && r.correct === r.total).length;
  if (perfect > 0) highlights.push(`${perfect === 1 ? "Eine Person hat" : `${perfect} Personen haben`} null Fehlerpunkte.`);
  return {
    title: `Prüfungsergebnis der Führerscheinprüfung (bestanden ab ${Math.round(summary.passShare * 100)} % richtig)`,
    players: summary.results.map((r) => ({
      playerId: r.playerId,
      verdict: r.passed ? "bestanden" : "durchgefallen",
      correct: r.correct,
      total: r.total,
    })),
    highlights,
  };
}
