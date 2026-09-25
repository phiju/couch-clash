import { GAME_MODULES } from "@couch-clash/games";
import { describe, expect, it, vi } from "vitest";
import { replaceQuestion, startOfUtcDay, type ReplaceDeps } from "../src/generate/replace";
import type { JsonModel } from "../src/generate/model";
import type { StatsStore } from "../src/stats/store";
import { brokenStore, sqliteStore } from "./stats-helpers";

const T0 = 1_700_000_000_000;
const QUIZ = GAME_MODULES.quiz.listContent!();
const original = QUIZ[0]!;

const goodQuiz = {
  text: "Wie viele Beine hat ein Käfer?",
  options: ["6", "8", "4", "10"],
  correctIndex: 0,
};

/** Scripted model: returns the queued answers in order and records prompts. Never calls a real API. */
function scripted(answers: unknown[]) {
  const prompts: { system: string; user: string }[] = [];
  const model: JsonModel = async (system, user) => {
    prompts.push({ system, user });
    if (answers.length === 0) throw new Error("no more answers");
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { model, prompts };
}

function deps(store: StatsStore, model: JsonModel | null, over: Partial<ReplaceDeps> = {}): ReplaceDeps {
  let n = 0;
  return { store, model, now: () => T0, newId: () => `id${++n}`, ...over };
}

describe("replacement questions", () => {
  it("writes, verifies and stores a replacement (same category, age rating, difficulty, tags)", async () => {
    const { store } = sqliteStore();
    const { model, prompts } = scripted([goodQuiz, { ok: true, reason: "stimmt" }]);
    const result = await replaceQuestion(deps(store, model), { id: original.id, categoryId: "quiz" });
    expect(result).toEqual({ ok: true, id: "quiz-gen-id1" });
    const [row] = await store.listGenerated();
    expect(row).toMatchObject({ id: "quiz-gen-id1", category_id: "quiz", replaces_id: original.id, status: "active" });
    expect(JSON.parse(row!.payload)).toMatchObject({
      ...goodQuiz,
      ageRating: original.ageRating,
      difficulty: original.difficulty,
      tags: original.tags,
    });
    // Similar questions are passed on to avoid duplicates; the prompt asks for JSON.
    expect(prompts[0]!.system).toContain('"correctIndex"');
    const similar = QUIZ.find((q) => q.id !== original.id && q.tags.some((t) => original.tags.includes(t)))!;
    expect(prompts[0]!.user).toContain(similar.text);
    expect(prompts[1]!.user).toContain("Als richtig markiert: 6");
    expect((await store.recentGenerationLog(5))[0]).toMatchObject({ ok: 1 });
  });

  it("retries up to 3 times: invalid JSON, duplicate, rejected check", async () => {
    const { store } = sqliteStore();
    const { model } = scripted([
      { text: "x", options: ["a"], correctIndex: 5 }, // invalid schema
      { ...goodQuiz, text: original.text }, // duplicate
      goodQuiz,
      { ok: false, reason: "zwei Antworten richtig" },
    ]);
    const result = await replaceQuestion(deps(store, model), { id: original.id, categoryId: "quiz" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Prüfung abgelehnt: zwei Antworten richtig");
    expect(await store.listGenerated()).toHaveLength(0);
    expect((await store.recentGenerationLog(5))[0]).toMatchObject({ ok: 0, model_calls: 4 });
  });

  it("succeeds on the third attempt", async () => {
    const { store } = sqliteStore();
    const { model } = scripted([new Error("OpenAI HTTP 500"), goodQuiz, { ok: false }, goodQuiz, { ok: true }]);
    const result = await replaceQuestion(deps(store, model), { id: original.id, categoryId: "quiz" });
    expect(result).toEqual({ ok: true, id: "quiz-gen-id2" });
  });

  it("respects the daily limit", async () => {
    const { store } = sqliteStore();
    for (let i = 0; i < 2; i++) {
      await store.logGeneration({ created_at: startOfUtcDay(T0) + i, category_id: "quiz", replaces_id: null, ok: 1, model_calls: 2, message: null });
    }
    const model = vi.fn<JsonModel>();
    const result = await replaceQuestion(deps(store, model, { dailyLimit: 2 }), { id: original.id, categoryId: "quiz" });
    expect(result).toEqual({ ok: false, error: "Tageslimit erreicht (2 pro Tag)." });
    expect(model).not.toHaveBeenCalled();
    // Yesterday's generations don't count.
    const other = sqliteStore().store;
    await other.logGeneration({ created_at: startOfUtcDay(T0) - 1, category_id: "quiz", replaces_id: null, ok: 1, model_calls: 2, message: null });
    const { model: m2 } = scripted([goodQuiz, { ok: true }]);
    expect((await replaceQuestion(deps(other, m2, { dailyLimit: 1 }), { id: original.id, categoryId: "quiz" })).ok).toBe(true);
  });

  it("estimate: builds a valid estimate item", async () => {
    const { store } = sqliteStore();
    const { model } = scripted([
      { text: "In welchem Jahr fiel die Berliner Mauer?", answer: 1989, unit: "", format: "year", zeroRange: 30, fact: "Am 9. November 1989." },
      { ok: true },
    ]);
    const result = await replaceQuestion(deps(store, model), { id: "estimate-001", categoryId: "estimate" });
    expect(result.ok).toBe(true);
    expect(JSON.parse((await store.listGenerated())[0]!.payload)).toMatchObject({ answer: 1989, format: "year", zeroRange: 30 });
  });

  it("fails cleanly without API key, generator or database", async () => {
    const { store } = sqliteStore();
    expect(await replaceQuestion(deps(store, null), { id: original.id, categoryId: "quiz" })).toEqual({ ok: false, error: "OPENAI_API_KEY fehlt." });
    expect(await store.generationsSince(0)).toBe(0); // no model call → not counted
    expect((await replaceQuestion(deps(store, scripted([]).model), { id: "x", categoryId: "unknown" })).ok).toBe(false);
    expect((await replaceQuestion(deps(store, scripted([]).model), { id: "quiz-nope", categoryId: "quiz" })).ok).toBe(false);
    expect(await replaceQuestion(deps(brokenStore(), scripted([]).model), { id: original.id, categoryId: "quiz" })).toEqual({
      ok: false,
      error: "Datenbank nicht erreichbar.",
    });
  });
});
