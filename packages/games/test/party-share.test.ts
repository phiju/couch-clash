/**
 * The party share in EVERY game: a round of N items in Party mode gets
 * max(1, ceil(N × share)) party items (adult) – spread, never all at the end –
 * Kids / Familie never get one, and an exhausted party pool falls back to the
 * family pool without crashing.
 */
import {
  BLUFF_WORDS_DE,
  ESTIMATE_QUESTIONS_DE,
  FUEHRERSCHEIN_QUESTIONS_DE,
  PIXELPANIK_MOTIFS,
  QUIZ_QUESTIONS_DE,
  SKURRIL_STORIES_DE,
} from "@couch-clash/content";
import {
  PARTY_CONFIG,
  partyCountFor,
  eligibleForMode,
  partyShareOf,
  type GameModeSettings,
  type ModuleContext,
  type ModuleInitOptions,
  type PartyShare,
} from "@couch-clash/shared";
import { describe, expect, it, vi } from "vitest";
import { GAME_MODULES, normalizeScoring, type CategoryId } from "../src";
import { CATEGORY_METAS, planGame } from "../src/meta";
import { categoryPickGame } from "../src/category-pick/module";
import { isPartyItem, partySlots, selectWithPartyShare } from "../src/party-share";
import { motifFlags, playableMotifs } from "../src/pixelpanik/module";

function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const ctx = (random = seeded()): ModuleContext => ({ now: 1_700_000_000_000, players: [], random });

const party = (partyShare?: PartyShare): GameModeSettings => ({
  mode: "party",
  allow16: false,
  difficulty: "mixed",
  ...(partyShare ? { partyShare } : {}),
});
const family: GameModeSettings = { mode: "family", allow16: true, difficulty: "mixed" };
const kids: GameModeSettings = { mode: "kids", allow16: false, difficulty: "mixed" };

/** Every game and the party ids of the content it plays. */
const POOLS: Record<CategoryId, readonly { id: string; adult?: boolean }[]> = {
  quiz: QUIZ_QUESTIONS_DE,
  "category-pick": QUIZ_QUESTIONS_DE,
  "double-or-nothing": QUIZ_QUESTIONS_DE,
  bet: QUIZ_QUESTIONS_DE,
  steal: QUIZ_QUESTIONS_DE,
  estimate: ESTIMATE_QUESTIONS_DE,
  fuehrerschein: FUEHRERSCHEIN_QUESTIONS_DE,
  bluff: BLUFF_WORDS_DE,
  skurril: SKURRIL_STORIES_DE,
  survival: QUIZ_QUESTIONS_DE,
  // Only motifs with pictures are played (the image script adds them).
  pixelpanik: playableMotifs(PIXELPANIK_MOTIFS).map((m) => ({ id: m.id, ...motifFlags(m) })),
};
// The Survival-Finale has no fixed round (it draws questions one by one) – tested in survival.test.ts.
// Pixelpanik needs pictures – the same checks run on a pool with pictures in pixelpanik.test.ts.
const GAMES = (Object.keys(GAME_MODULES) as CategoryId[]).filter((id) => !GAME_MODULES[id].meta.finale && id !== "pixelpanik");
const partyIds = (id: CategoryId) => POOLS[id].filter((x) => x.adult).map((x) => x.id);

/** The items a round plays, in order (Kategorienvorgabe draws them one by one after each pick). */
function playRound(id: CategoryId, questionCount: number, mode: GameModeSettings, extra: Partial<ModuleInitOptions> = {}, seed = 7) {
  const module = GAME_MODULES[id];
  const options: ModuleInitOptions = {
    questionCount,
    scoring: normalizeScoring(module.meta, module.meta.scoring),
    excludeContentIds: [],
    mode,
    ...extra,
  };
  const random = seeded(seed);
  if (id === "category-pick") {
    const def = categoryPickGame(QUIZ_QUESTIONS_DE);
    let { game } = def.init(ctx(random), options, QUIZ_QUESTIONS_DE);
    const out: { id: string; party: boolean }[] = [];
    for (let index = 0; index < questionCount; index++) {
      game = def.startQuestion!(game, { index, ctx: ctx(random), scores: {} });
      if (game.offer.length) game = { ...game, selectedCategory: game.offer[0]!, pickedBy: "picker" };
      const drawn = def.drawQuestion!(game, index, ctx(random));
      if (!drawn) break;
      game = drawn.game;
      out.push({ id: drawn.question.id, party: isPartyItem(drawn.question) });
    }
    return out;
  }
  const state = module.init(ctx(random), options).state as { questions?: unknown[]; words?: unknown[] };
  const items = (state.questions ?? state.words ?? []) as { id: string }[];
  return items.map((x) => ({ id: x.id, party: isPartyItem(x) }));
}

