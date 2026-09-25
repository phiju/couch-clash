import type { ScoringSettings } from "@couch-clash/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advance, beginGame, endGame, handlePlayerAction, updateSettings, type FlowDeps } from "../src/game-flow";
import { progressOf } from "../src/progress";
import type { Result } from "../src/result";
import { createRoomRecord, joinPlayer, type RoomRecord } from "../src/room-logic";
import { invalidateContentFilter, loadContentFilter, CONTENT_FILTER_TTL_MS } from "../src/stats/content-filter";
import { REPORT_UNDO_MS, StatsRecorder } from "../src/stats/recorder";
import type { StatsStore } from "../src/stats/store";
import { brokenStore, sqliteStore } from "./stats-helpers";

const T0 = 1_700_000_000_000;
const avatar = { character: "fox", color: "red" } as const;
const scoring: ScoringSettings = {
  mode: "absolute",
  maxPoints: 100,
  speedModifier: { enabled: false, fastestMultiplier: 1.5, slowestMultiplier: 0.5 },
};

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

beforeEach(() => invalidateContentFilter());
afterEach(() => vi.restoreAllMocks());

function setup(store: StatsStore | null, flow: Partial<FlowDeps> = {}) {
  let room = createRoomRecord("ABCD", "host-token-0123456789abcdef", T0);
  const ids: string[] = [];
  for (const name of ["Anna", "Ben"]) {
    const r = unwrap(joinPlayer(room, { name, avatar }, { now: T0 }));
    room = r.room;
    ids.push(r.player.id);
  }
  const rt = { room: room as RoomRecord | null, now: T0, tasks: [] as Promise<unknown>[] };
  const recorder: StatsRecorder = new StatsRecorder({
    read: () => rt.room,
    commit: async (next) => commit(next),
    store: () => store,
    waitUntil: (p) => rt.tasks.push(p),
    now: () => rt.now,
  });
  const commit = async (next: RoomRecord) => {
    const prev = rt.room;
    rt.room = next;
    recorder.roomChanged(prev, next);
  };
  const deps = (): FlowDeps => ({ now: rt.now, random: () => 0.4, connectedPlayerIds: new Set(ids), ...flow });
  const settle = async () => {
    while (rt.tasks.length) await Promise.all(rt.tasks.splice(0));
  };
  const start = async (count = 3) => {
    await commit(unwrap(updateSettings(rt.room!, [{ categoryId: "quiz", questionCount: count, scoring }])));
    await commit(unwrap(beginGame(rt.room!, deps())));
    await commit(unwrap(advance(rt.room!, deps()))); // intro → question 1
  };
  const next = async () => {
    rt.now += 1000;
    await commit(unwrap(advance(rt.room!, deps())));
  };
  const answerAll = async () => {
    const q = (rt.room!.game!.moduleState as { questions: { correctIndex: number }[]; index: number });
    const correct = q.questions[q.index]!.correctIndex;
    rt.now += 2000;
    await commit(unwrap(handlePlayerAction(rt.room!, ids[0]!, { type: "answer", value: correct }, deps())));
    await commit(unwrap(handlePlayerAction(rt.room!, ids[1]!, { type: "answer", value: (correct + 1) % 4 }, deps())));
  };
  const current = () => progressOf(rt.room)!;
  return { rt, recorder, ids, commit, deps, settle, start, next, answerAll, current };
}

