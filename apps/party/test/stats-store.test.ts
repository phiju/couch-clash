import { describe, expect, it } from "vitest";
import { sqliteStore } from "./stats-helpers";

const T0 = 1_700_000_000_000;
const play = (id: string, over: Partial<{ answers: number; correct: number; sumResponseMs: number; sumErrorPct: number | null }> = {}) => ({
  contentId: id,
  answers: 3,
  correct: 2,
  sumResponseMs: 9000,
  sumErrorPct: null,
  ...over,
});

describe("D1 stats store (real SQL on SQLite)", () => {
  it("upserts one row per question and adds up the numbers", async () => {
    const { store } = sqliteStore();
    await store.recordPlay("quiz", play("quiz-001"), T0);
    await store.recordPlay("quiz", play("quiz-001", { answers: 2, correct: 0, sumResponseMs: 1000 }), T0 + 5000);
    await store.recordPlay("estimate", play("estimate-001", { sumErrorPct: 0.75 }), T0);
    const rows = await store.listStats();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.question_id === "quiz-001")).toMatchObject({
      category_id: "quiz",
      plays: 2,
      answers: 5,
      correct: 2,
      sum_response_ms: 10_000,
      status: "active",
      first_played_at: T0,
      last_played_at: T0 + 5000,
    });
    expect(rows.find((r) => r.question_id === "estimate-001")?.sum_error_pct).toBe(0.75);
  });

  it("adds thumbs as counts and skips empty votes", async () => {
    const { store } = sqliteStore();
    await store.recordVotes("quiz", "quiz-002", 0, 0, T0);
    expect(await store.listStats()).toHaveLength(0);
    await store.recordVotes("quiz", "quiz-002", 2, 1, T0);
    await store.recordVotes("quiz", "quiz-002", 1, 3, T0);
    expect((await store.listStats())[0]).toMatchObject({ thumbs_up: 3, thumbs_down: 4, plays: 0, status: "active" });
  });

  it("report quarantines, undo restores; removed stays removed", async () => {
    const { store } = sqliteStore();
    await store.report("quiz", "quiz-003", T0);
    expect(await store.blockedIds()).toEqual(["quiz-003"]);
    expect((await store.listStats())[0]).toMatchObject({ reports: 1, status: "quarantined" });
    await store.undoReport("quiz-003", T0 + 1000);
    expect(await store.blockedIds()).toEqual([]);
    expect((await store.listStats())[0]).toMatchObject({ reports: 0, status: "active" });

    await store.setStatus([{ id: "quiz-003", categoryId: "quiz" }], "removed", T0);
    await store.report("quiz", "quiz-003", T0);
    expect((await store.listStats())[0]).toMatchObject({ reports: 1, status: "removed" });
  });

  it("stores generated questions and counts generations per day", async () => {
    const { store } = sqliteStore();
    await store.insertGenerated({ id: "quiz-gen-a", category_id: "quiz", payload: "{}", replaces_id: "quiz-001", status: "active", created_at: T0 });
    expect(await store.updateGenerated("quiz-gen-a", '{"x":1}', T0 + 1)).toBe(true);
    expect(await store.updateGenerated("nope", "{}", T0)).toBe(false);
    expect((await store.listGenerated())[0]).toMatchObject({ payload: '{"x":1}', updated_at: T0 + 1 });
    await store.logGeneration({ created_at: T0, category_id: "quiz", replaces_id: "quiz-001", ok: 1, model_calls: 2, message: "ok" });
    await store.logGeneration({ created_at: T0 - 100_000_000, category_id: "quiz", replaces_id: null, ok: 0, model_calls: 2, message: "alt" });
    expect(await store.generationsSince(T0 - 1000)).toBe(1);
    // Jobs that never reached the model (e.g. no API key) don't count.
    await store.logGeneration({ created_at: T0, category_id: "quiz", replaces_id: "quiz-002", ok: 0, model_calls: 0, message: "OPENAI_API_KEY fehlt." });
    expect(await store.generationsSince(T0 - 1000)).toBe(1);
    expect((await store.recentGenerationLog(10)).map((l) => l.message)).toEqual(["OPENAI_API_KEY fehlt.", "ok", "alt"]);
  });
});