describe("partyCountFor: max(1, ceil(N × share))", () => {
  it.each([
    [1, 1],
    [3, 1],
    [5, 2],
    [8, 3],
    [10, 3],
  ])("N = %i → %i party items at 30 %%", (n, want) => {
    expect(partyCountFor(n, 0.3)).toBe(want);
  });

  it("50 % / 100 %, no party outside Party mode", () => {
    expect([1, 3, 5, 8, 10].map((n) => partyCountFor(n, 0.5))).toEqual([1, 2, 3, 4, 5]);
    expect([1, 3, 5, 8, 10].map((n) => partyCountFor(n, 1))).toEqual([1, 3, 5, 8, 10]);
    expect(partyCountFor(0, 0.3)).toBe(0);
    expect(partyShareOf(family)).toBe(0);
    expect(partyShareOf(kids)).toBe(0);
    expect(partyShareOf(party())).toBe(PARTY_CONFIG.defaultShare);
    expect(PARTY_CONFIG.defaultShare).toBe(0.3);
    expect(partyShareOf(party(1))).toBe(1);
  });
});

describe("partySlots: spread over the round", () => {
  it("evenly spread, the first one at position 1 or 2, all within the round", () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const n of [1, 3, 5, 8, 10, 15]) {
        for (const share of PARTY_CONFIG.shares) {
          const k = partyCountFor(n, share);
          const slots = partySlots(n, k, seeded(seed));
          expect(new Set(slots).size).toBe(k);
          expect(slots.every((s) => s >= 0 && s < n)).toBe(true);
          expect(slots[0]).toBeLessThanOrEqual(1);
          // Gaps never bigger than ceil(n / k) + 1 – no clumps at the end.
          for (let i = 1; i < slots.length; i++) expect(slots[i]! - slots[i - 1]!).toBeLessThanOrEqual(Math.ceil(n / k) + 1);
        }
      }
    }
  });
});

describe.each(GAMES)("party share: %s", (id) => {
  const module = GAME_MODULES[id];

  it.each([1, 3, 5, 8, 10])("Party 30 %%, N = %i: exactly max(1, ceil(N × 0.3)) party items", (n) => {
    for (const seed of [1, 7, 42]) {
      const items = playRound(id, n, party(), {}, seed);
      expect(items).toHaveLength(n);
      expect(items.filter((x) => x.party)).toHaveLength(partyCountFor(n, 0.3));
      expect(new Set(items.map((x) => x.id)).size).toBe(n);
    }
  });

  it.each([1, 3, 5, 8, 10])("Party 50 %% / 100 %%, N = %i", (n) => {
    expect(playRound(id, n, party(0.5)).filter((x) => x.party)).toHaveLength(partyCountFor(n, 0.5));
    const all = playRound(id, n, party(1));
    expect(all).toHaveLength(n);
    expect(all.every((x) => x.party)).toBe(true);
  });

  it("spread: the first party item comes at position 1 or 2, never all at the end", () => {
    for (let seed = 1; seed <= 15; seed++) {
      const items = playRound(id, 10, party(), {}, seed);
      const at = items.flatMap((x, i) => (x.party ? [i] : []));
      expect(at[0]).toBeLessThanOrEqual(1);
      expect(at.some((i) => i < 5)).toBe(true);
      expect(at.some((i) => i >= 5)).toBe(true);
    }
  });

  it("Familie and Kids never get an adult item", () => {
    for (const mode of [family, kids]) {
      if (!module.meta.modes.includes(mode.mode)) continue;
      for (let seed = 1; seed <= 10; seed++) {
        for (const n of [1, 5, 10]) expect(playRound(id, n, mode, {}, seed).some((x) => x.party)).toBe(false);
      }
    }
  });

  it("party pool exhausted → logged, the family pool fills up, no crash", () => {
    const log = vi.fn();
    const items = playRound(id, 10, party(), { excludeContentIds: partyIds(id), log });
    expect(items).toHaveLength(10);
    expect(items.some((x) => x.party)).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("party pool"), expect.objectContaining({ label: id, wanted: 3, unplayedParty: 0 }));
  });

  it("only one unplayed party item left → that one, the rest family", () => {
    const [keep, ...played] = partyIds(id);
    const items = playRound(id, 10, party(), { excludeContentIds: played });
    expect(items).toHaveLength(10);
    expect(items.filter((x) => x.party).map((x) => x.id)).toEqual([keep]);
  });

  it("has enough party content for a full round at 100 %", () => {
    expect(partyIds(id).length).toBeGreaterThanOrEqual(module.meta.questionsPerRound.max);
  });
});

