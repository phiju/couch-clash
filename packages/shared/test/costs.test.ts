import { describe, expect, it } from "vitest";
import { costMonths, dailyCosts, fixedCostActive, monthCosts, type AdminCostsResponse, type CostUsageRow } from "../src/costs";

const row = (day: string, kind: CostUsageRow["kind"], calls: number, usd: number, units = 0): CostUsageRow => ({
  day,
  service: units ? "elevenlabs" : "openai",
  kind,
  calls,
  inputTokens: 0,
  outputTokens: 0,
  units,
  usd,
});

const data: AdminCostsResponse = {
  usdToEur: 0.5,
  elevenlabs: null,
  usage: [
    row("2026-08-31", "avatar-round", 1, 1),
    row("2026-09-01", "avatar-round", 2, 0.14),
    row("2026-09-01", "avatar-face", 6, 0.08),
    row("2026-09-02", "avatar-figure", 10, 0.1),
    row("2026-09-02", "voice-speech", 5, 0, 300),
  ],
  fixed: [
    { id: 1, name: "Claude", amount: 100, currency: "EUR", since: "2026-05", until: null, note: null },
    { id: 2, name: "ElevenLabs", amount: 22, currency: "USD", since: "2026-06", until: "2026-08", note: null },
  ],
};

describe("cost overview", () => {
  it("sums a month: measured per kind + running fixed costs, in euros", () => {
    const sep = monthCosts(data, "2026-09");
    expect(sep.byKind.map((k) => [k.kind, k.calls])).toEqual([
      ["avatar-round", 2],
      ["avatar-face", 6],
      ["avatar-figure", 10],
      ["voice-speech", 5],
    ]);
    expect(sep.byKind.find((k) => k.kind === "voice-speech")!.units).toBe(300);
    expect(sep.measuredEur).toBeCloseTo(0.16);
    expect(sep.fixed.map((f) => f.cost.name)).toEqual(["Claude"]);
    expect(sep.totalEur).toBeCloseTo(100.16);
    // (0.14 + 0.08 + 0.1) × 0.5 / 2 avatars
    expect(sep.eurPerAvatar).toBeCloseTo(0.08);
    const aug = monthCosts(data, "2026-08");
    expect(aug.fixedEur).toBeCloseTo(100 + 11);
  });

  it("fixed costs count from `since` up to and including `until`", () => {
    expect(fixedCostActive({ since: "2026-06", until: "2026-08" }, "2026-05")).toBe(false);
    expect(fixedCostActive({ since: "2026-06", until: "2026-08" }, "2026-08")).toBe(true);
    expect(fixedCostActive({ since: "2026-06", until: "2026-08" }, "2026-09")).toBe(false);
    expect(fixedCostActive({ since: "2026-06", until: null }, "2030-01")).toBe(true);
  });

  it("daily costs: one bar per day, days without calls are 0", () => {
    const days = dailyCosts(data, "2026-09-02", 4);
    expect(days.map((d) => d.day)).toEqual(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
    expect(days.map((d) => Math.round(d.eur * 100))).toEqual([0, 50, 11, 5]);
  });

  it("months: every month from the first entry up to now, newest first", () => {
    expect(costMonths(data, "2026-09")).toEqual(["2026-09", "2026-08", "2026-07", "2026-06", "2026-05"]);
    expect(costMonths({ usage: [], fixed: [] }, "2027-01")).toEqual(["2027-01"]);
    expect(costMonths({ usage: [row("2026-12-31", "voice-text", 1, 0)], fixed: [] }, "2027-01")).toEqual(["2027-01", "2026-12"]);
  });
});
