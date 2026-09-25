import { matchesQuickFilter, type AdminQuestion, type AdminQuestionsResponse } from "@couch-clash/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { handleAdmin, type AdminDeps } from "../src/admin/routes";
import type { JsonModel } from "../src/generate/model";
import { invalidateContentFilter, loadContentFilter } from "../src/stats/content-filter";
import type { StatsStore } from "../src/stats/store";
import { brokenStore, sqliteStore } from "./stats-helpers";

const T0 = 1_700_000_000_000;
const TOKEN = "admin-secret-token-123";

beforeEach(() => invalidateContentFilter());

function setup(opts: { token?: string; store?: StatsStore | null; model?: JsonModel } = {}) {
  const sq = sqliteStore();
  const store = opts.store === undefined ? sq.store : opts.store;
  const tasks: Promise<unknown>[] = [];
  const deps: AdminDeps = {
    adminToken: "token" in opts ? opts.token : TOKEN,
    store,
    background: (p) => tasks.push(p),
    replaceDeps: (s) => ({ store: s, model: opts.model ?? null, now: () => T0, newId: () => "r1" }),
    now: () => T0,
  };
  const call = async (path: string, init: RequestInit & { auth?: string | null } = {}) => {
    const headers = new Headers(init.headers);
    const auth = init.auth === undefined ? TOKEN : init.auth;
    if (auth !== null) headers.set("Authorization", `Bearer ${auth}`);
    const request = new Request(`https://party.test${path}`, { ...init, headers });
    const res = await handleAdmin(request, new URL(request.url), deps);
    return res!;
  };
  const settle = async () => {
    while (tasks.length) await Promise.all(tasks.splice(0));
  };
  return { store: sq.store, call, settle };
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

describe("admin auth", () => {
  it("401 without or with a wrong token", async () => {
    const { call } = setup();
    expect((await call("/api/admin/questions", { auth: null })).status).toBe(401);
    expect((await call("/api/admin/questions", { auth: "wrong" })).status).toBe(401);
    expect((await call("/api/admin/questions", { auth: TOKEN + "x" })).status).toBe(401);
    expect((await call("/api/admin/questions/status", { ...post({}), auth: "wrong" })).status).toBe(401);
  });

  it("503 when ADMIN_TOKEN or the database is not set up", async () => {
    expect((await setup({ token: undefined }).call("/api/admin/questions")).status).toBe(503);
    expect((await setup({ store: null }).call("/api/admin/questions")).status).toBe(503);
  });

  it("ignores other paths", async () => {
    const { call } = setup();
    const request = new Request("https://party.test/api/rooms");
    expect(await handleAdmin(request, new URL(request.url), {} as AdminDeps)).toBeNull();
    expect((await call("/api/admin/nope")).status).toBe(404);
  });

  it("D1 down → 503 with a readable error", async () => {
    const { call } = setup({ store: brokenStore() });
    const res = await call("/api/admin/questions");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Datenbank nicht erreichbar." });
  });
});

describe("admin questions", () => {
  it("joins the catalog with the stats", async () => {
    const { call, store } = setup();
    await store.recordPlay("quiz", { contentId: "quiz-001", answers: 4, correct: 3, sumResponseMs: 8000, sumErrorPct: null }, T0);
    await store.recordVotes("quiz", "quiz-001", 1, 2, T0);
    await store.recordPlay("estimate", { contentId: "estimate-001", answers: 2, correct: 0, sumResponseMs: 4000, sumErrorPct: 0.5 }, T0);
    const res = await call("/api/admin/questions");
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminQuestionsResponse;
    expect(body.questions.length).toBeGreaterThanOrEqual(400);
    expect(body.questions.find((q) => q.id === "quiz-001")).toMatchObject({
      categoryId: "quiz",
      answer: "8",
      plays: 1,
      correctRate: 0.75,
      avgErrorPct: null,
      avgResponseMs: 2000,
      thumbsUp: 1,
      thumbsDown: 2,
      status: "active",
      generated: false,
      payload: null,
      modes: ["kids", "family", "party"],
    });
    expect(body.questions.find((q) => q.id === "estimate-001")).toMatchObject({ avgErrorPct: 0.25, correctRate: 0 });
    expect(body.questions.find((q) => q.id === "quiz-002")).toMatchObject({ plays: 0, correctRate: null, lastPlayedAt: null });
    expect(body).toMatchObject({ generationsToday: 0, dailyGenerationLimit: 50 });
  });

  it("bulk status: reactivate and quarantine", async () => {
    const { call, store } = setup();
    const items = [
      { id: "quiz-001", categoryId: "quiz" },
      { id: "quiz-002", categoryId: "quiz" },
    ];
    expect((await call("/api/admin/questions/status", post({ items, status: "quarantined" }))).status).toBe(200);
    expect((await store.blockedIds()).sort()).toEqual(["quiz-001", "quiz-002"]);
    await call("/api/admin/questions/status", post({ items: items.slice(0, 1), status: "active" }));
    expect(await store.blockedIds()).toEqual(["quiz-002"]);
    expect((await call("/api/admin/questions/status", post({ items, status: "bogus" }))).status).toBe(400);
    expect((await call("/api/admin/questions/status", post({ items: [], status: "active" }))).status).toBe(400);
  });

  it("Rauswerfen → removed + an automatic replacement that is played from then on", async () => {
    const answers: unknown[] = [{ text: "Wie viele Beine hat ein Käfer?", options: ["6", "8", "4", "10"], correctIndex: 0 }, { ok: true }];
    const model: JsonModel = async () => answers.shift();
    const { call, store, settle } = setup({ model });
    const res = await call("/api/admin/questions/status", post({ items: [{ id: "quiz-001", categoryId: "quiz" }], status: "removed" }));
    expect(await res.json()).toEqual({ ok: true, replacing: 1 });
    await settle();
    const body = (await (await call("/api/admin/questions")).json()) as AdminQuestionsResponse;
    const gen = body.questions.find((q) => q.id === "quiz-gen-r1")!;
    expect(gen).toMatchObject({ generated: true, replacesId: "quiz-001", status: "active", answer: "6" });
    expect(body.questions.find((q) => q.id === "quiz-001")?.status).toBe("removed");
    expect(body.generationLog[0]).toMatchObject({ ok: true, replacesId: "quiz-001" });
    const filter = await loadContentFilter(store, T0);
    expect(filter!.blocked.has("quiz-001")).toBe(true);
    expect((filter!.extra.quiz as { id: string }[]).map((q) => q.id)).toEqual(["quiz-gen-r1"]);
  });

  it("replacement errors show up in the generation log", async () => {
    const { call, settle } = setup(); // no API key
    await call("/api/admin/questions/status", post({ items: [{ id: "quiz-001", categoryId: "quiz" }], status: "removed" }));
    await settle();
    const body = (await (await call("/api/admin/questions")).json()) as AdminQuestionsResponse;
    expect(body.generationLog[0]).toMatchObject({ ok: false, message: "OPENAI_API_KEY fehlt." });
  });

  it("edits generated questions only, validated with the category schema", async () => {
    const { call, store } = setup();
    const item = { id: "quiz-gen-a", text: "Wie viele Tage hat eine Woche?", ageRating: 6, tags: ["wissen"], difficulty: 1, options: ["7", "5", "6", "8"], correctIndex: 0 };
    await store.insertGenerated({ id: item.id, category_id: "quiz", payload: JSON.stringify(item), replaces_id: "quiz-001", status: "active", created_at: T0 });
    const put = (id: string, payload: unknown) => call(`/api/admin/questions/${id}`, { method: "PUT", body: JSON.stringify({ payload }) });
    expect((await put("quiz-001", item)).status).toBe(404);
    expect((await put(item.id, { ...item, options: ["7", "7", "6", "8"] })).status).toBe(400);
    expect((await put(item.id, { ...item, id: "other-id", text: "Wie viele Tage hat eine normale Woche?" })).status).toBe(200);
    const saved = JSON.parse((await store.listGenerated())[0]!.payload);
    expect(saved).toMatchObject({ id: "quiz-gen-a", text: "Wie viele Tage hat eine normale Woche?" });
  });
});

describe("quick filters", () => {
  const q = (over: Partial<AdminQuestion>): AdminQuestion => ({
    id: "x",
    categoryId: "quiz",
    text: "",
    answer: "",
    source: null,
    difficulty: 2,
    ageRating: 6,
    tags: [],
    plays: 10,
    answers: 20,
    correctRate: 0.6,
    avgErrorPct: null,
    avgResponseMs: 1000,
    thumbsUp: 0,
    thumbsDown: 0,
    reports: 0,
    status: "active",
    lastPlayedAt: T0,
    generated: false,
    replacesId: null,
    createdAt: null,
    payload: null,
    modes: ["kids", "family", "party"],
    ...over,
  });

  it("status, generated, reported, never played", () => {
    expect(matchesQuickFilter(q({ status: "quarantined" }), "quarantined")).toBe(true);
    expect(matchesQuickFilter(q({}), "quarantined")).toBe(false);
    expect(matchesQuickFilter(q({ status: "removed" }), "removed")).toBe(true);
    expect(matchesQuickFilter(q({ generated: true }), "generated")).toBe(true);
    expect(matchesQuickFilter(q({ reports: 1 }), "reported")).toBe(true);
    expect(matchesQuickFilter(q({ plays: 0 }), "neverPlayed")).toBe(true);
    expect(matchesQuickFilter(q({}), "neverPlayed")).toBe(false);
  });

  it("viele 👎: ≥ 3 votes and ≥ 50 % down", () => {
    expect(matchesQuickFilter(q({ thumbsUp: 1, thumbsDown: 2 }), "thumbsDown")).toBe(true);
    expect(matchesQuickFilter(q({ thumbsUp: 2, thumbsDown: 2 }), "thumbsDown")).toBe(true);
    expect(matchesQuickFilter(q({ thumbsUp: 0, thumbsDown: 2 }), "thumbsDown")).toBe(false);
    expect(matchesQuickFilter(q({ thumbsUp: 3, thumbsDown: 2 }), "thumbsDown")).toBe(false);
  });

  it("Schwierigkeit passt nicht: hard but > 80 % right, easy but < 40 %, min 5 plays", () => {
    expect(matchesQuickFilter(q({ difficulty: 3, correctRate: 0.85 }), "difficultyMismatch")).toBe(true);
    expect(matchesQuickFilter(q({ difficulty: 3, correctRate: 0.8 }), "difficultyMismatch")).toBe(false);
    expect(matchesQuickFilter(q({ difficulty: 1, correctRate: 0.3 }), "difficultyMismatch")).toBe(true);
    expect(matchesQuickFilter(q({ difficulty: 1, correctRate: 0.3, plays: 4 }), "difficultyMismatch")).toBe(false);
    expect(matchesQuickFilter(q({ difficulty: 2, correctRate: 0.1 }), "difficultyMismatch")).toBe(false);
  });
});
