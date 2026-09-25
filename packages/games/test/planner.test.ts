import { GAME_MODES, estimateGameSeconds, type CategoryMeta, type GameMode } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { CATEGORY_METAS, planGame, plannableCategories } from "../src/meta";

function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const METAS = CATEGORY_METAS as readonly CategoryMeta[];
const BIG_POOLS = { quiz: 500, estimate: 500, bluff: 500 };
const byId = new Map(METAS.map((m) => [m.id, m]));

describe("planGame", () => {
  for (const mode of GAME_MODES) {
    for (const minutes of [15, 30, 60, 90]) {
      it(`${mode}, ${minutes} min: within ±10 %, min/max respected, only available categories`, () => {
        for (let seed = 1; seed <= 20; seed++) {
          const plan = planGame({ mode, targetMinutes: minutes, categories: METAS, pools: BIG_POOLS, random: seeded(seed), playerCount: 4 });
          expect(plan.rounds.length).toBeGreaterThanOrEqual(2);
          expect(Math.abs(plan.estimatedSeconds - minutes * 60)).toBeLessThanOrEqual(minutes * 60 * 0.1);
          for (const r of plan.rounds) {
            const meta = byId.get(r.categoryId)!;
            expect(meta.modes).toContain(mode);
            expect(r.questionCount).toBeGreaterThanOrEqual(meta.questionsPerRound.min);
            expect(r.questionCount).toBeLessThanOrEqual(meta.questionsPerRound.max);
          }
          // Never the same category twice in a row.
          for (let i = 1; i < plan.rounds.length; i++) expect(plan.rounds[i]!.categoryId).not.toBe(plan.rounds[i - 1]!.categoryId);
          // The estimate is the regular estimate of the plan.
          expect(plan.estimatedSeconds).toBe(
            estimateGameSeconds(plan.rounds.map((r) => ({ meta: byId.get(r.categoryId)!, questionCount: r.questionCount }))),
          );
        }
      });
    }
  }

  it("kids never get the Bluff-Lexikon; the slow category closes family/party games", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const kids = planGame({ mode: "kids", targetMinutes: 45, categories: METAS, pools: BIG_POOLS, random: seeded(seed) });
      expect(kids.rounds.map((r) => r.categoryId)).not.toContain("bluff");
      const family = planGame({ mode: "family", targetMinutes: 45, categories: METAS, pools: BIG_POOLS, random: seeded(seed), playerCount: 3 });
      if (family.rounds.some((r) => r.categoryId === "bluff")) expect(family.rounds.at(-1)!.categoryId).toBe("bluff");
    }
  });

  it("stable with the same seed", () => {
    const a = planGame({ mode: "party", targetMinutes: 60, categories: METAS, pools: BIG_POOLS, random: seeded(42), playerCount: 5 });
    const b = planGame({ mode: "party", targetMinutes: 60, categories: METAS, pools: BIG_POOLS, random: seeded(42), playerCount: 5 });
    expect(a).toEqual(b);
  });

  it("never plans more questions than eligible ones (a repeated category shares its pool)", () => {
    const pools = { quiz: 12, estimate: 9, bluff: 0 };
    for (const minutes of [15, 60, 90]) {
      const plan = planGame({ mode: "kids", targetMinutes: minutes, categories: METAS, pools, random: seeded(3) });
      const used: Record<string, number> = {};
      for (const r of plan.rounds) used[r.categoryId] = (used[r.categoryId] ?? 0) + r.questionCount;
      for (const [id, n] of Object.entries(used)) expect(n).toBeLessThanOrEqual(pools[id as keyof typeof pools]);
    }
  });

  it("no available categories → empty plan, no crash", () => {
    const plan = planGame({ mode: "kids", targetMinutes: 30, categories: METAS, pools: {}, random: seeded(1) });
    expect(plan).toEqual({ rounds: [], estimatedSeconds: 0 });
  });

  it("categories per mode and player count", () => {
    const ids = (mode: GameMode, playerCount?: number) =>
      plannableCategories({ mode, categories: METAS, pools: BIG_POOLS, playerCount }).map((c) => c.id);
    expect(ids("kids")).toEqual(["quiz", "estimate"]);
    expect(ids("family", 3)).toEqual(["quiz", "estimate", "bluff"]);
    expect(ids("family", 1)).toEqual(["quiz", "estimate"]);
    expect(ids("party", 2)).toContain("bluff");
  });
});

