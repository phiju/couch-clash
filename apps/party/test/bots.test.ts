import { BOT_CONFIG, BOT_NAMES, type ScoringSettings } from "@couch-clash/shared";
import { CATEGORY_METAS, GAME_MODULES, normalizeScoring } from "@couch-clash/games";
import { describe, expect, it } from "vitest";
import { BotDriver } from "../src/bots";
import { advance, beginGame, handlePlayerAction, updateSettings, type FlowDeps } from "../src/game-flow";
import type { Result } from "../src/result";
import { addBot, botIds, claimSeat, createRoomRecord, joinPlayer, kickPlayer, toPublicState, type RoomRecord } from "../src/room-logic";
import { StatsRecorder } from "../src/stats/recorder";
import { ModuleTaskRunner } from "../src/tasks/runner";
import { sqliteStore } from "./stats-helpers";

const T0 = 1_700_000_000_000;
const avatar = { character: "fox", color: "red" } as const;

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

describe("test bots in the lobby", () => {
  it("normal players with a bot flag and names, at most 6, always connected, kickable", () => {
    let room = createRoomRecord("ABCD", "host-token-0123456789abcdef", T0);
    for (let i = 0; i < BOT_CONFIG.maxBots; i++) room = unwrap(addBot(room, { now: T0, random: () => 0.3 })).room;
    expect(room.players.map((p) => p.name)).toEqual([...BOT_NAMES]);
    expect(room.players.every((p) => p.bot)).toBe(true);
    expect(addBot(room, { now: T0 })).toEqual({ ok: false, error: "BOT_LIMIT" });
    const pub = toPublicState(room, { host: true, playerIds: new Set() }, { role: "host" });
    expect(pub.players.every((p) => p.bot && p.connected && p.online)).toBe(true);
    // A phone can't take over a bot's seat.
    const bot = room.players[0]!;
    expect(claimSeat(room, bot.id, botIds(room), { now: T0 })).toEqual({ ok: false, error: "SEAT_TAKEN" });
    room = unwrap(kickPlayer(room, bot.id));
    expect(room.players).toHaveLength(BOT_CONFIG.maxBots - 1);
    // The freed name is used again.
    expect(unwrap(addBot(room, { now: T0 })).player.name).toBe(BOT_NAMES[0]);
  });

  it("only in the lobby; a human with a bot's name keeps it free", () => {
    let room = createRoomRecord("ABCD", "host-token-0123456789abcdef", T0);
    room = unwrap(joinPlayer(room, { name: "Robo-Rudi", avatar }, { now: T0 })).room;
    expect(unwrap(addBot(room, { now: T0 })).player.name).toBe("Bot-Berta");
    expect(addBot({ ...room, phase: "play" }, { now: T0 })).toEqual({ ok: false, error: "WRONG_PHASE" });
  });
});

