/**
 * Where the finale's questions come from – it has no fixed length, so it
 * must never run dry:
 *
 *   1. the normal multiple-choice pool (static + AI-generated, mode filter),
 *      not played in this room yet
 *   2. the same pool, played in EARLIER games of this room
 *   3. fresh AI questions (requested in the background when the queue runs low)
 *   4. last resort (logged): the finale's own oldest question again
 *
 * Questions of the current game are never used (tiers 1–3). A question comes
 * up at most once per finale unless tier 4 is reached.
 */
import {
  ESTIMATE_QUESTIONS_DE,
  EstimateQuestionSchema,
  QUIZ_QUESTIONS_DE,
  QuizQuestionSchema,
  type EstimateQuestion,
  type QuizQuestion,
} from "@couch-clash/content";
import type { GameMode, ModeFilterMeta, ModuleInitOptions, ModuleTask } from "@couch-clash/shared";
import { playablePool } from "../content-pool";
import { knowledgePool, prepareQuizQuestion, selectQuestions, type PreparedQuizQuestion } from "../knowledge/questions";
import { pickFresh } from "../random";
import type { SurvivalConfig } from "./config";

export interface SurvivalQuestionPools {
  quiz: readonly QuizQuestion[];
  estimate: readonly EstimateQuestion[];
}

export const DEFAULT_SURVIVAL_POOLS: SurvivalQuestionPools = { quiz: QUIZ_QUESTIONS_DE, estimate: ESTIMATE_QUESTIONS_DE };

export interface SurvivalQuestionSource {
  /** Content ids in play order (tiers 1 + 2, then AI questions appended). */
  queue: string[];
  /** Next position in `queue`. */
  next: number;
  /** Items not in the static pool (generated ones) – kept whole, the pool can't look them up later. */
  extra: QuizQuestion[];
  /** Ids played in this finale, in order. */
  played: string[];
  /** Estimate questions for the tie-breaker. */
  estimateQueue: string[];
  estimateNext: number;
  /** Background AI refill. */
  ai: { requests: number; pending: boolean };
  /** For AI questions: who is playing. */
  mode: GameMode;
}

/** Content ids of the running game (never repeated in the finale). */
export type SurvivalInitOptions = ModuleInitOptions & { currentGameContentIds?: readonly string[] };

export function buildQuestionSource(
  pools: SurvivalQuestionPools,
  options: SurvivalInitOptions,
  random: () => number,
  meta: ModeFilterMeta,
  estimateMeta: ModeFilterMeta,
  config: Pick<SurvivalConfig, "questionQueueSize">,
): SurvivalQuestionSource {
  const current = new Set(options.currentGameContentIds ?? []);
  const candidates = knowledgePool(pools.quiz, options, meta).filter((q) => !current.has(q.id));
  // Fresh first, then questions from earlier games (selectQuestions prefers ids not in excludeContentIds).
  const picked = selectQuestions(candidates, config.questionQueueSize, options, random, "survival");
  const staticIds = new Set(pools.quiz.map((q) => q.id));
  const estimates = playablePool(pools.estimate, EstimateQuestionSchema, { blockedContentIds: options.blockedContentIds, mode: options.mode }, estimateMeta)
    .filter((q) => !current.has(q.id));
  return {
    queue: picked.map((q) => q.id),
    next: 0,
    extra: picked.filter((q) => !staticIds.has(q.id)),
    played: [],
    estimateQueue: pickFresh(estimates, 5, options.excludeContentIds, random).map((q) => q.id),
    estimateNext: 0,
    ai: { requests: 0, pending: false },
    mode: options.mode?.mode ?? "family",
  };
}

function lookup(pools: SurvivalQuestionPools, source: SurvivalQuestionSource, id: string): QuizQuestion | undefined {
  return source.extra.find((q) => q.id === id) ?? pools.quiz.find((q) => q.id === id);
}

export interface DrawnQuestion {
  source: SurvivalQuestionSource;
  question: PreparedQuizQuestion | null;
  /** Tier 4 was used. */
  repeated: boolean;
}

/** The next question (never one of this finale unless everything else is gone). */
export function drawQuestion(
  pools: SurvivalQuestionPools,
  source: SurvivalQuestionSource,
  random: () => number,
  config: Pick<SurvivalConfig, "aiRefillBelow" | "aiMaxRequests">,
): DrawnQuestion {
  let next = source.next;
  const played = new Set(source.played);
  let item: QuizQuestion | undefined;
  while (next < source.queue.length && !item) {
    const id = source.queue[next++]!;
    if (!played.has(id)) item = lookup(pools, source, id);
  }
  let repeated = false;
  if (!item && source.played.length > 0) {
    // Last resort: the question played longest ago in this finale.
    const id = source.played[0]!;
    item = lookup(pools, source, id);
    repeated = !!item;
  }
  const remaining = source.queue.length - next;
  const ai =
    remaining < config.aiRefillBelow && !source.ai.pending && source.ai.requests < config.aiMaxRequests
      ? { requests: source.ai.requests + 1, pending: true }
      : source.ai;
  const played2 = item ? [...source.played.filter((id) => id !== item.id), item.id] : source.played;
  return {
    source: { ...source, next, played: played2, ai },
    question: item ? prepareQuizQuestion(item, random) : null,
    repeated,
  };
}