describe("stats recorder", () => {
  it("writes one upsert per question at the reveal (not again at the leaderboard)", async () => {
    const { store } = sqliteStore();
    const t = setup(store);
    await t.start();
    await t.answerAll(); // → reveal
    const id = t.current().contentId!;
    await t.next(); // → leaderboard
    await t.settle();
    const rows = await store.listStats();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ question_id: id, category_id: "quiz", plays: 1, answers: 2, correct: 1 });
  });

  it("collects 👍/👎 (one per player, changeable) and writes counts when the question ends", async () => {
    const { store } = sqliteStore();
    const t = setup(store);
    await t.start();
    const id = t.current().contentId!;
    // Not before the reveal.
    expect(await t.recorder.rate(t.ids[0]!, id, "up")).toEqual({ ok: false, error: "WRONG_PHASE" });
    await t.answerAll();
    expect((await t.recorder.rate(t.ids[0]!, id, "up")).ok).toBe(true);
    expect((await t.recorder.rate(t.ids[1]!, id, "up")).ok).toBe(true);
    expect((await t.recorder.rate(t.ids[1]!, id, "down")).ok).toBe(true); // changed
    await t.next(); // leaderboard – still rateable
    expect((await t.recorder.rate(t.ids[0]!, id, "down")).ok).toBe(true);
    expect((await t.recorder.rate(t.ids[0]!, "quiz-999", "up")).ok).toBe(false); // other question
    expect((await t.recorder.rate("stranger", id, "up")).ok).toBe(false);
    await t.settle();
    expect((await store.listStats())[0]).toMatchObject({ thumbs_up: 0, thumbs_down: 0 });
    await t.next(); // next question → counts written
    await t.settle();
    expect((await store.listStats()).find((r) => r.question_id === id)).toMatchObject({ thumbs_up: 0, thumbs_down: 2 });
    expect(t.rt.room!.questionVotes).toBeNull();
  });

  it("writes pending votes when the game is aborted", async () => {
    const { store } = sqliteStore();
    const t = setup(store);
    await t.start();
    await t.answerAll();
    const id = t.current().contentId!;
    await t.recorder.rate(t.ids[0]!, id, "up");
    await t.commit(unwrap(endGame(t.rt.room!, t.rt.now)));
    await t.settle();
    expect((await store.listStats()).find((r) => r.question_id === id)?.thumbs_up).toBe(1);
  });

  it("thumbs-down never changes the status", async () => {
    const { store } = sqliteStore();
    const t = setup(store);
    await t.start();
    await t.answerAll();
    const id = t.current().contentId!;
    for (const p of t.ids) await t.recorder.rate(p, id, "down");
    await t.next();
    await t.next();
    await t.settle();
    expect(await store.blockedIds()).toEqual([]);
  });

  it("report quarantines immediately; undo within 10 s restores it", async () => {
    const { store } = sqliteStore();
    const t = setup(store);
    await t.start();
    const id = t.current().contentId!;
    expect(t.recorder.report(id).ok).toBe(false); // only after the reveal
    await t.answerAll();
    expect(t.recorder.report(id).ok).toBe(true);
    expect(t.recorder.report(id).ok).toBe(true); // double tap → counted once
    await t.settle();
    expect(await store.blockedIds()).toEqual([id]);
    expect((await store.listStats())[0]).toMatchObject({ reports: 1, status: "quarantined" });
    t.rt.now += 5000;
    expect(t.recorder.undoReport(id).ok).toBe(true);
    await t.settle();
    expect(await store.blockedIds()).toEqual([]);
    expect((await store.listStats())[0]).toMatchObject({ reports: 0, status: "active" });
  });

  it("undo is refused after 10 s", async () => {
    const { store } = sqliteStore();
    const t = setup(store);
    await t.start();
    await t.answerAll();
    const id = t.current().contentId!;
    t.recorder.report(id);
    t.rt.now += REPORT_UNDO_MS + 1;
    expect(t.recorder.undoReport(id)).toEqual({ ok: false, error: "WRONG_PHASE" });
    await t.settle();
    expect(await store.blockedIds()).toEqual([id]);
  });

  it("D1 unavailable: the game goes on, errors are only logged (without names)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = setup(brokenStore());
    await t.start();
    await t.answerAll();
    const id = t.current().contentId!;
    expect((await t.recorder.rate(t.ids[0]!, id, "up")).ok).toBe(true);
    expect(t.recorder.report(id).ok).toBe(true);
    await t.next();
    await t.next();
    await t.settle();
    expect(t.current().index).toBe(1);
    expect(warn).toHaveBeenCalled();
    for (const call of warn.mock.calls) expect(String(call[0])).not.toMatch(/Anna|Ben/);
  });

  it("no database configured → nothing is written, nothing fails", async () => {
    const t = setup(null);
    await t.start();
    await t.answerAll();
    expect(t.recorder.report(t.current().contentId!).ok).toBe(true);
    await t.settle();
  });
});

describe("content filter", () => {
  it("loads blocked ids + active generated questions and caches them ~5 min", async () => {
    const { store } = sqliteStore();
    await store.report("quiz", "quiz-001", T0);
    await store.insertGenerated({ id: "quiz-gen-a", category_id: "quiz", payload: '{"id":"quiz-gen-a"}', replaces_id: null, status: "active", created_at: T0 });
    await store.insertGenerated({ id: "quiz-gen-b", category_id: "quiz", payload: "{broken", replaces_id: null, status: "active", created_at: T0 });
    const spy = vi.spyOn(store, "blockedIds");
    const filter = await loadContentFilter(store, T0);
    expect([...filter!.blocked]).toEqual(["quiz-001"]);
    expect(filter!.extra.quiz).toEqual([{ id: "quiz-gen-a" }]);
    await loadContentFilter(store, T0 + CONTENT_FILTER_TTL_MS - 1);
    expect(spy).toHaveBeenCalledTimes(1);
    await loadContentFilter(store, T0 + CONTENT_FILTER_TTL_MS);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("D1 down → null (play without the filter), or the last cached filter", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await loadContentFilter(brokenStore(), T0)).toBeNull();
    const { store } = sqliteStore();
    await store.report("quiz", "quiz-001", T0);
    await loadContentFilter(store, T0);
    expect([...(await loadContentFilter(brokenStore(), T0 + CONTENT_FILTER_TTL_MS))!.blocked]).toEqual(["quiz-001"]);
  });

  it("blocked questions are never selected when a round starts", async () => {
    const { store } = sqliteStore();
    const blocked = ["quiz-001", "quiz-002", "quiz-003", "quiz-004", "quiz-005"];
    for (const id of blocked) await store.report("quiz", id, T0);
    const content = await loadContentFilter(store, T0);
    for (let i = 0; i < 10; i++) {
      const t = setup(null, { content, random: () => (i * 0.097) % 1 });
      await t.start(10);
      const ids = (t.rt.room!.game!.moduleState as { questions: { id: string }[] }).questions.map((q) => q.id);
      expect(ids.some((id) => blocked.includes(id))).toBe(false);
    }
  });
});