describe("bots play every game on their own and never block", () => {
  function harness(humans: string[], bots: number, seed = 5) {
    let room = createRoomRecord("ABCD", "host-token-0123456789abcdef", T0);
    const humanIds: string[] = [];
    for (const name of humans) {
      const r = unwrap(joinPlayer(room, { name, avatar }, { now: T0 }));
      room = r.room;
      humanIds.push(r.player.id);
    }
    for (let i = 0; i < bots; i++) room = unwrap(addBot(room, { now: T0 })).room;
    const random = seeded(seed);
    const rt = { room: room as RoomRecord | null, now: T0, tasks: [] as Promise<unknown>[], delays: [] as number[], waiting: [] as (() => void)[] };
    const { store, db } = sqliteStore();
    const deps = (): FlowDeps => ({ now: rt.now, random, connectedPlayerIds: new Set([...humanIds, ...botIds(rt.room!)]) });
    const commit = async (next: RoomRecord) => {
      const prev = rt.room;
      rt.room = next;
      stats.roomChanged(prev, next);
      tasks.roomChanged(next);
      driver.roomChanged(next);
    };
    const stats = new StatsRecorder({ read: () => rt.room, commit, store: () => store, waitUntil: (p) => rt.tasks.push(p), now: () => rt.now });
    const tasks = new ModuleTaskRunner({ read: () => rt.room, commit, waitUntil: (p) => rt.tasks.push(p), flowDeps: deps, model: () => null });
    const driver = new BotDriver({
      read: () => rt.room,
      commit,
      flowDeps: deps,
      waitUntil: (p) => rt.tasks.push(p),
      random,
      // Bots move only when the test lets time pass (settle).
      delay: (ms) =>
        new Promise<void>((resolve) => {
          rt.delays.push(ms);
          rt.waiting.push(resolve);
        }),
    });
    const settle = async () => {
      while (rt.tasks.length || rt.waiting.length) {
        for (const resolve of rt.waiting.splice(0)) resolve();
        await Promise.all(rt.tasks.splice(0));
      }
    };
    return { rt, humanIds, deps, commit, settle, db };
  }

  it("all games in one evening with 3 bots: every step moves on, bots act in each game", async () => {
    const t = harness([], 3);
    const rounds = CATEGORY_METAS.filter((m) => m.modes.includes("family")).map((m) => ({
      categoryId: m.id,
      questionCount: m.questionsPerRound.min,
      scoring: normalizeScoring(m, undefined) as ScoringSettings,
    }));
    await t.commit(unwrap(updateSettings(t.rt.room!, rounds)));
    await t.commit(unwrap(beginGame(t.rt.room!, t.deps())));
    const actedIn = new Set<string>();
    let steps = 0;
    while (t.rt.room!.phase !== "finale") {
      if (++steps > 2000) throw new Error(`stuck in ${t.rt.room!.phase}`);
      const before = JSON.stringify(t.rt.room!.game?.moduleState ?? null);
      await t.settle();
      const room = t.rt.room!;
      if (JSON.stringify(room.game?.moduleState ?? null) !== before && room.phase === "play") {
        actedIn.add(room.game!.rounds[room.game!.roundIndex]!.categoryId);
        continue;
      }
      // Nothing left to do for the bots: the step timer (or "Weiter").
      t.rt.now = Math.max(t.rt.now + 1, room.phaseEndsAt ?? t.rt.now + 1);
      await t.commit(unwrap(advance(room, t.deps())));
    }
    expect([...actedIn].sort()).toEqual(rounds.map((r) => r.categoryId).sort());
    expect(Math.min(...t.rt.delays)).toBeGreaterThanOrEqual(BOT_CONFIG.minDelayMs);
    expect(Math.max(...t.rt.delays)).toBeLessThanOrEqual(BOT_CONFIG.maxDelayMs);
    // Bot answers never reach the question statistics.
    await t.settle();
    const rows = t.db.prepare("SELECT SUM(answers) AS answers FROM question_stats").get() as { answers: number | null };
    expect(rows.answers ?? 0).toBe(0);
    const bots = [...botIds(t.rt.room!)];
    expect(bots.some((id) => (t.rt.room!.game!.scores[id] ?? 0) > 0)).toBe(true);
  });

  it("with a human: the question waits for the human only, their answer is counted in the stats", async () => {
    const t = harness(["Anna"], 2);
    await t.commit(unwrap(updateSettings(t.rt.room!, [{ categoryId: "quiz", questionCount: 3, scoring: GAME_MODULES.quiz.meta.scoring }])));
    await t.commit(unwrap(beginGame(t.rt.room!, t.deps())));
    await t.commit(unwrap(advance(t.rt.room!, t.deps()))); // intro → question
    await t.settle();
    const state = t.rt.room!.game!.moduleState as { step: string; answers: Record<string, unknown> };
    expect(state.step).toBe("question");
    expect(Object.keys(state.answers).sort()).toEqual([...botIds(t.rt.room!)].sort());
    t.rt.now += 1000;
    await t.commit(unwrap(handlePlayerAction(t.rt.room!, t.humanIds[0]!, { type: "answer", value: 0 }, t.deps())));
    expect((t.rt.room!.game!.moduleState as { step: string }).step).toBe("reveal");
    await t.settle();
    const row = t.db.prepare("SELECT plays, answers FROM question_stats").get() as { plays: number; answers: number };
    expect(row).toEqual({ plays: 1, answers: 1 });
  });
});
