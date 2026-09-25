/**
 * Every game, start to end, with ONE player: the player's moves are the bot
 * moves (GameModule.botAction), AI tasks answer with decoys, timers move on
 * when there is nothing to do. No step may wait for "others".
 */
import {
  BOT_CONFIG,
  DEFAULT_MODE_SETTINGS,
  type BotContext,
  type GameModule,
  type ModuleContext,
  type ModuleUpdate,
} from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { GAME_MODULES, normalizeCategoryOptions } from "../src";
import type { StealExtra } from "../src/knowledge/types";

const ME = "solo";

function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

function playSolo(id: string, seed = 1, opts: { players?: string[]; decoys?: boolean } = {}) {
  const module = GAME_MODULES[id as keyof typeof GAME_MODULES] as GameModule;
  const random = seeded(seed);
  const ids = opts.players ?? [ME];
  let now = 1_700_000_000_000;
  const scores: Record<string, number> = Object.fromEntries(ids.map((p) => [p, 0]));
  const ctx = (): ModuleContext => ({ now, random, players: ids.map((p) => ({ id: p, connected: true })), scores });
  const bot: BotContext = { ...BOT_CONFIG, random };
  const apply = (u: ModuleUpdate<unknown>) => {
    for (const [p, d] of Object.entries(u.scoreDelta ?? {})) scores[p] = (scores[p] ?? 0) + d;
    return u;
  };
  let update = apply(
    module.init(ctx(), {
      questionCount: module.meta.questionsPerRound.min,
      scoring: module.meta.scoring,
      excludeContentIds: [],
      options: normalizeCategoryOptions(module.meta, undefined),
      mode: DEFAULT_MODE_SETTINGS,
    }),
  );
  const log: { step: string | undefined; action?: string; instant?: boolean }[] = [];
  let guard = 0;
  while (!update.done) {
    if (++guard > 500) throw new Error(`${id}: never finished`);
    const state = update.state;
    const step = module.progress?.(state)?.step;
    const task = module.pendingTask?.(state);
    if (task) {
      const reply = opts.decoys === false ? null : { results: [], decoys: ["Ein erfundener Hut", "Eine Suppe aus Tirol", "Ein Tanz der Seeleute"] };
      // The judge reply for the player's text: "bluff", kept as written.
      const withResults =
        reply && task.input.user.includes('"id":"s1"') ? { ...reply, results: [{ id: "s1", verdict: "bluff", group: 1 }] } : reply;
      update = apply(module.resolveTask!(state, task.id, withResults, ctx())!);
      continue;
    }
    let acted = false;
    for (const p of ids) {
      const action = module.botAction?.(update.state, p, ctx(), bot);
      if (action == null) continue;
      now += 500;
      const r = module.handleAction(update.state, module.actionSchema.parse(action), p, ctx());
      if ("error" in r) throw new Error(`${id}: ${r.error} for ${JSON.stringify(action)} in ${step}`);
      update = apply(r);
      acted = true;
      const after = module.progress?.(update.state)?.step;
      log.push({ step, action: (action as { type: string }).type, instant: after !== step });
    }
    if (acted) continue;
    now = Math.max(now + 1, update.phaseEndsAt ?? now + 1);
    update = apply(module.onTimer(update.state, ctx()));
    log.push({ step });
  }
  return { log, scores };
}

describe("every game works with ONE player", () => {
  for (const id of Object.keys(GAME_MODULES)) {
    it(`${id}: start to end, every step the player acts in ends right away`, () => {
      for (const seed of [1, 2, 3]) {
        const { log } = playSolo(id, seed);
        const actions = log.filter((l) => l.action);
        expect(actions.length, id).toBeGreaterThan(0);
        // Once the only player acted, nobody else is waited for.
        for (const a of actions) expect(a.instant, `${id} ${a.step} ${a.action}`).toBe(true);
      }
    });
  }

  it("Punkteklau solo: nobody to steal from → +100 per right answer, 'Solo: kein Klau möglich'", async () => {
    const { stealModule } = await import("../src/steal/module");
    const random = seeded(4);
    let now = 0;
    const scores: Record<string, number> = { [ME]: 0 };
    const ctx = (): ModuleContext => ({ now, random, players: [{ id: ME, connected: true }], scores });
    let u = stealModule.init(ctx(), { questionCount: 4, scoring: stealModule.meta.scoring, excludeContentIds: [] });
    const seen: StealExtra["noHeist"][] = [];
    for (let q = 0; q < 4; q++) {
      const state = u.state as { questions: { correctIndex: number }[]; index: number };
      seen.push((stealModule.toPublicState(u.state, { role: "host" }).extra as StealExtra).noHeist);
      now += 1000;
      const r = stealModule.handleAction(u.state, { type: "answer", value: state.questions[state.index]!.correctIndex }, ME, ctx());
      if ("error" in r) throw new Error(r.error);
      expect(r.scoreDelta).toEqual({ [ME]: 100 });
      scores[ME] = (scores[ME] ?? 0) + 100;
      u = stealModule.onTimer(stealModule.onTimer(r.state, ctx()).state, ctx());
    }
    // Question 1: nobody leads yet; afterwards the only player leads → no heist possible.
    expect(seen).toEqual([null, "solo", "solo", "solo"]);
  });

  it("Punkteklau: two players tied at the top → nobody can steal either", async () => {
    const { stealGame } = await import("../src/steal/module");
    const players = [{ id: "a", connected: true }, { id: "b", connected: true }];
    const game = stealGame.startQuestion!(stealGame.init({ now: 0, random: Math.random, players }, { questionCount: 3, scoring: stealGame.meta.scoring, excludeContentIds: [] }, []).game, {
      index: 1,
      ctx: { now: 0, random: Math.random, players },
      scores: { a: 100, b: 100 },
    });
    expect(game).toMatchObject({ targetIds: [], noHeist: "tied" });
  });
});
