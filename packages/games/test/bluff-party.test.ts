import { BLUFF_WORDS_DE } from "@couch-clash/content";
import type { GameModeSettings, ModuleContext, ModulePlayer } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { judgePrompt } from "../src/bluff/judge";
import { bluffMeta } from "../src/bluff/meta";
import { createBluffModule, type BluffState } from "../src/bluff/module";
import type { BluffAction } from "../src/bluff/types";

const T0 = 1_700_000_000_000;
const family: GameModeSettings = { mode: "family", allow16: false, difficulty: "mixed" };
const party: GameModeSettings = { mode: "party", allow16: false, difficulty: "mixed" };

function seeded(seed = 3) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const ctx = (now: number, players: ModulePlayer[], random = seeded()): ModuleContext => ({ now, players, random });

describe("Bluff-Lexikon in the game modes", () => {
  it("Familie never gets a party word", () => {
    const mod = createBluffModule();
    for (let seed = 1; seed <= 20; seed++) {
      const s = mod.init(ctx(T0, [], seeded(seed)), { questionCount: 10, scoring: bluffMeta.scoring, excludeContentIds: [], mode: family }).state;
      expect(s.words.every((w) => !w.adult)).toBe(true);
    }
  });

  it("Party: ceil(30 %) of the words from the party set, spread out", () => {
    const mod = createBluffModule();
    for (let seed = 1; seed <= 20; seed++) {
      const s = mod.init(ctx(T0, [], seeded(seed)), { questionCount: 9, scoring: bluffMeta.scoring, excludeContentIds: [], mode: party }).state;
      expect(s.words.filter((w) => w.adult)).toHaveLength(3);
      expect(["PffPffPff", "fPffPffPf"]).toContain(s.words.map((w) => (w.adult ? "P" : "f")).join(""));
      expect(s.mode).toBe("party");
    }
    const five = mod.init(ctx(T0, []), { questionCount: 5, scoring: bluffMeta.scoring, excludeContentIds: [], mode: party }).state;
    expect(five.words.filter((w) => w.adult)).toHaveLength(2);
  });

  it("the party set is real content: adult, age 18, 85 words", () => {
    const adult = BLUFF_WORDS_DE.filter((w) => w.adult);
    expect(adult).toHaveLength(85);
    expect(adult.every((w) => w.ageRating === 18)).toBe(true);
  });

  it("the judge's offensive rule depends on the mode", () => {
    const fam = judgePrompt("der Singultus", "Schluckauf", [], "family").system;
    const par = judgePrompt("der Singultus", "Schluckauf", [], "party").system;
    expect(fam).toMatch(/sexuell oder anzüglich/);
    expect(par).toMatch(/Anzügliche, freche Antworten sind hier erlaubt/);
    expect(par).toMatch(/explizite sexuelle Beschreibungen/);
  });
});

describe("Bluff scoring with 10 players", () => {
  it("fooling 5 of 9 gives +56, not +250", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const ps = ids.map((id) => ({ id, connected: true }));
    const word = BLUFF_WORDS_DE.find((w) => !w.adult)!;
    const mod = createBluffModule([word]);
    let now = T0;
    let s: BluffState = mod.init(ctx(now, ps), { questionCount: 1, scoring: bluffMeta.scoring, excludeContentIds: [] }).state;
    for (const id of ids) {
      const r = mod.handleAction(s, { type: "define", text: `Erfindung Nummer ${id}` } as BluffAction, id, ctx(++now, ps));
      if ("error" in r) throw new Error(r.error);
      s = r.state;
    }
    s = mod.onTimer(s, ctx(++now, ps)).state; // judge timeout → as written
    s = mod.onTimer(s, ctx(++now, ps)).state; // present → vote
    const philip = s.options!.findIndex((o) => o.authors.includes("p0"));
    const real = s.options!.findIndex((o) => o.correct);
    const other = s.options!.findIndex((o) => o.authors.includes("p9"));
    for (const [i, id] of ids.entries()) {
      const option = id === "p0" ? real : i <= 5 ? philip : id === "p9" ? real : other;
      const r = mod.handleAction(s, { type: "vote", option } as BluffAction, id, ctx(++now, ps));
      if ("error" in r) throw new Error(`${id}: ${r.error}`);
      s = r.state;
    }
    expect(s.step).toBe("reveal");
    expect(s.results!.p0).toMatchObject({ fooled: 5, eligibleVoters: 9, foolBonus: 56, findPoints: 100, finalScore: 156 });
    // Nobody gets more than 200 in one word.
    for (const r of Object.values(s.results!)) expect(r.finalScore).toBeLessThanOrEqual(200);
  });
});