/** The next tie-breaker question, or null. */
export function drawEstimate(
  pools: SurvivalQuestionPools,
  source: SurvivalQuestionSource,
): { source: SurvivalQuestionSource; question: EstimateQuestion | null } {
  let next = source.estimateNext;
  while (next < source.estimateQueue.length) {
    const id = source.estimateQueue[next++]!;
    const q = pools.estimate.find((e) => e.id === id);
    if (q) return { source: { ...source, estimateNext: next }, question: q };
  }
  // All used: start over with the pool's first items (a repeat beats a hanging finale).
  const fallback = pools.estimate[source.estimateNext % Math.max(1, pools.estimate.length)] ?? null;
  return { source: { ...source, estimateNext: source.estimateNext + 1 }, question: fallback };
}

// ── AI refill (runs as a module task; the room never waits for it) ─────

export function aiTaskId(source: SurvivalQuestionSource): string {
  return `survival-questions-${source.ai.requests}`;
}

export function aiQuestionTask(
  pools: SurvivalQuestionPools,
  source: SurvivalQuestionSource,
  config: Pick<SurvivalConfig, "aiQuestionsPerRequest" | "aiTimeoutMs">,
): ModuleTask | null {
  if (!source.ai.pending) return null;
  const age = source.mode === "kids" ? 6 : 12;
  const recent = source.played.slice(-30).flatMap((id) => {
    const q = lookup(pools, source, id);
    return q ? [`- ${q.text}`] : [];
  });
  return {
    id: aiTaskId(source),
    kind: "llm_json",
    model: "fast",
    timeoutMs: config.aiTimeoutMs,
    input: {
      system: [
        "Du schreibst Quizfragen für ein deutschsprachiges Partyspiel (Familie, Freunde, TV).",
        'Antworte ausschließlich mit JSON: {"questions": [{"text": "Frage", "options": ["A", "B", "C", "D"], "correctIndex": 0}]}',
        "Regeln:",
        "- Deutsch, korrekt, eindeutig, kurz (höchstens 200 Zeichen).",
        `- Passend für Spieler ab ${age} Jahren, nichts für Erwachsene, kein Alkohol.`,
        "- Genau 4 verschiedene, kurze Antwortoptionen, genau eine ist sicher richtig.",
        "- Nur stabile Fakten, die sich nicht ändern.",
      ].join("\n"),
      user: [
        `Schreibe ${config.aiQuestionsPerRequest} neue Fragen aus gemischten Themen, schnell zu beantworten.`,
        recent.length ? `Diese Fragen gab es schon – nichts davon wiederholen:\n${recent.join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  };
}

const normalizeText = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Validated AI questions appended to the queue (invalid or duplicate ones are dropped). */
export function addAiQuestions(
  pools: SurvivalQuestionPools,
  source: SurvivalQuestionSource,
  result: unknown,
): { source: SurvivalQuestionSource; added: number } {
  const raw = (result as { questions?: unknown } | null)?.questions;
  const known = new Set(
    [...source.queue, ...source.played].flatMap((id) => {
      const q = lookup(pools, source, id);
      return q ? [normalizeText(q.text)] : [];
    }),
  );
  const age = source.mode === "kids" ? 6 : 12;
  const added: QuizQuestion[] = [];
  (Array.isArray(raw) ? raw : []).forEach((item, i) => {
    const x = item as Record<string, unknown> | null;
    const parsed = QuizQuestionSchema.safeParse({
      id: `survival-ai-${source.ai.requests}-${i}`,
      text: x?.text,
      options: x?.options,
      correctIndex: x?.correctIndex,
      ageRating: age,
      difficulty: source.mode === "kids" ? 1 : 2,
      tags: ["wissen"],
    });
    if (!parsed.success) return;
    const key = normalizeText(parsed.data.text);
    if (known.has(key)) return;
    known.add(key);
    added.push(parsed.data);
  });
  return {
    source: {
      ...source,
      queue: [...source.queue, ...added.map((q) => q.id)],
      extra: [...source.extra, ...added],
      ai: { ...source.ai, pending: false },
    },
    added: added.length,
  };
}