describe("selectWithPartyShare", () => {
  const item = (id: string, adult = false) => ({ id, difficulty: 2, adult });
  const fam = Array.from({ length: 5 }, (_, i) => item(`f${i}`));
  const par = Array.from({ length: 20 }, (_, i) => item(`p${i}`, true));

  it("family pool too small → party items fill up (the round is never short)", () => {
    const out = selectWithPartyShare([...fam, ...par], 10, { mode: party(), excludeContentIds: [] }, seeded());
    expect(out).toHaveLength(10);
    expect(out.filter((x) => x.adult)).toHaveLength(5);
  });

  it("more items than exist → as many as there are", () => {
    expect(selectWithPartyShare(fam.slice(0, 2), 5, { mode: party(), excludeContentIds: [] }, seeded())).toHaveLength(2);
    expect(selectWithPartyShare([], 5, { mode: party(), excludeContentIds: [] }, seeded())).toEqual([]);
  });

  it("no mode → no party share", () => {
    const out = selectWithPartyShare(fam, 3, { excludeContentIds: [] }, seeded());
    expect(out).toHaveLength(3);
  });
});

describe("commentary: partyItem flag in the reveal facts", () => {
  /** Run the round until the host gets facts (nobody answers). */
  function factsOf(id: CategoryId, mode: GameModeSettings) {
    const module = GAME_MODULES[id];
    let state = module.init(ctx(), {
      questionCount: 1,
      scoring: normalizeScoring(module.meta, module.meta.scoring),
      excludeContentIds: [],
      mode,
    }).state;
    for (let i = 0; i < 6; i++) {
      const facts = module.revealFacts?.(state);
      if (facts) return facts;
      state = module.onTimer(state, ctx()).state;
    }
    return null;
  }

  it("estimates are marked for the host (wild estimates / bullseyes), quiz answers are not", () => {
    expect(factsOf("estimate", family)?.answerKind).toBe("estimate");
    expect(factsOf("quiz", family)?.answerKind).toBeUndefined();
    expect(factsOf("fuehrerschein", family)?.answerKind).toBeUndefined();
  });

  it.each(GAMES.filter((id) => id !== "category-pick"))("%s: party item → partyItem: true, family item → none", (id) => {
    expect(factsOf(id, party(1))?.partyItem).toBe(true);
    const fam = factsOf(id, family);
    if (fam) expect(fam.partyItem).toBeUndefined();
  });
});

describe("Zufall (planGame) keeps the share in every round", () => {
  it.each(PARTY_CONFIG.shares)("Party %s: each planned round gets its own party count", (share) => {
    const mode = party(share);
    const pools = Object.fromEntries(
      CATEGORY_METAS.map((m) => [m.id, POOLS[m.id as CategoryId].filter((x) => eligibleForMode(x as never, mode, m)).length]),
    );
    for (const seed of [1, 2, 3]) {
      const plan = planGame({ mode: "party", targetMinutes: 60, categories: CATEGORY_METAS, pools, random: seeded(seed) });
      expect(plan.rounds.length).toBeGreaterThan(1);
      const used: string[] = [];
      for (const round of plan.rounds) {
        const id = round.categoryId as CategoryId;
        const items = playRound(id, round.questionCount, mode, { excludeContentIds: [...used] }, seed);
        expect(items, id).toHaveLength(round.questionCount);
        expect(items.filter((x) => x.party).length, id).toBe(partyCountFor(round.questionCount, share));
        used.push(...items.map((x) => x.id));
      }
    }
  });
});
