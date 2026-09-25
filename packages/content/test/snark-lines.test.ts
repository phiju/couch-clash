import { describe, expect, it } from "vitest";
import { SNARK_LINES_DE, SNARK_POOLS, SNARK_SITUATIONS, SnarkLinesSchema } from "../src";

const all = Object.values(SNARK_LINES_DE).flatMap((m) => [...m.family, ...m.party, ...m.kids]);

describe("snark lines (host library)", () => {
  it("105 unique lines for every situation; family and kids never empty", () => {
    expect(all).toHaveLength(105);
    expect(new Set(all).size).toBe(105);
    expect(Object.keys(SNARK_LINES_DE).sort()).toEqual([...SNARK_SITUATIONS].sort());
    for (const s of SNARK_SITUATIONS) {
      expect(SNARK_LINES_DE[s].family.length, s).toBeGreaterThan(0);
      expect(SNARK_LINES_DE[s].kids.length, s).toBeGreaterThan(0);
    }
  });

  it("short, spoken sentences without names or placeholders", () => {
    for (const line of all) {
      expect(line.length, line).toBeLessThanOrEqual(100);
      expect(line, line).not.toMatch(/[{}<>@#]|\$\{/);
      expect(line.trim(), line).toBe(line);
    }
  });

  it("kids lines stay gentle: nothing about alcohol", () => {
    for (const s of SNARK_SITUATIONS) {
      for (const line of SNARK_LINES_DE[s].kids) expect(line, line).not.toMatch(/\b(Aperol|Promille|Alkohol|trink\w*|Bar|Wein|Bier|Prost)\b/i);
    }
  });

  it("the schema rejects unknown situations, pools and duplicates", () => {
    expect(SNARK_POOLS).toEqual(["family", "party", "kids"]);
    expect(SnarkLinesSchema.safeParse({ ...SNARK_LINES_DE, dance: SNARK_LINES_DE.wrong }).success).toBe(false);
    expect(SnarkLinesSchema.safeParse({ ...SNARK_LINES_DE, wrong: { ...SNARK_LINES_DE.wrong, adults: [] } }).success).toBe(false);
    expect(SnarkLinesSchema.safeParse({ ...SNARK_LINES_DE, leader: { ...SNARK_LINES_DE.leader, family: [SNARK_LINES_DE.wrong.family[0]] } }).success).toBe(false);
  });
});