describe("mode pools on the real content", () => {
  it("kids: enough questions for quiz and estimate; the round only picks eligible questions", async () => {
    const { GAME_MODULES } = await import("../src");
    const { modePoolSize } = await import("../src/content-pool");
    const kids = { mode: "kids", allow16: false, difficulty: "mixed" } as const;
    expect(modePoolSize(GAME_MODULES.quiz.listContent!(), kids, GAME_MODULES.quiz.meta)).toBeGreaterThanOrEqual(200);
    expect(modePoolSize(GAME_MODULES.estimate.listContent!(), kids, GAME_MODULES.estimate.meta)).toBeGreaterThanOrEqual(90);
    const init = GAME_MODULES.quiz.init(
      { now: 0, players: [{ id: "a", connected: true }], random: seeded(5) },
      { questionCount: 20, scoring: GAME_MODULES.quiz.meta.scoring, excludeContentIds: [], mode: kids },
    );
    const ids = new Set((init.state as { questions: { id: string }[] }).questions.map((q) => q.id));
    const eligible = new Set(
      GAME_MODULES.quiz.listContent!().filter((e) => e.ageRating <= 6 && e.difficulty === 1).map((e) => e.id),
    );
    for (const id of ids) expect(eligible.has(id)).toBe(true);
  });

  it("kids estimate: difficulty up to 2 (kidsMaxDifficulty), quiz stays at 1", async () => {
    const { GAME_MODULES } = await import("../src");
    const kids = { mode: "kids", allow16: false, difficulty: "mixed" } as const;
    expect(GAME_MODULES.estimate.meta.kidsMaxDifficulty).toBe(2);
    expect(GAME_MODULES.quiz.meta.kidsMaxDifficulty ?? 1).toBe(1);
    const init = GAME_MODULES.estimate.init(
      { now: 0, players: [{ id: "a", connected: true }], random: seeded(7) },
      { questionCount: 15, scoring: GAME_MODULES.estimate.meta.scoring, excludeContentIds: [], mode: kids },
    );
    const byId = new Map(GAME_MODULES.estimate.listContent!().map((e) => [e.id, e]));
    const picked = (init.state as { questions: { id: string }[] }).questions.map((q) => byId.get(q.id)!);
    expect(picked).toHaveLength(15);
    for (const e of picked) {
      expect(e.ageRating).toBeLessThanOrEqual(6);
      expect(e.difficulty).toBeLessThanOrEqual(2);
    }
  });

  it("difficulty mix 'hard' prefers hard questions", async () => {
    const { GAME_MODULES } = await import("../src");
    let hard = 0;
    let easy = 0;
    for (const [mix, seed] of [["hard", 1], ["easy", 1]] as const) {
      const init = GAME_MODULES.quiz.init(
        { now: 0, players: [{ id: "a", connected: true }], random: seeded(seed) },
        { questionCount: 20, scoring: GAME_MODULES.quiz.meta.scoring, excludeContentIds: [], mode: { mode: "family", allow16: false, difficulty: mix } },
      );
      const qs = (init.state as { questions: { id: string }[] }).questions.map((q) => q.id);
      const diff = new Map(GAME_MODULES.quiz.listContent!().map((e) => [e.id, e.difficulty]));
      const avg = qs.reduce((s, id) => s + diff.get(id)!, 0) / qs.length;
      if (mix === "hard") hard = avg;
      else easy = avg;
    }
    expect(hard).toBeGreaterThan(easy);
  });
});
