import type { AdminQuestion } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { applyView, DEFAULT_VIEW, quickCounts, toCsv } from "../src/lib/admin-view";

const q = (over: Partial<AdminQuestion>): AdminQuestion => ({
  id: "quiz-001",
  categoryId: "quiz",
  text: "Frage",
  answer: "A",
  difficulty: 2,
  ageRating: 6,
  tags: ["wissen"],
  plays: 0,
  answers: 0,
  correctRate: null,
  avgErrorPct: null,
  avgResponseMs: null,
  thumbsUp: 0,
  thumbsDown: 0,
  reports: 0,
  status: "active",
  lastPlayedAt: null,
  generated: false,
  replacesId: null,
  createdAt: null,
  payload: null,
  modes: ["family", "party"],
  ...over,
});

const ROWS = [
  q({ id: "quiz-001", text: "Wie viele Beine hat eine Spinne?", plays: 5, correctRate: 0.9, status: "quarantined", reports: 1 }),
  q({ id: "quiz-002", text: "Welcher Planet ist der Sonne am nächsten?", plays: 2, correctRate: 0.5 }),
  q({ id: "estimate-001", categoryId: "estimate", text: "Wie hoch ist der Eiffelturm?", plays: 8, avgErrorPct: 0.2, answer: "330 m" }),
  q({ id: "quiz-gen-a", text: "Käfer?", generated: true }),
];

describe("admin view", () => {
  it("filters by category, quick filter and search (case/umlaut-insensitive)", () => {
    expect(applyView(ROWS, { ...DEFAULT_VIEW, category: "estimate" }).map((r) => r.id)).toEqual(["estimate-001"]);
    expect(applyView(ROWS, { ...DEFAULT_VIEW, quick: "quarantined" }).map((r) => r.id)).toEqual(["quiz-001"]);
    expect(applyView(ROWS, { ...DEFAULT_VIEW, quick: "generated" }).map((r) => r.id)).toEqual(["quiz-gen-a"]);
    expect(applyView(ROWS, { ...DEFAULT_VIEW, search: "NACHSTEN" }).map((r) => r.id)).toEqual(["quiz-002"]);
    expect(applyView(ROWS, { ...DEFAULT_VIEW, search: "330" }).map((r) => r.id)).toEqual(["estimate-001"]);
  });

  it("filters by game mode", () => {
    const rows = [q({ id: "k", modes: ["kids", "family", "party"] }), q({ id: "p", modes: ["party"] })];
    expect(applyView(rows, { ...DEFAULT_VIEW, mode: "kids" }).map((r) => r.id)).toEqual(["k"]);
    expect(applyView(rows, { ...DEFAULT_VIEW, mode: "party" }).map((r) => r.id)).toEqual(["k", "p"]);
  });

  it("sorts by plays and by score (empty values last)", () => {
    expect(applyView(ROWS, { ...DEFAULT_VIEW, sort: "plays", desc: true }).map((r) => r.id)).toEqual([
      "estimate-001",
      "quiz-001",
      "quiz-002",
      "quiz-gen-a",
    ]);
    // estimate: 1 − 20 % error = 0.8
    expect(applyView(ROWS, { ...DEFAULT_VIEW, sort: "score", desc: false }).map((r) => r.id)).toEqual([
      "quiz-002",
      "estimate-001",
      "quiz-001",
      "quiz-gen-a",
    ]);
  });

  it("counts quick filters", () => {
    const counts = quickCounts(ROWS, ["quarantined", "neverPlayed", "reported"]);
    expect(counts).toEqual({ quarantined: 1, neverPlayed: 1, reported: 1 });
  });

  it("exports the current view as CSV with quoting and no formula injection", () => {
    const csv = toCsv([q({ text: 'Sagt "Hallo", oder?', answer: "=SUM(A1)" })]);
    const [header, line] = csv.trim().split("\r\n");
    expect(header!.split(",")[0]).toBe("id");
    expect(line).toContain('"Sagt ""Hallo"", oder?"');
    expect(line).toContain("'=SUM(A1)");
  });
});
