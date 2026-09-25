/**
 * Question statistics in Cloudflare D1 (binding STATS). The room only ever
 * adds aggregated numbers; the admin page reads and changes statuses.
 */
import type { QuestionStatsPayload, QuestionStatus } from "@couch-clash/shared";

export interface StatsRow {
  question_id: string;
  category_id: string;
  plays: number;
  answers: number;
  correct: number;
  sum_response_ms: number;
  sum_error_pct: number;
  thumbs_up: number;
  thumbs_down: number;
  reports: number;
  status: QuestionStatus;
  status_changed_at: number | null;
  first_played_at: number | null;
  last_played_at: number | null;
}

export interface GeneratedRow {
  id: string;
  category_id: string;
  payload: string;
  replaces_id: string | null;
  status: string;
  created_at: number;
  updated_at: number | null;
}

export interface GenerationLogRow {
  id: number;
  created_at: number;
  category_id: string;
  replaces_id: string | null;
  ok: number;
  model_calls: number;
  message: string | null;
}

export interface StatsStore {
  recordPlay(categoryId: string, stats: QuestionStatsPayload, now: number): Promise<void>;
  recordVotes(categoryId: string, contentId: string, up: number, down: number, now: number): Promise<void>;
  /** "⚠️ Stimmt nicht?": quarantined + 1 report. */
  report(categoryId: string, contentId: string, now: number): Promise<void>;
  /** Undo within 10 s: back to active, report taken back. */
  undoReport(contentId: string, now: number): Promise<void>;
  setStatus(ids: readonly { id: string; categoryId: string }[], status: QuestionStatus, now: number): Promise<void>;
  /** Ids that must not be played (quarantined / removed). */
  blockedIds(): Promise<string[]>;
  listStats(): Promise<StatsRow[]>;
  listGenerated(): Promise<GeneratedRow[]>;
  insertGenerated(row: Omit<GeneratedRow, "updated_at">): Promise<void>;
  updateGenerated(id: string, payload: string, now: number): Promise<boolean>;
  /** Replacement jobs since `since` that called the model (daily limit). */
  generationsSince(since: number): Promise<number>;
  logGeneration(entry: Omit<GenerationLogRow, "id">): Promise<void>;
  recentGenerationLog(limit: number): Promise<GenerationLogRow[]>;
}

const UPSERT_BASE = `INSERT INTO question_stats (question_id, category_id, first_played_at, last_played_at)
  VALUES (?1, ?2, NULL, NULL) ON CONFLICT(question_id) DO NOTHING`;

export function d1StatsStore(db: D1Database): StatsStore {
  const ensure = (id: string, categoryId: string) => db.prepare(UPSERT_BASE).bind(id, categoryId);
  return {
    async recordPlay(categoryId, s, now) {
      await db
        .prepare(
          `INSERT INTO question_stats (question_id, category_id, plays, answers, correct, sum_response_ms, sum_error_pct, first_played_at, last_played_at)
           VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?7)
           ON CONFLICT(question_id) DO UPDATE SET
             plays = plays + 1,
             answers = answers + excluded.answers,
             correct = correct + excluded.correct,
             sum_response_ms = sum_response_ms + excluded.sum_response_ms,
             sum_error_pct = sum_error_pct + excluded.sum_error_pct,
             first_played_at = COALESCE(first_played_at, excluded.first_played_at),
             last_played_at = excluded.last_played_at`,
        )
        .bind(s.contentId, categoryId, s.answers, s.correct, Math.round(s.sumResponseMs), s.sumErrorPct ?? 0, now)
        .run();
    },
    async recordVotes(categoryId, contentId, up, down) {
      if (up === 0 && down === 0) return;
      await db.batch([
        ensure(contentId, categoryId),
        db
          .prepare("UPDATE question_stats SET thumbs_up = thumbs_up + ?2, thumbs_down = thumbs_down + ?3 WHERE question_id = ?1")
          .bind(contentId, up, down),
      ]);
    },
    async report(categoryId, contentId, now) {
      await db.batch([
        ensure(contentId, categoryId),
        db
          .prepare(
            "UPDATE question_stats SET reports = reports + 1, status = CASE WHEN status = 'removed' THEN status ELSE 'quarantined' END, status_changed_at = ?2 WHERE question_id = ?1",
          )
          .bind(contentId, now),
      ]);
    },
    async undoReport(contentId, now) {
      await db
        .prepare(
          "UPDATE question_stats SET reports = MAX(0, reports - 1), status = CASE WHEN status = 'quarantined' THEN 'active' ELSE status END, status_changed_at = ?2 WHERE question_id = ?1",
        )
        .bind(contentId, now)
        .run();
    },
    async setStatus(ids, status, now) {
      if (ids.length === 0) return;
      await db.batch(
        ids.flatMap(({ id, categoryId }) => [
          ensure(id, categoryId),
          db.prepare("UPDATE question_stats SET status = ?2, status_changed_at = ?3 WHERE question_id = ?1").bind(id, status, now),
        ]),
      );
    },
    async blockedIds() {
      const { results } = await db
        .prepare("SELECT question_id FROM question_stats WHERE status != 'active'")
        .all<{ question_id: string }>();
      return results.map((r) => r.question_id);
    },
    async listStats() {
      return (await db.prepare("SELECT * FROM question_stats").all<StatsRow>()).results;
    },
    async listGenerated() {
      return (await db.prepare("SELECT * FROM generated_questions ORDER BY created_at DESC").all<GeneratedRow>()).results;
    },
    async insertGenerated(row) {
      await db
        .prepare(
          "INSERT INTO generated_questions (id, category_id, payload, replaces_id, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(row.id, row.category_id, row.payload, row.replaces_id, row.status, row.created_at)
        .run();
    },
    async updateGenerated(id, payload, now) {
      const res = await db
        .prepare("UPDATE generated_questions SET payload = ?2, updated_at = ?3 WHERE id = ?1")
        .bind(id, payload, now)
        .run();
      return (res.meta.changes ?? 0) > 0;
    },
    async generationsSince(since) {
      const row = await db
        .prepare("SELECT COUNT(*) AS n FROM generation_log WHERE created_at >= ?1 AND model_calls > 0")
        .bind(since)
        .first<{ n: number }>();
      return row?.n ?? 0;
    },
    async logGeneration(e) {
      await db
        .prepare("INSERT INTO generation_log (created_at, category_id, replaces_id, ok, model_calls, message) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
        .bind(e.created_at, e.category_id, e.replaces_id, e.ok, e.model_calls, e.message)
        .run();
    },
    async recentGenerationLog(limit) {
      return (
        await db.prepare("SELECT * FROM generation_log ORDER BY created_at DESC, id DESC LIMIT ?1").bind(limit).all<GenerationLogRow>()
      ).results;
    },
  };
}
